import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Heart,
  MessageCircle,
  RefreshCw,
  SendHorizontal,
  Trash2,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui'
import { TagBadge } from '@/components/TagBadge'
import {
  MAX_COMMENT_LENGTH,
  MAX_POST_LENGTH,
  activityTargetName,
  createPost,
  createPostComment,
  deletePost,
  loadNewsFeed,
  loadPostsForAuthors,
  setPostLiked,
  type SocialActivity,
  type SocialPost,
  type SocialProfile,
} from '@/lib/social'

function formatDate(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function PostComposer({
  userId,
  profile,
  onCreated,
}: {
  userId: string
  profile: SocialProfile | null
  onCreated: (post: SocialPost) => void
}) {
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!body.trim() || posting) return
    setPosting(true)
    setError(null)
    try {
      const post = await createPost(userId, body)
      onCreated({
        ...post,
        author: post.author ?? profile,
      })
      setBody('')
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : 'Could not publish your post.')
    } finally {
      setPosting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mb-4 rounded-lg border border-dark-border bg-dark-card p-4">
      <div className="flex items-start gap-3">
        <Avatar
          src={profile?.avatar_url}
          name={profile?.username}
          seed={profile?.id || userId}
          size={40}
        />
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={MAX_POST_LENGTH}
          rows={3}
          placeholder="Share something with your wall"
          className="min-w-0 flex-1 resize-none rounded-lg border border-dark-border bg-dark px-3 py-2 text-white placeholder-gray-500 focus:border-accent focus:outline-none"
        />
      </div>
      <div className="mt-3 flex items-center justify-end gap-3">
        {error && <p role="alert" className="mr-auto text-xs text-kunai">{error}</p>}
        <button
          type="submit"
          disabled={!body.trim() || posting}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
          Post
        </button>
      </div>
    </form>
  )
}

function PostCard({
  post,
  viewerId,
  onChanged,
  onDeleted,
}: {
  post: SocialPost
  viewerId: string | null
  onChanged: (post: SocialPost) => void
  onDeleted: (postId: string) => void
}) {
  const [comment, setComment] = useState('')
  const [showAllComments, setShowAllComments] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visibleComments = showAllComments ? post.comments : post.comments.slice(-2)

  async function toggleLike() {
    if (!viewerId || working) return
    const nextLiked = !post.likedByViewer
    setWorking(true)
    setError(null)
    try {
      await setPostLiked(post.id, viewerId, nextLiked)
      onChanged({
        ...post,
        likedByViewer: nextLiked,
        likeCount: Math.max(0, post.likeCount + (nextLiked ? 1 : -1)),
      })
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : 'Could not update the like.')
    } finally {
      setWorking(false)
    }
  }

  async function addComment(event: React.FormEvent) {
    event.preventDefault()
    if (!viewerId || !comment.trim() || working) return
    setWorking(true)
    setError(null)
    try {
      const created = await createPostComment(post.id, viewerId, comment)
      onChanged({ ...post, comments: [...post.comments, created] })
      setComment('')
      setShowAllComments(true)
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : 'Could not add the comment.')
    } finally {
      setWorking(false)
    }
  }

  async function removePost() {
    if (working) return
    setWorking(true)
    setError(null)
    try {
      await deletePost(post.id)
      onDeleted(post.id)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the post.')
      setWorking(false)
    }
  }

  return (
    <article className="rounded-lg border border-dark-border bg-dark-card">
      <header className="flex items-start gap-3 px-4 pt-4">
        <Link to={`/profile/${post.user_id}`} className="shrink-0">
          <Avatar
            src={post.author?.avatar_url}
            name={post.author?.username}
            seed={post.user_id}
            size={40}
          />
        </Link>
        <div className="min-w-0 flex-1">
          <Link
            to={`/profile/${post.user_id}`}
            className="inline-flex max-w-full items-center gap-2 font-semibold text-white hover:text-accent"
          >
            <span className="truncate">{post.author?.username || 'Deleted player'}</span>
            <TagBadge
              artifactText={post.author?.equipped_tag_text}
              rarity={post.author?.equipped_tag_rarity}
            />
          </Link>
          <p className="text-xs text-gray-500">{formatDate(post.created_at)}</p>
        </div>
        {viewerId === post.user_id && (
          <button
            type="button"
            onClick={removePost}
            disabled={working}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-dark-border/40 hover:text-kunai disabled:opacity-50"
            aria-label="Delete post"
            title="Delete post"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </header>

      <p className="whitespace-pre-wrap break-words px-4 py-4 text-gray-200">{post.body}</p>

      <div className="flex items-center gap-1 border-t border-dark-border px-3 py-2">
        <button
          type="button"
          onClick={toggleLike}
          disabled={!viewerId || working}
          className={`inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm ${
            post.likedByViewer ? 'text-kunai' : 'text-gray-400 hover:text-white'
          } disabled:opacity-50`}
          aria-label={post.likedByViewer ? 'Unlike post' : 'Like post'}
        >
          <Heart className={`h-4 w-4 ${post.likedByViewer ? 'fill-current' : ''}`} />
          {post.likeCount}
        </button>
        <span className="inline-flex h-9 items-center gap-2 px-3 text-sm text-gray-400">
          <MessageCircle className="h-4 w-4" aria-hidden />
          {post.comments.length}
        </span>
      </div>

      {(visibleComments.length > 0 || viewerId) && (
        <div className="space-y-3 border-t border-dark-border px-4 py-3">
          {post.comments.length > 2 && !showAllComments && (
            <button
              type="button"
              onClick={() => setShowAllComments(true)}
              className="text-xs text-gray-400 hover:text-accent"
            >
              View all {post.comments.length} comments
            </button>
          )}
          {visibleComments.map((item) => (
            <div key={item.id} className="flex items-start gap-2">
              <Avatar
                src={item.author?.avatar_url}
                name={item.author?.username}
                seed={item.user_id}
                size={28}
              />
              <div className="min-w-0 flex-1 rounded-lg bg-dark px-3 py-2">
                <Link
                  to={`/profile/${item.user_id}`}
                  className="text-xs font-semibold text-white hover:text-accent"
                >
                  {item.author?.username || 'Deleted player'}
                </Link>
                <p className="break-words text-sm text-gray-300">{item.body}</p>
              </div>
            </div>
          ))}
          {viewerId && (
            <form onSubmit={addComment} className="flex items-center gap-2">
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={MAX_COMMENT_LENGTH}
                placeholder="Write a comment"
                className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
              <button
                type="submit"
                disabled={!comment.trim() || working}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-accent hover:bg-accent/10 disabled:opacity-40"
                aria-label="Post comment"
                title="Post comment"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </form>
          )}
          {error && <p role="alert" className="text-xs text-kunai">{error}</p>}
        </div>
      )}
    </article>
  )
}

function ActivityCard({ activity }: { activity: SocialActivity }) {
  const actorName = activity.actor?.username || 'Deleted player'
  const targetName = activityTargetName(activity)
  const meta = activity.target_meta && typeof activity.target_meta === 'object'
    ? activity.target_meta as Record<string, unknown>
    : {}

  let story: React.ReactNode
  if (activity.type === 'follow') {
    story = (
      <>
        followed{' '}
        {activity.target_id ? (
          <Link to={`/profile/${activity.target_id}`} className="font-medium text-accent hover:underline">
            {targetName}
          </Link>
        ) : targetName}
      </>
    )
  } else if (activity.type === 'reel_created') {
    story = (
      <>
        posted a reel
        {activity.target_id && (
          <>
            {': '}
            <Link to={`/reels/${activity.target_id}`} className="font-medium text-accent hover:underline">
              {typeof meta.title === 'string' && meta.title ? meta.title : 'View reel'}
            </Link>
          </>
        )}
      </>
    )
  } else if (activity.type === 'reel_like') {
    story = activity.target_id ? (
      <>
        liked{' '}
        <Link to={`/reels/${activity.target_id}`} className="font-medium text-accent hover:underline">
          a reel
        </Link>
      </>
    ) : 'liked a reel'
  } else {
    story = 'started a poll in chat'
  }

  return (
    <article className="flex items-start gap-3 rounded-lg border border-dark-border bg-dark-card p-4">
      <Link to={`/profile/${activity.user_id}`} className="shrink-0">
        <Avatar
          src={activity.actor?.avatar_url}
          name={actorName}
          seed={activity.user_id}
          size={36}
        />
      </Link>
      <div className="min-w-0">
        <p className="text-sm text-gray-300">
          <Link
            to={`/profile/${activity.user_id}`}
            className="font-semibold text-white hover:text-accent"
          >
            {actorName}
          </Link>{' '}
          {story}
        </p>
        <p className="mt-1 text-xs text-gray-500">{formatDate(activity.created_at)}</p>
      </div>
    </article>
  )
}

export function SocialFeed({
  mode,
  viewerId,
  profileId,
  composerProfile,
}: {
  mode: 'wall' | 'feed'
  viewerId: string | null
  profileId?: string | null
  composerProfile?: SocialProfile | null
}) {
  const [posts, setPosts] = useState<SocialPost[]>([])
  const [activities, setActivities] = useState<SocialActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (mode === 'wall') {
        if (!profileId) {
          setPosts([])
          setActivities([])
        } else {
          setPosts(await loadPostsForAuthors([profileId], viewerId))
          setActivities([])
        }
      } else {
        if (!viewerId) {
          setPosts([])
          setActivities([])
        } else {
          const data = await loadNewsFeed(viewerId)
          setPosts(data.posts)
          setActivities(data.activities)
        }
      }
    } catch (loadError) {
      setPosts([])
      setActivities([])
      setError(loadError instanceof Error ? loadError.message : 'Could not load the feed.')
    } finally {
      setLoading(false)
    }
  }, [mode, profileId, viewerId])

  useEffect(() => {
    void load()
  }, [load])

  const items = useMemo(() => (
    [
      ...posts.map((post) => ({
        id: `post:${post.id}`,
        createdAt: post.created_at,
        node: (
          <PostCard
            key={post.id}
            post={post}
            viewerId={viewerId}
            onChanged={(changed) => setPosts((current) => (
              current.map((item) => item.id === changed.id ? changed : item)
            ))}
            onDeleted={(postId) => setPosts((current) => (
              current.filter((item) => item.id !== postId)
            ))}
          />
        ),
      })),
      ...(mode === 'feed' ? activities.map((activity) => ({
        id: `activity:${activity.id}`,
        createdAt: activity.created_at,
        node: <ActivityCard key={activity.id} activity={activity} />,
      })) : []),
    ].sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))
  ), [activities, mode, posts, viewerId])

  const canCompose = mode === 'wall' && Boolean(viewerId && profileId === viewerId)

  return (
    <div>
      {canCompose && viewerId && (
        <PostComposer
          userId={viewerId}
          profile={composerProfile ?? null}
          onCreated={(post) => setPosts((current) => [post, ...current])}
        />
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-gray-500">Loading posts...</div>
      ) : error ? (
        <div className="rounded-lg border border-kunai/30 bg-kunai/5 p-4 text-center">
          <p className="text-sm text-kunai">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-dark-border px-3 py-2 text-sm text-gray-300 hover:text-white"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-gray-400">
            {mode === 'wall' ? 'No posts yet.' : 'Your feed is quiet right now.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((item) => <div key={item.id}>{item.node}</div>)}
        </div>
      )}
    </div>
  )
}
