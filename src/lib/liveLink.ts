/**
 * liveLink — the "do these live streams belong together?" engine.
 *
 * The founder's core loop: when several people are live at once, the system
 * should NOTICE that they belong together, link their streams into one
 * multi-angle view, and tell everyone. This module is the pure, dependency-free,
 * fully-unit-tested brain of that. It never touches the DOM, storage or a
 * backend — the impure half (fetching the facts, writing `live_groups`, firing
 * notifications) lives in `src/lib/liveLinkService.ts`.
 *
 * Given a list of CURRENTLY-LIVE streams plus a bag of relationship facts, it
 * scores every PAIR and attaches a reason:
 *
 *   scheduled_battle  the two users are the two fighters of a tournament_battles
 *                     row that is live / scheduled around now. STRONGEST — this
 *                     is a known match, not a guess.
 *   teammates         same clan AND same running tournament — they're repping
 *                     the same clan in the same event.
 *   same_clan         both in the same clan.
 *   same_tournament   both registered in the same running tournament.
 *   mutual_follow     they follow each other.
 *   concurrent_only   both live at the same time and nothing else. WEAKEST —
 *                     never auto-linked (see `shouldAutoLink`).
 *
 * Ranking is by confidence, then by reason strength, then by a stable pair key,
 * so the same inputs always produce the same output order.
 *
 * CONSENT. A strong signal is necessary but not sufficient. Every pair is also
 * put through two gates before it may link automatically:
 *
 *   1. BOTH users' `autoLinkMode` preference — 'auto' (the default) links on
 *      sight, 'ask' turns the link into a PROPOSAL that must be approved, 'off'
 *      never auto-links. The strictest of the two wins, so one person's 'off'
 *      is enough (see `combineAutoLinkModes`).
 *   2. BLOCKS — a blocked pair, in either direction, never auto-links, and if
 *      the block says `hideInSharedLives` they may not share a stage at all.
 *      See `src/lib/blocking.ts`.
 */

import {
  isBlockedPair,
  isHiddenPair,
  pairBlockState,
  type BlockFact,
} from '@/lib/blocking'

// ───────────────────────────────────────────────────────────────────────────
//  Types
// ───────────────────────────────────────────────────────────────────────────

/**
 * A user's live-link preference. AUTO IS THE DEFAULT — the founder's loop only
 * works if links form on their own — but it is a preference, not a fact of life.
 *
 *   'auto'  links form automatically on a strong signal (today's behaviour).
 *   'ask'   a link is PROPOSED; their stream joins only once they approve.
 *   'off'   never auto-linked. They can still join a stage by hand.
 */
export type AutoLinkMode = 'auto' | 'ask' | 'off'

export const DEFAULT_AUTO_LINK_MODE: AutoLinkMode = 'auto'

export const AUTO_LINK_MODES: readonly AutoLinkMode[] = ['auto', 'ask', 'off']

/** Plain-language copy for the settings UI. Kept here so it can be asserted. */
export const AUTO_LINK_MODE_COPY: Record<AutoLinkMode, { label: string; help: string }> = {
  auto: {
    label: 'Link me automatically',
    help: "When you and someone you're matched with are both live, your streams join one multi-angle view and your viewers are told. Recommended.",
  },
  ask: {
    label: 'Ask me first',
    help: "We'll tell you a link is available and your stream only joins once you say yes.",
  },
  off: {
    label: 'Never link me automatically',
    help: 'Your stream is never pulled into a shared stage on its own. You can still join one yourself any time.',
  },
}

/** Anything unrecognised (missing row, old value, junk) reads as the default. */
export function normalizeAutoLinkMode(value: unknown): AutoLinkMode {
  return value === 'ask' || value === 'off' ? value : DEFAULT_AUTO_LINK_MODE
}

/**
 * The pref that governs a PAIR. The stricter of the two always wins:
 * off > ask > auto. One person opting out is enough — consent here is
 * unanimous, never majority.
 */
export function combineAutoLinkModes(a: AutoLinkMode, b: AutoLinkMode): AutoLinkMode {
  if (a === 'off' || b === 'off') return 'off'
  if (a === 'ask' || b === 'ask') return 'ask'
  return 'auto'
}

/**
 * What actually happens to a pair.
 *   'auto'    link now, notify now.
 *   'ask'     propose it; nothing joins until it is approved.
 *   'off'     a user opted out — no link.
 *   'blocked' a block exists either way — no link, ever.
 *   'weak'    the signal itself never qualified (mutual follow / same clock).
 */
export type LinkDecision = 'auto' | 'ask' | 'off' | 'blocked' | 'weak'

export type LiveLinkReason =
  | 'scheduled_battle'
  | 'teammates'
  | 'same_clan'
  | 'same_tournament'
  | 'mutual_follow'
  | 'concurrent_only'

/** One currently-live stream, normalized. */
export interface LiveStreamFact {
  streamId: string
  userId: string
  username?: string | null
  avatarUrl?: string | null
  title?: string | null
  /** epoch ms the stream went live. */
  startedAt: number
  /** epoch ms it ended; null/undefined = still live. */
  endedAt?: number | null
  /** the YouTube (or other) watch url — carried through so the stage can embed it. */
  url?: string | null
  /** context the streamer declared when going live. */
  tournamentId?: string | null
  battleId?: string | null
  clanId?: string | null
}

/** A `tournament_battles` row, normalized. */
export interface BattleFact {
  battleId: string
  tournamentId?: string | null
  playerA: string
  playerB?: string | null
  status?: string | null
  /** epoch ms; null = "play anytime", which both being live satisfies. */
  scheduledAt?: number | null
  round?: number | null
}

/**
 * The relationship facts the engine reasons over. Every field is optional — the
 * more that's present, the more links it can find. Maps are keyed by user id.
 */
export interface RelationshipFacts {
  battles?: BattleFact[]
  /** userId → clan (server) ids they belong to. */
  clansByUser?: Record<string, string[]>
  /** userId → ids of RUNNING tournaments they're registered in. */
  tournamentsByUser?: Record<string, string[]>
  /** follower userId → the user ids they follow. */
  followsByUser?: Record<string, string[]>
  /**
   * userId → their live-link preference. Anyone missing is 'auto', which is
   * the product default — an unknown user must not silently become un-linkable.
   */
  autoLinkModes?: Record<string, AutoLinkMode>
  /**
   * Every block visible to the caller. Only what the current client is allowed
   * to read (its OWN blocks, by policy — nobody may see who blocked them), so
   * the durable enforcement of the other direction lives server-side in
   * TABLE_POLICY. See src/lib/blocking.ts.
   */
  blocks?: BlockFact[]
}

export interface LiveLinkOptions {
  now?: number
  /**
   * How far a battle's `scheduled_at` may sit from now and still count as
   * "happening now". Battles are self-scheduled play-anytime, so this is
   * generous by design.
   */
  battleWindowMs?: number
}

/** One scored pair of live streams. */
export interface LiveLinkCandidate {
  /** stable, order-independent id for the pair. */
  key: string
  a: LiveStreamFact
  b: LiveStreamFact
  /** the strongest reason these two belong together. */
  reason: LiveLinkReason
  /** every reason that matched, strongest first. */
  reasons: LiveLinkReason[]
  /** 0..1 */
  confidence: number
  /** human-readable, e.g. "Scheduled TKO King battle". */
  label: string
  battleId?: string
  tournamentId?: string
  clanId?: string
  /** convenience mirror of `shouldAutoLink(candidate)`. */
  autoLink: boolean
  /** the consent verdict — signal AND both prefs AND blocks. */
  decision: LinkDecision
  /** true when this link needs an explicit yes before the streams join. */
  pending: boolean
  /** a block exists in either direction — never auto-link. */
  blocked: boolean
  /** a block says these two must not share a stage at all. */
  hidden: boolean
  /** the combined preference of both users (strictest wins). */
  mode: AutoLinkMode
}

/** A proposed multi-angle stage: 2–4 live streams that belong on one screen. */
export interface LiveStage {
  key: string
  streams: LiveStreamFact[]
  reason: LiveLinkReason
  confidence: number
  title: string
  battleId?: string
  tournamentId?: string
  clanId?: string
}

// ───────────────────────────────────────────────────────────────────────────
//  Signal strengths & thresholds
// ───────────────────────────────────────────────────────────────────────────

/** Base confidence per reason. */
export const REASON_WEIGHT: Record<LiveLinkReason, number> = {
  scheduled_battle: 0.97,
  teammates: 0.85,
  same_clan: 0.8,
  same_tournament: 0.65,
  mutual_follow: 0.55,
  concurrent_only: 0.2,
}

/** Reasons in strength order (strongest first). Drives tie-breaking. */
export const REASON_RANK: readonly LiveLinkReason[] = [
  'scheduled_battle',
  'teammates',
  'same_clan',
  'same_tournament',
  'mutual_follow',
  'concurrent_only',
]

/** Minimum confidence for an automatic link. */
export const AUTO_LINK_THRESHOLD = 0.6

/**
 * Only these reasons may auto-link. `mutual_follow` (0.55) and
 * `concurrent_only` (0.2) fall short on BOTH the reason gate and the
 * confidence gate — two unrelated people who happen to be live at the same
 * time are never bundled together.
 */
export const AUTO_LINK_REASONS: ReadonlySet<LiveLinkReason> = new Set<LiveLinkReason>([
  'scheduled_battle',
  'teammates',
  'same_clan',
  'same_tournament',
])

/** Each extra corroborating signal nudges confidence up a little. */
const CORROBORATION_BONUS = 0.02
const MAX_CONFIDENCE = 0.99

/** A battle scheduled within ±2h of now counts as "happening now". */
export const DEFAULT_BATTLE_WINDOW_MS = 2 * 60 * 60_000

/** A multi-angle stage tops out at 4 feeds (matches the 4-up player grid). */
export const MAX_STAGE_ANGLES = 8

// ───────────────────────────────────────────────────────────────────────────
//  Small pure helpers
// ───────────────────────────────────────────────────────────────────────────

/** Stable, order-independent key for a pair of ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`
}

/** Is this stream live at `now`? (No end time = still live.) */
export function isLiveAt(s: LiveStreamFact, now: number): boolean {
  if (s.endedAt != null && s.endedAt <= now) return false
  return s.startedAt <= now
}

/** @ handle for display, falling back to a short user id. */
export function handleOf(s: LiveStreamFact): string {
  const name = (s.username ?? '').trim()
  return name ? `@${name.replace(/^@+/, '')}` : `@${s.userId.slice(0, 8)}`
}

function rankOf(r: LiveLinkReason): number {
  const i = REASON_RANK.indexOf(r)
  return i < 0 ? REASON_RANK.length : i
}

function uniq(list: string[]): string[] {
  return [...new Set(list.filter(Boolean))]
}

function intersect(a: string[] | undefined, b: string[] | undefined): string[] {
  if (!a?.length || !b?.length) return []
  const set = new Set(b)
  return uniq(a.filter((x) => set.has(x))).sort()
}

/**
 * Is a battle happening right now? `live` always is. `scheduled` is when its
 * time sits inside the window (or it has no time at all — play-anytime, where
 * both fighters being live IS the signal). Decided battles never are.
 */
export function battleIsNow(
  b: BattleFact,
  now: number,
  windowMs: number = DEFAULT_BATTLE_WINDOW_MS,
): boolean {
  const status = (b.status ?? 'scheduled').toLowerCase()
  if (status === 'complete' || status === 'forfeit') return false
  if (status === 'live') return true
  if (b.scheduledAt == null) return true
  return Math.abs(b.scheduledAt - now) <= windowMs
}

/** Human copy for a reason. */
export function reasonLabel(reason: LiveLinkReason): string {
  switch (reason) {
    case 'scheduled_battle':
      return 'Scheduled TKO King battle'
    case 'teammates':
      return 'Teammates — same clan, same tournament'
    case 'same_clan':
      return 'Same clan'
    case 'same_tournament':
      return 'Both in TKO King'
    case 'mutual_follow':
      return 'They follow each other'
    case 'concurrent_only':
    default:
      return 'Live at the same time'
  }
}

/**
 * The badge a live card shows, written from the point of view of ONE of the two
 * streams — e.g. "⚔ Scheduled battle vs @rex" on rex's opponent's card.
 */
export function linkBadge(c: LiveLinkCandidate, fromStreamId: string): string {
  const other = c.a.streamId === fromStreamId ? c.b : c.a
  const who = handleOf(other)
  switch (c.reason) {
    case 'scheduled_battle':
      return `⚔ Scheduled battle vs ${who}`
    case 'teammates':
      return `Teammates with ${who}`
    case 'same_clan':
      return `Same clan as ${who}`
    case 'same_tournament':
      return 'Both in TKO King'
    case 'mutual_follow':
      return `You both follow ${who}`
    case 'concurrent_only':
    default:
      return 'Also live now'
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Pair scoring
// ───────────────────────────────────────────────────────────────────────────

interface PairSignals {
  reasons: LiveLinkReason[]
  battleId?: string
  tournamentId?: string
  clanId?: string
}

function scanPair(
  a: LiveStreamFact,
  b: LiveStreamFact,
  facts: RelationshipFacts,
  now: number,
  battleWindowMs: number,
): PairSignals {
  const reasons: LiveLinkReason[] = []
  let battleId: string | undefined
  let tournamentId: string | undefined
  let clanId: string | undefined

  // 1. Scheduled battle — the two fighters of one battle row.
  for (const bt of facts.battles ?? []) {
    if (!bt.playerB) continue
    const pair = pairKey(bt.playerA, bt.playerB)
    if (pair !== pairKey(a.userId, b.userId)) continue
    if (!battleIsNow(bt, now, battleWindowMs)) continue
    reasons.push('scheduled_battle')
    battleId = bt.battleId
    if (bt.tournamentId) tournamentId = bt.tournamentId
    break
  }

  // 2/3. Clan — same clan, and "teammates" when they're also in one tournament.
  const sharedClans = intersect(facts.clansByUser?.[a.userId], facts.clansByUser?.[b.userId])
  const declaredClan = a.clanId && b.clanId && a.clanId === b.clanId ? a.clanId : undefined
  const clan = sharedClans[0] ?? declaredClan

  // 4. Tournament — both registered in a running tournament (or both streams
  //    declared the same tournament when they went live).
  const sharedTournaments = intersect(
    facts.tournamentsByUser?.[a.userId],
    facts.tournamentsByUser?.[b.userId],
  )
  const declaredTournament =
    a.tournamentId && b.tournamentId && a.tournamentId === b.tournamentId ? a.tournamentId : undefined
  const tourney = sharedTournaments[0] ?? declaredTournament

  if (clan) {
    clanId = clan
    if (tourney) reasons.push('teammates')
    reasons.push('same_clan')
  }
  if (tourney) {
    if (!tournamentId) tournamentId = tourney
    reasons.push('same_tournament')
  }

  // 5. Mutual follow.
  const aFollowsB = (facts.followsByUser?.[a.userId] ?? []).includes(b.userId)
  const bFollowsA = (facts.followsByUser?.[b.userId] ?? []).includes(a.userId)
  if (aFollowsB && bFollowsA) reasons.push('mutual_follow')

  // 6. Nothing but the clock.
  if (reasons.length === 0) reasons.push('concurrent_only')

  reasons.sort((x, y) => rankOf(x) - rankOf(y))
  return { reasons, battleId, tournamentId, clanId }
}

function scoreOf(reasons: LiveLinkReason[]): number {
  const primary = reasons[0]
  const base = REASON_WEIGHT[primary] ?? 0
  if (primary === 'concurrent_only') return base
  const extras = Math.max(0, reasons.length - 1)
  return Math.min(MAX_CONFIDENCE, Number((base + extras * CORROBORATION_BONUS).toFixed(4)))
}

/**
 * Is the SIGNAL itself strong enough? This is the original bar and says nothing
 * about consent — `linkDecision` layers the prefs and the blocks on top.
 */
export function signalQualifies(c: Pick<LiveLinkCandidate, 'reason' | 'confidence'>): boolean {
  return AUTO_LINK_REASONS.has(c.reason) && c.confidence >= AUTO_LINK_THRESHOLD
}

/**
 * The full verdict for a pair, in precedence order:
 *   a block beats everything → a weak signal never links → otherwise the
 *   strictest of the two users' preferences decides.
 */
export function linkDecision(input: {
  signal: boolean
  mode: AutoLinkMode
  blocked: boolean
}): LinkDecision {
  if (input.blocked) return 'blocked'
  if (!input.signal) return 'weak'
  return input.mode
}

export interface AutoLinkContext {
  /** first user's preference. Defaults to 'auto'. */
  modeA?: AutoLinkMode
  /** second user's preference. Defaults to 'auto'. */
  modeB?: AutoLinkMode
  /** a block exists in either direction. */
  blocked?: boolean
}

/**
 * May this pair link WITHOUT asking anyone? A strong relationship signal, both
 * users on 'auto', and no block between them. Called with no context it answers
 * the signal question alone (the pre-consent behaviour), which is what a caller
 * that has already resolved consent wants.
 */
export function shouldAutoLink(
  c: Pick<LiveLinkCandidate, 'reason' | 'confidence'>,
  ctx: AutoLinkContext = {},
): boolean {
  return (
    linkDecision({
      signal: signalQualifies(c),
      mode: combineAutoLinkModes(
        normalizeAutoLinkMode(ctx.modeA),
        normalizeAutoLinkMode(ctx.modeB),
      ),
      blocked: !!ctx.blocked,
    }) === 'auto'
  )
}

/**
 * Would this pair link if nobody had opted out? Used by the settings UI and the
 * "you turned this off" explainer, so a user can see WHY nothing is happening.
 */
export function wouldLinkWithoutPrefs(
  c: Pick<LiveLinkCandidate, 'reason' | 'confidence' | 'blocked'>,
): boolean {
  return !c.blocked && signalQualifies(c)
}

/**
 * Score every pair of currently-live streams. Returns a ranked list: highest
 * confidence first, ties broken by reason strength then by the stable pair key.
 */
export function linkCandidates(
  streams: LiveStreamFact[],
  facts: RelationshipFacts = {},
  opts: LiveLinkOptions = {},
): LiveLinkCandidate[] {
  const now = opts.now ?? Date.now()
  const battleWindowMs = opts.battleWindowMs ?? DEFAULT_BATTLE_WINDOW_MS
  const live = streams.filter((s) => isLiveAt(s, now))
  const blocks = facts.blocks ?? []
  const modes = facts.autoLinkModes ?? {}

  const out: LiveLinkCandidate[] = []
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i]
      const b = live[j]
      // Two angles from the SAME person aren't a relationship link.
      if (a.userId === b.userId) continue
      const sig = scanPair(a, b, facts, now, battleWindowMs)
      const reason = sig.reasons[0]
      const confidence = scoreOf(sig.reasons)

      // Consent: the block gate, then the strictest of the two preferences.
      const { blocked, hidden } = pairBlockState(blocks, a.userId, b.userId)
      const mode = combineAutoLinkModes(
        normalizeAutoLinkMode(modes[a.userId]),
        normalizeAutoLinkMode(modes[b.userId]),
      )
      const decision = linkDecision({
        signal: signalQualifies({ reason, confidence }),
        mode,
        blocked,
      })

      out.push({
        key: pairKey(a.streamId, b.streamId),
        a,
        b,
        reason,
        reasons: sig.reasons,
        confidence,
        label: reasonLabel(reason),
        battleId: sig.battleId,
        tournamentId: sig.tournamentId,
        clanId: sig.clanId,
        autoLink: decision === 'auto',
        decision,
        pending: decision === 'ask',
        blocked,
        hidden,
        mode,
      })
    }
  }

  return out.sort(
    (x, y) =>
      y.confidence - x.confidence ||
      rankOf(x.reason) - rankOf(y.reason) ||
      x.key.localeCompare(y.key),
  )
}

/** The candidates that clear the auto-link bar, still ranked. */
export function autoLinkCandidates(
  streams: LiveStreamFact[],
  facts: RelationshipFacts = {},
  opts: LiveLinkOptions = {},
): LiveLinkCandidate[] {
  return linkCandidates(streams, facts, opts).filter((c) => c.autoLink)
}

/**
 * The candidates that WOULD have auto-linked but are waiting on somebody's
 * approval because one of them chose "ask me first". These become proposals,
 * not links — nothing joins until it is accepted.
 */
export function pendingLinkCandidates(
  streams: LiveStreamFact[],
  facts: RelationshipFacts = {},
  opts: LiveLinkOptions = {},
): LiveLinkCandidate[] {
  return linkCandidates(streams, facts, opts).filter((c) => c.pending)
}

/** The users who must say yes before a pending link may form. */
export function approversFor(c: LiveLinkCandidate): string[] {
  return uniq([c.a.userId, c.b.userId])
}

/** Every candidate that involves a given stream, ranked. */
export function candidatesForStream(
  candidates: LiveLinkCandidate[],
  streamId: string,
): LiveLinkCandidate[] {
  return candidates.filter((c) => c.a.streamId === streamId || c.b.streamId === streamId)
}

/** The single strongest link for a stream — what its card badge shows. */
export function bestCandidateForStream(
  candidates: LiveLinkCandidate[],
  streamId: string,
): LiveLinkCandidate | null {
  return candidatesForStream(candidates, streamId)[0] ?? null
}

// ───────────────────────────────────────────────────────────────────────────
//  Stages — turn pair links into a 2–4 feed multi-angle view
// ───────────────────────────────────────────────────────────────────────────

/** Title for a proposed stage. */
export function stageTitle(reason: LiveLinkReason, streams: LiveStreamFact[]): string {
  if (reason === 'scheduled_battle' && streams.length === 2) {
    return `${handleOf(streams[0])} vs ${handleOf(streams[1])} — both angles`
  }
  return `${reasonLabel(reason)} — ${streams.length} angles`
}

/**
 * Greedily grow the ranked auto-link candidates into multi-angle stages of at
 * most `maxAngles` feeds. Each stream lands in at most one stage, and the
 * strongest pair always seeds first — so a scheduled battle is never swallowed
 * by a looser clan link.
 */
export function suggestStages(
  candidates: LiveLinkCandidate[],
  opts: { maxAngles?: number; include?: (c: LiveLinkCandidate) => boolean } = {},
): LiveStage[] {
  const maxAngles = Math.max(2, Math.min(opts.maxAngles ?? MAX_STAGE_ANGLES, MAX_STAGE_ANGLES))
  const include = opts.include ?? ((c: LiveLinkCandidate) => c.autoLink)
  const linkable = candidates.filter(include)
  // Every pair that must never share a stage, keyed by USER (a person may have
  // several angles live, and the block is about the person, not the feed).
  const hiddenKeys = new Set(
    candidates.filter((c) => c.hidden).map((c) => pairKey(c.a.userId, c.b.userId)),
  )
  const clashes = (members: LiveStreamFact[], add: LiveStreamFact): boolean =>
    members.some((m) => hiddenKeys.has(pairKey(m.userId, add.userId)))
  const used = new Set<string>()
  const stages: LiveStage[] = []

  for (const seed of linkable) {
    if (used.has(seed.a.streamId) || used.has(seed.b.streamId)) continue
    // A hidden pair can never seed a stage. (It can't auto-link either, so this
    // only bites the pending/manual paths — belt and braces.)
    if (hiddenKeys.has(pairKey(seed.a.userId, seed.b.userId))) continue
    const members: LiveStreamFact[] = [seed.a, seed.b]
    const ids = new Set([seed.a.streamId, seed.b.streamId])

    // Absorb further streams that link to a member with the SAME reason.
    for (const c of linkable) {
      if (members.length >= maxAngles) break
      if (c.reason !== seed.reason) continue
      const inA = ids.has(c.a.streamId)
      const inB = ids.has(c.b.streamId)
      if (inA === inB) continue // both already in, or neither touches the stage
      const add = inA ? c.b : c.a
      if (used.has(add.streamId)) continue
      // Growing the stage must not quietly put a hidden pair on one screen.
      if (clashes(members, add)) continue
      members.push(add)
      ids.add(add.streamId)
    }

    members.forEach((m) => used.add(m.streamId))
    stages.push({
      key: members
        .map((m) => m.streamId)
        .sort()
        .join('::'),
      streams: members,
      reason: seed.reason,
      confidence: seed.confidence,
      title: stageTitle(seed.reason, members),
      battleId: seed.battleId,
      tournamentId: seed.tournamentId,
      clanId: seed.clanId,
    })
  }

  return stages
}

/**
 * Build a stage from an explicit set of streams — what a VIEWER gets when they
 * hand-pick 2–4 feeds. The reason/context is inherited from the strongest link
 * that exists inside the selection (falling back to `concurrent_only`, which is
 * fine here: the human chose, so no auto-link rule was bypassed).
 */
/**
 * The stages that are only PROPOSED — the signal is strong and nobody is
 * blocked, but at least one of the people involved asked to be consulted first.
 * Nothing here is live until it is accepted.
 */
export function proposedStages(
  candidates: LiveLinkCandidate[],
  opts: { maxAngles?: number } = {},
): LiveStage[] {
  return suggestStages(candidates, { ...opts, include: (c) => c.pending })
}

/**
 * Take one member out of a stage — what "don't connect me" does from the link
 * notification, and what happens when a streamer leaves a live group.
 *
 * The point is that the stage COLLAPSES GRACEFULLY rather than breaking for the
 * people watching it: pull one angle out of a 3-up and the remaining two carry
 * on as a normal stage (re-titled and re-keyed for the new cast). Pull one out
 * of a 2-up and there is no stage left — null, and the caller should send
 * viewers to the single remaining stream instead of a dead multi-angle page.
 */
export function removeStreamFromStage(stage: LiveStage, streamId: string): LiveStage | null {
  const streams = stage.streams.filter((s) => s.streamId !== streamId)
  if (streams.length === stage.streams.length) return stage // nothing removed
  if (streams.length < 2) return null
  return {
    ...stage,
    streams,
    key: streams
      .map((s) => s.streamId)
      .sort()
      .join('::'),
    title: stageTitle(stage.reason, streams),
  }
}

/** Same, by person — pulls every angle that user contributed. */
export function removeUserFromStage(stage: LiveStage, userId: string): LiveStage | null {
  const streams = stage.streams.filter((s) => s.userId !== userId)
  if (streams.length === stage.streams.length) return stage
  if (streams.length < 2) return null
  return {
    ...stage,
    streams,
    key: streams
      .map((s) => s.streamId)
      .sort()
      .join('::'),
    title: stageTitle(stage.reason, streams),
  }
}

/** The streams left over when a stage collapses — where viewers should land. */
export function survivingStreams(stage: LiveStage, removedStreamId: string): LiveStreamFact[] {
  return stage.streams.filter((s) => s.streamId !== removedStreamId)
}

export function stageFromStreams(
  streams: LiveStreamFact[],
  candidates: LiveLinkCandidate[] = [],
  opts: { maxAngles?: number; blocks?: BlockFact[] } = {},
): LiveStage | null {
  if (streams.length < 2) return null
  const maxAngles = Math.max(2, Math.min(opts.maxAngles ?? MAX_STAGE_ANGLES, MAX_STAGE_ANGLES))
  // Even a hand-picked stage may not put a hidden pair on one screen. Earlier
  // picks win, so the viewer's first choice is the one that survives.
  const blocks = opts.blocks ?? []
  const allowed: LiveStreamFact[] = []
  for (const s of streams) {
    if (allowed.some((k) => isHiddenPair(blocks, k.userId, s.userId))) continue
    allowed.push(s)
  }
  if (allowed.length < 2) return null
  const members = allowed.slice(0, maxAngles)
  const ids = new Set(members.map((s) => s.streamId))
  // `candidates` arrives ranked, so the first match inside the selection wins.
  const best = candidates.find((c) => ids.has(c.a.streamId) && ids.has(c.b.streamId))
  const reason: LiveLinkReason = best?.reason ?? 'concurrent_only'
  return {
    key: members
      .map((m) => m.streamId)
      .sort()
      .join('::'),
    streams: members,
    reason,
    confidence: best?.confidence ?? REASON_WEIGHT.concurrent_only,
    title: stageTitle(reason, members),
    battleId: best?.battleId,
    tournamentId: best?.tournamentId,
    clanId: best?.clanId,
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Notifications — copy + who gets told (pure; the send lives in the service)
// ───────────────────────────────────────────────────────────────────────────

export interface LinkNotification {
  title: string
  body: string
}

/** The copy for "these streams just got linked". */
export function linkNotification(stage: Pick<LiveStage, 'reason' | 'streams' | 'title'>): LinkNotification {
  if (stage.reason === 'scheduled_battle') {
    return {
      title: 'Both fighters are live',
      body: 'Both fighters are live — watch the battle from both angles.',
    }
  }
  const who = stage.streams.map(handleOf).join(' + ')
  switch (stage.reason) {
    case 'teammates':
    case 'same_clan':
      return {
        title: 'Your clan is live',
        body: `${who} are live together — watch every angle on one screen.`,
      }
    case 'same_tournament':
      return {
        title: 'TKO King is live',
        body: `${who} are live in the same tournament — watch them side by side.`,
      }
    default:
      return {
        title: 'Streams linked',
        body: `${who} are linked into one multi-angle view.`,
      }
  }
}

/**
 * The copy for a link that is WAITING on someone. Sent to the two streamers
 * only — nobody's followers are told about a stage that may never exist.
 */
export function linkProposalNotification(
  stage: Pick<LiveStage, 'reason' | 'streams' | 'title'>,
): LinkNotification {
  const who = stage.streams.map(handleOf).join(' + ')
  return {
    title: 'Link your streams?',
    body: `${who} are live together (${reasonLabel(stage.reason).toLowerCase()}). Join up and your viewers get every angle on one screen.`,
  }
}

/**
 * The actions offered ON the link notification, so someone can get out of a
 * link without hunting through settings. `disconnect` removes them from this
 * stage now; the other two also change the preference so it stops happening.
 */
export type LinkOptOutChoice = 'disconnect' | 'ask_next_time' | 'never_again'

export const LINK_OPT_OUT_COPY: Record<
  LinkOptOutChoice,
  { label: string; help: string; mode: AutoLinkMode | null }
> = {
  disconnect: {
    label: "Don't connect me",
    help: 'Takes your stream out of this stage. Everyone else keeps watching.',
    mode: null,
  },
  ask_next_time: {
    label: "Don't connect me — ask first next time",
    help: "You'll be asked before your stream joins a stage from now on.",
    mode: 'ask',
  },
  never_again: {
    label: "Don't connect me — and never again",
    help: 'Your stream is never pulled into a stage automatically again.',
    mode: 'off',
  },
}

/** The preference a given opt-out choice implies, or null to leave it alone. */
export function modeForOptOut(choice: LinkOptOutChoice): AutoLinkMode | null {
  return LINK_OPT_OUT_COPY[choice].mode
}

export interface NotifyAudience {
  /** userId → the ids of people who follow them. */
  followersByUser?: Record<string, string[]>
  /** clanId → member user ids. */
  clanMembersByClan?: Record<string, string[]>
  /**
   * Blocks visible to the caller. Nobody is pinged about a stage starring
   * someone they blocked (or who blocked them) — a block that still sends you
   * push notifications about that person is not a block.
   */
  blocks?: BlockFact[]
}

export interface NotifyTargets {
  /** the streamers in the stage. */
  streamers: string[]
  /** their followers, minus anyone already in `streamers`. */
  followers: string[]
  /** the clan (for a clan link), minus everyone above. */
  clan: string[]
  /** the deduped union — nobody appears twice, so nobody is notified twice. */
  all: string[]
}

/**
 * Who to tell about a new link: both streamers, their followers, and — when the
 * link is a clan one — the clan. Buckets are disjoint and `all` is deduped, so a
 * clanmate who also follows one of the streamers still gets exactly one ping.
 */
export function linkNotifyTargets(
  stage: Pick<LiveStage, 'reason' | 'streams' | 'clanId'>,
  audience: NotifyAudience = {},
): NotifyTargets {
  const streamers = uniq(stage.streams.map((s) => s.userId))
  const seen = new Set(streamers)
  const blocks = audience.blocks ?? []
  // Never ping someone about a stage that features a person they blocked (or a
  // person who blocked them). Streamers are exempt — they are the stage.
  const muted = (uid: string): boolean =>
    streamers.some((s) => isBlockedPair(blocks, s, uid))

  const followers: string[] = []
  for (const s of streamers) {
    for (const f of audience.followersByUser?.[s] ?? []) {
      if (seen.has(f)) continue
      seen.add(f)
      if (muted(f)) continue
      followers.push(f)
    }
  }

  const clan: string[] = []
  const isClanLink = stage.reason === 'same_clan' || stage.reason === 'teammates'
  if (isClanLink && stage.clanId) {
    for (const m of audience.clanMembersByClan?.[stage.clanId] ?? []) {
      if (seen.has(m)) continue
      seen.add(m)
      if (muted(m)) continue
      clan.push(m)
    }
  }

  return { streamers, followers, clan, all: [...streamers, ...followers, ...clan] }
}

// ───────────────────────────────────────────────────────────────────────────
//  Session capture — what a combined highlight needs later
// ───────────────────────────────────────────────────────────────────────────

export interface LiveWindow {
  /** when ALL members were live (the latest start). */
  startMs: number
  /** when the first member dropped (or `now`). */
  endMs: number
  durationMs: number
}

/**
 * The window in which EVERY member of a group was live at once — exactly the
 * span a combined multi-angle highlight can be cut from.
 */
export function liveOverlapWindow(streams: LiveStreamFact[], now: number = Date.now()): LiveWindow {
  if (streams.length === 0) return { startMs: 0, endMs: 0, durationMs: 0 }
  const startMs = Math.max(...streams.map((s) => s.startedAt))
  const endMs = Math.min(...streams.map((s) => s.endedAt ?? now))
  return { startMs, endMs, durationMs: Math.max(0, endMs - startMs) }
}

/**
 * Everything needed to render a combined clip from a finished live group, later.
 * Deliberately NOT a renderer — just the durable record.
 */
export interface LiveSessionRecord {
  groupId: string
  streamIds: string[]
  userIds: string[]
  reason: LiveLinkReason | null
  battleId: string | null
  tournamentId: string | null
  startedAtMs: number
  endedAtMs: number
  durationMs: number
}

export function buildSessionRecord(input: {
  groupId: string
  streams: LiveStreamFact[]
  reason?: LiveLinkReason | null
  battleId?: string | null
  tournamentId?: string | null
  now?: number
}): LiveSessionRecord {
  const now = input.now ?? Date.now()
  const win = liveOverlapWindow(input.streams, now)
  return {
    groupId: input.groupId,
    streamIds: input.streams.map((s) => s.streamId),
    userIds: uniq(input.streams.map((s) => s.userId)),
    reason: input.reason ?? null,
    battleId: input.battleId ?? null,
    tournamentId: input.tournamentId ?? null,
    startedAtMs: win.startMs,
    endedAtMs: win.endMs,
    durationMs: win.durationMs,
  }
}
