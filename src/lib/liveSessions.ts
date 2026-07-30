import { supabase } from '@/lib/supabase'
import type { LiveSession } from '@/types/database'

/**
 * Live sessions — the unified "who's live right now" reads/writes behind the
 * Live surfaces on home + profiles (see db/schema.sql LIVE SESSIONS).
 *
 * READ is public (a session nobody can see is not live). WRITE is owner-forced
 * by TABLE_POLICY: `host_id` is set to the caller on insert, so `startLiveSession`
 * always marks YOU live, and only you (or a global host) may `endLiveSession`.
 * A session is live while `status='live'` and stops being live the moment it is
 * ended; a video of it can be posted afterwards through the youtube_id path.
 */

/** True while the session is on air. Pure so it can be asserted. */
export function isSessionLive(s: Pick<LiveSession, 'status'>): boolean {
  return s.status === 'live'
}

const tsOf = (s: Pick<LiveSession, 'started_at' | 'created_at'>): number =>
  new Date(s.started_at ?? s.created_at ?? 0).getTime() || 0

/** Sessions that are live right now, newest first. */
export async function liveSessionsNow(limit = 24): Promise<LiveSession[]> {
  const { data } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('status', 'live')
    .order('started_at', { ascending: false })
    .limit(limit)
  return ((data ?? []) as LiveSession[])
    .filter(isSessionLive)
    .sort((a, b) => tsOf(b) - tsOf(a))
    .slice(0, limit)
}

/** The live sessions a given player is currently hosting (for their profile). */
export async function liveSessionsForHost(hostId: string): Promise<LiveSession[]> {
  if (!hostId) return []
  const { data } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('host_id', hostId)
    .eq('status', 'live')
  return ((data ?? []) as LiveSession[]).filter(isSessionLive).sort((a, b) => tsOf(b) - tsOf(a))
}

/** What `startLiveSession` accepts. `host_id` is forced server-side, never sent. */
export interface StartLiveInput {
  kind?: LiveSession['kind']
  title?: string | null
  watch_url?: string | null
  match_id?: string | null
  reel_id?: string | null
  battle_id?: string | null
  tournament_id?: string | null
}

/**
 * Mark the caller live. Returns the created row (host_id is stamped to the
 * caller by the server), or null if the write failed / no session.
 */
export async function startLiveSession(input: StartLiveInput = {}): Promise<LiveSession | null> {
  const { data } = await supabase
    .from('live_sessions')
    .insert({ kind: 'host', ...input, status: 'live', started_at: new Date().toISOString() })
    .select()
    .single()
  return (data ?? null) as LiveSession | null
}

/**
 * End a live session. Only the owner (or a global host) may, per policy; the
 * row stops counting as live immediately. A produced video may be posted after.
 */
export async function endLiveSession(id: string): Promise<void> {
  if (!id) return
  await supabase
    .from('live_sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', id)
}
