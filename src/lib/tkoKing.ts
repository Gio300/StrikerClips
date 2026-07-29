/**
 * TKO King — the featured 1-on-1, pit-based, play-anytime tournament format.
 *
 * "No in-game rules — find the best Shinobi." A TKO King tournament is a SINGLES
 * ladder that gets PRIME placement on the front page and whose battles are meant
 * to stream to our YouTube + the home page (the auto-streaming itself is a later
 * integration — see the `streams_to_youtube` scaffold note below).
 *
 * This module is the PURE, unit-tested core (mirrors tiers.ts / clans.ts /
 * predictions.ts): the format constant, the registration entry-gate state
 * machine, the phase resolver, the battle status model, the HOST capability
 * (founder host codes → a global `tko_host` flag), the +30-day membership grant
 * builder, and the Shinobi Trophy Closet aggregation. Nothing here touches the
 * DOM, storage, React or a backend, so it can be tested in isolation. The pages
 * (src/pages/TkoKing.tsx, Profile.tsx) call these helpers.
 */

import { MONTH_DAYS } from './trial'
import { grantAsset, type DigitalAsset, type AssetStorage } from './assets'
import { callFn } from './backend'
import { entitlementsFromUser } from './entitlements'
import { TOP_TIER } from './tiers'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// ───────────────────────────────────────────────────────────────────────────
//  FORMAT
// ───────────────────────────────────────────────────────────────────────────

/** The featured format key stored on `tournaments.format`. */
export const KING_PIT_FORMAT = 'king_pit'

/** All recognized tournament formats. 'standard' is the pre-existing default. */
export type TournamentFormat = 'standard' | 'king_pit'

/** One-line pitch shown on the TKO King hero / registration screen. */
export const KING_TAGLINE =
  '1-on-1 singles · pit-based · play anytime — no in-game rules, find the best Shinobi.'

/** True if a tournament row is a TKO King (king_pit) tournament. */
export function isKingPit(t: { format?: string | null } | null | undefined): boolean {
  return (t?.format ?? 'standard') === KING_PIT_FORMAT
}

// ───────────────────────────────────────────────────────────────────────────
//  HOST CAPABILITY — founder host codes → a global `tko_host` flag.
//
//  Redeeming one of these codes sets `user_metadata.tko_host = true`. That flag
//  lets the holder host / run ANY tournament or battle at any time — it passes
//  every tournament host/admin permission check (see isTkoHost + the wiring in
//  TournamentDetail / TkoKing). Distinct from the paid-tier redeem codes: a host
//  code grants NO tier, just the run-anything capability.
// ───────────────────────────────────────────────────────────────────────────

/**
 * The 3 founder HOST codes. Redeeming any of these flips `tko_host` on for good.
 * Recognized by the redeem-code function in server/app.ts AND the mock backend
 * (src/lib/mockSupabase.ts) — keep all three lists in sync.
 */
export const TKO_HOST_CODES: readonly string[] = [
  'TKO-HOST-K9F3QX',
  'TKO-HOST-M4R7PZ',
  'TKO-HOST-B2X8LT',
  'TKO-HOST-3P9K2J',
  'TKO-HOST-7X4M8Q',
] as const

/** Metadata key the global host flag lives under on `user.user_metadata`. */
export const HOST_META_KEY = 'tko_host'

/** True if `code` (case-insensitive, trimmed) is one of the 3 founder host codes. */
export function isHostCode(code: string | null | undefined): boolean {
  const c = String(code ?? '').trim().toUpperCase()
  return TKO_HOST_CODES.includes(c)
}

type MaybeUser = { user_metadata?: Record<string, unknown> | null } | null | undefined

/** True if the signed-in user holds the global TKO host capability. */
export function isTkoHost(user: MaybeUser): boolean {
  const md = (user?.user_metadata ?? undefined) as Record<string, unknown> | undefined
  return md?.[HOST_META_KEY] === true
}

/**
 * True if the user is an ACTIVE member of the single top paid tier (`creator`,
 * shown as "Legend"). Resolved through entitlementsFromUser so a lapsed grant
 * (past `reelone_tier_expires`) does NOT count.
 */
export function isTopTier(user: MaybeUser): boolean {
  return entitlementsFromUser(user).tier === TOP_TIER
}

/**
 * May this user access the HOST lane? Viewing is open to everyone; HOSTING is
 * gated to EITHER a founder host code (the global tko_host capability) OR an
 * active top-tier ("Legend") membership. This is the single source of truth for
 * the /host route guard, the sidebar "Host" link, and mirrors the backend
 * host_commentaries insert check in server/app.ts.
 */
export function canHost(user: MaybeUser): boolean {
  return isTkoHost(user) || isTopTier(user)
}

/** The user_metadata patch that grants the global host flag. */
export function grantHostMeta(): { [HOST_META_KEY]: true } {
  return { [HOST_META_KEY]: true }
}

// ───────────────────────────────────────────────────────────────────────────
//  MEMBERSHIP GRANT — "everyone who competes gets a month of membership."
//
//  On successful registration a competitor is granted the lowest paid tier
//  (`ad_free`) for 30 days, via the SAME entitlement path redeem/trial use
//  (reelone_tier + reelone_tier_expires). We never DOWNGRADE: a user already on a
//  streaming tier (pro/supporter/creator) that outlasts the +30d window keeps it.
// ───────────────────────────────────────────────────────────────────────────

/** The lowest paid tier competitors receive for a month. */
export const COMPETITOR_TIER = 'ad_free'

export type MembershipPatch = {
  reelone_tier: string
  reelone_tier_expires: string
}

const STREAMING_TIERS = new Set(['pro', 'supporter', 'creator'])

/**
 * Build the +30-day membership grant for a competitor, or `null` when the user
 * already has an equal-or-better active grant (so we never shorten/downgrade a
 * paying member). Reuses reelone_tier / reelone_tier_expires — exactly what
 * useEntitlements reads — so the grant shows up immediately and lapses cleanly.
 */
export function membershipGrantMeta(user: MaybeUser, now: number = Date.now()): MembershipPatch | null {
  const target = now + MONTH_DAYS * MS_PER_DAY
  const md = (user?.user_metadata ?? undefined) as Record<string, unknown> | undefined
  const curTier = typeof md?.reelone_tier === 'string' ? md.reelone_tier : ''
  const curExpiresRaw = typeof md?.reelone_tier_expires === 'string' ? md.reelone_tier_expires : ''
  const curExpires = curExpiresRaw ? Date.parse(curExpiresRaw) : NaN
  const active = Number.isFinite(curExpires) ? curExpires > now : false

  // Keep a still-active STREAMING tier (higher than ad_free) as-is.
  if (active && STREAMING_TIERS.has(curTier) && curExpires >= target) return null

  // Otherwise grant ad_free through the later of (existing expiry, now+30d) so a
  // longer existing ad_free grant is never shortened.
  const expiresMs = active && Number.isFinite(curExpires) ? Math.max(curExpires, target) : target
  return {
    reelone_tier: COMPETITOR_TIER,
    reelone_tier_expires: new Date(expiresMs).toISOString(),
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  REGISTRATION ENTRY GATE
//
//  FOUR steps are REQUIRED to register, and connecting YouTube is RECOMMENDED
//  but NOT a gate.
//
//  Why: Google OAuth for the TKO client is still in "testing" mode, so only
//  allow-listed Google accounts can complete the consent flow until app
//  verification clears. Making the channel link mandatory therefore locked
//  everyone else out of sign-ups entirely. The channel is still needed before a
//  Shinobi's FIRST BATTLE streams — it just no longer blocks the door.
//
//  The recommended step can be satisfied two ways, both of which land a row in
//  `user_youtube_links` and flip `youtubeConnected`:
//    • one-tap Google OAuth on /connect, or
//    • pasting a channel / clip link on /connect (the pre-existing paste path).
//  A Shinobi who does neither can still register after ticking `streamPlanAck`
//  ("I'll add my stream link before my first battle") — that tick is recorded
//  for follow-up but is NOT part of `canRegister`.
// ───────────────────────────────────────────────────────────────────────────

/** The registration checklist. Only REGISTRATION_REQUIRED_STEP_KEYS gate entry. */
export interface RegistrationChecklist {
  /** (a) REQUIRED — signed in with at least a free account. */
  signedIn: boolean
  /** (b) RECOMMENDED — YouTube connected (OAuth) or a link pasted / saved. */
  youtubeConnected: boolean
  /** (c) REQUIRED — agreed to LIVE-STREAM their battles on TKO. */
  agreedToStream: boolean
  /** (d) REQUIRED — no-modding attestation accepted. */
  noModAck: boolean
  /** (e) REQUIRED — completed a stat check for this tournament. */
  statCheckDone: boolean
  /**
   * (f) OPTIONAL acknowledgement — "I'll add my stream link before my first
   * battle." Recorded so hosts can chase it; never gates registration.
   */
  streamPlanAck?: boolean
}

/** Every step the UI renders, in order (required + recommended). */
export const REGISTRATION_STEP_KEYS: (keyof RegistrationChecklist)[] = [
  'signedIn',
  'youtubeConnected',
  'agreedToStream',
  'noModAck',
  'statCheckDone',
]

/** The steps that ACTUALLY gate registration. YouTube is deliberately absent. */
export const REGISTRATION_REQUIRED_STEP_KEYS: (keyof RegistrationChecklist)[] = [
  'signedIn',
  'agreedToStream',
  'noModAck',
  'statCheckDone',
]

/** Steps shown as "recommended" — surfaced, explained, but never blocking. */
export const REGISTRATION_RECOMMENDED_STEP_KEYS: (keyof RegistrationChecklist)[] = [
  'youtubeConnected',
]

/** How many steps must be cleared before the Register button unlocks. */
export const REGISTRATION_REQUIRED_COUNT = REGISTRATION_REQUIRED_STEP_KEYS.length

/** Short human labels for each registration step. */
export const REGISTRATION_STEP_LABELS: Record<keyof RegistrationChecklist, string> = {
  signedIn: 'Sign in',
  youtubeConnected: 'Connect YouTube',
  agreedToStream: 'Agree to live-stream',
  noModAck: 'No-modding attestation',
  statCheckDone: 'Stat check',
  streamPlanAck: "I'll add my stream link before my first battle",
}

/** True when every REQUIRED step is cleared and the Shinobi may register. */
export function canRegister(c: RegistrationChecklist): boolean {
  return REGISTRATION_REQUIRED_STEP_KEYS.every((k) => c[k] === true)
}

/** How many of the REQUIRED steps are cleared (for the progress read-out). */
export function registrationProgress(c: RegistrationChecklist): number {
  return REGISTRATION_REQUIRED_STEP_KEYS.reduce((n, k) => n + (c[k] ? 1 : 0), 0)
}

/**
 * True when the recommended channel step is settled one way or the other —
 * either the channel is linked, or the Shinobi acknowledged they'll add it
 * before their first battle. Purely for display state; never gates entry.
 */
export function registrationChannelSettled(c: RegistrationChecklist): boolean {
  return c.youtubeConnected === true || c.streamPlanAck === true
}

// ───────────────────────────────────────────────────────────────────────────
//  THE SCHEDULE — ONE configurable place. The TKO King runs ITSELF.
//
//  Nobody has to "start" the King. The season is a fixed calendar, and every
//  phase is a pure function of the CURRENT DATE against these constants. Change
//  a date here and the whole product — the hero, /king, the board, the
//  countdowns, the seeded tournament row — moves with it. No organizer, no
//  cron, no host action required.
//
//  Season 1 (September sign-up season):
//    • Enrollment   Mon 2026-09-07 → Sun 2026-09-27
//    • Battles      Mon 2026-09-28 → Sun 2026-10-25
//    • Finals week  Mon 2026-10-26 → Sat 2026-10-31
//    • Crowned      Sun 2026-11-01
//
//  Boundaries are stored as UTC instants at the START of the named day, so
//  "battles Mon 09-28" means the battles phase begins at 2026-09-28T00:00Z and
//  the enrollment phase ends at the very same instant (no dead gap between
//  phases — the King is always in exactly one phase).
// ───────────────────────────────────────────────────────────────────────────

export interface KingSchedule {
  /** Season label shown on the board / hero. */
  season: string
  /** Enrollment opens (ISO). Before this the King is in 'preseason'. */
  enrollOpens: string
  /** Enrollment closes AND battles begin (ISO) — one shared boundary. */
  battlesStart: string
  /** Battles end AND finals week begins (ISO) — one shared boundary. */
  finalsStart: string
  /** The King is crowned (ISO). Finals week runs up to this instant. */
  crownedAt: string
}

/**
 * THE schedule. Edit these five values to move the season; everything else
 * (phases, countdowns, the seeded tournament row, the board header) derives.
 */
export const KING_SCHEDULE: KingSchedule = {
  season: 'Season 1',
  enrollOpens: '2026-09-07T00:00:00.000Z',
  battlesStart: '2026-09-28T00:00:00.000Z',
  finalsStart: '2026-10-26T00:00:00.000Z',
  crownedAt: '2026-11-01T00:00:00.000Z',
}

/** Enrollment closes exactly when battles start — exposed for readable UI copy. */
export const KING_ENROLL_CLOSES = KING_SCHEDULE.battlesStart

/**
 * The five schedule-driven phases. Distinct from the legacy 4-value `KingPhase`
 * (which describes a tournament ROW); this one describes the SEASON.
 */
export type KingScheduledPhase = 'preseason' | 'enroll' | 'battles' | 'finals' | 'crowned'

export const KING_SCHEDULED_PHASES: KingScheduledPhase[] = [
  'preseason',
  'enroll',
  'battles',
  'finals',
  'crowned',
]

/**
 * Where the season is RIGHT NOW, purely from the date. This is the function
 * that makes the tournament self-running: it never returns "no tournament" and
 * never needs an organizer to advance it.
 */
export function scheduledKingPhase(
  now: number = Date.now(),
  schedule: KingSchedule = KING_SCHEDULE,
): KingScheduledPhase {
  const open = Date.parse(schedule.enrollOpens)
  const battles = Date.parse(schedule.battlesStart)
  const finals = Date.parse(schedule.finalsStart)
  const crowned = Date.parse(schedule.crownedAt)
  if (now >= crowned) return 'crowned'
  if (now >= finals) return 'finals'
  if (now >= battles) return 'battles'
  if (now >= open) return 'enroll'
  return 'preseason'
}

/** Bold, user-facing name for a scheduled phase. */
export function scheduledPhaseLabel(phase: KingScheduledPhase): string {
  switch (phase) {
    case 'preseason': return 'Preseason'
    case 'enroll': return 'Enrollment open'
    case 'battles': return 'Battles'
    case 'finals': return 'Finals week'
    case 'crowned': return 'King crowned'
  }
}

/** The one line telling a Shinobi what to DO in this phase. */
export function scheduledPhaseAction(phase: KingScheduledPhase): string {
  switch (phase) {
    case 'preseason':
      return 'Enrollment has not opened yet. Get your YouTube connected and your stat check done so you can register the minute it opens.'
    case 'enroll':
      return 'Register now — clear the 5 entry steps and claim your free month. Enrollment closes when battles begin.'
    case 'battles':
      return 'Find your matchup on the board, agree a time with your opponent, swap your in-game name in the pit meet-up, and play.'
    case 'finals':
      return 'Finals week. Only the Shinobi still standing fight. Watch the board — every battle streams.'
    case 'crowned':
      return 'The King has been crowned. Check the board for the full run and the next season.'
  }
}

/** The phase that follows this one, or null once the King is crowned. */
export function nextScheduledPhase(phase: KingScheduledPhase): KingScheduledPhase | null {
  const i = KING_SCHEDULED_PHASES.indexOf(phase)
  return i < 0 || i >= KING_SCHEDULED_PHASES.length - 1 ? null : KING_SCHEDULED_PHASES[i + 1]
}

/** The ISO instant a given phase BEGINS (preseason has no start — it just is). */
export function phaseStartIso(
  phase: KingScheduledPhase,
  schedule: KingSchedule = KING_SCHEDULE,
): string | null {
  switch (phase) {
    case 'preseason': return null
    case 'enroll': return schedule.enrollOpens
    case 'battles': return schedule.battlesStart
    case 'finals': return schedule.finalsStart
    case 'crowned': return schedule.crownedAt
  }
}

/**
 * Render a duration as a short, phone-friendly countdown: "12d 4h", "4h 13m",
 * "13m 20s", "now". Never negative.
 */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'now'
  const totalSec = Math.floor(ms / 1000)
  const d = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

/** Everything a surface needs to render the season header, in one object. */
export interface KingPhaseState {
  phase: KingScheduledPhase
  /** Bold phase name, e.g. "Finals week". */
  label: string
  /** What the user should do now. */
  action: string
  /** ISO the current phase began (null in preseason). */
  startsAt: string | null
  /** The phase that comes next (null once crowned). */
  nextPhase: KingScheduledPhase | null
  /** Label of the next phase (null once crowned). */
  nextLabel: string | null
  /** ISO the next phase begins (null once crowned). */
  nextAt: string | null
  /** Milliseconds until the next phase (0 once crowned). */
  msUntilNext: number
  /** Short countdown string, e.g. "12d 4h" (empty once crowned). */
  countdown: string
  /** Always true — the King ALWAYS exists. Kept explicit so UI can't regress. */
  running: true
}

/**
 * The single call every King surface makes. Given only the current time it
 * returns the live phase, what to do, and a countdown to the next phase — so
 * the tournament advertises and advances itself with nobody running it.
 */
export function kingPhaseState(
  now: number = Date.now(),
  schedule: KingSchedule = KING_SCHEDULE,
): KingPhaseState {
  const phase = scheduledKingPhase(now, schedule)
  const next = nextScheduledPhase(phase)
  const nextAt = next ? phaseStartIso(next, schedule) : null
  const nextMs = nextAt ? Date.parse(nextAt) : NaN
  const msUntilNext = Number.isFinite(nextMs) ? Math.max(0, nextMs - now) : 0
  return {
    phase,
    label: scheduledPhaseLabel(phase),
    action: scheduledPhaseAction(phase),
    startsAt: phaseStartIso(phase, schedule),
    nextPhase: next,
    nextLabel: next ? scheduledPhaseLabel(next) : null,
    nextAt,
    msUntilNext,
    countdown: next ? formatCountdown(msUntilNext) : '',
    running: true,
  }
}

/** True only during the scheduled enrollment window. */
export function isScheduledEnrollmentOpen(
  now: number = Date.now(),
  schedule: KingSchedule = KING_SCHEDULE,
): boolean {
  return scheduledKingPhase(now, schedule) === 'enroll'
}

/**
 * The tournament ROW the King should exist as, built entirely from the
 * schedule. `/king` find-or-creates with this (mirroring `ensureTkoSpace`), so
 * the King is never an empty "no tournament running" state and its row dates
 * always agree with the schedule constants.
 */
export function kingTournamentSeed(
  createdBy: string | null = null,
  schedule: KingSchedule = KING_SCHEDULE,
): Record<string, unknown> {
  return {
    name: `TKO King — ${schedule.season}`,
    description: `The featured Shinobi ladder. ${KING_TAGLINE}`,
    rules:
      'No in-game rules — find the best Shinobi. 1-on-1 singles, pit-based, play anytime. All battles are live-streamed; no modding.',
    created_by: createdBy,
    status: 'open',
    format: KING_PIT_FORMAT,
    is_featured: true,
    streams_to_youtube: true,
    enroll_opens: schedule.enrollOpens,
    enroll_closes: schedule.battlesStart,
    start_at: schedule.battlesStart,
    end_at: schedule.crownedAt,
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  PHASES — open ENROLLMENT → SCHEDULING → BATTLES → COMPLETE.
// ───────────────────────────────────────────────────────────────────────────

export type KingPhase = 'enroll' | 'scheduling' | 'battles' | 'complete'

export interface KingPhaseInput {
  /** ISO — when enrollment opens (null = already open). */
  enroll_opens?: string | null
  /** ISO — when enrollment closes and scheduling begins. */
  enroll_closes?: string | null
  /** ISO — when battles begin (play from here on). */
  start_at?: string | null
  /** Tournament status; 'closed' forces 'complete'. */
  status?: string | null
}

function ms(iso: string | null | undefined): number {
  if (!iso) return NaN
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : NaN
}

/**
 * Resolve the current phase from the tournament's window columns + status.
 * Missing dates degrade gracefully: with no windows set a tournament sits in
 * 'enroll' until a host closes enrollment / starts battles (or sets status).
 *   • status 'closed'                         → complete
 *   • now ≥ start_at                          → battles
 *   • now ≥ enroll_closes (before start_at)   → scheduling
 *   • no windows at all                       → derived from KING_SCHEDULE
 *   • otherwise                               → enroll
 *
 * The no-windows fallback is what keeps a King with a bare row self-running:
 * it still advances on the season calendar rather than sitting in 'enroll'
 * forever waiting for an organizer.
 */
export function kingPhase(t: KingPhaseInput, now: number = Date.now()): KingPhase {
  if ((t.status ?? '') === 'closed') return 'complete'
  const start = ms(t.start_at)
  const close = ms(t.enroll_closes)
  if (Number.isFinite(start) && now >= start) return 'battles'
  if (Number.isFinite(close) && now >= close) return 'scheduling'
  if (!Number.isFinite(start) && !Number.isFinite(close)) {
    return scheduledToLegacyPhase(scheduledKingPhase(now))
  }
  return 'enroll'
}

/** Map a schedule phase onto the legacy 4-value row phase. */
export function scheduledToLegacyPhase(phase: KingScheduledPhase): KingPhase {
  switch (phase) {
    case 'preseason': return 'enroll'
    case 'enroll': return 'enroll'
    case 'battles': return 'battles'
    case 'finals': return 'battles'
    case 'crowned': return 'complete'
  }
}

/** True while enrollment is open (registration accepted). */
export function isEnrollmentOpen(t: KingPhaseInput, now: number = Date.now()): boolean {
  if (kingPhase(t, now) !== 'enroll') return false
  const opens = ms(t.enroll_opens)
  // If an opens time is set and it's in the future, enrollment hasn't opened yet.
  return Number.isFinite(opens) ? now >= opens : true
}

/** User-facing label for a phase. */
export function kingPhaseLabel(phase: KingPhase): string {
  switch (phase) {
    case 'enroll': return 'Enrollment open'
    case 'scheduling': return 'Scheduling'
    case 'battles': return 'Battles live'
    case 'complete': return 'Complete'
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  BATTLES — 1-on-1 matchups with a self-scheduled time + a status lifecycle.
// ───────────────────────────────────────────────────────────────────────────

export type BattleStatus = 'scheduled' | 'live' | 'complete' | 'forfeit'

export const BATTLE_STATUSES: BattleStatus[] = ['scheduled', 'live', 'complete', 'forfeit']

/** A battle is finished (a winner is recorded) when complete OR forfeited. */
export function isBattleDecided(status: string | null | undefined): boolean {
  return status === 'complete' || status === 'forfeit'
}

/** User-facing label + colour hint for a battle status. */
export function battleStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'live': return 'Live'
    case 'complete': return 'Complete'
    case 'forfeit': return 'Forfeit'
    case 'scheduled':
    default: return 'Scheduled'
  }
}

/**
 * A no-show / not-present Shinobi loses by FORFEIT. Given the battle's two
 * players and which one didn't show, returns the { winner, loser } — the player
 * who WAS present takes the win. Returns null if the no-show isn't in the battle.
 */
export function forfeitOutcome(
  playerA: string,
  playerB: string | null,
  noShowId: string,
): { winner: string; loser: string } | null {
  if (noShowId === playerA && playerB) return { winner: playerB, loser: playerA }
  if (noShowId === playerB) return { winner: playerA, loser: noShowId }
  return null
}

// ───────────────────────────────────────────────────────────────────────────
//  SHINOBI TROPHY CLOSET — each defeated opponent becomes a "Shinobi" entry.
//
//  Pure aggregation over `shinobi_defeats` rows (user beat opponent, beat_count).
//  The UI renders one card per opponent with their avatar + a "times beaten"
//  count shown as "coming soon" for now (see COUNT_COMING_SOON).
// ───────────────────────────────────────────────────────────────────────────

/** Placeholder shown for the beat count until the live counter ships. */
export const COUNT_COMING_SOON = 'coming soon'

export interface ShinobiDefeatRow {
  opponent_id: string
  beat_count?: number | null
  /** Optional enrichment the UI joins in. */
  opponent_username?: string | null
  opponent_avatar_url?: string | null
}

export interface ShinobiTrophy {
  opponentId: string
  username: string
  avatarUrl: string | null
  beatCount: number
}

/**
 * Fold `shinobi_defeats` rows into the closet's per-opponent trophies, summing
 * duplicate rows defensively and sorting most-beaten first. Pure.
 */
export function buildTrophyCloset(rows: ShinobiDefeatRow[]): ShinobiTrophy[] {
  const byOpp = new Map<string, ShinobiTrophy>()
  for (const r of rows) {
    if (!r?.opponent_id) continue
    const prev = byOpp.get(r.opponent_id)
    const add = Math.max(0, Math.floor(Number(r.beat_count ?? 1)) || 0)
    if (prev) {
      prev.beatCount += add
      prev.username = prev.username || r.opponent_username || 'Shinobi'
      prev.avatarUrl = prev.avatarUrl ?? r.opponent_avatar_url ?? null
    } else {
      byOpp.set(r.opponent_id, {
        opponentId: r.opponent_id,
        username: r.opponent_username || 'Shinobi',
        avatarUrl: r.opponent_avatar_url ?? null,
        beatCount: add,
      })
    }
  }
  return Array.from(byOpp.values()).sort((a, b) => b.beatCount - a.beatCount)
}

/** How the closet renders a trophy's count today: a "coming soon" placeholder. */
export function trophyCountLabel(_trophy: ShinobiTrophy): string {
  // Real per-opponent tallies land with the live battle counter; until then the
  // count is a placeholder so the closet UI is complete without over-promising.
  return COUNT_COMING_SOON
}

// ───────────────────────────────────────────────────────────────────────────
//  ADVERTISING — the upcoming / live battles every surface shows.
// ───────────────────────────────────────────────────────────────────────────

/** The minimal battle shape the pure helpers need (a superset of the DB row). */
export interface BattleLike {
  id: string
  player_a: string
  player_b?: string | null
  scheduled_at?: string | null
  status?: string | null
  winner?: string | null
  /** Optional explicit round; derived when absent. */
  round?: number | null
  created_at?: string | null
}

/**
 * The battles worth ADVERTISING right now, best-first:
 *   1. anything LIVE (most urgent),
 *   2. then scheduled battles in the future, soonest first.
 * Decided battles and battles with no time set are never advertised.
 */
export function upcomingBattles<T extends BattleLike>(
  battles: T[],
  now: number = Date.now(),
  limit = 6,
): T[] {
  const live = battles.filter((b) => b.status === 'live')
  const soon = battles
    .filter((b) => !isBattleDecided(b.status) && b.status !== 'live' && b.scheduled_at)
    .filter((b) => {
      const t = Date.parse(String(b.scheduled_at))
      return Number.isFinite(t) && t >= now
    })
    .sort((a, b) => Date.parse(String(a.scheduled_at)) - Date.parse(String(b.scheduled_at)))
  return [...live, ...soon].slice(0, Math.max(0, limit))
}

/** "In 4h 13m" / "Live now" / "Time TBD" — the one-liner on a battle card. */
export function battleTimingLabel(b: BattleLike, now: number = Date.now()): string {
  if (b.status === 'live') return 'Live now'
  if (isBattleDecided(b.status)) return battleStatusLabel(b.status)
  if (!b.scheduled_at) return 'Time TBD'
  const t = Date.parse(String(b.scheduled_at))
  if (!Number.isFinite(t)) return 'Time TBD'
  if (t <= now) return 'Starting now'
  return `In ${formatCountdown(t - now)}`
}

// ───────────────────────────────────────────────────────────────────────────
//  THE BOARD — the whole field: fighters, rounds, results, who advances.
//
//  `tournament_battles` has no required `round` column, so rounds are DERIVED
//  when one isn't set: battles are walked in chronological order and a battle's
//  round is one past the deeper of its two fighters' win counts so far. That
//  reproduces a normal single-elimination ladder without a schema change, and
//  an explicit `round` (if it ever lands) always wins.
// ───────────────────────────────────────────────────────────────────────────

/** Total rounds a field of `n` fighters needs (single elimination). */
export function totalRoundsForField(n: number): number {
  const size = Math.max(0, Math.floor(n))
  if (size <= 1) return 0
  return Math.ceil(Math.log2(size))
}

/**
 * Round name relative to the finish: the last round is the Final, the one
 * before it the Semifinal, then Quarterfinal, then "Round of 16/32/…".
 */
export function roundLabel(round: number, totalRounds: number): string {
  const r = Math.max(1, Math.floor(round))
  const total = Math.floor(totalRounds)
  if (!Number.isFinite(total) || total < r) return `Round ${r}`
  const remaining = total - r
  if (remaining === 0) return 'Final'
  if (remaining === 1) return 'Semifinal'
  if (remaining === 2) return 'Quarterfinal'
  return `Round of ${2 ** (remaining + 1)}`
}

export type BoardFighterStatus = 'active' | 'eliminated' | 'champion'

export interface BoardFighter {
  userId: string
  username: string
  avatarUrl: string | null
  wins: number
  losses: number
  /** How many rounds this Shinobi cleared — "how far they got". */
  roundsCleared: number
  status: BoardFighterStatus
  /** Round they went out in (null while still standing). */
  eliminatedInRound: number | null
}

export interface BoardBattle<T extends BattleLike = BattleLike> {
  battle: T
  round: number
}

export interface BoardRound<T extends BattleLike = BattleLike> {
  round: number
  label: string
  battles: BoardBattle<T>[]
  /** True when every battle in the round is decided. */
  complete: boolean
}

export interface KingBoard<T extends BattleLike = BattleLike> {
  fighters: BoardFighter[]
  rounds: BoardRound<T>[]
  totalRounds: number
  fieldSize: number
  /** The crowned King, once the final is decided. */
  champion: BoardFighter | null
  /** Everyone still standing (no losses). */
  advancing: BoardFighter[]
}

export interface BoardFighterInput {
  user_id: string
  username?: string | null
  avatar_url?: string | null
}

function battleOrderKey(b: BattleLike): number {
  const created = b.created_at ? Date.parse(b.created_at) : NaN
  if (Number.isFinite(created)) return created
  const sched = b.scheduled_at ? Date.parse(b.scheduled_at) : NaN
  return Number.isFinite(sched) ? sched : 0
}

/**
 * Fold registrations + battles into the big board: every fighter with their
 * record and how far they got, every battle grouped into a labelled round, the
 * champion once the final lands. Pure — the board page just renders this.
 */
export function buildKingBoard<T extends BattleLike>(
  registrations: BoardFighterInput[],
  battles: T[],
): KingBoard<T> {
  const fighters = new Map<string, BoardFighter>()
  const ensure = (id: string, name?: string | null, avatar?: string | null): BoardFighter => {
    let f = fighters.get(id)
    if (!f) {
      f = {
        userId: id,
        username: name || 'shinobi',
        avatarUrl: avatar ?? null,
        wins: 0,
        losses: 0,
        roundsCleared: 0,
        status: 'active',
        eliminatedInRound: null,
      }
      fighters.set(id, f)
    } else if (name && f.username === 'shinobi') {
      f.username = name
    }
    return f
  }

  for (const r of registrations) {
    if (r?.user_id) ensure(r.user_id, r.username, r.avatar_url)
  }

  // Walk battles in order so derived rounds respect the ladder.
  const ordered = [...battles].sort((a, b) => battleOrderKey(a) - battleOrderKey(b))
  const winsSoFar = new Map<string, number>()
  const placed: BoardBattle<T>[] = []

  for (const b of ordered) {
    const a = ensure(b.player_a)
    const opp = b.player_b ? ensure(b.player_b) : null
    const depth = Math.max(winsSoFar.get(a.userId) ?? 0, opp ? winsSoFar.get(opp.userId) ?? 0 : 0)
    const round =
      Number.isFinite(Number(b.round)) && Number(b.round) > 0 ? Math.floor(Number(b.round)) : depth + 1
    placed.push({ battle: b, round })

    if (isBattleDecided(b.status) && b.winner) {
      const winner = ensure(b.winner)
      const loserId = b.winner === b.player_a ? b.player_b ?? null : b.player_a
      winner.wins += 1
      winner.roundsCleared = Math.max(winner.roundsCleared, round)
      winsSoFar.set(winner.userId, (winsSoFar.get(winner.userId) ?? 0) + 1)
      if (loserId) {
        const loser = ensure(loserId)
        loser.losses += 1
        loser.status = 'eliminated'
        if (loser.eliminatedInRound == null) loser.eliminatedInRound = round
      }
    }
  }

  const fieldSize = fighters.size
  const maxRound = placed.reduce((m, p) => Math.max(m, p.round), 0)
  const totalRounds = Math.max(totalRoundsForField(fieldSize), maxRound)

  const byRound = new Map<number, BoardBattle<T>[]>()
  for (const p of placed) {
    const list = byRound.get(p.round) ?? []
    list.push(p)
    byRound.set(p.round, list)
  }
  const rounds: BoardRound<T>[] = Array.from(byRound.keys())
    .sort((a, b) => a - b)
    .map((round) => {
      const list = byRound.get(round) ?? []
      return {
        round,
        label: roundLabel(round, totalRounds),
        battles: list,
        complete: list.length > 0 && list.every((x) => isBattleDecided(x.battle.status)),
      }
    })

  // The King: the winner of a DECIDED final (the single battle of the last round).
  let champion: BoardFighter | null = null
  const finalRound = rounds.find((r) => r.round === totalRounds)
  if (finalRound && finalRound.battles.length === 1 && finalRound.complete) {
    const w = finalRound.battles[0].battle.winner
    const f = w ? fighters.get(w) ?? null : null
    if (f) {
      f.status = 'champion'
      champion = f
    }
  }

  const list = Array.from(fighters.values()).sort(
    (a, b) => b.roundsCleared - a.roundsCleared || b.wins - a.wins || a.losses - b.losses ||
      a.username.localeCompare(b.username),
  )
  return {
    fighters: list,
    rounds,
    totalRounds,
    fieldSize,
    champion,
    advancing: list.filter((f) => f.status !== 'eliminated'),
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  PIT MEET-UP — the private per-battle info exchange between the 2 fighters.
//
//  The pit is played in-game, so the two Shinobi have to swap the details that
//  let them actually FIND each other: in-game name, platform, lobby/room, notes.
//  Each fighter posts their own card; both see the other's. Nobody else does,
//  except a host who may need to adjudicate. Persisted per battle in
//  `battle_meetups` (battle_id, user_id) — see db/schema.sql.
// ───────────────────────────────────────────────────────────────────────────

export interface MeetupDetails {
  /** The name the opponent will actually see in-game. The critical field. */
  inGameName: string
  /** PSN / Xbox / Steam / Switch — free text so no platform is excluded. */
  platform: string
  /** Lobby / room / session code, if the pair use one. */
  lobby: string
  /** Anything else: "message me first", "I'm on around 9pm ET". */
  notes: string
}

export const EMPTY_MEETUP: MeetupDetails = { inGameName: '', platform: '', lobby: '', notes: '' }

/** The prompt shown above the form — the point of the whole exchange. */
export const MEETUP_PROMPT =
  'Share your in-game name so your opponent can find you in the pit.'

/**
 * Who may see a battle's meet-up exchange: ONLY the two fighters and hosts.
 * Everything else on the board is public; this is not.
 */
export function canSeeMeetup(input: {
  viewerId: string | null | undefined
  playerA: string
  playerB?: string | null
  isHost?: boolean
}): boolean {
  if (input.isHost === true) return true
  const v = input.viewerId
  if (!v) return false
  return v === input.playerA || (!!input.playerB && v === input.playerB)
}

/** True once a fighter has posted enough for their opponent to find them. */
export function isMeetupReady(d: Partial<MeetupDetails> | null | undefined): boolean {
  return Boolean(d && String(d.inGameName ?? '').trim().length > 0)
}

/** Normalize a meet-up form into a trimmed, storable record. */
export function normalizeMeetup(d: Partial<MeetupDetails> | null | undefined): MeetupDetails {
  return {
    inGameName: String(d?.inGameName ?? '').trim().slice(0, 60),
    platform: String(d?.platform ?? '').trim().slice(0, 40),
    lobby: String(d?.lobby ?? '').trim().slice(0, 60),
    notes: String(d?.notes ?? '').trim().slice(0, 300),
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  ARTIFACT PRIZES — advancing a round earns a cosmetic artifact.
//
//  Prestige only. These are DigitalAssets granted through the same
//  `assets.grantAsset` path the Oracle rewards use (priceTokens 0 — never for
//  sale, only earned). No cash, ever.
// ───────────────────────────────────────────────────────────────────────────

/** Every King artifact id starts with this, so the locker can group them. */
export const KING_PRIZE_ID_PREFIX = 'king-prize-'

/** The `teamName` all King artifacts carry. */
export const KING_PRIZE_TEAM = 'TKO King'

function kingArtifact(
  slug: string,
  name: string,
  kind: DigitalAsset['kind'],
  colors: string,
  caption: string,
): DigitalAsset {
  return {
    id: `${KING_PRIZE_ID_PREFIX}${slug}`,
    name,
    teamName: KING_PRIZE_TEAM,
    imageUrl: `https://placehold.co/400x400/${colors}?text=${encodeURIComponent(caption)}`,
    priceTokens: 0,
    kind,
    sellerType: 'official',
    clanId: null,
    createdBy: 'tko-king',
    createdAt: 0,
  }
}

/** The crown — for the Shinobi who wins the final. The biggest artifact. */
export const KING_CROWN_PRIZE = kingArtifact(
  'crown',
  'TKO King Crown',
  'badge_skin',
  '1a1400/f9c74f',
  'KING',
)

/** For reaching the final (won the semifinal). */
export const KING_FINALIST_PRIZE = kingArtifact(
  'finalist',
  'Finalist Banner',
  'banner',
  '1a1a2e/e94560',
  'FINALIST',
)

/** For reaching the semifinal (won the quarterfinal). */
export const KING_SEMIFINALIST_PRIZE = kingArtifact(
  'semifinalist',
  'Semifinalist Sigil',
  'badge_skin',
  '0f3460/16db93',
  'SEMI',
)

/** The per-round advancement tokens, keyed by the round-of size they clear. */
export function roundTokenPrize(round: number, totalRounds: number): DigitalAsset {
  const label = roundLabel(round, totalRounds)
  const slug = `round-${Math.max(1, Math.floor(round))}`
  return kingArtifact(slug, `${label} Token`, 'emote', '241a2e/c084fc', label)
}

/** The whole prize table, biggest first — rendered on the board. */
export const KING_PRIZE_TABLE: { when: string; asset: DigitalAsset }[] = [
  { when: 'Win the Final — you are the TKO King', asset: KING_CROWN_PRIZE },
  { when: 'Win the Semifinal — you are a Finalist', asset: KING_FINALIST_PRIZE },
  { when: 'Win the Quarterfinal — you are a Semifinalist', asset: KING_SEMIFINALIST_PRIZE },
  { when: 'Win any earlier round', asset: roundTokenPrize(1, 4) },
]

/**
 * The artifact a fighter earns for WINNING a battle in `round` of a bracket
 * with `totalRounds` rounds. Deterministic and pure, so it's easy to test.
 */
export function advancementPrize(round: number, totalRounds: number): DigitalAsset {
  const r = Math.max(1, Math.floor(round))
  const total = Math.max(r, Math.floor(totalRounds) || r)
  const remaining = total - r
  if (remaining === 0) return KING_CROWN_PRIZE
  if (remaining === 1) return KING_FINALIST_PRIZE
  if (remaining === 2) return KING_SEMIFINALIST_PRIZE
  return roundTokenPrize(r, total)
}

/** The notification copy that goes with an earned artifact. */
export function prizeNotification(asset: DigitalAsset): { title: string; body: string } {
  const crown = asset.id === KING_CROWN_PRIZE.id
  return {
    title: crown ? 'You are the TKO King 👑' : `Artifact earned — ${asset.name} 🏅`,
    body: crown
      ? 'You won the Final. The crown is in your locker. No cash, all prestige.'
      : `You advanced and earned the ${asset.name}. It's in your locker.`,
  }
}

export interface PrizeGrant {
  asset: DigitalAsset
  alreadyOwned: boolean
}

/**
 * LOCAL MODE. Grant the advancement artifact into a local store. `storage` is
 * REQUIRED — the server path is `awardBattlePrize()` below.
 *
 * Idempotent (re-granting an owned artifact is a no-op) so a host re-confirming
 * a result can't duplicate prizes. No cash moves — this is the prestige economy.
 */
export function grantAdvancementPrize(
  userId: string,
  round: number,
  totalRounds: number,
  storage: AssetStorage | null,
): PrizeGrant | null {
  if (!userId) return null
  const asset = advancementPrize(round, totalRounds)
  const res = grantAsset(userId, asset, storage)
  if (!res.ok) return null
  return { asset, alreadyOwned: res.alreadyOwned }
}

/**
 * SERVER PATH — award the prize for a DECIDED battle.
 *
 * This is the fix for the single worst line in the old audit: "win the whole
 * tournament and your crown exists only in your own browser." The crown is now
 * a row in `asset_ownership` with `source='prize'` and the winning battle's id
 * in `ref_id`, and it survives a cache clear, a new device and a reinstall.
 *
 * The client sends ONLY a battle id. The server (/api/fn/king-prize) then:
 *   • checks the caller is the tournament's host (a fighter cannot award);
 *   • checks the battle is actually decided and reads the winner off the row;
 *   • derives the bracket depth from the registration count, so a shallower
 *     `totalRounds` cannot turn a first-round win into a crown;
 *   • upserts the artifact, grants ownership idempotently, and books both the
 *     `shinobi_defeats` trophy-closet entry and a `wallet_ledger` row.
 *
 * `round` / `totalRounds` are passed as HINTS for brackets whose battles predate
 * the `round` column; the server may only use them to make the bracket deeper
 * (a smaller prize), never shallower.
 */
export async function awardBattlePrize(
  battleId: string,
  hints?: { round?: number; totalRounds?: number },
): Promise<PrizeGrant | null> {
  if (!battleId) return null
  const data = await callFn<{
    ok: boolean
    artifact?: { id: string; name: string; team_name: string; image_url: string; price_tokens: number; kind: DigitalAsset['kind'] }
    alreadyOwned?: boolean
    reason?: string
  }>('king-prize', {
    battleId,
    round: hints?.round,
    totalRounds: hints?.totalRounds,
  })
  if (!data?.ok || !data.artifact) return null
  const a = data.artifact
  return {
    asset: {
      id: a.id,
      name: a.name,
      teamName: a.team_name,
      imageUrl: a.image_url,
      priceTokens: a.price_tokens,
      kind: a.kind,
      sellerType: 'official',
      clanId: null,
      createdBy: 'tko-king',
      createdAt: 0,
    },
    alreadyOwned: !!data.alreadyOwned,
  }
}
