import { supabase } from '@/lib/supabase'
import type { Clan, ClanMember, ClanMatch, ClanJoinMode } from '@/types/database'

/**
 * clans — typed data layer for the CLANS feature.
 *
 * Every function throws on a Supabase error so callers can rely on a resolved
 * value being real data. RLS does the authorization; these helpers just shape
 * the queries. Ordering for `listClans` is points-desc because that list *is*
 * the leaderboard.
 */

/** A roster row with the joined profile columns the UI renders (name/avatar). */
export type ClanMemberWithProfile = ClanMember & {
  profiles: { username: string; avatar_url: string | null } | null
}

export type CreateClanInput = {
  tag: string
  name: string
  description?: string | null
  emblem_icon: string
  emblem_bg: string
  emblem_fg: string
  join_mode: ClanJoinMode
  banner_url?: string | null
}

export type CreateClanMatchInput = {
  clan_a: string
  clan_b: string
  scheduled_at?: string | null
  created_by: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Every clan, highest points first. This ordering *is* the leaderboard. */
export async function listClans(): Promise<Clan[]> {
  const { data, error } = await supabase
    .from('clans')
    .select('*')
    .order('points', { ascending: false })
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as Clan[]
}

/**
 * Look a clan up by its uuid id or its (case-sensitive) tag. Route params are
 * ids, but this keeps `/clans/KILL` style links working too.
 */
export async function getClanByIdOrTag(idOrTag: string): Promise<Clan | null> {
  const column = UUID_RE.test(idOrTag) ? 'id' : 'tag'
  const { data, error } = await supabase
    .from('clans')
    .select('*')
    .eq(column, idOrTag)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data as Clan | null) ?? null
}

/**
 * Create a clan and seat the creator as its owner. Two inserts: the clan row
 * (owner_id = current user) then the owner's roster row. The DB trigger keeps
 * clans.member_count in sync, so we never touch it here.
 */
export async function createClan(input: CreateClanInput): Promise<Clan> {
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) throw new Error('You must be signed in to create a clan.')

  const { data: clan, error } = await supabase
    .from('clans')
    .insert({
      tag: input.tag,
      name: input.name,
      description: input.description ?? null,
      emblem_icon: input.emblem_icon,
      emblem_bg: input.emblem_bg,
      emblem_fg: input.emblem_fg,
      banner_url: input.banner_url ?? null,
      join_mode: input.join_mode,
      owner_id: user.id,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)

  const { error: memberErr } = await supabase
    .from('clan_members')
    .insert({ clan_id: clan.id, user_id: user.id, role: 'owner' })
  if (memberErr) throw new Error(memberErr.message)

  return clan as Clan
}

/** Add a user to a clan's roster as a plain member. */
export async function joinClan(clanId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('clan_members')
    .insert({ clan_id: clanId, user_id: userId, role: 'member' })
  if (error) throw new Error(error.message)
}

/** Remove a user from a clan's roster. */
export async function leaveClan(clanId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from('clan_members')
    .delete()
    .eq('clan_id', clanId)
    .eq('user_id', userId)
  if (error) throw new Error(error.message)
}

/** The roster, oldest members first, with each member's profile joined in. */
export async function getMembers(clanId: string): Promise<ClanMemberWithProfile[]> {
  const { data, error } = await supabase
    .from('clan_members')
    .select('*, profiles(username, avatar_url)')
    .eq('clan_id', clanId)
    .order('joined_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as ClanMemberWithProfile[]
}

/** Whether a user currently sits on a clan's roster. */
export async function isMember(clanId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('clan_members')
    .select('id')
    .eq('clan_id', clanId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

/** Every match this clan is on either side of, most recently scheduled first. */
export async function listClanMatches(clanId: string): Promise<ClanMatch[]> {
  const { data, error } = await supabase
    .from('clan_matches')
    .select('*')
    .or(`clan_a.eq.${clanId},clan_b.eq.${clanId}`)
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []) as ClanMatch[]
}

/** Schedule a clan-vs-clan match. RLS requires created_by = current user. */
export async function createClanMatch(input: CreateClanMatchInput): Promise<ClanMatch> {
  const { data, error } = await supabase
    .from('clan_matches')
    .insert({
      clan_a: input.clan_a,
      clan_b: input.clan_b,
      scheduled_at: input.scheduled_at ?? null,
      created_by: input.created_by,
    })
    .select('*')
    .single()
  if (error) throw new Error(error.message)
  return data as ClanMatch
}
