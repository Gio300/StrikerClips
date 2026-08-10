import { supabase } from './supabase'
import type { ClipCategory } from './clipSearch'
import type { SquadClip, SquadMember } from './squad'

type FollowRow = { following_id: string }
type ClanRow = { server_id: string; user_id?: string }
type OwnedClanRow = { id: string }
type ProfileRow = { id: string; username: string; avatar_url: string | null }
type ClipRow = {
  player_id: string | null
  player_handle: string | null
  category: string | null
  composite_youtube_id: string | null
  recorded_at: string | null
  created_at: string | null
}
type ReelRow = {
  user_id: string
  title: string | null
  combined_video_url: string | null
  created_at: string | null
}

const CATEGORIES = new Set<ClipCategory>(['kill', 'death', 'ultimate', 'flag', 'win', 'clutch'])

function category(value: string | null | undefined, fallback: ClipCategory): ClipCategory {
  return value && CATEGORIES.has(value as ClipCategory) ? value as ClipCategory : fallback
}

function youtubeId(value: string | null | undefined): string {
  const text = String(value ?? '').trim()
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text
  return text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/|live\/|embed\/))([a-zA-Z0-9_-]{11})/i)?.[1] ?? ''
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : 0
}

/** Convert the real follow/clan graph and public produced catalogue into the shelf model. */
export function buildSquadData(
  viewerId: string,
  follows: FollowRow[],
  ownClans: ClanRow[],
  clanMembers: ClanRow[],
  profiles: ProfileRow[],
  clipRows: ClipRow[],
  reelRows: ReelRow[],
): { members: SquadMember[]; clips: SquadClip[] } {
  const clanIds = new Set(ownClans.map((row) => row.server_id))
  const circleIds = new Set(follows.map((row) => row.following_id))
  for (const row of clanMembers) {
    if (clanIds.has(row.server_id) && row.user_id) circleIds.add(row.user_id)
  }
  circleIds.delete(viewerId)

  const memberProfiles = profiles
    .filter((profile) => circleIds.has(profile.id))
    .sort((a, b) => a.username.localeCompare(b.username))
  const members: SquadMember[] = memberProfiles.map((profile) => ({
    id: profile.id,
    name: profile.username,
    avatarUrl: profile.avatar_url,
  }))
  const names = new Map(memberProfiles.map((profile) => [profile.id, profile.username]))

  const clips: SquadClip[] = []
  const seen = new Set<string>()
  const add = (ownerId: string, id: string, title: string, kind: ClipCategory, publishedAt: number) => {
    if (!names.has(ownerId) || !id) return
    const key = `${ownerId}:${id}`
    if (seen.has(key)) return
    seen.add(key)
    clips.push({
      id,
      ownerId,
      ownerName: names.get(ownerId)!,
      category: kind,
      title,
      publishedAt,
      visibility: 'followers',
    })
  }

  // composite_youtube_id is the rendered TKO output. Raw source archives stay
  // out of this shelf so a full private livestream is never mistaken for a cut.
  for (const row of clipRows) {
    const ownerId = String(row.player_id ?? '')
    const id = youtubeId(row.composite_youtube_id)
    const ownerName = names.get(ownerId) ?? row.player_handle ?? 'Squadmate'
    add(
      ownerId,
      id,
      `${ownerName} — produced match`,
      category(row.category, 'clutch'),
      timestamp(row.recorded_at ?? row.created_at),
    )
  }

  // User-built reels may also be reusable squad footage when their result is a
  // public YouTube video. Non-YouTube/local paths are deliberately skipped.
  for (const row of reelRows) {
    const id = youtubeId(row.combined_video_url)
    add(
      row.user_id,
      id,
      String(row.title ?? '').trim() || `${names.get(row.user_id) ?? 'Squadmate'} — reel`,
      'clutch',
      timestamp(row.created_at),
    )
  }

  return { members, clips: clips.sort((a, b) => b.publishedAt - a.publishedAt) }
}

function assertQuery(name: string, error: { message?: string } | null | undefined): void {
  if (error) throw new Error(`${name}: ${error.message || 'request failed'}`)
}

/** Load people the viewer follows plus everyone sharing any of their clans. */
export async function loadSquadData(viewerId: string): Promise<{ members: SquadMember[]; clips: SquadClip[] }> {
  if (!viewerId) return { members: [], clips: [] }

  const [followResult, clanMemberOfResult, serverMemberOfResult, ownedClanResult] = await Promise.all([
    supabase.from('follows').select('following_id').eq('follower_id', viewerId),
    supabase.from('clan_members').select('server_id').eq('user_id', viewerId),
    supabase.from('server_members').select('server_id').eq('user_id', viewerId),
    supabase.from('servers').select('id').eq('owner_id', viewerId).eq('kind', 'clan'),
  ])
  assertQuery('Following', followResult.error)
  assertQuery('Clan membership', clanMemberOfResult.error)
  assertQuery('Server membership', serverMemberOfResult.error)
  assertQuery('Owned clans', ownedClanResult.error)
  const follows = (followResult.data ?? []) as FollowRow[]
  const ownClans = [
    ...((clanMemberOfResult.data ?? []) as ClanRow[]),
    ...((serverMemberOfResult.data ?? []) as ClanRow[]),
    ...((ownedClanResult.data ?? []) as OwnedClanRow[]).map((row) => ({ server_id: row.id })),
  ]
  const clanIds = [...new Set(ownClans.map((row) => row.server_id).filter(Boolean))]

  const [clanRosterResult, serverRosterResult] = clanIds.length
    ? await Promise.all([
      supabase.from('clan_members').select('server_id,user_id').in('server_id', clanIds),
      supabase.from('server_members').select('server_id,user_id').in('server_id', clanIds),
    ])
    : [
      { data: [] as ClanRow[], error: null },
      { data: [] as ClanRow[], error: null },
    ]
  assertQuery('Clan roster', clanRosterResult.error)
  assertQuery('Server roster', serverRosterResult.error)
  const clanMembers = [
    ...((clanRosterResult.data ?? []) as ClanRow[]),
    ...((serverRosterResult.data ?? []) as ClanRow[]),
  ]
  const ids = [...new Set([
    ...follows.map((row) => row.following_id),
    ...clanMembers.map((row) => row.user_id ?? ''),
  ].filter((id) => id && id !== viewerId))]
  if (ids.length === 0) return { members: [], clips: [] }

  const [profileResult, clipResult, reelResult] = await Promise.all([
    supabase.from('profiles').select('id,username,avatar_url').in('id', ids),
    supabase
      .from('clip_records')
      .select('player_id,player_handle,category,composite_youtube_id,recorded_at,created_at')
      .in('player_id', ids),
    supabase.from('reels').select('user_id,title,combined_video_url,created_at').in('user_id', ids),
  ])
  assertQuery('Squad profiles', profileResult.error)
  assertQuery('Squad clips', clipResult.error)
  assertQuery('Squad reels', reelResult.error)

  return buildSquadData(
    viewerId,
    follows,
    ownClans,
    clanMembers,
    (profileResult.data ?? []) as ProfileRow[],
    (clipResult.data ?? []) as ClipRow[],
    (reelResult.data ?? []) as ReelRow[],
  )
}
