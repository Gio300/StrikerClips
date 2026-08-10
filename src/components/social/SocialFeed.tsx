import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Heart,
  ImagePlus,
  MessageCircle,
  Pencil,
  RefreshCw,
  SendHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui'
import { ShareButton } from '@/components/ShareButton'
import { canonicalShareUrl } from '@/lib/canonicalUrl'
import { PlayerMetaLine } from '@/components/PlayerMetaLine'
import { ReportContentButton } from '@/components/ReportContentButton'
import { ExternalVideoPreview } from '@/components/social/ExternalVideoPreview'
import { searchPeople, type PersonHit } from '@/lib/liveAngles'
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
  updatePostComment,
  type SocialActivity,
  type SocialComment,
  type SocialPost,
  type SocialProfile,
} from '@/lib/social'
import { isSafePostImageUrl } from '@/lib/postMedia'

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

// The @mention token being typed right before the caret, if any. Matches a
// word of letters/digits/underscore that follows an "@" at a word boundary — the
// same shape the rest of the app renders as a handle. Returns the search query
// (without the "@") and the index of the "@" so we can splice the pick back in.
function activeMentionAt(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret)
  const match = before.match(/(?:^|\s)@([\w]{1,30})$/)
  if (!match) return null
  const query = match[1]
  return { query, start: caret - query.length - 1 }
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
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null)
      return
    }
    const preview = URL.createObjectURL(imageFile)
    setImagePreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [imageFile])

  // @mention autocomplete: reuses the same partial `ilike '%q%'` username search
  // that powers Discover / the go-live people search (searchPeople). When the
  // caret sits on an "@handle" token we show a small dropdown and insert
  // `@username` on pick.
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [hits, setHits] = useState<PersonHit[]>([])
  const [activeIdx, setActiveIdx] = useState(0)

  // Debounced search whenever the active @token changes.
  useEffect(() => {
    const q = mention?.query ?? ''
    if (!q) { setHits([]); return }
    let cancelled = false
    const t = window.setTimeout(async () => {
      const people = await searchPeople(q, userId)
      if (!cancelled) { setHits(people.slice(0, 6)); setActiveIdx(0) }
    }, 150)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [mention?.query, userId])

  const showMenu = Boolean(mention) && hits.length > 0

  function syncMention(text: string, caret: number) {
    setMention(activeMentionAt(text, caret))
  }

  function pick(person: PersonHit) {
    const username = person.username
    if (!username || !mention) return
    const caret = textareaRef.current?.selectionStart ?? body.length
    const next = `${body.slice(0, mention.start)}@${username} ${body.slice(caret)}`
    setBody(next)
    setMention(null)
    setHits([])
    // Restore focus and drop the caret right after the inserted handle.
    const pos = mention.start + username.length + 2
    window.requestAnimationFrame(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!showMenu) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIdx((i) => (i + 1) % hits.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIdx((i) => (i - 1 + hits.length) % hits.length)
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      pick(hits[activeIdx])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setMention(null)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if ((!body.trim() && !imageFile) || posting) return
    setPosting(true)
    setError(null)
    try {
      const post = await createPost(userId, body, imageFile)
      onCreated({
        ...post,
        author: post.author ?? profile,
      })
      setBody('')
      setImageFile(null)
      if (imageInputRef.current) imageInputRef.current.value = ''
      setMention(null)
      setHits([])
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
        <div className="relative min-w-0 flex-1">
          <textarea
            ref={textareaRef}
            value={body}
            onChange={(event) => {
              setBody(event.target.value)
              syncMention(event.target.value, event.target.selectionStart ?? event.target.value.length)
            }}
            onKeyDown={onKeyDown}
            onClick={(event) => syncMention(body, event.currentTarget.selectionStart ?? body.length)}
            onBlur={() => window.setTimeout(() => setMention(null), 120)}
            maxLength={MAX_POST_LENGTH}
            rows={3}
            placeholder="Share something with your wall — @mention a player"
            className="min-w-0 w-full resize-none rounded-lg border border-dark-border bg-dark px-3 py-2 text-white placeholder-gray-500 focus:border-accent focus:outline-none"
          />
          {showMenu && (
            <ul className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-dark-border bg-dark-card py-1 shadow-2xl">
              {hits.map((person, index) => (
                <li key={person.id}>
                  <button
                    type="button"
                    // onMouseDown (not onClick) so the pick fires before the
                    // textarea's onBlur closes the menu.
                    onMouseDown={(event) => { event.preventDefault(); pick(person) }}
                    onMouseEnter={() => setActiveIdx(index)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      index === activeIdx ? 'bg-dark-elevated text-white' : 'text-gray-300 hover:bg-dark-elevated'
                    }`}
                  >
                    <Avatar src={person.avatar_url} name={person.username} seed={person.id} size={24} />
                    <span className="truncate">@{person.username || 'player'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {imagePreview && (
        <div className="relative mt-3 overflow-hidden rounded-lg border border-dark-border bg-dark">
          <img
            src={imagePreview}
            alt="Selected post preview"
            className="max-h-80 w-full object-contain"
          />
          <button
            type="button"
            onClick={() => {
              setImageFile(null)
              if (imageInputRef.current) imageInputRef.current.value = ''
            }}
            className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full bg-black/75 text-white hover:bg-black"
            aria-label="Remove selected picture"
            title="Remove picture"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <input
          ref={imageInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          aria-label="Choose a picture for your post"
          onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            setError(null)
            if (file && file.size > 8 * 1024 * 1024) {
              setError('Choose an image smaller than 8 MB.')
              event.target.value = ''
              return
            }
            setImageFile(file)
          }}
        />
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          disabled={posting}
          className="inline-flex items-center gap-2 rounded-lg border border-dark-border px-3 py-2 text-sm font-medium text-gray-300 hover:border-accent hover:text-accent disabled:opacity-50"
          aria-label={imageFile ? 'Change post picture' : 'Add a picture to your post'}
        >
          <ImagePlus className="h-4 w-4" aria-hidden />
          {imageFile ? 'Change photo' : 'Photo'}
        </button>
        {error && <p role="alert" className="min-w-0 flex-1 text-xs text-kunai">{error}</p>}
        <button
          type="submit"
          disabled={(!body.trim() && !imageFile) || posting}
          className="ml-auto inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50"
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
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editingCommentBody, setEditingCommentBody] = useState('')
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

  function beginCommentEdit(item: SocialComment) {
    if (working || viewerId !== item.user_id) return
    setError(null)
    setEditingCommentId(item.id)
    setEditingCommentBody(item.body)
  }

  function cancelCommentEdit() {
    if (working) return
    setEditingCommentId(null)
    setEditingCommentBody('')
    setError(null)
  }

  async function saveCommentEdit(event: React.FormEvent, item: SocialComment) {
    event.preventDefault()
    if (!viewerId || viewerId !== item.user_id || working) return
    setWorking(true)
    setError(null)
    try {
      const updated = await updatePostComment(item.id, viewerId, editingCommentBody)
      onChanged({
        ...post,
        comments: post.comments.map((existing) => (
          existing.id === item.id
            ? { ...existing, ...updated, author: updated.author ?? existing.author }
            : existing
        )),
      })
      setEditingCommentId(null)
      setEditingCommentBody('')
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : 'Could not update the comment.')
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
            className="block max-w-full truncate font-semibold text-white hover:text-accent"
          >
            {post.author?.username || 'Deleted player'}
          </Link>
          <div className="mt-0.5 flex min-w-0 items-center gap-2">
            <PlayerMetaLine
              title={post.author?.equipped_tag_text}
              titleRarity={post.author?.equipped_tag_rarity}
              powerLevel={post.author?.power_level}
              className="max-w-full"
            />
            <p className="shrink-0 text-[10px] text-gray-500">{formatDate(post.created_at)}</p>
          </div>
        </div>
        {viewerId === post.user_id ? (
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
        ) : (
          <ReportContentButton
            reporterId={viewerId}
            targetOwnerId={post.user_id}
            targetType="post"
            targetId={post.id}
            className="shrink-0"
          />
        )}
      </header>

      {post.body && (
        <p data-user-content className="whitespace-pre-wrap break-words px-4 py-4 text-gray-200">{post.body}</p>
      )}
      {(post.attachments ?? [])
        .filter((attachment) => attachment.type === 'image' && isSafePostImageUrl(attachment.url_or_id))
        .map((attachment) => (
          <a
            key={attachment.id}
            href={attachment.url_or_id}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden border-t border-dark-border bg-dark"
          >
            <img
              src={attachment.url_or_id}
              alt={`${post.author?.username || 'Player'}'s post`}
              loading="lazy"
              className="max-h-[36rem] w-full object-contain"
            />
          </a>
        ))}
      {post.body && <ExternalVideoPreview text={post.body} />}

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
        {/* Share: native sheet when available, else copies the link. Posts have no
            dedicated route yet, so we deep-link to the author's wall with a
            ?post=<id> param. TODO: a real /post/:id page once posts are routable. */}
        <ShareButton
          url={canonicalShareUrl(`/profile/${post.user_id}?tab=wall&post=${post.id}`)}
          title={`${post.author?.username || 'A player'} on TKO`}
          text={post.body?.slice(0, 140)}
          className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm text-gray-400 hover:text-white"
        />
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
                <div className="flex items-start justify-between gap-2">
                  <Link
                    to={`/profile/${item.user_id}`}
                    className="min-w-0 truncate text-xs font-semibold text-white hover:text-accent"
                  >
                    {item.author?.username || 'Deleted player'}
                  </Link>
                  {viewerId === item.user_id && editingCommentId === null ? (
                    <button
                      type="button"
                      onClick={() => beginCommentEdit(item)}
                      disabled={working}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-gray-400 hover:bg-dark-border/50 hover:text-accent disabled:opacity-50"
                      aria-label="Edit your comment"
                      title="Edit your comment"
                    >
                      <Pencil className="h-3 w-3" aria-hidden />
                      Edit
                    </button>
                  ) : (
                    <ReportContentButton
                      reporterId={viewerId}
                      targetOwnerId={item.user_id}
                      targetType="post_comment"
                      targetId={item.id}
                      className="shrink-0"
                    />
                  )}
                </div>
                {editingCommentId === item.id ? (
                  <form onSubmit={(event) => void saveCommentEdit(event, item)} className="mt-2">
                    <textarea
                      autoFocus
                      value={editingCommentBody}
                      onChange={(event) => setEditingCommentBody(event.target.value)}
                      maxLength={MAX_COMMENT_LENGTH}
                      rows={2}
                      aria-label="Edit comment text"
                      className="w-full resize-y rounded-lg border border-accent bg-dark-card px-3 py-2 text-sm text-white focus:outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={cancelCommentEdit}
                        disabled={working}
                        className="rounded-lg border border-dark-border px-3 py-1.5 text-xs font-medium text-gray-300 hover:text-white disabled:opacity-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!editingCommentBody.trim() || working}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-dark disabled:opacity-50"
                      >
                        Save comment
                      </button>
                    </div>
                  </form>
                ) : (
                  <p data-user-content className="whitespace-pre-wrap break-words text-sm text-gray-300">{item.body}</p>
                )}
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

  const canCompose = Boolean(
    viewerId && (mode === 'feed' || (mode === 'wall' && profileId === viewerId)),
  )

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
