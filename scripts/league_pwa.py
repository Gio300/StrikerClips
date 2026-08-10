#!/usr/bin/env python3
"""
league_pwa.py — brand a built app bundle (dist/) as a LEAGUE's own PWA.

WHY (operator 2026-08-03): installing the app from a league's domain
(e.g. shinobistrikerleague.com, the SSL Amplify deploy) must put the LEAGUE's
name and logo on the home screen — not TKO's. The web app already re-skins at
runtime via the domain takeover (src/lib/leagueDomain.ts), but the PWA
manifest is static, so the installed-app identity has to be stamped at
build/deploy time. This is also the seed of per-league app-store builds: the
same name/icon inputs feed a store listing when a league graduates to a
wrapped build.

WHY THE SOCIAL META TOO (operator 2026-08-04): sharing a league link showed
**TKO.cam's** preview card. Same root cause one layer up — the runtime
takeover is JavaScript, and no crawler (Slack, Discord, iMessage, X,
Facebook) executes it. Whatever is in the STATIC `<head>` of the shipped
index.html *is* the link preview, forever. So the league's title/description/
Open Graph/Twitter tags — including a real 1200x630 card rendered from the
league's own logo — are stamped here as well.

WHAT it does to an existing dist/ (run AFTER `vite build`):
  1. Regenerates every icons/*.png from the league logo
     (public/leagues/<slug>.png) on the stock app dark (#0A0A0C), sized for
     both `any` and `maskable` purposes (logo fits the maskable safe zone).
  2. Renders dist/leagues/<slug>-og.png — a 1200x630 social preview card:
     the league mark (alpha-trimmed, contained) on the stock dark with a soft
     glow in the mark's own dominant hue, plus the league name and/or tagline
     beneath when they fit legibly.
  3. Overwrites dist/manifest.json with the league identity (name/short_name,
     description, stock-dark theme/background — league bundles keep the stock
     dark chrome; only brand hues re-skin at runtime).
  4. Rewrites the static <head> of dist/index.html for the league: a
     content-versioned manifest href (so a browser cannot reuse the former TKO
     manifest URL), <title>, apple-mobile-web-app-title, description,
     og:title/description/type/url/site_name/image(+secure_url/type/alt/width/
     height), and twitter:card/title/description/image/image:alt. Missing meta
     tags are inserted, so this survives template changes.
  5. Optionally zips dist/ for an Amplify manual deploy (--zip). Always uses
     forward-slash arcnames — Windows backslash zip entries break Amplify.

It never touches the source index.html, so tko.cam's own previews stay TKO's.

USAGE (the SSL Amplify bundle):
  set VITE_REAL_BACKEND=1& set VITE_API_BASE=https://tko.cam& set VITE_BASE_PATH=& npm run build
  python scripts/league_pwa.py --slug shinobistrikerleague ^
      --name "Shinobi Striker League" --domain shinobistrikerleague.com ^
      --tagline "rise. strike. reign." --no-card-name ^
      --zip ssl-deploy7.zip

FUTURE LEAGUES: drop the logo at public/leagues/<slug>.png (same asset the
watermark/BrandLogo use — src/components/LeagueWatermark.tsx LEAGUE_MARKS),
then run this with their --slug/--name/--domain. Nothing else to wire. Use
--no-card-name when the logo is a full lockup that already spells the league
name (repeating it under the mark just reads as a typo); leave it off for
mark-only logos so the card still says who it is.

--pwa-icons: THE SHARED-BUNDLE MODE (operator 2026-08-06). Everything above
stamps ONE bundle as ONE league, which is right for a league with its own
Amplify deploy and wrong for the Cloud Run service that serves tko.cam AND
every league domain from a single dist/. There the manifest is built per
REQUEST instead (server/app.ts GET /manifest.json + src/lib/pwaManifest.ts),
so each league needs its own icons living alongside everyone else's rather
than overwriting dist/icons/. This mode writes exactly that set —

  public/leagues/<slug>/icon-180.png   (iOS apple-touch-icon)
  public/leagues/<slug>/icon-192.png
  public/leagues/<slug>/icon-512.png

— from the same logo, through the same make_icon() (stock dark plate, logo at
the maskable safe scale), and touches nothing else. It needs no dist/, so it
runs before a build. After running it, add the slug to LEAGUE_PWA_ICON_DIRS in
src/lib/pwaManifest.ts — that map is what stops the manifest ever naming an
icon that isn't there.

  python scripts/league_pwa.py --pwa-icons --slug shinobistrikerleague
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# Stock app dark (index.site.html / manifest theme color family).
STOCK_DARK = (10, 10, 12, 255)  # #0A0A0C

# Every icon the stock bundle ships (public/icons/*) gets a league version so
# no TKO mark leaks into a league install surface.
ICON_SIZES = {
    "icons/favicon-16.png": 16,
    "icons/favicon-32.png": 32,
    "icons/favicon-48.png": 48,
    "icons/apple-touch-icon.png": 180,
    "icons/icon-192.png": 192,
    "icons/icon-512.png": 512,
    "icons/icon-1024.png": 1024,
}

# Logo fills ~78% of the canvas: inside the maskable safe zone (80% circle)
# while still reading large for `any` purpose.
LOGO_SCALE = 0.78

# 192/512 are what the per-request manifest names (src/lib/pwaManifest.ts
# manifestIconsIn) — one file per size, used for both `any` and `maskable`,
# exactly like the stock TKO manifest. 180 is the apple-touch-icon: iOS's "Add
# to Home Screen" reads that <link> and ignores the manifest's icons entirely,
# so without it an iPhone install of a league would still wear TKO's mark.
BUNDLE_ICON_SIZES = (180, 192, 512)

# ───────────────────────────────────────────────────────────────────────────
#  Social preview card (Open Graph / Twitter summary_large_image)
# ───────────────────────────────────────────────────────────────────────────

CARD_W, CARD_H = 1200, 630  # the size every scraper crops to; do not change
CARD_PAD = 46
CARD_NAME_SIZE = 62
CARD_NAME_MIN = 34  # below this the name is illegible in a feed → drop it
CARD_TAGLINE_SIZE = 30
CARD_TAGLINE_MIN = 22
CARD_TEXT_GAP = 24  # mark → text block
CARD_LINE_GAP = 12  # name → tagline
CARD_MIN_LOGO_H = 180  # never squeeze the mark below this to fit text

OFF_WHITE = (240, 242, 245, 255)
MUTED = (152, 158, 170, 255)
GLOW_ALPHA = 58  # peak alpha of the accent wash over the stock dark

FONT_BOLD_CANDIDATES = (
    r"C:\Windows\Fonts\segoeuib.ttf",
    r"C:\Windows\Fonts\arialbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
)
FONT_REGULAR_CANDIDATES = (
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
)


def load_font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    """First installed face that opens. Falls back to PIL's bitmap default
    (tiny, but the caller's legibility check then drops the text rather than
    stamping something unreadable onto the card)."""
    for path in FONT_BOLD_CANDIDATES if bold else FONT_REGULAR_CANDIDATES:
        try:
            return ImageFont.truetype(path, max(8, size))
        except OSError:
            continue
    return ImageFont.load_default()


def make_icon(logo: Image.Image, size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), STOCK_DARK)
    target = int(size * LOGO_SCALE)
    ratio = min(target / logo.width, target / logo.height)
    w = max(1, round(logo.width * ratio))
    h = max(1, round(logo.height * ratio))
    resized = logo.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(resized, ((size - w) // 2, (size - h) // 2))
    return canvas


def accent_from_logo(logo: Image.Image) -> tuple[int, int, int]:
    """The mark's own dominant saturated colour, for the card's glow — so the
    card feels like the league instead of a generic dark rectangle. Falls back
    to a cool slate when the logo is greyscale."""
    small = logo.resize((72, 72), Image.LANCZOS)
    scored: list[tuple[float, tuple[int, int, int]]] = []
    for r, g, b, a in small.getdata():
        if a < 160:
            continue
        hi, lo = max(r, g, b), min(r, g, b)
        if hi < 64:
            continue
        sat = (hi - lo) / hi
        if sat < 0.35:
            continue
        scored.append((sat * hi, (r, g, b)))
    if not scored:
        return (86, 104, 132)
    scored.sort(key=lambda s: s[0], reverse=True)
    top = scored[: max(1, len(scored) // 4)]
    return tuple(round(sum(c[i] for _, c in top) / len(top)) for i in range(3))  # type: ignore[return-value]


def glow_mask(width: int, height: int, *, cx: float = 0.5, cy: float = 0.42) -> Image.Image:
    """Soft elliptical falloff, computed small and upscaled (fast + smooth)."""
    sw, sh = 120, 63
    mask = Image.new("L", (sw, sh), 0)
    px = mask.load()
    for y in range(sh):
        dy = (y / (sh - 1) - cy) * 1.45  # squash: the wash is wider than tall
        for x in range(sw):
            dx = x / (sw - 1) - cx
            d = math.hypot(dx, dy)
            v = max(0.0, 1.0 - d / 0.78)
            px[x, y] = int(GLOW_ALPHA * v * v)
    return mask.resize((width, height), Image.BICUBIC)


def trim_alpha(img: Image.Image, threshold: int = 16) -> Image.Image:
    """Crop to the mark itself. A plain getbbox() keeps the near-invisible
    outer glow most league logos carry (SSL's is ~24% of the canvas), which
    would size the artwork small and leave a dead gap under it."""
    mask = img.getchannel("A").point(lambda v: 255 if v > threshold else 0)
    return img.crop(mask.getbbox() or img.getbbox() or (0, 0, img.width, img.height))


def fit_text(
    draw: ImageDraw.ImageDraw, text: str, max_width: int, start: int, minimum: int, *, bold: bool
) -> tuple[ImageFont.FreeTypeFont, int] | None:
    """Largest size in [minimum, start] whose rendering fits max_width, or None
    when even `minimum` overflows (→ caller drops the line)."""
    for size in range(start, minimum - 1, -2):
        font = load_font(size, bold=bold)
        if draw.textlength(text, font=font) <= max_width:
            return font, size
    return None


def make_og_card(
    logo: Image.Image, name: str, tagline: str | None, *, draw_name: bool = True
) -> Image.Image:
    """1200x630 link-preview card: the league mark on the stock dark, over a
    wash in the mark's own hue, with the name/tagline beneath when legible."""
    card = Image.new("RGBA", (CARD_W, CARD_H), STOCK_DARK)
    accent = accent_from_logo(logo)
    card.paste(Image.new("RGB", (CARD_W, CARD_H), accent), (0, 0), glow_mask(CARD_W, CARD_H))
    draw = ImageDraw.Draw(card)

    # Trim the logo's transparent margin so the mark itself — not its
    # packaging — is what gets sized to the card.
    mark = trim_alpha(logo)

    inner_w = CARD_W - 2 * CARD_PAD
    lines: list[tuple[str, ImageFont.FreeTypeFont, tuple[int, int, int, int], int]] = []
    if draw_name and name.strip():
        fitted = fit_text(draw, name, inner_w, CARD_NAME_SIZE, CARD_NAME_MIN, bold=True)
        if fitted:
            lines.append((name, fitted[0], OFF_WHITE, fitted[1]))
    if tagline and tagline.strip():
        fitted = fit_text(draw, tagline, inner_w, CARD_TAGLINE_SIZE, CARD_TAGLINE_MIN, bold=False)
        if fitted:
            lines.append((tagline, fitted[0], MUTED, fitted[1]))

    def block_height(items) -> int:
        if not items:
            return 0
        return sum(round(s * 1.28) for *_, s in items) + CARD_LINE_GAP * (len(items) - 1)

    # Legibility guard: the mark always wins. Drop trailing text lines rather
    # than shrink the logo past CARD_MIN_LOGO_H.
    while lines and CARD_H - 2 * CARD_PAD - block_height(lines) - CARD_TEXT_GAP < CARD_MIN_LOGO_H:
        lines.pop()

    text_h = block_height(lines)
    gap = CARD_TEXT_GAP if lines else 0
    logo_area = CARD_H - 2 * CARD_PAD - text_h - gap
    ratio = min(inner_w / mark.width, logo_area / mark.height)
    w = max(1, round(mark.width * ratio))
    h = max(1, round(mark.height * ratio))
    # Centre mark+text as ONE block: centring the mark inside its own reserved
    # area instead leaves a visible hole between it and the text.
    top = (CARD_H - (h + gap + text_h)) // 2
    card.alpha_composite(mark.resize((w, h), Image.LANCZOS), ((CARD_W - w) // 2, top))

    y = top + h + gap
    for text, font, fill, size in lines:
        draw.text((CARD_W // 2, y), text, font=font, fill=fill, anchor="ma")
        y += round(size * 1.28) + CARD_LINE_GAP

    return card.convert("RGB")  # scrapers prefer opaque cards


# ───────────────────────────────────────────────────────────────────────────
#  Manifest + <head>
# ───────────────────────────────────────────────────────────────────────────


def league_manifest(slug: str, name: str, description: str) -> dict:
    return {
        "$comment": (
            "League-branded manifest generated by scripts/league_pwa.py for "
            f"'{slug}' — do not edit by hand; re-run the script instead."
        ),
        # League bundles are served at THEIR domain's root; the id is
        # origin-scoped so it can never collide with tko.cam's '/app/' id.
        "id": "/",
        "name": name,
        "short_name": name,
        "description": description,
        "lang": "en",
        "dir": "ltr",
        "start_url": ".",
        "scope": ".",
        "display": "standalone",
        "display_override": ["standalone", "minimal-ui", "browser"],
        "orientation": "any",
        "background_color": "#0A0A0C",
        "theme_color": "#0A0A0C",
        "categories": ["entertainment", "sports", "games"],
        "icons": [
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
            {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"},
        ],
    }


def esc(value: str) -> str:
    return value.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")


def set_meta(html: str, attr: str, key: str, content: str) -> str:
    """Rewrite <meta {attr}="{key}" content="…">, inserting it before </head>
    when the template doesn't carry it. Crawlers read the FIRST match, so a
    missing tag must be added rather than silently skipped."""
    pattern = rf'(<meta\s+{attr}="{re.escape(key)}"\s+content=")[^"]*(")'
    out, n = re.subn(pattern, lambda m: m.group(1) + esc(content) + m.group(2), html, count=1)
    if n:
        return out
    close = re.search(r"([ \t]*)</head>", out)
    if not close:
        print(f"  ! index.html: no </head>, could not add {attr}={key}")
        return out
    indent = close.group(1)
    tag = f'{indent}  <meta {attr}="{esc(key)}" content="{esc(content)}" />\n'
    return out[: close.start()] + tag + out[close.start() :]


def set_manifest_href(html: str, href: str) -> str:
    """Point the one PWA manifest link at a content-versioned URL.

    Chromium may keep the manifest it read earlier in the tab even after the
    origin and CDN have the re-branded bytes. A new URL makes the new league
    identity observable immediately after the page itself refreshes.
    """
    pattern = r'(<link\b(?=[^>]*\brel=["\']manifest["\'])[^>]*\bhref=)(["\'])[^"\']*\2'
    out, n = re.subn(
        pattern,
        lambda m: f"{m.group(1)}{m.group(2)}{esc(href)}{m.group(2)}",
        html,
        count=1,
        flags=re.IGNORECASE,
    )
    if not n:
        raise ValueError("index.html: no <link rel=\"manifest\"> to version")
    return out


def patch_index_html(
    index_path: Path,
    *,
    manifest_href: str,
    name: str,
    title: str,
    description: str,
    site_url: str,
    image_url: str,
    image_alt: str,
) -> None:
    """Stamp the league's identity into the STATIC head. Everything a link
    preview shows comes from here — the runtime takeover is invisible to
    crawlers."""
    html = index_path.read_text(encoding="utf-8")
    html = set_manifest_href(html, manifest_href)

    html, n = re.subn(r"<title>.*?</title>", lambda _m: f"<title>{esc(title)}</title>", html, count=1)
    if not n:
        print("  ! index.html: no <title>, skipped")

    html = set_meta(html, "name", "apple-mobile-web-app-title", name)
    html = set_meta(html, "name", "description", description)

    html = set_meta(html, "property", "og:title", title)
    html = set_meta(html, "property", "og:description", description)
    html = set_meta(html, "property", "og:type", "website")
    html = set_meta(html, "property", "og:url", site_url)
    html = set_meta(html, "property", "og:site_name", name)
    html = set_meta(html, "property", "og:image", image_url)
    html = set_meta(html, "property", "og:image:secure_url", image_url)
    html = set_meta(html, "property", "og:image:type", "image/png")
    html = set_meta(html, "property", "og:image:alt", image_alt)
    html = set_meta(html, "property", "og:image:width", str(CARD_W))
    html = set_meta(html, "property", "og:image:height", str(CARD_H))

    html = set_meta(html, "name", "twitter:card", "summary_large_image")
    html = set_meta(html, "name", "twitter:title", title)
    html = set_meta(html, "name", "twitter:description", description)
    html = set_meta(html, "name", "twitter:image", image_url)
    html = set_meta(html, "name", "twitter:image:alt", image_alt)

    index_path.write_text(html, encoding="utf-8")


def zip_dist(dist: Path, zip_path: Path) -> int:
    """Zip dist/ contents at the archive ROOT with forward-slash arcnames
    (Amplify rejects backslash entries, and wants index.html at the root).

    customHttp.yml rides along from the REPO ROOT because `vite build` does not
    copy it (it is not in public/), and Amplify only reads it from the artifact
    root. Without it the deploy inherits the default
    `s-maxage=31536000` -- a ONE YEAR edge cache on manifest.json and the icons.
    That is not theoretical: on 2026-08-08 a league's install prompt still said
    "TKO" on a real phone while every check from the build machine said the
    manifest was correct. Both were true -- the origin had the re-brand, the
    edge that phone reached did not, and would not for a year.
    """
    count = 0
    headers = Path(__file__).resolve().parents[1] / "customHttp.yml"
    if headers.exists():
        target = dist / "customHttp.yml"
        if not target.exists() or target.read_bytes() != headers.read_bytes():
            target.write_bytes(headers.read_bytes())
        print("  included customHttp.yml (CDN cache rules for identity files)")
    else:
        raise FileNotFoundError(
            "customHttp.yml is required for an Amplify deploy; without it "
            "manifest.json and /icons/ inherit a one-year edge cache"
        )
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(dist.rglob("*")):
            if f.is_file():
                arc = f.relative_to(dist).as_posix()
                zf.write(f, arc)
                count += 1
    return count


def main() -> int:
    # This file (and --help, which prints the docstring) is full of em dashes;
    # a Windows console defaults to cp1252 and would die on them mid-run.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # type: ignore[union-attr]
    except (AttributeError, OSError):
        pass

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--slug", required=True, help="league slug (leagues.slug)")
    ap.add_argument("--name", help='display name, e.g. "Shinobi Striker League"')
    ap.add_argument(
        "--domain",
        help="the league's domain, e.g. shinobistrikerleague.com — og:url and the "
        "og:image URL must be ABSOLUTE or scrapers ignore them",
    )
    ap.add_argument(
        "--pwa-icons",
        dest="pwa_icons",
        action="store_true",
        help="SHARED-BUNDLE MODE: write only public/leagues/<slug>/icon-{180,192,512}.png "
        "for the per-request manifest, then stop. Needs no dist/, --name or --domain.",
    )
    ap.add_argument("--tagline", default=None, help="optional tagline for title/description/card")
    ap.add_argument("--description", default=None, help="link-preview description (default: derived)")
    ap.add_argument("--dist", default="dist", help="built bundle dir (default dist)")
    ap.add_argument("--logo", default=None, help="logo PNG (default public/leagues/<slug>.png)")
    ap.add_argument(
        "--no-card-name",
        dest="card_name",
        action="store_false",
        help="don't print the league name on the preview card (use when the logo "
        "is a lockup that already spells it)",
    )
    ap.add_argument("--zip", dest="zip_path", default=None, help="also zip dist/ for Amplify manual deploy")
    args = ap.parse_args()

    root = Path(__file__).resolve().parent.parent
    dist = (root / args.dist).resolve()
    logo_path = Path(args.logo) if args.logo else root / "public" / "leagues" / f"{args.slug}.png"

    if not logo_path.is_file():
        print(f"error: league logo not found: {logo_path}")
        return 1

    # SHARED-BUNDLE MODE — icons only, into public/, no dist/ required. Kept
    # ahead of every dist check so it can run before the first build.
    if args.pwa_icons:
        out_dir = root / "public" / "leagues" / args.slug
        out_dir.mkdir(parents=True, exist_ok=True)
        # Trim the near-invisible outer glow first, for the reason trim_alpha's
        # docstring already gives (SSL's is ~24% of its canvas): untrimmed, the
        # mark lands small inside a mostly-empty plate, which is exactly what a
        # home-screen icon cannot afford. The stamped-bundle path above stays
        # untrimmed on purpose — leagues already have those icons installed.
        logo = trim_alpha(Image.open(logo_path).convert("RGBA"))
        print(f"league_pwa: per-league PWA icons for '{args.slug}' <- {logo_path.name}")
        for size in BUNDLE_ICON_SIZES:
            out = out_dir / f"icon-{size}.png"
            make_icon(logo, size).save(out, format="PNG", optimize=True)
            print(f"  wrote {out.relative_to(root).as_posix()} ({size}x{size})")
        print(
            "  next: add "
            f"{args.slug}: 'leagues/{args.slug}' to LEAGUE_PWA_ICON_DIRS "
            "in src/lib/pwaManifest.ts"
        )
        return 0

    missing = [f"--{f}" for f in ("name", "domain") if not getattr(args, f)]
    if missing:
        print(f"error: {', '.join(missing)} is required (or pass --pwa-icons)")
        return 1

    if not dist.is_dir() or not (dist / "index.html").is_file():
        print(f"error: {dist} is not a built bundle (run `vite build` first)")
        return 1

    logo = Image.open(logo_path).convert("RGBA")
    domain = args.domain.strip().rstrip("/").removeprefix("https://").removeprefix("http://")
    site_url = f"https://{domain}/"
    title = f"{args.name} — {args.tagline}" if args.tagline else args.name
    lead = f"{args.name} — {args.tagline}" if args.tagline else args.name
    description = args.description or (
        f"{lead} Live multi-angle matches, tournaments, standings, and highlight reels."
    )

    print(f"league_pwa: branding {dist} as '{args.name}' ({args.slug}) @ {domain}")
    for rel, size in ICON_SIZES.items():
        out = dist / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        make_icon(logo, size).save(out, format="PNG", optimize=True)
        print(f"  wrote {rel} ({size}x{size})")

    card_rel = f"leagues/{args.slug}-og.png"
    card_path = dist / card_rel
    card_path.parent.mkdir(parents=True, exist_ok=True)
    make_og_card(logo, args.name, args.tagline, draw_name=args.card_name).save(
        card_path, format="PNG", optimize=True
    )
    # Content hash busts the scrapers' image cache exactly when the card
    # changes, and never otherwise.
    stamp = hashlib.sha1(card_path.read_bytes()).hexdigest()[:8]
    image_url = f"{site_url}{card_rel}?v={stamp}"
    print(f"  wrote {card_rel} ({CARD_W}x{CARD_H}, v={stamp})")

    manifest_path = dist / "manifest.json"
    manifest_text = json.dumps(
        league_manifest(args.slug, args.name, description), indent=2
    ) + "\n"
    manifest_path.write_text(manifest_text, encoding="utf-8")
    manifest_stamp = hashlib.sha1(manifest_text.encode("utf-8")).hexdigest()[:8]
    manifest_href = f"/manifest.json?v={manifest_stamp}"
    print(f"  wrote manifest.json (v={manifest_stamp})")

    # The site manifest never ships in league bundles (dist has no
    # manifest.site.json — that belongs to dist-site), so nothing else to do.
    patch_index_html(
        dist / "index.html",
        manifest_href=manifest_href,
        name=args.name,
        title=title,
        description=description,
        site_url=site_url,
        image_url=image_url,
        image_alt=f"{args.name} logo",
    )
    print(f"  patched index.html (title + og/twitter -> {domain})")

    if args.zip_path:
        zip_path = (root / args.zip_path).resolve()
        n = zip_dist(dist, zip_path)
        print(f"  zipped {n} files -> {zip_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
