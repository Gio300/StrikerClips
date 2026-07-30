"""Generate every raster TKO brand asset from one code-native mark.

Run from the repository root:
    py scripts/generate_tko_brand_assets.py
"""

from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_ICONS = ROOT / "public" / "icons"
PUBLIC_BRAND = ROOT / "public" / "brand"
EXPORTS = ROOT / "brand" / "exports"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
DESKTOP_EXPORTS = Path.home() / "Desktop" / "TKO Branding"

DARK = "#08090B"
DARK_RAISED = "#101216"
OFF_WHITE = "#F7F7F8"
MUTED = "#A7ABB4"
CORAL = "#FF5B3D"
CYAN = "#2ED3DC"
BLUE = "#627DFF"

FONT_BOLD = Path(r"C:\Windows\Fonts\segoeuib.ttf")
FONT_REGULAR = Path(r"C:\Windows\Fonts\segoeui.ttf")


def font(size: int, *, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONT_BOLD if bold else FONT_REGULAR), max(8, size))


def rounded_line(
    draw: ImageDraw.ImageDraw,
    points: list[tuple[float, float]],
    fill: str | tuple[int, int, int, int],
    width: int,
) -> None:
    draw.line(points, fill=fill, width=width, joint="curve")
    radius = width / 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=fill)


def draw_mark(
    image: Image.Image,
    box: tuple[float, float, float, float],
    *,
    frame_color: str | tuple[int, int, int, int] = OFF_WHITE,
) -> None:
    x0, y0, x1, y1 = box
    size = min(x1 - x0, y1 - y0)
    x0 += ((x1 - x0) - size) / 2
    y0 += ((y1 - y0) - size) / 2
    draw = ImageDraw.Draw(image)
    sx = lambda value: x0 + size * value / 40
    sy = lambda value: y0 + size * value / 40
    stroke = max(2, round(size * 2.5 / 40))

    corners = [
        [(sx(4), sy(13)), (sx(4), sy(6)), (sx(11), sy(6))],
        [(sx(29), sy(6)), (sx(36), sy(6)), (sx(36), sy(13))],
        [(sx(36), sy(27)), (sx(36), sy(34)), (sx(29), sy(34))],
        [(sx(11), sy(34)), (sx(4), sy(34)), (sx(4), sy(27))],
    ]
    for segment in corners:
        rounded_line(draw, segment, frame_color, stroke)

    draw.ellipse((sx(10), sy(10), sx(30), sy(30)), fill=CORAL)
    draw.polygon(
        [(sx(17), sy(14.8)), (sx(26), sy(20)), (sx(17), sy(25.2))],
        fill=OFF_WHITE,
    )
    rounded_line(draw, [(sx(8), sy(37)), (sx(32), sy(37))], CYAN, stroke)


def draw_wordmark(
    image: Image.Image,
    origin: tuple[int, int],
    size: int,
    *,
    include_domain: bool = True,
) -> tuple[int, int]:
    draw = ImageDraw.Draw(image)
    x, y = origin
    face = font(size, bold=True)
    first = "TKO"
    second = ".cam" if include_domain else ""
    draw.text((x, y), first, fill=OFF_WHITE, font=face, anchor="la")
    first_box = draw.textbbox((x, y), first, font=face, anchor="la")
    first_width = first_box[2] - first_box[0]
    if second:
        draw.text((x + first_width, y), second, fill=CORAL, font=face, anchor="la")
    full_box = draw.textbbox((x, y), first + second, font=face, anchor="la")
    return full_box[2] - full_box[0], full_box[3] - full_box[1]


def square_icon(size: int, *, round_mask: bool = False, transparent: bool = False) -> Image.Image:
    mode = "RGBA"
    background = (0, 0, 0, 0) if transparent or round_mask else DARK
    image = Image.new(mode, (size, size), background)
    if round_mask:
        ImageDraw.Draw(image).ellipse((0, 0, size - 1, size - 1), fill=DARK)

    mark_size = size * (0.66 if transparent else 0.58)
    inset = (size - mark_size) / 2
    draw_mark(image, (inset, inset, size - inset, size - inset))
    return image


def transparent_lockup(width: int, height: int) -> Image.Image:
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mark_size = min(height * 0.78, width * 0.30)
    mark_x = width * 0.04
    mark_y = (height - mark_size) / 2
    draw_mark(image, (mark_x, mark_y, mark_x + mark_size, mark_y + mark_size))
    text_size = round(height * 0.32)
    draw_wordmark(image, (round(mark_x + mark_size + height * 0.08), height // 2), text_size)
    return image


def add_background_texture(image: Image.Image) -> None:
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size

    # Quiet broadcast-grid texture.
    grid = max(48, width // 34)
    for x in range(0, width + grid, grid):
        draw.line((x, 0, x, height), fill=(255, 255, 255, 10), width=1)
    for y in range(0, height + grid, grid):
        draw.line((0, y, width, y), fill=(255, 255, 255, 8), width=1)

    # Multi-angle frame outlines, deliberately outside the YouTube safe area.
    frame_color = (255, 255, 255, 22)
    accent_coral = (255, 91, 61, 90)
    accent_cyan = (46, 211, 220, 90)
    left_frames = [(70, 170, 440, 390), (125, 430, 445, 620), (50, 830, 430, 1060)]
    right_frames = [
        (width - 445, 130, width - 70, 350),
        (width - 430, 410, width - 85, 610),
        (width - 460, 850, width - 60, 1085),
    ]
    for index, rect in enumerate(left_frames + right_frames):
        draw.rounded_rectangle(rect, radius=18, outline=frame_color, width=3)
        line_color = accent_cyan if index % 2 else accent_coral
        draw.line((rect[0] + 24, rect[3] - 30, rect[2] - 24, rect[3] - 30), fill=line_color, width=5)

    # Restrained diagonal energy bands.
    for offset, color in ((0, (255, 91, 61, 38)), (46, (46, 211, 220, 30))):
        points = [
            (-100, height * 0.70 + offset),
            (width * 0.38, height * 0.42 + offset),
            (width + 100, height * 0.56 + offset),
        ]
        draw.line(points, fill=color, width=max(5, width // 180), joint="curve")


def youtube_banner() -> Image.Image:
    width, height = 2560, 1440
    image = Image.new("RGB", (width, height), DARK)
    add_background_texture(image)

    # All essential content stays inside YouTube's centered 1546x423 safe area.
    mark_size = 300
    mark_x = 575
    mark_y = (height - mark_size) // 2
    draw_mark(image, (mark_x, mark_y, mark_x + mark_size, mark_y + mark_size))
    text_x = mark_x + mark_size + 76
    draw_wordmark(image, (text_x, height // 2 - 88), 150)

    draw = ImageDraw.Draw(image)
    draw.text(
        (text_x + 4, height // 2 + 82),
        "EVERY ANGLE OF THE KNOCKOUT. ONE CAM.",
        fill=OFF_WHITE,
        font=font(37, bold=True),
        anchor="la",
    )
    draw.text(
        (text_x + 4, height // 2 + 136),
        "CLIPS  |  LIVE  |  TOURNAMENTS  |  CLANS",
        fill=MUTED,
        font=font(27),
        anchor="la",
    )
    return image


def youtube_profile() -> Image.Image:
    image = Image.new("RGB", (800, 800), DARK)
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle((44, 44, 756, 756), radius=170, outline=(255, 255, 255, 22), width=3)
    draw_mark(image, (142, 92, 658, 608))
    face = font(92, bold=True)
    text_box = draw.textbbox((0, 0), "TKO.cam", font=face)
    width = text_box[2] - text_box[0]
    draw_wordmark(image, ((800 - width) // 2, 628), 92)
    return image


def social_card() -> Image.Image:
    width, height = 1200, 630
    image = Image.new("RGB", (width, height), DARK)
    add_background_texture(image)
    draw_mark(image, (92, 120, 382, 410))
    draw_wordmark(image, (438, 226), 116)
    draw = ImageDraw.Draw(image)
    draw.text(
        (442, 356),
        "Every angle of the knockout. One cam.",
        fill=OFF_WHITE,
        font=font(34, bold=True),
    )
    draw.text(
        (442, 410),
        "Multi-angle clips, live events, tournaments, and clans.",
        fill=MUTED,
        font=font(25),
    )
    return image


def video_outro() -> Image.Image:
    width, height = 1920, 1080
    image = Image.new("RGB", (width, height), DARK)
    add_background_texture(image)
    draw_mark(image, (700, 150, 1220, 670))
    draw = ImageDraw.Draw(image)
    face = font(132, bold=True)
    text_box = draw.textbbox((0, 0), "TKO.cam", font=face)
    draw_wordmark(image, ((width - (text_box[2] - text_box[0])) // 2, 770), 132)
    draw.text(
        (width // 2, 930),
        "EVERY ANGLE OF THE KNOCKOUT. ONE CAM.",
        fill=OFF_WHITE,
        font=font(36, bold=True),
        anchor="ma",
    )
    draw.text((width // 2, 990), "TKO.cam", fill=MUTED, font=font(26), anchor="ma")
    return image


def splash(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), DARK)
    draw = ImageDraw.Draw(image, "RGBA")
    shortest = min(width, height)
    mark_size = shortest * (0.40 if height >= width else 0.32)
    center_x = width / 2
    center_y = height / 2 - mark_size * 0.14
    draw_mark(
        image,
        (
            center_x - mark_size / 2,
            center_y - mark_size / 2,
            center_x + mark_size / 2,
            center_y + mark_size / 2,
        ),
    )
    word_size = max(18, round(shortest * 0.095))
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    face = font(word_size, bold=True)
    text_box = measure.textbbox((0, 0), "TKO.cam", font=face)
    text_width = text_box[2] - text_box[0]
    draw_wordmark(
        image,
        (round(center_x - text_width / 2), round(center_y + mark_size * 0.58)),
        word_size,
    )
    if shortest >= 480:
        draw.text(
            (center_x, center_y + mark_size * 0.88),
            "EVERY ANGLE. ONE CAM.",
            fill=(167, 171, 180, 220),
            font=font(max(11, round(shortest * 0.025)), bold=True),
            anchor="ma",
        )
    return image


def save(image: Image.Image, path: Path, **kwargs: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True, **kwargs)


def generate_public_assets() -> None:
    PUBLIC_ICONS.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 192, 512, 1024):
        name = f"favicon-{size}.png" if size <= 48 else f"icon-{size}.png"
        save(square_icon(size), PUBLIC_ICONS / name)
    save(square_icon(180), PUBLIC_ICONS / "apple-touch-icon.png")

    PUBLIC_BRAND.mkdir(parents=True, exist_ok=True)
    save(square_icon(512, transparent=True), PUBLIC_BRAND / "tko-video-watermark.png")
    save(transparent_lockup(2048, 640), PUBLIC_BRAND / "tko-logo-transparent.png")
    save(social_card(), PUBLIC_BRAND / "tko-social-card.png")
    save(video_outro(), PUBLIC_BRAND / "tko-video-outro.png")


def generate_android_assets() -> None:
    for directory in ANDROID_RES.glob("mipmap-*"):
        if not directory.is_dir() or directory.name == "mipmap-anydpi-v26":
            continue
        for filename in (
            "ic_launcher.png",
            "ic_launcher_round.png",
            "ic_launcher_foreground.png",
            "ic_launcher_background.png",
        ):
            path = directory / filename
            if not path.exists():
                continue
            with Image.open(path) as current:
                width, height = current.size
            size = min(width, height)
            if filename == "ic_launcher_foreground.png":
                image = square_icon(size, transparent=True)
            elif filename == "ic_launcher_background.png":
                image = Image.new("RGBA", (size, size), DARK)
            elif filename == "ic_launcher_round.png":
                image = square_icon(size, round_mask=True)
            else:
                image = square_icon(size)
            save(image.resize((width, height), Image.Resampling.LANCZOS), path)

    for path in ANDROID_RES.glob("drawable*/splash.png"):
        with Image.open(path) as current:
            width, height = current.size
        save(splash(width, height), path)


def generate_exports() -> None:
    save(square_icon(1024), EXPORTS / "TKO-app-icon-1024.png")
    save(transparent_lockup(2048, 640), EXPORTS / "TKO-logo-transparent-2048.png")
    save(youtube_profile(), EXPORTS / "TKO-YouTube-profile-800.png")
    save(youtube_banner(), EXPORTS / "TKO-YouTube-banner-2560x1440.png")
    save(square_icon(150, transparent=True), EXPORTS / "TKO-YouTube-watermark-150.png")
    save(square_icon(512, transparent=True), EXPORTS / "TKO-video-watermark-512.png")
    save(social_card(), EXPORTS / "TKO-social-card-1200x630.png")
    save(video_outro(), EXPORTS / "TKO-video-outro-1920x1080.png")

    DESKTOP_EXPORTS.mkdir(parents=True, exist_ok=True)
    for path in EXPORTS.glob("*.png"):
        shutil.copy2(path, DESKTOP_EXPORTS / path.name)


def main() -> None:
    generate_public_assets()
    generate_android_assets()
    generate_exports()
    print(f"Generated TKO brand assets in {EXPORTS}")
    print(f"Copied creator exports to {DESKTOP_EXPORTS}")


if __name__ == "__main__":
    main()
