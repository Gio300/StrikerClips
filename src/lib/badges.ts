/**
 * badges.ts — prestige badge catalog + pure helpers.
 *
 * TKO is pivoting away from cash betting to a GIVING + PRESTIGE model:
 * people earn standing by donating to clans, sponsoring tournaments, sharing
 * pages, and accurately calling the rise & fall of clans / tournaments — never
 * by winning money. This module is the single source of truth for the badges
 * that represent that standing.
 *
 * It is deliberately DATA-ONLY and side-effect free: no React, no Supabase, no
 * network. The earning backend isn't built yet, so badges are read from
 * `user_metadata.badges` (an array of badge ids). When that's absent — which is
 * the case for everyone today — every helper degrades cleanly to "no badges".
 */

export type BadgeFamily = 'sponsor' | 'giver' | 'oracle' | 'role'

export interface Badge {
  /** Stable id stored in user_metadata.badges. */
  id: string
  /** Human-facing label, e.g. "Gold Sponsor". */
  label: string
  /** Small icon shown inline. */
  emoji: string
  family: BadgeFamily
  /** Tailwind classes for the pill (text + bg + border), tuned per tier. */
  colorClass: string
  /**
   * Prestige weight. `topBadge` shows the single highest-prestige badge a user
   * holds, so a Platinum Sponsor outranks a Patron inline. Higher wins.
   */
  prestige: number
  /** Longer tooltip describing how the badge is earned. */
  title: string
}

/**
 * The full catalog, keyed by id. Grouped by family:
 *
 *  - SPONSOR  — prestige account level for cumulative givers (Bronze→Platinum).
 *  - GIVER    — discrete generous acts (Patron / Benefactor / Herald).
 *  - ORACLE   — prediction skill at calling clan/tournament rise & fall.
 *  - ROLE     — what the person does in the community (Organizer / Influencer).
 */
export const BADGES: Record<string, Badge> = {
  // ── Sponsor status — earned by cumulative giving ─────────────────────────
  bronze_sponsor: {
    id: 'bronze_sponsor',
    label: 'Bronze Sponsor',
    emoji: '🥉',
    family: 'sponsor',
    colorClass: 'text-amber-200 bg-amber-900/40 border border-amber-700/50',
    prestige: 40,
    title: 'Bronze Sponsor — cumulative giving to clans & tournaments',
  },
  silver_sponsor: {
    id: 'silver_sponsor',
    label: 'Silver Sponsor',
    emoji: '🥈',
    family: 'sponsor',
    colorClass: 'text-slate-100 bg-slate-500/25 border border-slate-400/50',
    prestige: 50,
    title: 'Silver Sponsor — sustained giving to the community',
  },
  gold_sponsor: {
    id: 'gold_sponsor',
    label: 'Gold Sponsor',
    emoji: '🥇',
    family: 'sponsor',
    colorClass: 'text-yellow-200 bg-yellow-800/40 border border-yellow-600/50',
    prestige: 60,
    title: 'Gold Sponsor — major cumulative giving',
  },
  platinum_sponsor: {
    id: 'platinum_sponsor',
    label: 'Platinum Sponsor',
    emoji: '💎',
    family: 'sponsor',
    colorClass: 'text-cyan-100 bg-cyan-500/20 border border-cyan-300/40',
    prestige: 70,
    title: 'Platinum Sponsor — the highest tier of giving',
  },

  // ── Giver badges — discrete generous acts ────────────────────────────────
  patron: {
    id: 'patron',
    label: 'Patron',
    emoji: '🎗️',
    family: 'giver',
    colorClass: 'text-leaf bg-leaf/15 border border-leaf/40',
    prestige: 20,
    title: 'Patron — donated to a clan',
  },
  benefactor: {
    id: 'benefactor',
    label: 'Benefactor',
    emoji: '🏛️',
    family: 'giver',
    colorClass: 'text-chakra bg-chakra/15 border border-chakra/40',
    prestige: 30,
    title: 'Benefactor — sponsored a tournament',
  },
  herald: {
    id: 'herald',
    label: 'Herald',
    emoji: '📣',
    family: 'giver',
    colorClass: 'text-accent bg-accent/15 border border-accent/40',
    prestige: 15,
    title: 'Herald — shared pages and boosted others',
  },

  // ── Oracle badges — prediction skill (prestige only, no cash) ────────────
  //
  //  The `novice_oracle → oracle → adept_oracle → master_oracle → grand_oracle`
  //  rungs form a PROGRESSION keyed to cumulative CORRECT tournament predictions
  //  (see ORACLE_MILESTONES + oracleBadgeForCorrect below). `seer` and `prophet`
  //  remain as standalone prestige badges for the older "call the rise & fall"
  //  framing so nothing that already references them breaks.
  seer: {
    id: 'seer',
    label: 'Seer',
    emoji: '🔮',
    family: 'oracle',
    colorClass: 'text-purple-200 bg-purple-500/20 border border-purple-400/40',
    prestige: 25,
    title: 'Seer — accurate at calling the rise & fall of clans and tournaments',
  },
  novice_oracle: {
    id: 'novice_oracle',
    label: 'Novice Oracle',
    emoji: '🪄',
    family: 'oracle',
    colorClass: 'text-purple-200 bg-purple-500/15 border border-purple-400/30',
    prestige: 20,
    title: 'Novice Oracle — called your first tournament correctly',
  },
  oracle: {
    id: 'oracle',
    label: 'Oracle',
    emoji: '🔮',
    family: 'oracle',
    colorClass: 'text-purple-100 bg-purple-500/25 border border-purple-300/50',
    prestige: 35,
    title: 'Oracle — 5 correct tournament predictions',
  },
  adept_oracle: {
    id: 'adept_oracle',
    label: 'Adept Oracle',
    emoji: '✨',
    family: 'oracle',
    colorClass: 'text-fuchsia-100 bg-fuchsia-500/20 border border-fuchsia-300/40',
    prestige: 48,
    title: 'Adept Oracle — 15 correct tournament predictions',
  },
  master_oracle: {
    id: 'master_oracle',
    label: 'Master Oracle',
    emoji: '🌟',
    family: 'oracle',
    colorClass: 'text-amber-100 bg-amber-500/20 border border-amber-300/40',
    prestige: 62,
    title: 'Master Oracle — 30 correct tournament predictions',
  },
  grand_oracle: {
    id: 'grand_oracle',
    label: 'Grand Oracle',
    emoji: '🌌',
    family: 'oracle',
    colorClass: 'text-indigo-100 bg-indigo-500/25 border border-indigo-300/50',
    prestige: 78,
    title: 'Grand Oracle — 50 correct tournament predictions',
  },
  prophet: {
    id: 'prophet',
    label: 'Prophet',
    emoji: '⭐',
    family: 'oracle',
    colorClass: 'text-fuchsia-100 bg-fuchsia-500/25 border border-fuchsia-300/50',
    prestige: 55,
    title: 'Prophet — elite prediction accuracy',
  },

  // ── Role badges — what the person does in the community ───────────────────
  organizer: {
    id: 'organizer',
    label: 'Organizer',
    emoji: '🎯',
    family: 'role',
    colorClass: 'text-kunai bg-kunai/15 border border-kunai/40',
    prestige: 22,
    title: 'Organizer — runs tournaments',
  },
  influencer: {
    id: 'influencer',
    label: 'Influencer',
    emoji: '🌟',
    family: 'role',
    colorClass: 'text-pink-200 bg-pink-500/20 border border-pink-400/40',
    prestige: 18,
    title: 'Influencer — a voice the community follows',
  },
}

/**
 * Anything a caller might have on hand that could carry badge ids. We accept a
 * loose shape so callers can pass Supabase auth `user_metadata`, a full user
 * object (`{ user_metadata: { badges } }`), or a profile-ish row that happens
 * to carry a `badges` array — without any of them being required.
 */
export type BadgeMeta =
  | {
      badges?: unknown
      user_metadata?: { badges?: unknown } | null
    }
  | null
  | undefined

/** Pull the raw badge-id array out of whatever meta shape we were given. */
function readBadgeIds(meta: BadgeMeta): string[] {
  if (!meta || typeof meta !== 'object') return []
  const direct = (meta as { badges?: unknown }).badges
  const nested = (meta as { user_metadata?: { badges?: unknown } | null }).user_metadata?.badges
  const raw = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : []
  return raw.filter((v): v is string => typeof v === 'string')
}

/**
 * Resolve the badge ids on a user's metadata into full Badge objects.
 * Unknown ids are dropped. Result is sorted highest-prestige first so callers
 * can render them in a sensible order. Never throws; `[]` when nothing applies.
 */
export function badgesForUser(meta: BadgeMeta): Badge[] {
  const ids = readBadgeIds(meta)
  const seen = new Set<string>()
  const out: Badge[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const badge = BADGES[id]
    if (badge) {
      seen.add(id)
      out.push(badge)
    }
  }
  return out.sort((a, b) => b.prestige - a.prestige)
}

/**
 * The single highest-prestige badge to show inline next to a name, or `null`
 * when the user has none (the current default for everyone).
 */
export function topBadge(meta: BadgeMeta): Badge | null {
  const all = badgesForUser(meta)
  return all.length > 0 ? all[0] : null
}

// ─────────────────────────────────────────────────────────────────────────
//  ORACLE PROGRESSION — badges keyed to cumulative CORRECT predictions.
//
//  The Oracle system (src/lib/predictions.ts) tracks how many tournaments a user
//  has correctly called. That running count unlocks the oracle rungs below. This
//  is pure/data-only: the count is passed in, and we resolve which badge id(s)
//  have been earned. No DOM, no storage.
// ─────────────────────────────────────────────────────────────────────────

export interface OracleMilestone {
  /** Cumulative correct predictions required to earn `badgeId`. */
  minCorrect: number
  /** The oracle badge id granted at this milestone (a key in BADGES). */
  badgeId: string
}

/**
 * Ascending ladder of oracle badges by cumulative correct predictions.
 * `oracleBadgeForCorrect` walks this to find the single highest rung earned.
 */
export const ORACLE_MILESTONES: OracleMilestone[] = [
  { minCorrect: 1, badgeId: 'novice_oracle' },
  { minCorrect: 5, badgeId: 'oracle' },
  { minCorrect: 15, badgeId: 'adept_oracle' },
  { minCorrect: 30, badgeId: 'master_oracle' },
  { minCorrect: 50, badgeId: 'grand_oracle' },
]

/**
 * The highest oracle badge id earned for a given cumulative correct count, or
 * `null` when the user hasn't landed their first correct call yet. Negative /
 * NaN counts degrade cleanly to `null`.
 */
export function oracleBadgeForCorrect(correctCount: number): string | null {
  const n = Number.isFinite(correctCount) ? correctCount : 0
  let earned: string | null = null
  for (const m of ORACLE_MILESTONES) {
    if (n >= m.minCorrect) earned = m.badgeId
    else break
  }
  return earned
}

/**
 * The next milestone a user is working toward, or `null` when they've earned the
 * top rung. Handy for "X more correct until <badge>" progress copy.
 */
export function nextOracleMilestone(correctCount: number): OracleMilestone | null {
  const n = Number.isFinite(correctCount) ? correctCount : 0
  for (const m of ORACLE_MILESTONES) {
    if (n < m.minCorrect) return m
  }
  return null
}

/** Every oracle badge earned at/under a correct count, prestige-sorted (desc). */
export function oracleBadgesForCorrect(correctCount: number): Badge[] {
  const n = Number.isFinite(correctCount) ? correctCount : 0
  return ORACLE_MILESTONES.filter((m) => n >= m.minCorrect)
    .map((m) => BADGES[m.badgeId])
    .filter((b): b is Badge => Boolean(b))
    .sort((a, b) => b.prestige - a.prestige)
}
