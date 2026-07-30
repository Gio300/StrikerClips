/**
 * conquestLayout — where each Shinobi Conquest territory sits on the painted
 * ninja-world map image (public/conquest-map.webp).
 *
 * The board is the real map now: an illustration of the shinobi world with every
 * territory painted and labelled. We overlay one interactive "control point" per
 * territory at the coordinates below — a glowing marker that shows who holds the
 * land, how many occupy it, and lights up for the clan you're in. Coordinates
 * are PERCENTAGES of the image box (0–100), so the overlay scales with the map
 * at any width.
 *
 * Keyed by lowercased territory name so it stays data-driven against whatever the
 * `territories` table seeds; an unknown name falls back to a neutral point.
 */

export interface MapPoint {
  /** center X as a percent of the image width (0–100). */
  x: number
  /** center Y as a percent of the image height (0–100). */
  y: number
  /** The great nation / land this territory belongs to (shown in the detail). */
  nation: string
  /** A great nation gets a larger marker + always-on label. */
  great?: boolean
}

/** The painted map's territory control points (percent coords on the image). */
export const CONQUEST_POINTS: Record<string, MapPoint> = {
  // ── northern belt ────────────────────────────────────────────────────────
  stone: { x: 16, y: 7, nation: 'Land of Earth · Hidden Stone', great: true },
  sound: { x: 35, y: 6, nation: 'Land of Sound · Hidden Sound' },
  snow: { x: 48, y: 4, nation: 'Land of Snow' },
  cloud: { x: 70, y: 8, nation: 'Land of Lightning · Hidden Cloud', great: true },

  // ── central belt ─────────────────────────────────────────────────────────
  waterfall: { x: 32, y: 17, nation: 'Land of Waterfall · Hidden Waterfall' },
  grass: { x: 24, y: 22, nation: 'Land of Grass' },
  valley: { x: 45, y: 19, nation: 'Valley of the End' },
  ember: { x: 57, y: 18, nation: 'Land of Hot Springs' },
  leaf: { x: 44, y: 32, nation: 'Land of Fire · Hidden Leaf', great: true },
  rain: { x: 26, y: 29, nation: 'Land of Rain · Hidden Rain' },
  star: { x: 67, y: 29, nation: 'Land of Star' },
  mist: { x: 82, y: 31, nation: 'Land of Water · Hidden Mist', great: true },

  // ── western wind ─────────────────────────────────────────────────────────
  sand: { x: 18, y: 42, nation: 'Land of Wind · Hidden Sand', great: true },
  dune: { x: 25, y: 50, nation: 'Land of Wind — Dune' },
  tide: { x: 61, y: 37, nation: 'Land of Whirlpools · Tide' },

  // ── southern seas (the growth frontier) ──────────────────────────────────
  ridge: { x: 44, y: 62, nation: 'Land of Tea · Ridge' },
  hollow: { x: 69, y: 58, nation: 'Land of the Sea · Hollow' },
  reach: { x: 79, y: 64, nation: 'Land of the Sea · Reach' },
  moon: { x: 25, y: 79, nation: 'Land of the Moon' },
  verge: { x: 61, y: 80, nation: "World's Verge" },
}

/** Resolve a control point for a territory name; unknown names get a spare slot. */
export function pointFor(name: string, spareIndex: number): MapPoint {
  const key = name.trim().toLowerCase()
  if (CONQUEST_POINTS[key]) return CONQUEST_POINTS[key]
  // Unknown territory: drop it along the bottom edge so it's still interactive.
  const perRow = 6
  const col = spareIndex % perRow
  const row = Math.floor(spareIndex / perRow)
  return { x: 10 + col * 15, y: 90 + row * 5, nation: 'Frontier' }
}
