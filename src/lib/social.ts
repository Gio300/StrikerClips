import { supabase } from './supabase'
import type { Activity, Profile } from '@/types/database'

export const MAX_POST_LENGTH = 3000
export const MAX_COMMENT_LENGTH = 1000

export type SocialProfile = Pick<
  Profile,
  'id' | 'username' | 'avatar_url' | 'power_level' | 'equipped_tag_text' | 'equipped_tag_rarity'
>

export interface SocialComment {
  id: string
  post_id: string
  user_id: string
  body: string
  created_at: string | null
  author: SocialProfile | null
}

export interface SocialPost {
  id: string
  user_id: string
  body: string
  created_at: string | null
  updated_at: string | null
  author: SocialProfile | null
  likeCount: number
  likedByViewer: boolean
  comments: SocialComment[]
}

export interface SocialActivity extends Activity {
  actor: SocialProfile | null
  target: SocialProfile | null
}

export interface FeedAudience {
  userIds: string[]
  followingCount: number
  clanmateCount: number
}

export interface NewsFeedData {
  audience: FeedAudience
  posts: SocialPost[]
  activities: SocialActivity[]
}

type ErrorLike = { message?: string } | null | undefined

function throwIfError(error: ErrorLike, fallback: string): void {
  if (error) throw new Error(error.message || fallback)
}

function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))]
}

/** Build the feed audience deterministically: viewer, follows, then clanmates. */
export function mergeFeedAudience(
  viewerId: string,
  followedIds: readonly string[],
  clanmateIds: readonly string[],
): string[] {
  return uniqueIds([viewerId, ...followedIds, ...clanmateIds])
}

/** Collapse duplicate trigger/client activity rows while keeping the newest. */
export function dedupeActivities<T extends Pick<Activity, 'user_id' | 'type' | 'target_id' | 'created_at'>>(
  rows: readonly T[],
): T[] {
  const sorted = [...rows].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  const seen = new Set<string>()
  return sorted.filter((row) => {
    const key = `${row.user_id}:${row.type}:${row.target_id ?? ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function directConversationId(
  conversations: readonly { id: string; participantIds: readonly string[] }[],
  viewerId: string,
  targetId: string,
): string | null {
  for (const conversation of conversations) {
    const participants = uniqueIds(conversation.participantIds)
    if (
      participants.length === 2
      && participants.includes(viewerId)
      && participants.includes(targetId)
    ) {
      return conversation.id
    }
  }
  return null
}

export function activityTargetName(activity: Pick<SocialActivity, 'target' | 'target_meta'>): string {
  if (activity.target?.username) return activity.target.username
  const meta = activity.target_meta
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const username = (meta as Record<string, unknown>).username
    if (typeof username === 'string' && username.trim()) return username.trim()
  }
  return 'a player'
}

async function loadProfiles(ids: readonly string[]): Promise<Map<string, SocialProfile>> {
  const unique = uniqueIds(ids)
  if (unique.length === 0) return new Map()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_url, power_level, equipped_tag_text, equipped_tag_rarity')
    .in('id', unique)
  throwIfError(error, 'Could not load player profiles.')
  return new Map(
    ((data ?? []) as SocialProfile[]).map((profile) => [profile.id, profile]),
  )
}

export async function loadFeedAudience(viewerId: string): Promise<FeedAudience> {
  const { data: follows, error: followsError } = await supabase
    .from('follows')
    .select('following_id')
    .eq('follower_id', viewerId)
  throwIfError(followsError, 'Could not load followed players.')

  const followedIds = uniqueIds((follows ?? []).map((follow) => follow.following_id))
  const { data: memberships } = await supabase
    .from('clan_members')
    .select('server_id')
    .eq('user_id', viewerId)
  const serverIds = uniqueIds((memberships ?? []).map((membership) => membership.server_id))

  let clanmateIds: string[] = []
  if (serverIds.length > 0) {
    const { data: members } = await supabase
      .from('clan_members')
      .select('user_id')
      .in('server_id', serverIds)
    clanmateIds = uniqueIds((members ?? []).map((member) => member.user_id))
      .filter((id) => id !== viewerId)
  }

  return {
    userIds: mergeFeedAudience(viewerId, followedIds, clanmateIds),
    followingCount: followedIds.length,
    clanmateCount: clanmateIds.length,
  }
}

export async function loadPostsForAuthors(
  authorIds: readonly string[],
  viewerId: string | null,
  limit = 40,
): Promise<SocialPost[]> {
  const ids = uniqueIds(authorIds)
  if (ids.length === 0) return []

  const { data: rawPosts, error: postsError } = await supabase
    .from('posts')
    .select('*')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit)
  throwIfError(postsError, 'Could not load posts.')

  const posts = (rawPosts ?? []) as {
    id: string
    user_id: string
    body: string
    created_at: string | null
    updated_at: string | null
  }[]
  const postIds = posts.map((post) => post.id)
  if (postIds.length === 0) return []

  const [likesResult, commentsResult] = await Promise.all([
    supabase.from('post_likes').select('*').in('post_id', postIds),
    supabase
      .from('post_comments')
      .select('*')
      .in('post_id', postIds)
      .order('created_at', { ascending: true }),
  ])

  const likes = likesResult.error
    ? []
    : ((likesResult.data ?? []) as { post_id: string; user_id: string }[])
  const rawComments = commentsResult.error
    ? []
    : ((commentsResult.data ?? []) as {
        id: string
        post_id: string
        user_id: string
        body: string
        created_at: string | null
      }[])

  const profiles = await loadProfiles([
    ...posts.map((post) => post.user_id),
    ...rawComments.map((comment) => comment.user_id),
  ])

  return posts.map((post) => ({
    ...post,
    author: profiles.get(post.user_id) ?? null,
    likeCount: likes.filter((like) => like.post_id === post.id).length,
    likedByViewer: Boolean(
      viewerId
      && likes.some((like) => like.post_id === post.id && like.user_id === viewerId),
    ),
    comments: rawComments
      .filter((comment) => comment.post_id === post.id)
      .map((comment) => ({
        ...comment,
        author: profiles.get(comment.user_id) ?? null,
      })),
  }))
}

export async function loadActivitiesForAuthors(
  authorIds: readonly string[],
  limit = 40,
): Promise<SocialActivity[]> {
  const ids = uniqueIds(authorIds)
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('activities')
    .select('*')
    .in('user_id', ids)
    .order('created_at', { ascending: false })
    .limit(limit)
  throwIfError(error, 'Could not load activity.')

  const rows = dedupeActivities((data ?? []) as Activity[])
  const profiles = await loadProfiles([
    ...rows.map((row) => row.user_id),
    ...rows.map((row) => row.target_id),
  ].filter((id): id is string => Boolean(id)))

  return rows.map((row) => ({
    ...row,
    actor: profiles.get(row.user_id) ?? null,
    target: row.target_id ? profiles.get(row.target_id) ?? null : null,
  }))
}

export async function loadNewsFeed(viewerId: string): Promise<NewsFeedData> {
  const audience = await loadFeedAudience(viewerId)
  const [posts, activities] = await Promise.all([
    loadPostsForAuthors(audience.userIds, viewerId),
    loadActivitiesForAuthors(audience.userIds),
  ])
  return { audience, posts, activities }
}

export async function createPost(userId: string, body: string): Promise<SocialPost> {
  const text = body.trim()
  if (!text) throw new Error('Write something before posting.')
  if (text.length > MAX_POST_LENGTH) {
    throw new Error(`Posts must be ${MAX_POST_LENGTH.toLocaleString()} characters or fewer.`)
  }

  const { data, error } = await supabase
    .from('posts')
    .insert({ user_id: userId, body: text })
    .select()
    .single()
  throwIfError(error, 'Could not publish your post.')
  if (!data) throw new Error('The server did not return the new post.')
  const profiles = await loadProfiles([userId])
  return {
    ...(data as SocialPost),
    author: profiles.get(userId) ?? null,
    likeCount: 0,
    likedByViewer: false,
    comments: [],
  }
}

export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', postId)
  throwIfError(error, 'Could not delete the post.')
}

export async function setPostLiked(postId: string, userId: string, liked: boolean): Promise<void> {
  if (liked) {
    const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId })
    throwIfError(error, 'Could not like the post.')
    return
  }
  const { error } = await supabase
    .from('post_likes')
    .delete()
    .eq('post_id', postId)
    .eq('user_id', userId)
  throwIfError(error, 'Could not remove the like.')
}

export async function createPostComment(
  postId: string,
  userId: string,
  body: string,
): Promise<SocialComment> {
  const text = body.trim()
  if (!text) throw new Error('Write a comment first.')
  if (text.length > MAX_COMMENT_LENGTH) {
    throw new Error(`Comments must be ${MAX_COMMENT_LENGTH.toLocaleString()} characters or fewer.`)
  }
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, user_id: userId, body: text })
    .select()
    .single()
  throwIfError(error, 'Could not add the comment.')
  if (!data) throw new Error('The server did not return the new comment.')
  const profiles = await loadProfiles([userId])
  return {
    ...(data as SocialComment),
    author: profiles.get(userId) ?? null,
  }
}
