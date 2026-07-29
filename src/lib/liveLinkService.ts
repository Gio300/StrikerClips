/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * liveLinkService — the impure half of live linking.
 *
 * `src/lib/liveLink.ts` decides WHETHER a set of live streams belong together.
 * This module does the I/O around that decision:
 *
 *   loadLiveLinkContext()  read every currently-live stream + the relationship
 *                          facts (battles, clans, tournaments, follows) and run
 *                          the engine over them.
 *   createStageGroup()     persist a link as a `live_groups` row + members, so
 *                          anyone can open the same combined multi-angle view.
 *   notifyStageLinked()    tell both streamers, their followers and (for a clan
 *                          link) the clan — exactly once per group.
 *   loadStageGroup()       read a saved link back for the combined view.
 *   endStageGroup()        close a group and snapshot what a combined highlight
 *                          would need to be produced from it later.
 *
 * Every read is best-effort: live discovery must keep working even when an
 * optional table (registrations, clans) is unreadable for the current viewer.
 */

import { supabase } from '@/lib/supabase'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { notifyMany } from '@/lib/notifications'
import { loadAutoLinkModes, saveAutoLinkMode } from '@/lib/liveLinkPrefs'
import { normalizeBlocks, type BlockFact } from '@/lib/blocking'
import {
  buildSessionRecord,
  linkCandidates,
  linkNotification,
  linkNotifyTargets,
  linkProposalNotification,
  modeForOptOut,
  proposedStages,
  removeUserFromStage,
  suggestStages,
  type AutoLinkMode,
  type LinkOptOutChoice,
  type LiveLinkCandidate,
  type LiveStage,
  type LiveStreamFact,
  type NotifyAudience,
  type RelationshipFacts,
} from '@/lib/liveLink'

/** A live stream as the discovery UI renders it. */
export interface LiveCard extends LiveStreamFact {
  placement: string | null
  /** '' when the url isn't a YouTube link (no thumbnail / no embed). */
  videoId: string
}

export interface LiveLinkContext {
  cards: LiveCard[]
  facts: RelationshipFacts
  candidates: LiveLinkCandidate[]
  /** Links that may form on their own — both users on 'auto', nobody blocked. */
  stages: LiveStage[]
  /**
   * Links that are strong enough but WAITING on somebody who chose "ask me
   * first". These are proposals: nothing joins until they're accepted.
   */
  pending: LiveStage[]
}

const EMPTY_CONTEXT: LiveLinkContext = {
  cards: [],
  facts: {},
  candidates: [],
  stages: [],
  pending: [],
}

/** The placement a stream was published to, incl. the legacy title-prefix form. */
function readPlacement(row: any): { placement: string | null; title: string } {
  const rawTitle = String(row?.title ?? '')
  if (row?.placement) return { placement: String(row.placement), title: rawTitle }
  const m = rawTitle.match(/^\s*[[#(]\s*(profile|clan|front_page|tournament)\s*[\])]?\s*/i)
  if (m) return { placement: m[1].toLowerCase(), title: rawTitle.slice(m[0].length).trim() }
  return { placement: null, title: rawTitle }
}

function ms(value: any, fallback: number): number {
  if (!value) return fallback
  const t = new Date(value).getTime()
  return Number.isFinite(t) ? t : fallback
}

async function safeSelect<T = any>(table: string, cols = '*'): Promise<T[]> {
  try {
    const { data } = await (supabase.from(table as any) as any).select(cols)
    return (data ?? []) as T[]
  } catch {
    return []
  }
}

/** Group a flat rows list into `key → value[]`, deduped. */
function indexBy<T>(rows: T[], key: (r: T) => any, value: (r: T) => any): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const r of rows) {
    const k = key(r)
    const v = value(r)
    if (!k || !v) continue
    const list = (out[String(k)] ??= [])
    if (!list.includes(String(v))) list.push(String(v))
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
//  Load
// ───────────────────────────────────────────────────────────────────────────

/**
 * Read EVERYONE who is live right now plus the relationship facts, and run the
 * link engine over them. `live_streams` is public-read by policy, so concurrent
 * streams from different users all show up here.
 */
export async function loadLiveLinkContext(now: number = Date.now()): Promise<LiveLinkContext> {
  let streamRows: any[] = []
  try {
    const { data } = await supabase
      .from('live_streams')
      .select('*, profiles(username, avatar_url)')
      .order('created_at', { ascending: false })
    streamRows = (data ?? []) as any[]
  } catch {
    // Some backends reject the embedded profiles join — fall back to the plain row.
    streamRows = await safeSelect('live_streams')
  }

  const cards: LiveCard[] = streamRows
    .filter((r) => r?.is_live !== false)
    .map((r) => {
      const { placement, title } = readPlacement(r)
      const url = String(r.youtube_url ?? r.url ?? '')
      return {
        streamId: String(r.id),
        userId: String(r.user_id ?? ''),
        username: r.profiles?.username ?? null,
        avatarUrl: r.profiles?.avatar_url ?? null,
        title: title || 'Live stream',
        startedAt: ms(r.started_at ?? r.created_at, now),
        endedAt: r.ended_at ? ms(r.ended_at, now) : null,
        url,
        placement,
        videoId: extractYouTubeId(url) ?? '',
        tournamentId: r.tournament_id ?? null,
        battleId: r.battle_id ?? null,
        clanId: r.clan_id ?? r.server_id ?? null,
      }
    })
    .filter((c) => c.userId)

  if (cards.length === 0) return EMPTY_CONTEXT

  const [battleRows, clanRows, regRows, followRows, blockRows] = await Promise.all([
    safeSelect('tournament_battles', 'id, tournament_id, player_a, player_b, scheduled_at, status, round'),
    safeSelect('clan_members', 'server_id, user_id'),
    safeSelect('tournament_registrations', 'tournament_id, user_id'),
    safeSelect('follows', 'follower_id, following_id'),
    // Only the caller's OWN blocks come back (select:'owner' by policy) — the
    // other direction is enforced server-side on insert. See blockingService.
    safeSelect('blocks', '*'),
  ])

  // Everyone's live-link preference. Missing / unreadable reads as 'auto'.
  const autoLinkModes = await loadAutoLinkModes(cards.map((c) => c.userId))

  const facts: RelationshipFacts = {
    battles: battleRows.map((b: any) => ({
      battleId: String(b.id),
      tournamentId: b.tournament_id ?? null,
      playerA: String(b.player_a ?? ''),
      playerB: b.player_b ? String(b.player_b) : null,
      status: b.status ?? null,
      scheduledAt: b.scheduled_at ? ms(b.scheduled_at, now) : null,
      round: b.round ?? null,
    })),
    clansByUser: indexBy(clanRows, (r: any) => r.user_id, (r: any) => r.server_id),
    tournamentsByUser: indexBy(regRows, (r: any) => r.user_id, (r: any) => r.tournament_id),
    followsByUser: indexBy(followRows, (r: any) => r.follower_id, (r: any) => r.following_id),
    autoLinkModes,
    blocks: normalizeBlocks(blockRows as never[]),
  }

  const candidates = linkCandidates(cards, facts, { now })
  return {
    cards,
    facts,
    candidates,
    stages: suggestStages(candidates),
    pending: proposedStages(candidates),
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Persist a link
// ───────────────────────────────────────────────────────────────────────────

/** Groups we've already created/notified this session — cheap client-side dedupe. */
const notifiedGroups = new Set<string>()

/**
 * Find an OPEN `live_groups` row that already links exactly these streams, so
 * two viewers pressing "Link" at the same moment don't create twin stages.
 */
export async function findStageGroup(streamIds: string[]): Promise<string | null> {
  if (streamIds.length < 2) return null
  try {
    const { data: members } = await supabase
      .from('live_group_members')
      .select('group_id, stream_id')
      .in('stream_id', streamIds)
    const rows = (members ?? []) as any[]
    const byGroup = new Map<string, Set<string>>()
    for (const m of rows) {
      if (!m.group_id || !m.stream_id) continue
      const set = byGroup.get(m.group_id) ?? new Set<string>()
      set.add(String(m.stream_id))
      byGroup.set(m.group_id, set)
    }
    const wanted = new Set(streamIds)
    const exact = [...byGroup.entries()]
      .filter(([, set]) => set.size === wanted.size && [...wanted].every((id) => set.has(id)))
      .map(([gid]) => gid)
    if (exact.length === 0) return null

    const { data: groups } = await supabase.from('live_groups').select('*').in('id', exact)
    const open = ((groups ?? []) as any[]).find((g) => !g.ended_at)
    return open ? String(open.id) : null
  } catch {
    return null
  }
}

export interface CreateStageResult {
  groupId: string
  created: boolean
}

/**
 * Persist a stage as a `live_groups` row + one `live_group_members` row per
 * angle, then notify. Reuses an existing open group for the same streams.
 *
 * `live_group_members.user_id` is forced to the actor by policy for rows the
 * actor isn't elevated for — the group's CREATOR is elevated, so the creating
 * client can add every angle's owner in one pass.
 */
export async function createStageGroup(
  stage: LiveStage,
  actorId: string,
): Promise<CreateStageResult | null> {
  const streamIds = stage.streams.map((s) => s.streamId)
  const existing = await findStageGroup(streamIds)
  if (existing) {
    await notifyStageLinked(existing, stage)
    return { groupId: existing, created: false }
  }
  try {
    const { data: group, error } = await supabase
      .from('live_groups')
      .insert({
        name: stage.title,
        creator_id: actorId,
        link_reason: stage.reason,
        battle_id: stage.battleId ?? null,
        tournament_id: stage.tournamentId ?? null,
        clan_id: stage.clanId ?? null,
        confidence: stage.confidence,
        started_at: new Date().toISOString(),
      } as any)
      .select()
      .single()
    if (error || !group) return null
    const groupId = String((group as any).id)

    // ONE AT A TIME, deliberately. The server's block check for a new member
    // compares them against the members already in the group, and rows inside a
    // single multi-row insert aren't visible to each other yet. Four rows at
    // most, so the extra round-trips are free — and a member the server refuses
    // is simply left out instead of poisoning the whole stage.
    for (const s of stage.streams) {
      await supabase.from('live_group_members').insert({
        group_id: groupId,
        user_id: s.userId,
        stream_id: s.streamId,
        // The streamers themselves are in by definition — this is their stream.
        accepted: true,
      } as any)
    }

    await notifyStageLinked(groupId, stage)
    return { groupId, created: true }
  } catch {
    return null
  }
}

/**
 * THE MOMENT SOMEONE GOES LIVE. Re-run the engine and, if the freshly published
 * stream lands in a stage the engine is confident about (a scheduled battle with
 * the opponent already live, a clanmate, a fellow entrant), link it right there
 * and notify everyone. Returns the stage that was linked, or null when this
 * stream has no strong connection yet — a lone streamer is never bundled with
 * whoever happens to be live at the same time.
 */
export interface AutoLinkOutcome {
  stage: LiveStage
  /** null when the link is only PROPOSED — no group row exists yet. */
  groupId: string | null
  /** true when somebody chose "ask me first" and must approve it. */
  pending: boolean
}

export async function autoLinkForStream(
  streamId: string,
  actorId: string,
  now: number = Date.now(),
): Promise<AutoLinkOutcome | null> {
  try {
    const ctx = await loadLiveLinkContext(now)
    // `stages` only ever contains groups that cleared BOTH gates: a strong
    // signal, and consent — both users on 'auto' with no block between them.
    const stage = ctx.stages.find((s) => s.streams.some((x) => x.streamId === streamId))
    if (stage) {
      const res = await createStageGroup(stage, actorId)
      return res ? { stage, groupId: res.groupId, pending: false } : null
    }
    // Nothing linked, but the signal may still be there and simply waiting on
    // someone who asked to be consulted. Propose it instead of forcing it.
    const proposal = ctx.pending.find((s) => s.streams.some((x) => x.streamId === streamId))
    if (!proposal) return null
    await notifyStageProposed(proposal)
    return { stage: proposal, groupId: null, pending: true }
  } catch {
    return null
  }
}

/**
 * Tell the two streamers a link is AVAILABLE (because one of them is on "ask me
 * first"). Only the streamers hear about it — nobody's followers are pinged
 * about a stage that may never exist.
 */
export async function notifyStageProposed(stage: LiveStage): Promise<boolean> {
  const copy = linkProposalNotification(stage)
  const streamers = [...new Set(stage.streams.map((s) => s.userId))]
  try {
    await notifyMany(streamers, {
      kind: 'live_link_proposed',
      title: copy.title,
      body: copy.body,
      link: `/live-stage/new?s=${encodeURIComponent(stage.streams.map((s) => s.streamId).join(','))}`,
      relatedId: stage.key,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Accept a proposed link — the "yes, link us" half of `autoLinkMode: 'ask'`.
 * The stage is created exactly as an auto-link would have created it.
 */
export async function acceptProposedStage(
  stage: LiveStage,
  actorId: string,
): Promise<CreateStageResult | null> {
  return createStageGroup(stage, actorId)
}

// ───────────────────────────────────────────────────────────────────────────
//  "Don't connect me" — leaving a link from the notification
// ───────────────────────────────────────────────────────────────────────────

export interface LeaveStageResult {
  /** the member row was removed. */
  left: boolean
  /** fewer than two angles remain, so the group was closed. */
  collapsed: boolean
  /** the stream ids still in the stage — where viewers should be sent. */
  remainingStreamIds: string[]
  /** the preference that was changed, if the user asked for that too. */
  modeSet: AutoLinkMode | null
}

/**
 * Take a user OUT of a linked stage — the action on the link notification.
 *
 * Two things have to happen and both are graceful:
 *   1. their `live_group_members` row goes, and any of their angles with it;
 *   2. if that leaves fewer than two angles the group is ENDED rather than left
 *      as a one-feed "multi-angle" page that looks broken to whoever is
 *      watching. The remaining stream ids come back so the caller can send
 *      viewers to that stream instead.
 *
 * Optionally sets their preference at the same time, so "don't connect me"
 * can mean "and stop doing this" in one tap (see LINK_OPT_OUT_COPY).
 */
export async function leaveStageGroup(args: {
  groupId: string
  userId: string
  /** 'disconnect' just leaves; the others also change the preference. */
  choice?: LinkOptOutChoice
  now?: number
}): Promise<LeaveStageResult> {
  const { groupId, userId } = args
  const result: LeaveStageResult = {
    left: false,
    collapsed: false,
    remainingStreamIds: [],
    modeSet: null,
  }
  if (!groupId || !userId) return result

  // The preference first — it must stick even if the group write fails.
  const mode = args.choice ? modeForOptOut(args.choice) : null
  if (mode) {
    await saveAutoLinkMode(userId, mode)
    result.modeSet = mode
  }

  const saved = await loadStageGroup(groupId)
  try {
    const { error } = await supabase
      .from('live_group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', userId)
    result.left = !error
  } catch {
    return result
  }

  const remaining = (saved?.cards ?? []).filter((c) => c.userId !== userId)
  result.remainingStreamIds = remaining.map((c) => c.streamId)

  // A stage needs two angles to be a stage. Below that, close it cleanly.
  if (remaining.length < 2) {
    result.collapsed = true
    try {
      await supabase
        .from('live_groups')
        .update({ ended_at: new Date(args.now ?? Date.now()).toISOString() } as any)
        .eq('id', groupId)
    } catch {
      /* best effort — the member is out either way */
    }
  }
  return result
}

/**
 * The same thing expressed against an in-memory stage, for callers that already
 * have one (the live board, the stage page). Returns null when it collapses.
 */
export function stageWithoutUser(stage: LiveStage, userId: string): LiveStage | null {
  return removeUserFromStage(stage, userId)
}

// ───────────────────────────────────────────────────────────────────────────
//  Notify
// ───────────────────────────────────────────────────────────────────────────

/** Followers of the given users + members of a clan, for the notification fan-out. */
export async function loadNotifyAudience(
  userIds: string[],
  clanId?: string | null,
): Promise<NotifyAudience> {
  const audience: NotifyAudience = {}
  // Blocks the caller can see, so nobody is pinged about a stage starring
  // somebody they blocked. See linkNotifyTargets.
  try {
    const { data } = await supabase.from('blocks').select('*')
    audience.blocks = normalizeBlocks((data ?? []) as never[]) as BlockFact[]
  } catch {
    audience.blocks = []
  }
  try {
    const { data } = await supabase
      .from('follows')
      .select('follower_id, following_id')
      .in('following_id', userIds)
    audience.followersByUser = indexBy(
      (data ?? []) as any[],
      (r: any) => r.following_id,
      (r: any) => r.follower_id,
    )
  } catch {
    audience.followersByUser = {}
  }
  if (clanId) {
    try {
      const { data } = await supabase.from('clan_members').select('server_id, user_id').eq('server_id', clanId)
      audience.clanMembersByClan = indexBy(
        (data ?? []) as any[],
        (r: any) => r.server_id,
        (r: any) => r.user_id,
      )
    } catch {
      audience.clanMembersByClan = {}
    }
  }
  return audience
}

/**
 * Announce a link. Both streamers, their followers and — for a clan link — the
 * clan all hear about it, and a scheduled battle gets the loud copy:
 * "Both fighters are live — watch the battle from both angles."
 *
 * DEDUPE: `live_groups.notified_at` is the durable latch (set before the fan-out
 * so a second client that notices the same link is a no-op), plus an in-memory
 * guard for repeated calls inside one session. Recipients are deduped by
 * `linkNotifyTargets`, so a clanmate who also follows a fighter gets ONE ping.
 */
export async function notifyStageLinked(groupId: string, stage: LiveStage): Promise<boolean> {
  if (notifiedGroups.has(groupId)) return false
  notifiedGroups.add(groupId)
  try {
    const { data: existing } = await supabase
      .from('live_groups')
      .select('notified_at')
      .eq('id', groupId)
      .single()
    if ((existing as any)?.notified_at) return false
    await supabase
      .from('live_groups')
      .update({ notified_at: new Date().toISOString() } as any)
      .eq('id', groupId)
  } catch {
    // No backend / not readable — still fire the notifications best-effort.
  }

  const audience = await loadNotifyAudience(
    stage.streams.map((s) => s.userId),
    stage.reason === 'same_clan' || stage.reason === 'teammates' ? stage.clanId : null,
  )
  const targets = linkNotifyTargets(stage, audience)
  const copy = linkNotification(stage)
  const kind = stage.reason === 'scheduled_battle' ? 'live_battle_both_live' : 'live_link_created'
  const link = `/live-stage/${groupId}`

  // Streamers get the direct "you're linked" note; everyone else gets the
  // watch-it copy. Buckets are disjoint, so nobody receives both.
  await notifyMany(targets.streamers, {
    kind,
    title: copy.title,
    body:
      stage.reason === 'scheduled_battle'
        ? 'Your battle is live from both angles — send your viewers here.'
        : `${copy.body} You're one of the angles.`,
    link,
    relatedId: groupId,
  })
  await notifyMany([...targets.followers, ...targets.clan], {
    kind,
    title: copy.title,
    body: copy.body,
    link,
    relatedId: groupId,
  })
  return true
}

// ───────────────────────────────────────────────────────────────────────────
//  Read a saved stage back
// ───────────────────────────────────────────────────────────────────────────

export interface SavedStage {
  groupId: string
  name: string
  creatorId: string | null
  reason: LiveStage['reason'] | null
  battleId: string | null
  tournamentId: string | null
  clanId: string | null
  confidence: number | null
  endedAt: string | null
  cards: LiveCard[]
}

/** Read a persisted link (group + its member streams) for the combined view. */
export async function loadStageGroup(groupId: string): Promise<SavedStage | null> {
  try {
    const { data: group } = await supabase.from('live_groups').select('*').eq('id', groupId).single()
    if (!group) return null
    const g = group as any

    const { data: members } = await supabase
      .from('live_group_members')
      .select('user_id, stream_id')
      .eq('group_id', groupId)
    const streamIds = ((members ?? []) as any[]).map((m) => m.stream_id).filter(Boolean).map(String)
    if (streamIds.length === 0) {
      return {
        groupId,
        name: String(g.name ?? 'Multi-angle stage'),
        creatorId: g.creator_id ?? null,
        reason: g.link_reason ?? null,
        battleId: g.battle_id ?? null,
        tournamentId: g.tournament_id ?? null,
        clanId: g.clan_id ?? null,
        confidence: g.confidence ?? null,
        endedAt: g.ended_at ?? null,
        cards: [],
      }
    }

    let streamRows: any[] = []
    try {
      const { data } = await supabase
        .from('live_streams')
        .select('*, profiles(username, avatar_url)')
        .in('id', streamIds)
      streamRows = (data ?? []) as any[]
    } catch {
      const { data } = await supabase.from('live_streams').select('*').in('id', streamIds)
      streamRows = (data ?? []) as any[]
    }

    const now = Date.now()
    const cards: LiveCard[] = streamRows.map((r) => {
      const { placement, title } = readPlacement(r)
      const url = String(r.youtube_url ?? r.url ?? '')
      return {
        streamId: String(r.id),
        userId: String(r.user_id ?? ''),
        username: r.profiles?.username ?? null,
        avatarUrl: r.profiles?.avatar_url ?? null,
        title: title || 'Live stream',
        startedAt: ms(r.started_at ?? r.created_at, now),
        endedAt: r.ended_at ? ms(r.ended_at, now) : null,
        url,
        placement,
        videoId: extractYouTubeId(url) ?? '',
      }
    })
    // Keep the member order stable (by the order the ids came back).
    cards.sort((a, b) => streamIds.indexOf(a.streamId) - streamIds.indexOf(b.streamId))

    return {
      groupId,
      name: String(g.name ?? 'Multi-angle stage'),
      creatorId: g.creator_id ?? null,
      reason: g.link_reason ?? null,
      battleId: g.battle_id ?? null,
      tournamentId: g.tournament_id ?? null,
      clanId: g.clan_id ?? null,
      confidence: g.confidence ?? null,
      endedAt: g.ended_at ?? null,
      cards,
    }
  } catch {
    return null
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  End the session — capture what a combined highlight will need
// ───────────────────────────────────────────────────────────────────────────

/**
 * Close a linked stage and SNAPSHOT it: the member stream ids, who was in it,
 * the window in which every member was live at once, and the match context.
 * That's everything a combined multi-angle highlight needs to be produced from
 * this session afterwards — the renderer itself is deliberately out of scope.
 */
export async function endStageGroup(
  groupId: string,
  actorId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const saved = await loadStageGroup(groupId)
  if (!saved) return false
  const record = buildSessionRecord({
    groupId,
    streams: saved.cards,
    reason: saved.reason ?? null,
    battleId: saved.battleId,
    tournamentId: saved.tournamentId,
    now,
  })
  try {
    await supabase
      .from('live_group_sessions')
      .insert({
        group_id: groupId,
        creator_id: actorId,
        // jsonb columns — send JSON text so the driver hands Postgres valid JSON.
        stream_ids: JSON.stringify(record.streamIds),
        user_ids: JSON.stringify(record.userIds),
        link_reason: record.reason,
        battle_id: record.battleId,
        tournament_id: record.tournamentId,
        started_at: new Date(record.startedAtMs).toISOString(),
        ended_at: new Date(record.endedAtMs).toISOString(),
        duration_ms: record.durationMs,
      } as any)
    await supabase
      .from('live_groups')
      .update({ ended_at: new Date(now).toISOString() } as any)
      .eq('id', groupId)
    return true
  } catch {
    return false
  }
}

/**
 * Read specific streams as cards — powers the AD-HOC combined view
 * (`/live-stage/new?s=id,id`), which lets a signed-out viewer still watch
 * several angles on one screen without persisting anything.
 */
export async function loadCards(streamIds: string[]): Promise<LiveCard[]> {
  const ids = streamIds.filter(Boolean)
  if (ids.length === 0) return []
  let rows: any[] = []
  try {
    const { data } = await supabase
      .from('live_streams')
      .select('*, profiles(username, avatar_url)')
      .in('id', ids)
    rows = (data ?? []) as any[]
  } catch {
    try {
      const { data } = await supabase.from('live_streams').select('*').in('id', ids)
      rows = (data ?? []) as any[]
    } catch {
      return []
    }
  }
  const now = Date.now()
  const cards = rows.map((r) => {
    const { placement, title } = readPlacement(r)
    const url = String(r.youtube_url ?? r.url ?? '')
    return {
      streamId: String(r.id),
      userId: String(r.user_id ?? ''),
      username: r.profiles?.username ?? null,
      avatarUrl: r.profiles?.avatar_url ?? null,
      title: title || 'Live stream',
      startedAt: ms(r.started_at ?? r.created_at, now),
      endedAt: r.ended_at ? ms(r.ended_at, now) : null,
      url,
      placement,
      videoId: extractYouTubeId(url) ?? '',
    } as LiveCard
  })
  return cards.sort((a, b) => ids.indexOf(a.streamId) - ids.indexOf(b.streamId))
}

/** jsonb id arrays come back as an array OR as JSON text depending on backend. */
export function parseIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}
