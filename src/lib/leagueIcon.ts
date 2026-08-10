/**
 * leagueIcon.ts — turn a league's uploaded logo into its INSTALLED APP ICON.
 *
 * ── WHY THIS EXISTS (operator, 2026-08-08) ──────────────────────────────────
 * "what do we need to do for users to make their app like ssl?"
 *
 * The answer was four manual steps, and step three was the wall: the manifest's
 * icons came from LEAGUE_PWA_ICON_DIRS in src/lib/pwaManifest.ts, a HARDCODED
 * map with one entry. Shinobi Striker League only has its own mark on the home
 * screen because a human ran scripts/league_pwa.py, committed the PNGs, edited
 * that TypeScript map and redeployed. A league that signs up at 2am got TKO's
 * icon until someone did all of that again.
 *
 * Meanwhile the Studio HAS been collecting a logo the whole time — it lands in
 * `leagues.logo_url` as a data: URL — and nothing ever looked at it. The upload
 * and the install icon were simply never connected. This module connects them.
 *
 * ── WHY THE BROWSER RENDERS THEM ────────────────────────────────────────────
 * This repo has no image library (no sharp, no jimp, no canvas — 53 deps, none
 * of them imaging) and Cloud Run is the wrong place to grow a native build
 * dependency for something that happens once per league. The browser doing the
 * upload already has the decoded bitmap and a <canvas>. So the client renders
 * the three PNGs and the server stores bytes it never has to understand.
 *
 * ── GEOMETRY IS A MIRROR, NOT A CHOICE ──────────────────────────────────────
 * Every constant here matches scripts/league_pwa.py (STOCK_DARK, LOGO_SCALE,
 * BUNDLE_ICON_SIZES) because BOTH paths must produce the same icon. SSL's
 * bundled art and a brand-new league's generated art sit at the same URL shape
 * (`leagues/<slug>/icon-<size>.png`) and have to be indistinguishable. If you
 * retune one, retune the other — see iconGeometry.test.ts, which pins them.
 */

/** Stock app dark, the plate every icon is composited onto. #0A0A0C. */
export const STOCK_DARK = '#0A0A0C'

/**
 * The logo fills 78% of the canvas — inside the maskable safe zone (an 80%
 * circle) so Android may crop the plate to any shape without ever clipping the
 * mark, while still reading large for `any` purpose. Mirrors LOGO_SCALE.
 */
export const LOGO_SCALE = 0.78

/**
 * 192 and 512 are what the manifest names for both `any` and `maskable`. 180 is
 * the apple-touch-icon: iOS "Add to Home Screen" reads that <link> and ignores
 * the manifest's icons entirely, so a league without it installs on an iPhone
 * wearing TKO's mark. Mirrors BUNDLE_ICON_SIZES.
 */
export const ICON_SIZES = [180, 192, 512] as const
export type IconSize = (typeof ICON_SIZES)[number]

/**
 * Where a league's icons live, bundled or generated.
 *
 * Deliberately ONE shape for both. SSL's committed PNGs are served by
 * express.static; a self-serve league's generated PNGs are served by the
 * database-backed route at the identical path. Neither the manifest, the
 * <link rel=apple-touch-icon>, nor the CDN rule in customHttp.yml ('/leagues/**')
 * needs to know which kind it is looking at.
 */
export function leagueIconDir(slug: string): string {
  return `leagues/${String(slug).trim().toLowerCase()}`
}

/** The public path of one generated/bundled icon. */
export function leagueIconPath(slug: string, size: number): string {
  return `${leagueIconDir(slug)}/icon-${size}.png`
}

// ───────────────────────────────────────────────────────────────────────────
//  Geometry — pure, and the part worth testing
// ───────────────────────────────────────────────────────────────────────────

export type Placement = { w: number; h: number; x: number; y: number }

/**
 * CONTAIN-fit the logo into the safe box and centre it.
 *
 * Contain, never cover: a league's mark is usually a wordmark or a crest, and
 * cropping one to fill a square is how you turn "Northside Cup" into "orthside
 * Cu". Aspect ratio is preserved and the leftover space stays plate.
 */
export function placeLogo(srcW: number, srcH: number, size: number): Placement {
  if (!(srcW > 0) || !(srcH > 0) || !(size > 0)) return { w: 0, h: 0, x: 0, y: 0 }
  // FLOOR, not round — this mirrors Python's `int(size * LOGO_SCALE)` in
  // scripts/league_pwa.py, which truncates. They disagree at 192:
  // 192 * 0.78 = 149.76, so int() gives 149 and round() would give 150. A
  // one-pixel difference is invisible on its own, but it means SSL's committed
  // icon and a generated icon of the same logo are not byte-identical, and
  // Chrome decides whether to re-mint a WebAPK by HASHING THE ICON BYTES. Two
  // renderers that disagree by a pixel are two renderers that can silently
  // fight over a user's home screen.
  const target = Math.floor(size * LOGO_SCALE)
  const ratio = Math.min(target / srcW, target / srcH)
  const w = Math.max(1, Math.round(srcW * ratio))
  const h = Math.max(1, Math.round(srcH * ratio))
  // Integer centring. Math.round would bias a 1px remainder down-right on some
  // sizes and up-left on others; floor is consistent and off by at most half a
  // pixel, which is invisible and, more usefully, deterministic across sizes.
  return { w, h, x: Math.floor((size - w) / 2), y: Math.floor((size - h) / 2) }
}

// ───────────────────────────────────────────────────────────────────────────
//  Upload validation — runs before any of the above
// ───────────────────────────────────────────────────────────────────────────

/**
 * What a league may upload as a logo.
 *
 * SVG is absent on purpose and it is a security decision, not a format
 * preference: an SVG is a document that can carry <script>, and this file ends
 * up rendered into a canvas and served back from our own origin to every member
 * of that league. Raster only.
 */
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** 6 MB. Comfortably past any real logo; short of someone posting a movie. */
export const MAX_LOGO_BYTES = 6 * 1024 * 1024

export type LogoRejection = 'empty' | 'type' | 'too-big'

/** Null when the file is acceptable; otherwise why it is not. */
export function rejectLogo(file: { type?: string; size?: number } | null | undefined): LogoRejection | null {
  if (!file) return 'empty'
  if (!(ALLOWED_LOGO_TYPES as readonly string[]).includes(String(file.type || ''))) return 'type'
  if (!(Number(file.size) > 0)) return 'empty'
  if (Number(file.size) > MAX_LOGO_BYTES) return 'too-big'
  return null
}

export function logoRejectionMessage(reason: LogoRejection): string {
  switch (reason) {
    case 'type':
      return 'Use a PNG, JPG or WebP. (SVG is not accepted.)'
    case 'too-big':
      return `That file is over ${Math.round(MAX_LOGO_BYTES / (1024 * 1024))} MB. Try a smaller export.`
    default:
      return 'That file looks empty. Pick another.'
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Rendering — browser only
// ───────────────────────────────────────────────────────────────────────────

/** One rendered icon, ready to POST. */
export type GeneratedIcon = { size: number; dataUrl: string }

type Drawable = CanvasImageSource & { width: number; height: number }

/**
 * Composite one icon: stock-dark plate, logo contained at the safe scale.
 *
 * Returns a `data:image/png;base64,...` string. PNG, not WebP: the manifest
 * declares `image/png`, and Chrome's WebAPK minting compares the icon bytes it
 * fetches against what it expects.
 */
export function drawIcon(image: Drawable, size: number): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2d context unavailable')
  ctx.fillStyle = STOCK_DARK
  ctx.fillRect(0, 0, size, size)
  const { w, h, x, y } = placeLogo(image.width, image.height, size)
  if (w > 0 && h > 0) {
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(image, x, y, w, h)
  }
  return canvas.toDataURL('image/png')
}

/** Decode a data:/blob: URL into something drawable. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('could not decode that image'))
    img.src = src
  })
}

/**
 * The whole job: a logo data URL in, the league's three app icons out.
 *
 * Callers hand the result straight to the save payload. It throws rather than
 * returning partial output — a league with two of three icons installs wrong on
 * exactly one platform, which is the kind of bug nobody reports and everybody
 * sees.
 */
export async function generateLeagueIcons(logoDataUrl: string): Promise<GeneratedIcon[]> {
  const img = await loadImage(logoDataUrl)
  return ICON_SIZES.map((size) => ({ size, dataUrl: drawIcon(img, size) }))
}
