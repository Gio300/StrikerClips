/**
 * PWA IDENTITY — what the install button says, and what lands on the home
 * screen (operator 2026-08-06: on shinobistrikerleague.com "install ... should
 * install the app they are on.. this is taking me to TKO").
 *
 * THE BUG THIS FIXES. `<link rel="manifest">` is ONE static file, so every
 * league domain served by the same bundle installed as TKO — TKO's name, TKO's
 * icon. scripts/league_pwa.py already solved that for a SEPARATE per-league
 * bundle (it stamps dist/manifest.json + dist/icons at deploy time), but the
 * Cloud Run service serves EVERY host from ONE bundle, so the identity has to
 * be resolved per REQUEST instead. This module is the shared half: the pure
 * shapes, used by
 *
 *   • server/app.ts — GET /manifest.json, built from the league that the
 *     request's HOSTNAME resolves to (hostGateDecision — the same server-side
 *     league-by-host lookup the domain takeover already uses), and
 *   • the browser — the install LABEL, and the host-aware manifest href.
 *
 * DELIBERATELY IDENTICAL to scripts/league_pwa.py's `league_manifest()`: a
 * league that gets its own stamped bundle and a league served dynamically must
 * install as the SAME app, or an existing home-screen icon would be orphaned.
 * Keep the two in step — including `id: '/'` and the stock-dark colors (league
 * bundles keep the stock dark chrome; only brand HUES re-skin at runtime, see
 * src/lib/leagueDomain.ts).
 *
 * FAIL-SOFT: anything unresolved — unknown host, missing league row, a league
 * with no bundled icons — degrades to TKO_MANIFEST, which is byte-for-byte
 * today's public/manifest.json. A manifest is never worth a 500.
 */

/** The house brand, and the label's default. */
export const DEFAULT_BRAND_NAME = 'TKO'

/**
 * Stock app dark — `STOCK_DARK` in scripts/league_pwa.py, `#0A0A0C` in
 * index.css / index.html's theme-color. Every league bundle keeps it: league
 * configs carry no SURFACE color (only brand hues), so inventing one here
 * would put a color on the splash that appears nowhere else in the app.
 */
export const STOCK_DARK = '#0A0A0C'

export type ManifestIcon = {
  src: string
  sizes: string
  type: string
  purpose: string
}

export type WebAppManifest = {
  $comment?: string
  id: string
  name: string
  short_name: string
  description: string
  lang: string
  dir: string
  start_url: string
  scope: string
  display: string
  display_override: string[]
  orientation: string
  background_color: string
  theme_color: string
  categories: string[]
  icons: ManifestIcon[]
}

/**
 * TODAY'S MANIFEST, verbatim. tko.cam and every unknown host must get exactly
 * this — an installed TKO app must not change identity because this route
 * started existing. src/lib/pwaManifest.test.ts asserts it still deep-equals
 * public/manifest.json, so the file and this constant can never drift.
 */
export const TKO_MANIFEST: WebAppManifest = {
  $comment:
    'App manifest. The id is pinned to /app/ so site and in-app installs create one TKO app.',
  id: '/app/',
  name: 'TKO.cam',
  short_name: 'TKO',
  description:
    'Every angle of the knockout. One cam - multi-angle highlights, live events, clans, and tournaments.',
  lang: 'en',
  dir: 'ltr',
  start_url: '.',
  scope: '.',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui', 'browser'],
  orientation: 'any',
  background_color: STOCK_DARK,
  theme_color: STOCK_DARK,
  categories: ['entertainment', 'sports', 'games'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}

/**
 * BUNDLED PER-LEAGUE PWA ICONS: slug → asset directory (relative to the deploy
 * base), holding `icon-192.png` and `icon-512.png`.
 *
 * Same discipline as LEAGUE_MARKS in src/components/LeagueWatermark.tsx and
 * for the same reason, one step worse: a manifest that names an icon which
 * 404s does not fall back to the next entry — the install silently drops to a
 * generic letter glyph, or on some Chromium versions is refused outright. So a
 * slug goes in here ONLY once the two files actually exist in public/leagues/.
 * A league with no entry keeps TKO's icons and still gets its own NAME, which
 * is a partial win, never a broken install.
 *
 * Generate a league's pair with:
 *   python scripts/league_pwa.py --pwa-icons --slug <slug>
 */
export const LEAGUE_PWA_ICON_DIRS: Record<string, string> = {
  shinobistrikerleague: 'leagues/shinobistrikerleague',
}

/** The four icon entries (192/512 x any/maskable) under `dir`. */
export function manifestIconsIn(dir: string): ManifestIcon[] {
  const base = String(dir).replace(/\/+$/, '')
  return [
    { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${base}/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
    { src: `${base}/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ]
}

/**
 * Where a league's icons live, whoever made them.
 *
 * TWO SOURCES, ONE PATH (2026-08-08). A slug is served icons if EITHER:
 *
 *   bundled    it is in LEAGUE_PWA_ICON_DIRS above — committed PNGs under
 *              public/leagues/, generated by hand with league_pwa.py. SSL.
 *   generated  the league uploaded a logo in the Studio and the browser
 *              rendered its icon set (src/lib/leagueIcon.ts). Every self-serve
 *              league. Served from the database at the SAME path shape.
 *
 * Deliberately indistinguishable downstream: the manifest, the iOS
 * apple-touch-icon <link>, and the CDN rule ('/leagues/**' in customHttp.yml)
 * all key on `leagues/<slug>/icon-<size>.png` and never ask which kind it is.
 * That is what lets the hardcoded map stop being the gate — before this, a
 * league that signed up at 2am wore TKO's mark until a human edited this file
 * and redeployed.
 *
 * `generated` must be a real answer from the row, never an optimistic guess: a
 * manifest naming an icon that 404s does not fall back, it drops the install to
 * a generic glyph or is refused outright. Unknown => false => TKO's icons, which
 * is a partial win rather than a broken install.
 */
export function leagueIconDirFor(
  slug: string | null | undefined,
  opts: { generated?: boolean } = {},
): string | null {
  if (!slug) return null
  const bundled = LEAGUE_PWA_ICON_DIRS[slug]
  if (bundled) return bundled
  return opts.generated ? `leagues/${String(slug).trim().toLowerCase()}` : null
}

/** A league's own icon set, or TKO's when it has neither bundled nor generated. */
export function leagueManifestIcons(
  slug: string | null | undefined,
  opts: { generated?: boolean } = {},
): ManifestIcon[] {
  const dir = leagueIconDirFor(slug, opts)
  return dir ? manifestIconsIn(dir) : TKO_MANIFEST.icons
}

/** True when this slug has real per-league icons (tests + tooling read it). */
export function hasLeaguePwaIcons(
  slug: string | null | undefined,
  opts: { generated?: boolean } = {},
): boolean {
  return !!leagueIconDirFor(slug, opts)
}

/**
 * THE iOS HALF. "Add to Home Screen" on iPhone/iPad reads `apple-touch-icon`
 * and `apple-mobile-web-app-title` out of the live <head> and ignores the
 * manifest's icons and name completely — so a league install on iOS would
 * still land as a TKO icon called "TKO" even with everything above correct.
 * Returns the 180px league mark under `base`, or null when the league has none
 * bundled (in which case the static TKO tags stay, which is the honest answer).
 */
export function leagueAppleTouchIcon(
  slug: string | null | undefined,
  base = '/',
  opts: { generated?: boolean } = {},
): string | null {
  const dir = leagueIconDirFor(slug, opts)
  if (!dir) return null
  const b = String(base || '/').endsWith('/') ? String(base || '/') : `${base}/`
  return `${b}${dir.replace(/^\/+/, '')}/icon-180.png`
}

/**
 * A league name as a HUMAN reads it.
 *
 * League names are stored the way they are drawn — SSL's row says
 * "SHINOBI STRIKER LEAGUE", and the app renders it through CSS `uppercase`.
 * A manifest name and a menu label are plain strings with no stylesheet, and
 * "Install SHINOBI STRIKER LEAGUE" reads as shouting, so an ALL-CAPS name is
 * folded to title case here — the same name scripts/league_pwa.py is invoked
 * with by hand today (`--name "Shinobi Striker League"`).
 *
 * Two guards keep it honest: a name that already contains a lowercase letter
 * is the author's own casing and is returned untouched, and runs of three
 * letters or fewer stay uppercase so acronyms (TKO, SSL, FC) survive.
 */
export function brandDisplayName(raw: string | null | undefined): string {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return ''
  if (/[a-z]/.test(name)) return name
  return name.replace(/[A-Z][A-Z']*/g, (word) =>
    word.length <= 3 ? word : word.charAt(0) + word.slice(1).toLowerCase(),
  )
}

/**
 * THE install label. One string, six call sites (BottomNav, Sidebar, HomeMenu,
 * Marketing x2, TournamentDetail) — see src/hooks/useInstallLabel.ts for the
 * hook that feeds it the active league.
 */
export function installLabel(leagueName?: string | null): string {
  return `Install ${brandDisplayName(leagueName) || DEFAULT_BRAND_NAME}`
}

/**
 * The description scripts/league_pwa.py derives, character for character, so a
 * stamped bundle and this route describe a league identically.
 */
export function leagueManifestDescription(name: string, tagline?: string | null): string {
  const t = String(tagline ?? '').trim()
  const lead = t ? `${name} — ${t}` : name
  return `${lead} Live multi-angle matches, tournaments, standings, and highlight reels.`
}

export type LeagueManifestInput = {
  slug: string
  /** The league's stored name (any casing — brandDisplayName folds it). */
  name: string
  tagline?: string | null
  /**
   * The PATH the installed app owns.
   *   • undefined — the league answers on its OWN address (its domain, or
   *     `<slug>.tko.cam`). The whole origin is the league's, so id/start_url/
   *     scope stay exactly what scripts/league_pwa.py stamps.
   *   • '/<slug>/' — the PATH rung (`tko.cam/<slug>`). tko.cam's own app owns
   *     '/', so a league installed from a path must be scoped to its prefix or
   *     it would collide with the TKO install and swallow tko.cam's routes.
   */
  pathScope?: string | null
}

/** A league's manifest. Pure — the caller supplies the row. */
export function buildLeagueManifest(input: LeagueManifestInput): WebAppManifest {
  const name = brandDisplayName(input.name) || DEFAULT_BRAND_NAME
  const scope = input.pathScope ? normalizeScope(input.pathScope) : null
  return {
    $comment: `League manifest for '${input.slug}', built per-host by server/app.ts — the dynamic twin of scripts/league_pwa.py.`,
    // Origin-scoped on the league's own address (never collides with tko.cam's
    // '/app/'); prefix-scoped on the path rung so it installs as its own app.
    id: scope ?? '/',
    name,
    short_name: name,
    description: leagueManifestDescription(name, input.tagline),
    lang: 'en',
    dir: 'ltr',
    start_url: scope ?? '.',
    scope: scope ?? '.',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui', 'browser'],
    orientation: 'any',
    background_color: STOCK_DARK,
    theme_color: STOCK_DARK,
    categories: ['entertainment', 'sports', 'games'],
    icons: leagueManifestIcons(input.slug),
  }
}

/** '/x' → '/x/'; blank → '/'. Scope and start_url must be directory-shaped. */
function normalizeScope(raw: string): string {
  const s = String(raw).trim()
  if (!s) return '/'
  const lead = s.startsWith('/') ? s : `/${s}`
  return lead.endsWith('/') ? lead : `${lead}/`
}

/**
 * The manifest URL for this page load.
 *
 * The HOSTNAME cases need nothing: the server reads the Host header and answers
 * with that league. The PATH rung and the `?league=` preview do — `tko.cam` is
 * the host for both, so the slug has to travel in the URL or the server would
 * (correctly) describe TKO. See src/main.tsx for who calls this.
 */
export function manifestHref(base: string, slug?: string | null): string {
  const b = String(base || '/').endsWith('/') ? String(base || '/') : `${base}/`
  const file = `${b}manifest.json`
  return slug ? `${file}?league=${encodeURIComponent(slug)}` : file
}

/** The minimum of a document this needs — injectable, so it unit-tests dry. */
export type ManifestLinkHost = {
  querySelector(selectors: string): { setAttribute(name: string, value: string): void } | null
}

/**
 * Re-point `<link rel="manifest">` at the league this page load is serving.
 *
 * Touches ONLY the href, and only the manifest link — the service worker's
 * scope (src/lib/swClient.ts: swUrl/swScope off BASE_URL) and the update
 * prompt are untouched, because a manifest and a worker registration are
 * independent: the worker keeps controlling the same scope whatever the
 * manifest is called. Returns whether the link was found; a missing link means
 * the static href stands, which is TKO's — never a broken page.
 */
export function syncManifestLink(
  doc: ManifestLinkHost | null | undefined,
  base: string,
  slug?: string | null,
): boolean {
  try {
    const link =
      doc?.querySelector('link#app-manifest') ?? doc?.querySelector('link[rel="manifest"]')
    if (!link) return false
    link.setAttribute('href', manifestHref(base, slug))
    return true
  } catch {
    return false
  }
}
