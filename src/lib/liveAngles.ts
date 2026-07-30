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
  created_at?: string | null
}

export interface PersonHit {
  id: string
  username: string | null
  avatar_url: string | null
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

/** Remove one angle from the host's show. */
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
