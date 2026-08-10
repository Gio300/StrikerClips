/**
 * TOURNAMENT REPLAY — turn a tournament's existing timestamped rows into an
 * ordered event timeline a viewer can play back like a stream, plus the
 * "bracket as of time T" projection the replay page feeds to TournamentBracket.
 *
 * Everything here is PURE and derived from data the product already stores:
 *   tournaments.created_at / start_at / end_at,
 *   tournament_entrants.created_at,  tournament_registrations.registered_at,
 *   tournament_battles.created_at / scheduled_at / decided_at / media_updated_at,
 *   tournament_results.created_at.
 * `decided_at` and `media_updated_at` are the two additive columns this feature
 * introduces (see db/schema.sql); rows from before those columns fall back to
 * the battle's own created_at so old tournaments still replay.
 */
import type { TournamentBattle } from '@/types/database'

export type ReplayEventKind =
  | 'created'
  | 'started'
  | 'entrant_joined'
  | 'registered'
  | 'battle_seeded'
  | 'battle_decided'
  | 'media_attached'
  | 'result_recorded'
  | 'ended'

export type ReplayMediaLink = { url: string; kind: 'live' | 'clip'; side: 'a' | 'b' }

export type ReplayEvent = {
  /** ISO timestamp the event applies at (the scrubber position). */
  at: string
  kind: ReplayEventKind
  /** Human line for the ticker, e.g. "Semifinal decided — ayaka advances". */
  label: string
  battleId?: string
  userId?: string
  /** Watch links surfaced at this moment (media_attached events). */
  media?: ReplayMediaLink[]
}

/** Ordering priority inside one timestamp so playback reads naturally. */
const KIND_ORDER: Record<ReplayEventKind, number> = {
  created: 0,
  started: 1,
  entrant_joined: 2,
  registered: 3,
  battle_seeded: 4,
  battle_decided: 5,
  media_attached: 6,
  result_recorded: 7,
  ended: 8,
}

export type ReplayBattle = TournamentBattle & {
  decided_at?: string | null
  media_updated_at?: string | null
}

export type ReplayInput = {
  tournament: {
    id: string
    name: string
    status?: string | null
    created_at: string
    start_at?: string | null
    end_at?: string | null
  }
  battles: ReplayBattle[]
  entrants?: { user_id: string; created_at: string; status?: string | null }[]
  registrations?: { user_id: string; registered_at: string }[]
  results?: { winner_profile_id: string; created_at: string }[]
  /** id → display name, used for labels; unknown ids render as "a player". */
  usernames?: Map<string, string>
}

const validTime = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null
  return Number.isFinite(new Date(value).getTime()) ? value : null
}

/** When a battle counts as decided, with the pre-column fallback. */
export function battleDecidedAt(battle: ReplayBattle): string | null {
  if (!battle.winner) return null
  return validTime(battle.decided_at) ?? validTime(battle.created_at)
}

/** When a battle's watch links appeared, with the pre-column fallback. */
export function battleMediaAt(battle: ReplayBattle): string | null {
  if (!battle.media || (!battle.media.a && !battle.media.b)) return null
  return (
    validTime(battle.media_updated_at) ??
    battleDecidedAt(battle) ??
    validTime(battle.created_at)
  )
}

function mediaLinks(battle: ReplayBattle): ReplayMediaLink[] {
  const links: ReplayMediaLink[] = []
  for (const side of ['a', 'b'] as const) {
    const entry = battle.media?.[side]
    if (!entry) continue
    if (entry.live_url) links.push({ url: entry.live_url, kind: 'live', side })
    for (const url of entry.clip_urls ?? []) links.push({ url, kind: 'clip', side })
  }
  return links
}

/**
 * Build the ordered playback timeline. Events sort by time, then by kind
 * priority (so "tournament created" precedes a same-second entry, and "ended"
 * always closes the tape), then by a stable key.
 */
export function buildReplayTimeline(input: ReplayInput): ReplayEvent[] {
  const name = (id: string | null | undefined): string =>
    (id && input.usernames?.get(String(id))) || 'a player'
  const events: ReplayEvent[] = []

  const createdAt = validTime(input.tournament.created_at)
  if (createdAt) {
    events.push({ at: createdAt, kind: 'created', label: `"${input.tournament.name}" was created` })
  }
  const startAt = validTime(input.tournament.start_at)
  if (startAt) events.push({ at: startAt, kind: 'started', label: 'Scheduled start time' })

  for (const entrant of input.entrants ?? []) {
    const at = validTime(entrant.created_at)
    if (!at) continue
    events.push({
      at,
      kind: 'entrant_joined',
      label: `${name(entrant.user_id)} entered`,
      userId: String(entrant.user_id),
    })
  }
  for (const registration of input.registrations ?? []) {
    const at = validTime(registration.registered_at)
    if (!at) continue
    events.push({
      at,
      kind: 'registered',
      label: `${name(registration.user_id)} registered`,
      userId: String(registration.user_id),
    })
  }

  for (const battle of input.battles) {
    const seededAt = validTime(battle.created_at)
    if (seededAt) {
      const versus = battle.player_b
        ? `${name(battle.player_a)} vs ${name(battle.player_b)}`
        : `${name(battle.player_a)} (bye)`
      events.push({
        at: seededAt,
        kind: 'battle_seeded',
        label: `Matchup set — ${versus}`,
        battleId: String(battle.id),
      })
    }
    const decidedAt = battleDecidedAt(battle)
    if (decidedAt) {
      events.push({
        at: decidedAt,
        kind: 'battle_decided',
        label:
          battle.status === 'forfeit'
            ? `${name(battle.winner)} advances by forfeit`
            : `${name(battle.winner)} wins the matchup`,
        battleId: String(battle.id),
        userId: battle.winner ? String(battle.winner) : undefined,
      })
    }
    const mediaAt = battleMediaAt(battle)
    if (mediaAt) {
      const links = mediaLinks(battle)
      if (links.length) {
        events.push({
          at: mediaAt,
          kind: 'media_attached',
          label: `Watch links attached — ${name(battle.player_a)} vs ${name(battle.player_b)}`,
          battleId: String(battle.id),
          media: links,
        })
      }
    }
  }

  for (const result of input.results ?? []) {
    const at = validTime(result.created_at)
    if (!at) continue
    events.push({
      at,
      kind: 'result_recorded',
      label: `${name(result.winner_profile_id)} recorded as tournament winner`,
      userId: String(result.winner_profile_id),
    })
  }

  const endAt = validTime(input.tournament.end_at)
  if (endAt && (input.tournament.status === 'closed' || new Date(endAt).getTime() <= Date.now())) {
    events.push({ at: endAt, kind: 'ended', label: 'Tournament ended' })
  }

  return events.sort(
    (a, b) =>
      new Date(a.at).getTime() - new Date(b.at).getTime() ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.battleId ?? a.userId ?? '').localeCompare(b.battleId ?? b.userId ?? ''),
  )
}

/**
 * The bracket AS OF a moment on the tape: battles that already existed, with a
 * winner/status/media only once their own event time has passed. Feeding this
 * to TournamentBracket re-renders the board exactly as a live viewer saw it.
 */
export function battlesAsOf(battles: ReplayBattle[], atIso: string): ReplayBattle[] {
  const cursor = new Date(atIso).getTime()
  if (!Number.isFinite(cursor)) return []
  const out: ReplayBattle[] = []
  for (const battle of battles) {
    const seededAt = validTime(battle.created_at)
    if (!seededAt || new Date(seededAt).getTime() > cursor) continue
    const decidedAt = battleDecidedAt(battle)
    const decided = decidedAt != null && new Date(decidedAt).getTime() <= cursor
    const mediaAt = battleMediaAt(battle)
    const mediaVisible = mediaAt != null && new Date(mediaAt).getTime() <= cursor
    out.push({
      ...battle,
      winner: decided ? battle.winner : null,
      status: decided ? battle.status : 'scheduled',
      media: mediaVisible ? battle.media : null,
    })
  }
  return out
}
