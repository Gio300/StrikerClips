/**
 * Highlight categories — the tabs a creator picks when building a reel
 * ("all K.O.s", "flag runs", "ultimates", "opening", "closing stats").
 *
 * Each category carries the on-screen text cues the OCR detector looks for
 * (uppercased, whitespace-stripped substrings) plus tuning for how the audio
 * fallback behaves. Cues are intentionally game-agnostic defaults; a per-game
 * profile (public/game-profiles/<id>.json) can override `cues` later.
 */

export type HighlightCategoryId = 'all' | 'ko' | 'ultimate' | 'flag' | 'opening' | 'closing'

export type HighlightCategory = {
  id: HighlightCategoryId
  label: string
  sub: string
  /** OCR cues: if a sampled frame's text contains any of these, it matches. */
  cues: string[]
  /** Clip padding around a matched moment, seconds. */
  padBefore: number
  padAfter: number
}

export const HIGHLIGHT_CATEGORIES: HighlightCategory[] = [
  { id: 'all', label: 'All highlights', sub: 'Loudest moments (audio)', cues: [], padBefore: 1.5, padAfter: 1.5 },
  { id: 'ko', label: 'K.O.s', sub: 'Every knockout', cues: ['KO', 'K.O', 'KO!', 'FINISH', 'DOWN'], padBefore: 8, padAfter: 2 },
  { id: 'ultimate', label: 'Ultimates', sub: 'Ougi / ultimate jutsu', cues: ['ULTIMATE', 'NINJUTSU', 'OUGI', 'SECRETTECHNIQUE', 'AWAKENING'], padBefore: 4, padAfter: 3 },
  { id: 'flag', label: 'Flag runs', sub: 'Scrolls / captures', cues: ['FLAG', 'SCROLL', 'CAPTURE', 'GOTASCROLL', 'GRABTHESCROLL'], padBefore: 5, padAfter: 3 },
  { id: 'opening', label: 'Opening', sub: 'Match start', cues: ['COMBATBATTLE', 'BEGINBATTLE', 'BEGIN', 'READY', 'MATCHSTART', 'DEFEATYOUR'], padBefore: 0.5, padAfter: 4 },
  { id: 'closing', label: 'Closing + stats', sub: 'Result / players', cues: ['YOUWIN', 'VICTORY', 'DEFEAT', 'RESULT', 'RESULTS', 'PLAYTIME', 'GRADE', 'SCORE'], padBefore: 3, padAfter: 5 },
]

export function getCategory(id: HighlightCategoryId): HighlightCategory {
  return HIGHLIGHT_CATEGORIES.find((c) => c.id === id) ?? HIGHLIGHT_CATEGORIES[0]
}
