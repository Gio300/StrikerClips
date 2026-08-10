/**
 * League theme — runtime re-skin of the WHOLE app chrome for white-label
 * leagues. Modeled on src/lib/broadcastTheme.ts (localStorage + event bus +
 * swappable ThemeStorage), but instead of feeding one page it writes the CSS
 * variables that tailwind.config.js's palette is built on, so every
 * `bg-kunai` / `text-accent` / `border-dark-border` class in the app follows
 * the active league's colors.
 *
 * The config shape mirrors the renderer's league schema
 * (`Loras/assets/leagues/*.json`: name / domain / colors / tagline /
 * video_ownership) so a Studio "Download league.json" stays renderer
 * compatible and `GET /api/league/:slug/config` can hydrate both sides.
 *
 * IMPORTANT: "no league" (null) is a real state — it means the stock TKO
 * chrome. The stock values live as CSS-variable defaults in src/index.css, so
 * applying `null` simply removes the inline overrides and the app looks
 * exactly as it did before this file existed.
 *
 * Keyed storage (`kc_league_theme:<key>`) so the Studio's draft ("studio")
 * and the signed-in user's league ("active") never clobber each other.
 */

export type LeagueColors = {
  /** Main brand / CTA color — drives the `kunai` slot (buttons, live dots). */
  primary: string
  /** Secondary hue — drives the `accent` slot (cyan by default). */
  secondary?: string
  /** Highlight — drives the `chakra` slot (gold by default). */
  accent?: string
  /** Body text color (renderer-side; the app keeps its gray scale). */
  text?: string
  /** Optional near-black surface base — drives dark / card / elevated / border. */
  background?: string
}

export type LeagueConfig = {
  /** URL-safe id, becomes the `leagues.slug` row key. */
  slug?: string
  name: string
  domain?: string
  colors: LeagueColors
  tagline?: string
  logo_url?: string
  /** Music selection (Suno library track ids / vibe), opaque to theming. */
  music?: Record<string, unknown> | string
  /** Who owns the produced videos: TKO's channel or the league's own. */
  video_ownership?: 'tko' | 'league'
  /** Which league plan — the four of src/lib/leaguePlans.ts. */
  tier?: 'starter' | 'pro' | 'dynasty' | 'enterprise'
  /**
   * Whether that plan was PAID for (`leagues.plan_status`). Carried through
   * theming because the chrome's white-label decision (the "powered by TKO"
   * lockup) needs BOTH: tier alone defaults to 'starter', a paid plan, so it
   * would entitle every unsaved draft.
   */
  plan_status?: 'none' | 'active' | 'comped' | 'past_due' | 'canceled'
}

/** A partial update — nested colors may also be partial. */
export type LeaguePatch = Partial<Omit<LeagueConfig, 'colors'>> & {
  colors?: Partial<LeagueColors>
}

const KEY_PREFIX = 'kc_league_theme:'
const EVENT = 'kc:league-theme'

/** Storage key for the league a signed-in user actually belongs to. */
export const ACTIVE_LEAGUE_KEY = 'active'
/** Storage key for the Studio's work-in-progress draft config. */
export const STUDIO_LEAGUE_KEY = 'studio'

/**
 * TKO NEUTRAL — the operator-approved brand palette (palette v2, measured
 * from the operator's UI-mockup reference image, 2026-08-03). THE one place
 * the neutral design lives: the gateway board skin, the Studio chrome, the
 * phone-preview default config and the renderer JSON all read these tokens,
 * so a future brand tweak is a one-edit change here.
 *
 * Values are pixel-measured swatches from the reference (cluster mode /
 * flat-fill samples). Where a raw measurement missed a WCAG AA floor the
 * lightness was shifted minimally — noted per token — so the contrast
 * audit (2026-08-03) keeps holding.
 */
export const TKO_NEUTRAL = {
  /** Sapphire brand blue — primary / CTAs. Measured #447be7 (flat CTA fill),
   *  darkened to hold AA on the board field (white 4.95:1, ice links 4.54:1). */
  blue: '#2b69e4',
  /** Deep royal — secondary hue, gradients, the /make-a-league field. Deep
   *  companion of the measured blue family (teal clears 4.58:1 on its cards). */
  royal: '#1647aa',
  /** Lifted bubble blue — gradient companion (measured chat-bubble highlight). */
  sky: '#6893e4',
  /** Ink navy — pressed/hover state + board CTA plates (measured darkest
   *  screen slate; white label 14.25:1). */
  deepNavy: '#142c44',
  /** Slate navy surface base — the GLOBAL app chrome + Studio background.
   *  Measured #2c3c50 (dark phone screen); deepened to #1a2636 so the full
   *  tko.cam site (index.css :root reconciles to this) holds WCAG-AA app-wide:
   *  the measured slate left muted body text (gray-400 4.42:1) and sapphire
   *  accents (text-kunai 2.27:1) below floor. At #1a2636 body/secondary text
   *  clears 6–14:1, chakra highlights 5.9–6.7:1, and the sapphire accent lifts
   *  to the 3:1 large/UI floor while white-on-CTA stays 4.95:1 (audit 2026-08-03). */
  navy: '#1a2636',
  /** Steel blue — links / focus / info accent (measured nav-pill blue;
   *  6.18:1 on the navy field). */
  cyan: '#a8c3e1',
  /** Ice blue — accent ink that reads on the bright boards (measured pale
   *  icon field; 4.34:1 on blue, 7.32:1 on royal). */
  paleCyan: '#e9f1fa',
  /** Spring green — highlight accent (measured chat-bubble green). */
  teal: '#40c094',
  /** Mint — highlight accent on the bright board (measured green lifted to
   *  3.01:1 on the blue field for large-type/graphic use). */
  seafoam: '#8bd9be',
  /** Ice — near-white ink on navy (measured device whites #f4f4f4–#f6f6f6). */
  ice: '#f5f5f6',

  // ── LIGHT BRAND BOARD (palette v3, measured from the operator's reference
  //    image 2026-08-03) ───────────────────────────────────────────────────
  //    The reference is a LIGHT product surface: a near-white paper canvas,
  //    pure-white cards, hairline gray rules, dark ink and one sapphire CTA.
  //    Cluster measurement of the reference (n = 4.2M px, hue/sat/value
  //    buckets) returned: canvas #ededed–#eaeaeb · card #f3f3f3–#f9f9f9 ·
  //    hairline #cfd5db · ink #1b2121–#212121 · muted #8d8d8d ·
  //    CTA #457be7 · green #3fc393. Values below are those swatches with the
  //    minimum lightness shift needed to hold WCAG AA (noted per token).

  /** Paper canvas — the page field. Measured #eaeaeb, cooled a hair so it
   *  reads as the same blue-gray family as the cards' shadows. */
  canvas: '#eceef2',
  /** Card / panel fill. Measured #f5f5f5; taken to pure white so cards
   *  separate from the canvas the way they do in the reference. */
  surface: '#ffffff',
  /** Inset / elevated fill (rails, pills, table headers). Measured #e7e7e7,
   *  lifted so muted ink keeps ~5.9:1 on it. This is exactly what
   *  leagueThemeVars derives for a light canvas (shadeHex(canvas, +0.45)) —
   *  one truth for hand-written board maps and derived league skins alike. */
  surfaceAlt: '#f5f6f8',
  /** Hairline rules and card edges (measured #cfd5db). Non-text. Equals the
   *  light-canvas derivation shadeHex(canvas, -0.11). */
  hairline: '#d2d4d7',
  /** Primary ink — headings and body copy. Measured #1b2121, cooled toward
   *  the navy family: 14.1:1 on the canvas, 16.4:1 on cards. */
  ink: '#16202e',
  /** Secondary ink — captions, meta, ghost-button labels. The measured
   *  #8d8d8d is only 2.9:1 on white, so it is darkened to the lightest tone
   *  that still clears AA everywhere (5.5:1 canvas, 6.5:1 card). */
  inkMuted: '#565f6e',
  /** Link / accent INK on the light board. The CTA blue itself is 4.26:1 on
   *  the canvas (below the 4.5 body floor), so links ride this one step
   *  darker: 4.9:1 canvas, 5.7:1 card, same measured hue family. */
  azure: '#2560d4',
  /** Highlight ink on light. The measured spring green #3fc393 is 2.3:1 on
   *  white — unusable as text — so the light board's chakra slot is the same
   *  hue taken deep: 5.9:1 on cards, 5.0:1 on the canvas. (The bright teal
   *  above is still the FILL used for badges/plates.) */
  forest: '#0f7350',
  /** The /make-a-league board's tinted paper — a cool blue-gray wash that
   *  keeps that funnel visually distinct from the browse board while staying
   *  in the light family (ink 13.6:1, royal links 6.9:1). */
  paper: '#e4eaf6',

  /** Ink for DARK chromes (the in-app product, SSL's stock dark). Tailwind
   *  gray-100 — what those surfaces already used literally. */
  inkOnDark: '#f3f4f6',
  /** Secondary ink for DARK chromes (10.3:1 on the navy, 13.6:1 on #07070a). */
  inkMutedOnDark: '#cbd5e1',
} as const

/**
 * Luminance split between a "light" chrome (dark ink) and a "dark" chrome
 * (light ink). 0.4 sits well clear of both families we ship — the light
 * canvas is ~0.83, the darkest navy ~0.02 — so no skin lands near the edge.
 */
const LIGHT_SURFACE_LUMINANCE = 0.4

/**
 * The stock TKO identity expressed as a league config — and, since palette v3
 * (operator 2026-08-03), THE definition of "the TKO look" for every PUBLIC TKO
 * surface: the gateway boards, the marketing page, the Studio chrome and the
 * Studio's phone MOCKUP (PhonePreview falls back to this config whenever the
 * draft still wears the untouched neutral colors).
 *
 * `background` is the measured LIGHT canvas, so leagueThemeVars() emits the
 * light surface set AND — because it derives ink from the surface luminance —
 * the dark ink pair that goes with it. That is what turns the mockup light.
 *
 * `text` stays ice: it is renderer-side only (burned-in video captions sit over
 * footage, where white is correct) and has no CSS variable.
 */
export const DEFAULT_LEAGUE_CONFIG: LeagueConfig = {
  slug: 'tko',
  name: 'TKO',
  domain: 'tko.cam',
  colors: {
    primary: TKO_NEUTRAL.blue,
    secondary: TKO_NEUTRAL.azure,
    accent: TKO_NEUTRAL.forest,
    text: TKO_NEUTRAL.ice,
    background: TKO_NEUTRAL.canvas,
  },
  tagline: 'every angle. one cam.',
  video_ownership: 'tko',
}

// Storage is injectable so tests can pass a fake; defaults to localStorage.
export interface ThemeStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem?(k: string): void
}

function defaultStorage(): ThemeStorage | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch { /* access blocked (SSR / private mode) */ }
  return null
}

function storageKey(key: string): string {
  return `${KEY_PREFIX}${key || ACTIVE_LEAGUE_KEY}`
}

function broadcast(): void {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM */ }
}

// ---------------------------------------------------------------------------
// Color math (pure, exported for tests)
// ---------------------------------------------------------------------------

/**
 * Coerce input into a #rrggbb hex or null if it isn't one.
 * Accepts `#abc`, `#aabbcc`, or the same without the leading `#`.
 */
export function normalizeHex(input: string | undefined | null): string | null {
  const raw = (input ?? '').trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return `#${raw.toLowerCase()}`
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    const [r, g, b] = raw.split('')
    return `#${(r + r + g + g + b + b).toLowerCase()}`
  }
  return null
}

/** #rrggbb → "r g b" channel triplet (the format tailwind's rgb(var()) wants). */
export function hexToChannels(hex: string): string {
  const h = normalizeHex(hex) ?? '#000000'
  const n = parseInt(h.slice(1), 16)
  return `${(n >> 16) & 0xff} ${(n >> 8) & 0xff} ${n & 0xff}`
}

/** WCAG relative luminance of a #rrggbb hex (sRGB, per WCAG 2.x). */
function relativeLuminance(hex: string): number {
  const h = normalizeHex(hex) ?? '#000000'
  const n = parseInt(h.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return (
    0.2126 * lin((n >> 16) & 0xff) +
    0.7152 * lin((n >> 8) & 0xff) +
    0.0722 * lin(n & 0xff)
  )
}

/**
 * WCAG 2.x contrast ratio between two hex colors (1..21). The board skins
 * below are contrast-audited (operator report 2026-08-03: "hard to see");
 * the gateway/studio test suites assert AA floors through this function so
 * a future palette tweak can't silently reintroduce illegible pairs.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Mix `hex` toward black (amount < 0) or white (amount > 0) by |amount| ∈ [0,1].
 * Used to derive the -dark / -muted / gradient-end companions a league config
 * doesn't specify.
 */
export function shadeHex(hex: string, amount: number): string {
  const h = normalizeHex(hex) ?? '#000000'
  const n = parseInt(h.slice(1), 16)
  const t = amount > 0 ? 255 : 0
  const p = Math.min(Math.abs(amount), 1)
  const ch = (c: number) => Math.round(c + (t - c) * p)
  const r = ch((n >> 16) & 0xff)
  const g = ch((n >> 8) & 0xff)
  const b = ch(n & 0xff)
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

// ---------------------------------------------------------------------------
// Config → CSS variables
// ---------------------------------------------------------------------------

/**
 * STOCK LEAGUE COLORS — the ninja "dark + orange" identity a branding-only
 * league (SSL) wears, expressed as the league-config color slots:
 * primary = --league-kunai, secondary = --league-accent, accent = --league-chakra.
 * `text` is renderer-side only (no CSS variable — the app keeps its gray scale).
 *
 * NOTE (2026-08-03): tko.cam's GLOBAL chrome moved to the neutral navy palette
 * (index.css :root reconciles to TKO_NEUTRAL — see STOCK_DARK_VARS below), so
 * these values NO LONGER equal the :root defaults. They are the fixed
 * stock-dark chrome that lives on league DOMAINS (shinobistrikerleague.com):
 * a league whose colors equal these is a BRANDING-ONLY league (logo / name /
 * watermark change) that must render the stock-dark chrome REGARDLESS of what
 * tko.cam's :root is — leagueThemeVars pins it to STOCK_DARK_VARS so the SSL
 * takeover is byte-identical to the pre-navy look and independent of :root.
 */
export const STOCK_LEAGUE_COLORS = {
  primary: '#ff5b3d',   // stock --league-kunai
  secondary: '#2ed3dc', // stock --league-accent
  accent: '#ffb224',    // stock --league-chakra
  text: '#f5f5f8',      // renderer body text (no app CSS variable)
} as const

/**
 * STOCK DARK CHROME — the exact pre-2026-08-03 index.css `:root` values (the
 * ninja dark + orange look), kept as an explicit "r g b" var map so league
 * DOMAINS that opt into the stock-dark chrome (SSL) stay pixel-identical after
 * tko.cam's :root moved to the neutral navy palette. A branding-only league
 * (isStockLeagueColors) now EMITS this map rather than zero overrides: the app
 * default (no takeover) reads the new navy :root; SSL reads STOCK_DARK_VARS and
 * so renders its stock dark independent of :root. All names are in
 * LEAGUE_THEME_VAR_NAMES so applyLeagueTheme cleans them up on removal.
 * WCAG-AA verified: body gray-100 18.3:1, accent 11.0:1, chakra 11.2:1 on the
 * #07070a field (audit 2026-08-03).
 */
export const STOCK_DARK_VARS: Record<string, string> = {
  '--league-dark': '7 7 10',            // #07070a
  '--league-dark-card': '17 17 22',     // #111116
  '--league-dark-elevated': '24 24 31', // #18181f
  '--league-dark-border': '41 41 48',   // #292930
  '--league-accent': '46 211 220',      // #2ed3dc
  '--league-accent-muted': '31 165 173',// #1fa5ad
  '--league-kunai': '255 91 61',        // #ff5b3d
  '--league-kunai-dark': '216 62 38',   // #d83e26
  '--league-kunai-2': '255 138 61',     // #ff8a3d
  '--league-chakra': '255 178 36',      // #ffb224
  '--league-chakra-dark': '199 123 0',  // #c77b00
  // Ink slots were added with palette v3 (the light TKO board). SSL is a DARK
  // chrome, so it pins the light-on-dark pair — and pins the CTA label to
  // white so its orange buttons stay byte-identical to the pre-v3 look
  // (leagueThemeVars' derived rule would have flipped a 3.08:1 orange to dark
  // ink; SSL returns early here, so it never runs).
  '--league-ink': '243 244 246',        // #f3f4f6 gray-100, 18.3:1
  '--league-ink-muted': '203 213 225',  // #cbd5e1, 13.6:1
  '--league-on-primary': '255 255 255', // white label on #ff5b3d
}

/**
 * True when a config's brand trio IS the stock-dark chrome (and no custom
 * surface background is set) — i.e. a branding-only league (SSL) that renders
 * the fixed stock-dark chrome (STOCK_DARK_VARS) rather than tko.cam's :root.
 */
export function isStockLeagueColors(c: LeagueColors | undefined | null): boolean {
  if (!c) return false
  if (normalizeHex(c.background)) return false
  return (
    normalizeHex(c.primary) === STOCK_LEAGUE_COLORS.primary &&
    normalizeHex(c.secondary) === STOCK_LEAGUE_COLORS.secondary &&
    normalizeHex(c.accent) === STOCK_LEAGUE_COLORS.accent
  )
}

/**
 * Compute the CSS-variable map for a league config. Only slots the config
 * actually provides (directly or derivably) are present — anything absent
 * keeps its index.css default. Values are "r g b" channel triplets matching
 * the `rgb(var(--league-*) / <alpha-value>)` entries in tailwind.config.js.
 */
export function leagueThemeVars(config: LeagueConfig): Record<string, string> {
  const vars: Record<string, string> = {}
  const c = config.colors ?? ({} as LeagueColors)

  // Branding-only league (colors == stock-dark trio): pin the fixed stock-dark
  // chrome. Before 2026-08-03 this returned {} so the takeover inherited the
  // index.css :root (which WAS the stock dark). Now :root is the neutral navy
  // palette, so a branding-only takeover (SSL on shinobistrikerleague.com) must
  // EMIT the stock-dark map to stay its dark self, independent of :root.
  if (isStockLeagueColors(c)) return { ...STOCK_DARK_VARS }

  const primary = normalizeHex(c.primary)
  if (primary) {
    vars['--league-kunai'] = hexToChannels(primary)
    vars['--league-kunai-dark'] = hexToChannels(shadeHex(primary, -0.2))
    vars['--league-kunai-2'] = hexToChannels(shadeHex(primary, 0.25))
    // CTA label ink: white unless the league's primary is too pale to carry
    // it (a pastel brand would otherwise ship an illegible button), in which
    // case the label flips to the dark ink. AA is therefore structural, not
    // a property of the one palette we happen to ship.
    vars['--league-on-primary'] = hexToChannels(
      contrastRatio('#ffffff', primary) >= 4.5 ? '#ffffff' : TKO_NEUTRAL.ink,
    )
  }

  const secondary = normalizeHex(c.secondary) ?? (primary ? shadeHex(primary, 0.35) : null)
  if (secondary) {
    vars['--league-accent'] = hexToChannels(secondary)
    vars['--league-accent-muted'] = hexToChannels(shadeHex(secondary, -0.2))
  }

  const accent = normalizeHex(c.accent) ?? secondary
  if (accent) {
    vars['--league-chakra'] = hexToChannels(accent)
    vars['--league-chakra-dark'] = hexToChannels(shadeHex(accent, -0.3))
  }

  const background = normalizeHex(c.background)
  if (background) {
    // A surface base can now be LIGHT (TKO's palette-v3 paper canvas) or dark
    // (the ninja/navy chromes). The companions have to be derived in the right
    // DIRECTION or the skin collapses: on a dark base cards/rules step up
    // toward the light, on a light base cards lift to paper-white while rules
    // and insets step DOWN — otherwise a light board has invisible borders.
    const light = relativeLuminance(background) > LIGHT_SURFACE_LUMINANCE
    vars['--league-dark'] = hexToChannels(background)
    vars['--league-dark-card'] = hexToChannels(light ? '#ffffff' : shadeHex(background, 0.04))
    vars['--league-dark-elevated'] = hexToChannels(shadeHex(background, light ? 0.45 : 0.07))
    vars['--league-dark-border'] = hexToChannels(shadeHex(background, light ? -0.11 : 0.13))
    // …and the ink follows the surface, so `text-ink` / `text-ink-muted` are
    // legible on ANY league base without the markup knowing which way it went.
    vars['--league-ink'] = hexToChannels(light ? TKO_NEUTRAL.ink : TKO_NEUTRAL.inkOnDark)
    vars['--league-ink-muted'] = hexToChannels(
      light ? TKO_NEUTRAL.inkMuted : TKO_NEUTRAL.inkMutedOnDark,
    )
  }

  return vars
}

/** Every variable this module may set (used to clean up on removal). */
export const LEAGUE_THEME_VAR_NAMES = [
  '--league-kunai', '--league-kunai-dark', '--league-kunai-2',
  '--league-accent', '--league-accent-muted',
  '--league-chakra', '--league-chakra-dark',
  '--league-dark', '--league-dark-card', '--league-dark-elevated', '--league-dark-border',
  '--league-ink', '--league-ink-muted', '--league-on-primary',
] as const

/**
 * Write (or clear, when `config` is null) the league variables as inline
 * styles on `el`. CSS variables cascade, so `document.documentElement` skins
 * the whole app while a PhonePreview frame can pass its own root element to
 * skin only the preview.
 */
export function applyLeagueTheme(el: HTMLElement, config: LeagueConfig | null): void {
  const vars = config ? leagueThemeVars(config) : {}
  for (const name of LEAGUE_THEME_VAR_NAMES) {
    const value = vars[name]
    if (value !== undefined) el.style.setProperty(name, value)
    else el.style.removeProperty(name)
  }
}

// ---------------------------------------------------------------------------
// TKO-neutral subtree skins — precomputed --league-* maps for TKO's OWN
// product surfaces. Spread into a root element's `style` to dress just that
// subtree; the global in-app chrome (index.css defaults) is untouched.
// ---------------------------------------------------------------------------

/**
 * The Studio chrome — and, since palette v3, the LIGHT TKO product board:
 * paper canvas, white panels, hairline rules, dark ink, one sapphire CTA.
 * Derived straight from DEFAULT_LEAGUE_CONFIG so the Studio, its phone mockup
 * and the gateway can never drift apart. `--brand-cam` (the ".cam" wordmark
 * ink) rides the azure link tone — 4.9:1 on the paper field, where the
 * sapphire CTA fill would only manage 4.26:1 as body-size ink.
 */
export const TKO_NEUTRAL_STUDIO_VARS: Record<string, string> = {
  ...leagueThemeVars(DEFAULT_LEAGUE_CONFIG),
  '--brand-cam': hexToChannels(TKO_NEUTRAL.azure),
}

/**
 * The marketing / browse board — the surface at tko.cam's front door.
 *
 * PALETTE V3 (operator 2026-08-03): this used to be a full-bleed sapphire
 * field with white ink. The operator's reference image is a LIGHT product
 * surface, so the board is now the same paper/white/ink family the Studio and
 * the phone mockup wear. It is spelled out rather than derived only so the
 * intent of each slot is readable at the call site; every value is a
 * TKO_NEUTRAL token and matches what leagueThemeVars derives for the canvas.
 *
 * CONTRAST AUDIT (recomputed for palette v3; the test suite asserts these):
 *   • field is the paper canvas #eceef2: ink 14.12:1, muted ink 5.55:1.
 *   • panels are WHITE — LIGHTER than the field, the inverse of the old
 *     dark board — ink 16.40:1, muted ink 6.45:1.
 *   • CTA plate keeps the sapphire #2b69e4: white label 4.95:1.
 *   • links ride the azure ink #2560d4: 4.88:1 on the field, 5.67:1 on cards.
 *   • highlights ride the deep forest green: 5.04:1 field, 5.85:1 cards
 *     (the bright #40c094 is 2.29:1 on white — a fill, never an ink).
 *   • ".cam" wordmark rides --brand-cam = azure (4.88:1, clears the 3:1
 *     large-type floor with room to spare).
 */
export const TKO_NEUTRAL_BOARD_VARS: Record<string, string> = {
  '--league-dark': hexToChannels(TKO_NEUTRAL.canvas),
  '--league-dark-card': hexToChannels(TKO_NEUTRAL.surface),
  '--league-dark-elevated': hexToChannels(TKO_NEUTRAL.surfaceAlt),
  '--league-dark-border': hexToChannels(TKO_NEUTRAL.hairline),
  '--league-kunai': hexToChannels(TKO_NEUTRAL.blue),
  '--league-kunai-dark': hexToChannels(shadeHex(TKO_NEUTRAL.blue, -0.2)),
  '--league-kunai-2': hexToChannels(TKO_NEUTRAL.sky),
  '--league-accent': hexToChannels(TKO_NEUTRAL.azure),
  '--league-accent-muted': hexToChannels(TKO_NEUTRAL.royal),
  '--league-chakra': hexToChannels(TKO_NEUTRAL.forest),
  '--league-chakra-dark': hexToChannels(shadeHex(TKO_NEUTRAL.forest, -0.3)),
  '--league-ink': hexToChannels(TKO_NEUTRAL.ink),
  '--league-ink-muted': hexToChannels(TKO_NEUTRAL.inkMuted),
  '--league-on-primary': hexToChannels('#ffffff'),
  '--brand-cam': hexToChannels(TKO_NEUTRAL.azure),
}

// ---------------------------------------------------------------------------
// Persistence (broadcastTheme-style: keyed, event-bus notified)
// ---------------------------------------------------------------------------

/** Load the stored league config for a key, or null (= stock TKO chrome). */
export function loadLeagueTheme(
  key: string = ACTIVE_LEAGUE_KEY,
  storage: ThemeStorage | null = defaultStorage(),
): LeagueConfig | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(storageKey(key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as LeagueConfig
    if (!parsed || typeof parsed !== 'object' || typeof parsed.name !== 'string') return null
    return { ...parsed, colors: { ...(parsed.colors ?? { primary: '' }) } }
  } catch {
    return null
  }
}

/** Persist a config (partials merged over what's stored) and notify listeners. */
export function saveLeagueTheme(
  key: string,
  patch: LeaguePatch,
  storage: ThemeStorage | null = defaultStorage(),
): LeagueConfig {
  const current = loadLeagueTheme(key, storage)
  const next: LeagueConfig = {
    name: '',
    ...current,
    ...patch,
    colors: { ...(current?.colors ?? { primary: '' }), ...(patch.colors ?? {}) },
  }
  if (storage) {
    try { storage.setItem(storageKey(key), JSON.stringify(next)) } catch { /* quota */ }
  }
  broadcast()
  return next
}

/** Drop a stored config (back to stock chrome) and notify listeners. */
export function clearLeagueTheme(
  key: string = ACTIVE_LEAGUE_KEY,
  storage: ThemeStorage | null = defaultStorage(),
): void {
  if (storage) {
    try {
      if (storage.removeItem) storage.removeItem(storageKey(key))
      else storage.setItem(storageKey(key), '')
    } catch { /* quota */ }
  }
  broadcast()
}

/** Subscribe a component to league-theme changes. Returns an unsubscribe fn. */
export function subscribeLeagueTheme(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}
