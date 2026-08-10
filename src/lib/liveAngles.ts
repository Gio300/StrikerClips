/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * liveAngles — the I/O for a host-curated multi-angle live "show".
 *
 * A single `live_streams` row is the host's show. The host's own stream is angle
 * 1; the host then SEARCHES for other players by name and ADDS their streams as
 * further angles (`live_stream_angles`), pulling the player's linked YouTube live
 * URL automatically or letting the host paste one. Viewers read the angles back
 * and switch between them (see LiveControlLayout).
 *
 * Reads go through the public `live_stream_angles` policy; writes go through the
 * trusted /api/fn/live-angle-* handlers, which verify the caller owns the parent
 * live stream. A live heartbeat keeps the stream fresh so the stale-live TTL
 * never expires a genuinely-active broadcast.
 */
import { supabase } from '@/lib/supabase'

export interface LiveAngleRow {
  id: string
  live_stream_id: string
  user_id: string | null
  label: string | null
  youtube_url: string | null
  /** Per-angle lifecycle: 'live' (on air), 'stopped' (host paused, slot kept),
   *  'reconnecting' (feed dropped, slot reserved, auto-reconnecting). */
  status?: 'live' | 'stopped' | 'reconnecting' | null
  /** Action score 0-100 posted by the PC's HUD watcher (tko_live_director);
   *  stale when action_at is old — AUTO ignores anything older than ~30s. */
  action_level?: number | null
  action_at?: string | null
  created_at?: string | null
}

export interface LiveSessionRow {
  id: string
  user_id: string
  youtube_url: string
  title: string | null
  is_live: boolean
  placement: string
  host_feed_status?: 'live' | 'stopped' | null
  source?: string | null
  external_stream_id?: string | null
  /** The tournament this show is connected to (see attachTournamentToLive). */
  tournament_id?: string | null
  angle_count?: number
  created_at?: string | null
  updated_at?: string | null
}

export interface PersonHit {
  id: string
  username: string | null
  avatar_url: string | null
}

export interface LiveScoreboard {
  team_a: string
  team_b: string
  score_a: number
  score_b: number
  score_revision: number
}

/** Read the extra angles a host has attached to their live show. */
export async function loadAngles(liveStreamId: string): Promise<LiveAngleRow[]> {
  if (!liveStreamId || liveStreamId === 'direct') return []
  try {
    // `live_stream_angles` isn't in the generated DB types — cast like safeSelect.
    const { data } = await (supabase.from('live_stream_angles' as any) as any)
      .select('*')
      .eq('live_stream_id', liveStreamId)
      .order('created_at', { ascending: true })
    return (data ?? []) as LiveAngleRow[]
  } catch {
    return []
  }
}

/** Search players by (partial, case-insensitive) username — reused go-live people search. */
export async function searchPeople(query: string, excludeUserId?: string): Promise<PersonHit[]> {
  const q = query.trim()
  if (!q) return []
  try {
    const { data } = await supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .ilike('username', `%${q}%`)
      .limit(15)
    let rows = (data ?? []) as PersonHit[]
    if (excludeUserId) rows = rows.filter((p) => p.id !== excludeUserId)
    return rows
  } catch {
    return []
  }
}

export interface AddAngleInput {
  liveStreamId: string
  /** the added player's id — their linked YouTube live URL is resolved for them. */
  userId?: string | null
  /** a pasted stream link, used when the player has no linked YouTube (or no id). */
  youtubeUrl?: string | null
  label?: string | null
}

/** Add a player's stream as another angle of the host's live show. */
export async function addAngle(input: AddAngleInput): Promise<{ ok: boolean; angle?: LiveAngleRow; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-add', {
      body: {
        liveStreamId: input.liveStreamId,
        userId: input.userId ?? undefined,
        youtubeUrl: input.youtubeUrl ?? undefined,
        label: input.label ?? undefined,
      },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not add angle' }
    const payload = data as any
    if (payload?.ok === false) return { ok: false, error: payload?.error || 'Could not add angle' }
    return { ok: true, angle: payload?.angle }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not add angle' }
  }
}

/** Remove one angle from the host's show (a real leave — hard delete). */
export async function removeAngle(angleId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-remove', { body: { angleId } })
    if (error) return false
    return (data as any)?.ok !== false
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  STOP / RESTART / RECONNECT — retain a participant's SLOT across a stop or a
//  dropped feed instead of tearing the multi-cam down. Stopping the host's own
//  feed (setHostFeed) never ends the session (is_live stays true).
// ─────────────────────────────────────────────────────────────────────────

/** Stop one participant's feed but KEEP its slot (host only). */
export async function stopAngle(angleId: string): Promise<{ ok: boolean; angle?: LiveAngleRow; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-stop', { body: { angleId } })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not stop angle' }
    const p = data as any
    if (p?.ok === false) return { ok: false, error: p?.error || 'Could not stop angle' }
    return { ok: true, angle: p?.angle }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not stop angle' }
  }
}

/** Bring a stopped/reconnecting participant back on air, re-resolving their link (host only). */
export async function restartAngle(angleId: string): Promise<{ ok: boolean; angle?: LiveAngleRow; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-restart', { body: { angleId } })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not restart angle' }
    const p = data as any
    if (p?.ok === false) return { ok: false, error: p?.error || 'Could not restart angle' }
    return { ok: true, angle: p?.angle }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not restart angle' }
  }
}

/** Report that a participant's feed dropped — reserves the slot as 'reconnecting'. */
export async function markAngleDropped(angleId: string): Promise<{ ok: boolean; angle?: LiveAngleRow }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-dropped', { body: { angleId } })
    if (error) return { ok: false }
    const p = data as any
    return { ok: p?.ok !== false, angle: p?.angle }
  } catch {
    return { ok: false }
  }
}

/**
 * Attempt to reconnect a dropped feed by re-resolving the player's live link.
 * `reconnected` is true when the slot flipped back to 'live'. Poll this while an
 * angle is 'reconnecting'.
 */
export async function reconnectAngle(angleId: string): Promise<{ ok: boolean; reconnected: boolean; angle?: LiveAngleRow }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-reconnect', { body: { angleId } })
    if (error) return { ok: false, reconnected: false }
    const p = data as any
    return { ok: p?.ok !== false, reconnected: p?.reconnected === true, angle: p?.angle }
  } catch {
    return { ok: false, reconnected: false }
  }
}

/**
 * Re-resolve every active camera slot in a show. The server performs the
 * YouTube lookup once for the host; viewers only consume the repaired rows.
 */
export async function refreshLiveAngles(
  liveStreamId: string,
): Promise<{ ok: boolean; angles: LiveAngleRow[]; updated: number; waiting: number; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-refresh-all', {
      body: { liveStreamId },
    })
    if (error) {
      return { ok: false, angles: [], updated: 0, waiting: 0, error: (error as any)?.message || 'Could not refresh feeds' }
    }
    const payload = data as any
    if (payload?.ok === false) {
      return { ok: false, angles: [], updated: 0, waiting: 0, error: payload?.error || 'Could not refresh feeds' }
    }
    return {
      ok: true,
      angles: Array.isArray(payload?.angles) ? payload.angles as LiveAngleRow[] : [],
      updated: Number(payload?.updated || 0),
      waiting: Number(payload?.waiting || 0),
    }
  } catch (e: any) {
    return { ok: false, angles: [], updated: 0, waiting: 0, error: e?.message || 'Could not refresh feeds' }
  }
}

/** Update the shared live scoreboard (host only): team names and/or absolute
 *  scores. Every viewer's scorebug follows within one poll (~3s). */
export async function updateLiveScoreboard(input: {
  liveStreamId: string
  teamA?: string
  teamB?: string
  scoreA?: number
  scoreB?: number
}): Promise<{ ok: boolean; scoreboard?: LiveScoreboard; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-scoreboard-update', {
      body: {
        streamId: input.liveStreamId,
        teamA: input.teamA,
        teamB: input.teamB,
        scoreA: input.scoreA,
        scoreB: input.scoreB,
      },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not update the scoreboard' }
    const payload = data as any
    if (payload?.ok === false) return { ok: false, error: payload?.error || 'Could not update the scoreboard' }
    return { ok: true, scoreboard: payload?.scoreboard as LiveScoreboard }
  } catch (error: any) {
    return { ok: false, error: error?.message || 'Could not update the scoreboard' }
  }
}

/** The shot the host currently has on air; viewers on "Host's view" mirror it. */
export interface HostView {
  layout: 'solo' | 'duo' | 'grid' | 'pip'
  /** Angle ids ('host' for angle 1, else live_stream_angles row ids), max 4. */
  feeds: string[]
  at?: string
}

/** Publish the host's on-air shot (host only, debounced by the caller). */
export async function setHostView(
  liveStreamId: string,
  view: { layout: HostView['layout']; feeds: string[] },
): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('live-host-view', {
      body: { streamId: liveStreamId, layout: view.layout, feeds: view.feeds },
    })
    if (error) return false
    return (data as any)?.ok !== false
  } catch {
    return false
  }
}

/** Stop or restart the HOST'S OWN feed (angle 1) without ending the session. */
export async function setHostFeed(
  liveStreamId: string,
  action: 'stop' | 'start',
  youtubeUrl?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-host-feed', {
      body: { liveStreamId, action, youtubeUrl: youtubeUrl?.trim() || undefined },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not update your feed' }
    const p = data as any
    if (p?.ok === false) return { ok: false, error: p?.error || 'Could not update your feed' }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not update your feed' }
  }
}

/** Load the caller's active and recently-ended shows for cross-device recovery. */
export async function listMyLiveSessions(): Promise<LiveSessionRow[]> {
  try {
    const { data, error } = await supabase.functions.invoke('live-session-list', { body: {} })
    if (error) return []
    const payload = data as any
    return Array.isArray(payload?.streams) ? payload.streams as LiveSessionRow[] : []
  } catch {
    return []
  }
}

/**
 * Attach (or detach, with `tournamentId: null`) one of the host's OWN
 * tournaments to a live show. The server verifies the caller owns the stream
 * AND runs the tournament (creator / listed admin / global TKO host) and that
 * the tournament isn't completed — see /api/fn/live-tournament-attach.
 */
export async function attachTournamentToLive(
  liveStreamId: string,
  tournamentId: string | null,
): Promise<{ ok: boolean; stream?: LiveSessionRow; reason?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-tournament-attach', {
      body: { liveStreamId, tournamentId },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not connect the tournament' }
    const payload = data as any
    if (payload?.ok === false) {
      return { ok: false, reason: payload?.reason, error: payload?.error || 'Could not connect the tournament' }
    }
    return { ok: true, stream: payload?.stream }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not connect the tournament' }
  }
}

/** Resume an existing show or end it completely (all camera slots stop). */
export async function controlLiveSession(
  liveStreamId: string,
  action: 'resume' | 'end',
  youtubeUrl?: string,
): Promise<{ ok: boolean; stream?: LiveSessionRow; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-session-control', {
      body: { liveStreamId, action, youtubeUrl: youtubeUrl?.trim() || undefined },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not control this show' }
    const payload = data as any
    if (payload?.ok === false) return { ok: false, error: payload?.error || 'Could not control this show' }
    return { ok: true, stream: payload?.stream }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not control this show' }
  }
}

/**
 * TOP-TIER auto live-detect: start a show from the host's CONNECTED channel with
 * no manual link entry. The server resolves their linked YouTube live URL.
 */
export async function autostartLive(
  placement?: string,
  title?: string,
): Promise<{ ok: boolean; streamId?: string; reason?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-autostart', {
      body: { placement, title },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not go live' }
    const p = data as any
    if (p?.ok === false) return { ok: false, reason: p?.reason, error: p?.error || 'Could not go live' }
    return { ok: true, streamId: p?.stream?.id }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not go live' }
  }
}

/**
 * TOP-TIER team auto-assemble: detect which teammates are live and add them all
 * as angles at once. Returns how many were added.
 */
export async function assembleTeam(
  liveStreamId: string,
): Promise<{ ok: boolean; added: number; reason?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-team-assemble', {
      body: { liveStreamId },
    })
    if (error) return { ok: false, added: 0, error: (error as any)?.message || 'Could not assemble team' }
    const p = data as any
    if (p?.ok === false) return { ok: false, added: 0, reason: p?.reason, error: p?.error || 'Could not assemble team' }
    return { ok: true, added: Number(p?.added ?? 0) }
  } catch (e: any) {
    return { ok: false, added: 0, error: e?.message || 'Could not assemble team' }
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  CO-STREAM INVITES — role-based.
//
//  A host (or an accepted co-host) INVITES another player to co-stream; the
//  invited player then adds THEIR OWN link as an angle (addSelfAngle), so the
//  host doesn't paste everyone's streams. The server enforces the ROLE CEILING
//  (you can invite a player only at your streaming tier or LOWER) — see the
//  live-invite fn. Writes are fn-only; reads go through the owner-scoped
//  live_stream_invites policy (both the invitee and the inviter can read theirs).
// ─────────────────────────────────────────────────────────────────────────

export interface LiveInviteRow {
  id: string
  live_stream_id: string
  inviter_id: string
  invitee_id: string
  role: string | null
  status: 'pending' | 'accepted' | 'declined'
  created_at?: string | null
}

/** Read the invites on a stream (host view — who's been invited). */
export async function loadStreamInvites(liveStreamId: string): Promise<LiveInviteRow[]> {
  if (!liveStreamId || liveStreamId === 'direct') return []
  try {
    const { data } = await (supabase.from('live_stream_invites' as any) as any)
      .select('*')
      .eq('live_stream_id', liveStreamId)
      .order('created_at', { ascending: true })
    return (data ?? []) as LiveInviteRow[]
  } catch {
    return []
  }
}

/** Read the invites addressed TO the current user (invitee view). */
export async function loadMyInvites(userId: string): Promise<LiveInviteRow[]> {
  if (!userId) return []
  try {
    const { data } = await (supabase.from('live_stream_invites' as any) as any)
      .select('*')
      .eq('invitee_id', userId)
      .order('created_at', { ascending: false })
    return (data ?? []) as LiveInviteRow[]
  } catch {
    return []
  }
}

/** Invite a player to co-stream. The server enforces the role ceiling. */
export async function inviteToCoStream(
  liveStreamId: string,
  userId: string,
): Promise<{ ok: boolean; invite?: LiveInviteRow; reason?: string; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-invite', {
      body: { liveStreamId, userId },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not invite' }
    const payload = data as any
    if (payload?.ok === false) {
      return { ok: false, reason: payload?.reason, error: payload?.error || 'Could not invite' }
    }
    return { ok: true, invite: payload?.invite }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not invite' }
  }
}

/** Accept or decline a co-stream invite (invitee only). */
export async function respondToInvite(
  inviteId: string,
  accept: boolean,
): Promise<{ ok: boolean; invite?: LiveInviteRow; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-invite-respond', {
      body: { inviteId, accept },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not respond' }
    const payload = data as any
    if (payload?.ok === false) return { ok: false, error: payload?.error || 'Could not respond' }
    return { ok: true, invite: payload?.invite }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not respond' }
  }
}

/**
 * Add the CALLER'S OWN stream as an angle — the self-service path an invited
 * player uses. With no url the server resolves their linked YouTube.
 */
export async function addSelfAngle(
  liveStreamId: string,
  youtubeUrl?: string,
): Promise<{ ok: boolean; angle?: LiveAngleRow; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('live-angle-add-self', {
      body: { liveStreamId, youtubeUrl: youtubeUrl?.trim() || undefined },
    })
    if (error) return { ok: false, error: (error as any)?.message || 'Could not add your stream' }
    const payload = data as any
    if (payload?.ok === false) return { ok: false, error: payload?.error || 'Could not add your stream' }
    return { ok: true, angle: payload?.angle }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Could not add your stream' }
  }
}

/** Bump the live stream's heartbeat so the stale-live TTL keeps it "live". */
export async function sendLiveHeartbeat(streamId?: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('live-heartbeat', {
      body: streamId ? { streamId } : {},
    })
    if (error) return false
    return (data as any)?.ok !== false
  } catch {
    return false
  }
}
