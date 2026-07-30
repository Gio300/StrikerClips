/**
 * Host commentary — the "with host" lane (docs/TKO-BUILD-PLAN.md §3 + §4).
 *
 * A HOST (global tko_host capability) narrates matches, either by HOSTING A LIVE
 * MATCH now (captured through their local OBS, or the phone/browser camera+mic)
 * or by ADDING COMMENTARY TO A PAST MATCH (picking an existing match/reel and
 * recording camera+mic or mic-only over it). Each saved commentary is the
 * "with host" version marker for its match/reel — the player's version picker
 * reads them back to offer with-host vs without-host.
 *
 * Thin wrappers over the generic backend (`supabase.from('host_commentaries')`);
 * the server's TABLE_POLICY is what actually gates creation to hosts and forces
 * `host_id` to the caller, so nothing here is trusted for authorization.
 */
import { supabase } from './supabase'
import type { HostCommentary } from '@/types/database'

/** How the host is captured. */
export type HostSource = 'obs' | 'camera' | 'mic'
/** Whether the host is on a live match or commentating a past one. */
export type HostMode = 'live' | 'past'

export interface CreateHostCommentaryInput {
  mode: HostMode
  source: HostSource
  /** The past match this is the "with host" version of (mode 'past'). */
  matchId?: string | null
  /** The past reel this is the "with host" version of (mode 'past'). */
  reelId?: string | null
  title?: string | null
  /** The produced commentary track / video URL, when already known. */
  commentaryUrl?: string | null
  status?: HostCommentary['status']
}

/** Human label for a capture source (shown in the host lane + version picker). */
export function hostSourceLabel(source: HostSource): string {
  switch (source) {
    case 'obs': return 'OBS restream'
    case 'camera': return 'Camera + mic'
    case 'mic': return 'Mic only'
  }
}

/**
 * Persist a host-commentary association. `host_id` is set server-side to the
 * caller (a host), so it is deliberately NOT sent here. Returns the created row,
 * or null when the backend refused (e.g. the caller is not a host) or is offline.
 */
export async function createHostCommentary(
  input: CreateHostCommentaryInput,
): Promise<HostCommentary | null> {
  const { data, error } = await supabase
    .from('host_commentaries')
    .insert({
      mode: input.mode,
      capture_source: input.source,
      match_id: input.matchId ?? null,
      reel_id: input.reelId ?? null,
      title: input.title ?? null,
      commentary_url: input.commentaryUrl ?? null,
      status: input.status ?? 'ready',
    })
    .select()
    .single()
  if (error) return null
  return (data as HostCommentary) ?? null
}

/** Every host commentary recorded against a given match (newest first). */
export async function listHostCommentariesForMatch(matchId: string): Promise<HostCommentary[]> {
  const { data, error } = await supabase
    .from('host_commentaries')
    .select('*')
    .eq('match_id', matchId)
    .order('created_at', { ascending: false })
  if (error) return []
  return (data as HostCommentary[]) ?? []
}

/** The most recent host commentary for a match, or null when there is no host cut. */
export async function latestHostVersion(matchId: string): Promise<HostCommentary | null> {
  const rows = await listHostCommentariesForMatch(matchId)
  return rows[0] ?? null
}

/** True when a match has at least one "with host" version. */
export async function matchHasHostVersion(matchId: string): Promise<boolean> {
  return (await latestHostVersion(matchId)) != null
}
