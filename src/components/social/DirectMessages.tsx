import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Clapperboard,
  Info,
  MessageSquare,
  Search,
  Sparkles,
  UserRound,
  UserRoundPlus,
  UsersRound,
  X,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui'
import { PlayerMetaLine } from '@/components/PlayerMetaLine'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  openDirectConversation,
  openGroupConversation,
  addConversationMembers,
  readDirectMessages,
  searchMessageUsers,
  sendDirectMessage,
  type MessageUserSearchResult,
} from '@/lib/directMessages'
import { directConversationId, type SocialProfile } from '@/lib/social'
import type { DmConversation, DmMessage } from '@/types/database'
import { ChatComposer, ChatMessageContent, type ChatSendMeta } from './ChatPoll'
import { useChatPresence } from '@/hooks/useChatPresence'
import { useChatUnread } from '@/hooks/useChatUnread'
import { useChatMessages } from '@/hooks/useChatMessages'
import { useChatReactions } from '@/hooks/useChatReactions'
import { mergeMessages } from '@/lib/chatMessages'
import { createAuthorCache, type AuthorCache } from '@/lib/chatAuthors'
import { ChatConnectionNote, ChatLiveBar, TypingLine } from '@/components/chat/ChatLiveBar'
import { NewMessagesDivider } from '@/components/chat/NewMessagesDivider'
import { ReactionRow, ReplyButton, ReplyQuote } from '@/components/chat'
import { parseMentions, serializeMentions, type ChatMention } from '@/lib/chatMentions'
import {
  replyPreview,
  replyToColumn,
  resolveReplyTarget,
  type ReplyTarget,
} from '@/lib/chatReplies'
import { AskTkoConversation } from './AskTkoConversation'
import { ReportContentButton } from '@/components/ReportContentButton'

interface DirectThread extends DmConversation {
  participantIds: string[]
  participants: SocialProfile[]
}

interface EnrichedDmMessage extends DmMessage {
  author: SocialProfile | null
  /** Validated mentions for THIS row — parsed once, never re-derived from text. */
  mentionList?: ChatMention[]
}

function formatThreadName(thread: DirectThread, viewerId: string): string {
  if (thread.name?.trim()) return thread.name.trim()
  const others = thread.participants.filter((participant) => participant.id !== viewerId)
  if (others.length > 0) return others.map((participant) => participant.username).join(', ')
  return thread.name?.trim() || 'Private conversation'
}

function formatMessageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Consecutive author-read failures a thread tolerates before it renders the
 * messages ANYWAY, with a placeholder author.
 *
 * Two failures is one retry: long enough that a blip never costs a missing
 * name, short enough that a genuine `profiles` outage cannot hold the whole
 * conversation hostage. A DM you can read from someone whose avatar has not
 * loaded is a working chat; an empty thread is not.
 */
const DM_AUTHOR_DEGRADE_AFTER = 2
const DIRECT_THREAD_PAGE_SIZE = 30

/**
 * Resolve authors for a BATCH of thread rows, reading `profiles` only for ids
 * this thread has never resolved. Shared by the opening backfill and the
 * incremental poll so a polled message renders identically to a loaded one.
 *
 * FAILURE HAS TWO MODES, and neither of them loses a message:
 *   • normally it THROWS, which tells the poll loop these rows were NOT
 *     delivered, so its (monotonic) cursor does not advance and the same window
 *     is re-read next tick;
 *   • under `degrade` it renders with `author: null` instead. The cache is
 *     deliberately left UNFILLED either way, so the ids stay "missing" and the
 *     names fill in on the next batch once `profiles` answers again.
 */
async function hydrateDmRows(
  rows: readonly DmMessage[],
  authors: AuthorCache<SocialProfile>,
  options: { degrade?: boolean } = {},
): Promise<EnrichedDmMessage[]> {
  const wanted = authors.missing(rows.map((message) => message.user_id))
  if (wanted.length > 0) {
    try {
      authors.fill(wanted, await profileMap(wanted))
    } catch (readError) {
      if (!options.degrade) throw readError
      // Fall through with the cache untouched — placeholder now, real name as
      // soon as a later batch can resolve it (see the backfill effect below).
    }
  }
  return rows.map((message) => ({
    ...message,
    author: authors.get(message.user_id) ?? null,
    // Parsed defensively: a null/legacy value is simply "no mentions".
    mentionList: parseMentions(message.mentions, message.content),
  }))
}

async function profileMap(ids: readonly string[]): Promise<Map<string, SocialProfile>> {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  if (uniqueIds.length === 0) return new Map()
  // Resolve members resiliently: try the enriched select first, and if it errors
  // (e.g. the equipped-tag columns aren't available on this backend) fall back to
  // a plain id/username/avatar select so members never blank out.
  const enriched = await supabase
    .from('profiles')
    .select('id, username, avatar_url, power_level, equipped_tag_text, equipped_tag_rarity')
    .in('id', uniqueIds)
  if (!enriched.error) {
    return new Map(
      ((enriched.data ?? []) as SocialProfile[]).map((player) => [player.id, player]),
    )
  }
  const plain = await supabase
    .from('profiles')
    .select('id, username, avatar_url')
    .in('id', uniqueIds)
  if (plain.error) throw new Error(plain.error.message || 'Could not load conversation members.')
  return new Map(
    ((plain.data ?? []) as Array<Pick<SocialProfile, 'id' | 'username' | 'avatar_url'>>).map((player) => {
      const member: SocialProfile = {
        id: player.id,
        username: player.username,
        avatar_url: player.avatar_url ?? null,
      }
      return [player.id, member]
    }),
  )
}

export function DirectMessages({
  userId,
  initialConversationId,
  targetUserId,
}: {
  userId: string
  initialConversationId?: string | null
  targetUserId?: string | null
}) {
  const { profile } = useAuth()
  const [threads, setThreads] = useState<DirectThread[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [assistantSelected, setAssistantSelected] = useState(false)
  const [messages, setMessages] = useState<EnrichedDmMessage[]>([])
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null)
  const [composerMode, setComposerMode] = useState<'direct' | 'group'>('direct')
  const [searchName, setSearchName] = useState('')
  const [searchResults, setSearchResults] = useState<MessageUserSearchResult[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupMembers, setGroupMembers] = useState('')
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false)
  const [threadLimit, setThreadLimit] = useState(DIRECT_THREAD_PAGE_SIZE)
  const [hasMoreThreads, setHasMoreThreads] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [searching, setSearching] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [newMembers, setNewMembers] = useState('')
  const [addingMembers, setAddingMembers] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoOpenTarget = useRef<string | null>(null)

  const loadThreads = useCallback(async (
    visibleLimit = DIRECT_THREAD_PAGE_SIZE,
    includeConversationId: string | null = initialConversationId ?? null,
    quiet = false,
  ) => {
    if (!quiet) setLoadingThreads(true)
    setError(null)
    try {
      // dm_conversations is membership-scoped by the backend/RLS. Read only the
      // newest visible window; the old three-query path first downloaded every
      // membership id, then every conversation, then every participant.
      const { data: conversationRows, error: conversationsError } = await supabase
        .from('dm_conversations')
        .select('*')
        .order('updated_at', { ascending: false })
        .range(0, visibleLimit)
      if (conversationsError) {
        throw new Error(conversationsError.message || 'Could not load your conversations.')
      }
      const bounded = (conversationRows ?? []) as DmConversation[]
      const hasMore = bounded.length > visibleLimit
      let conversations = bounded.slice(0, visibleLimit)

      // A notification can deep-link to a thread older than the first page.
      // Fetch that one scoped row explicitly so pagination never turns a valid
      // link into "conversation unavailable."
      if (includeConversationId && !conversations.some((row) => row.id === includeConversationId)) {
        const { data: included } = await supabase
          .from('dm_conversations')
          .select('*')
          .eq('id', includeConversationId)
          .maybeSingle()
        if (included) conversations = [included as DmConversation, ...conversations]
      }

      const conversationIds = conversations.map((conversation) => conversation.id)
      if (conversationIds.length === 0) {
        setThreads([])
        setHasMoreThreads(false)
        setThreadLimit(visibleLimit)
        return
      }

      const { data: allParticipants, error: participantsError } = await supabase
        .from('dm_participants')
        .select('conversation_id, user_id')
        .in('conversation_id', conversationIds)
      if (participantsError) {
        throw new Error(participantsError.message || 'Could not load conversation members.')
      }
      const membersByConversation = new Map<string, string[]>()
      for (const participant of allParticipants ?? []) {
        const members = membersByConversation.get(participant.conversation_id) ?? []
        if (!members.includes(participant.user_id)) members.push(participant.user_id)
        membersByConversation.set(participant.conversation_id, members)
      }
      const participantRows = ((conversations ?? []) as DmConversation[]).map((conversation) => ({
        conversation,
        participantIds: membersByConversation.get(conversation.id) ?? [],
      }))

      const profiles = await profileMap(participantRows.flatMap((row) => row.participantIds))
      const nextThreads = participantRows
        .filter((row) => row.participantIds.includes(userId))
        .map(({ conversation, participantIds }) => ({
          ...conversation,
          participantIds,
          participants: participantIds
            .map((id) => profiles.get(id))
            .filter((player): player is SocialProfile => Boolean(player)),
        }))
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      setThreads(nextThreads)
      setHasMoreThreads(hasMore)
      setThreadLimit(visibleLimit)
    } catch (loadError) {
      if (!quiet) setThreads([])
      setError(loadError instanceof Error ? loadError.message : 'Could not load your conversations.')
    } finally {
      if (!quiet) setLoadingThreads(false)
    }
  }, [initialConversationId, userId])

  useEffect(() => {
    setThreadLimit(DIRECT_THREAD_PAGE_SIZE)
    void loadThreads(DIRECT_THREAD_PAGE_SIZE)
  }, [loadThreads])

  const openConversation = useCallback(async (otherUserId: string) => {
    const conversationId = await openDirectConversation(supabase, otherUserId)
    await loadThreads(threadLimit, conversationId, true)
    setSelectedId(conversationId)
    setAssistantSelected(false)
    return conversationId
  }, [loadThreads, threadLimit])

  useEffect(() => {
    if (composerMode !== 'direct') {
      setSearchResults([])
      return
    }
    const query = searchName.trim()
    if (!query) {
      setSearchResults([])
      setLoadingSearch(false)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoadingSearch(true)
      void searchMessageUsers(supabase, query)
        .then((users) => {
          if (!cancelled) setSearchResults(users)
        })
        .catch((searchError) => {
          if (!cancelled) {
            setSearchResults([])
            setError(searchError instanceof Error ? searchError.message : 'Could not search players.')
          }
        })
        .finally(() => {
          if (!cancelled) setLoadingSearch(false)
        })
    }, 220)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [composerMode, searchName])

  useEffect(() => {
    if (loadingThreads) return

    if (initialConversationId) {
      if (threads.some((thread) => thread.id === initialConversationId)) {
        setSelectedId(initialConversationId)
        setAssistantSelected(false)
      } else {
        setError('That conversation is unavailable or you are not a participant.')
      }
      return
    }

    if (!targetUserId) return
    const existingId = directConversationId(threads, userId, targetUserId)
    if (existingId) {
      setSelectedId(existingId)
      setAssistantSelected(false)
      return
    }
    const targetKey = `${userId}:${targetUserId}`
    if (autoOpenTarget.current === targetKey) return
    autoOpenTarget.current = targetKey
    setSearching(true)
    setError(null)
    void openConversation(targetUserId)
      .catch((openError) => {
        autoOpenTarget.current = null
        setError(openError instanceof Error ? openError.message : 'Could not start the conversation.')
      })
      .finally(() => setSearching(false))
  }, [
    initialConversationId,
    loadingThreads,
    openConversation,
    targetUserId,
    threads,
    userId,
  ])

  // Author identity, memoized for the life of THIS thread — see hydrateDmRows.
  const authorsRef = useRef<AuthorCache<SocialProfile>>(createAuthorCache<SocialProfile>())

  const loadMessages = useCallback(async () => {
    if (!selectedId) {
      setMessages([])
      return
    }
    // A new thread is a new set of participants.
    authorsRef.current = createAuthorCache<SocialProfile>()
    setLoadingMessages(true)
    setError(null)
    try {
      // readDirectMessages now takes the NEWEST window, so a long thread opens
      // instantly on recent messages instead of replaying its whole history.
      const rows = await readDirectMessages(supabase, selectedId)
      setMessages(await hydrateDmRows(rows, authorsRef.current))
    } catch (loadError) {
      setMessages([])
      setError(loadError instanceof Error ? loadError.message : 'Could not load messages.')
    } finally {
      setLoadingMessages(false)
    }
  }, [selectedId])

  // Initial load of the selected thread. Liveness is the shared incremental
  // poll below — the subscription this used to register was an inert stub, and
  // its handler was a FULL re-read of the thread on every insert.
  useEffect(() => {
    void loadMessages()
  }, [loadMessages, selectedId])

  /**
   * Fold rows the other side wrote into the thread.
   *
   * Authors come from the per-thread memo, so a tick in a conversation whose
   * participants are already resolved costs NO profile request — a DM thread
   * has two or three speakers who never change, which made re-reading them
   * every 5s the purest waste in the whole transport (see lib/chatAuthors.ts).
   *
   * FAILING THE FIRST TIME IS A THROW, and the poll loop depends on it: a throw
   * means the rows were NOT delivered, so the (monotonic) cursor does not
   * advance and the same window is re-read next tick instead of the messages
   * vanishing for good. FAILING REPEATEDLY DEGRADES instead — after
   * DM_AUTHOR_DEGRADE_AFTER tries the rows render with a placeholder author,
   * because a `profiles` outage must not be able to hold a conversation
   * hostage. Either way, no message is ever silently consumed.
   */
  const authorFailuresRef = useRef(0)
  const onPolled = useCallback(async (rows: DmMessage[]) => {
    const degrade = authorFailuresRef.current >= DM_AUTHOR_DEGRADE_AFTER
    let hydrated: EnrichedDmMessage[]
    try {
      hydrated = await hydrateDmRows(rows, authorsRef.current, { degrade })
    } catch (hydrateError) {
      authorFailuresRef.current += 1
      throw hydrateError
    }
    authorFailuresRef.current = 0
    setMessages((current) => mergeMessages(current, hydrated, (m) => m.content))
  }, [])

  // THE LIVE LAYER — the same incremental cursor + visibility gate every chat
  // surface now uses. `dm_messages` is the one scoped table of the four, so a
  // tick costs the participant check plus one indexed range scan.
  const delivery = useChatMessages<DmMessage>({
    scope: 'dm',
    roomId: selectedId,
    messages,
    onMessages: onPolled,
    ready: !loadingMessages,
  })

  // BACKFILL THE PLACEHOLDERS. Rows delivered while `profiles` was unreadable
  // rendered with `author: null`; the cache was left unfilled, so a later batch
  // asks for those ids again. When it resolves them, patch the names into the
  // lines already on screen rather than leaving a permanent "someone".
  // Returning `current` unchanged is what stops this from looping.
  useEffect(() => {
    setMessages((current) => {
      let changed = false
      const patched = current.map((message) => {
        if (message.author || !message.user_id) return message
        const found = authorsRef.current.get(message.user_id)
        if (!found) return message
        changed = true
        return { ...message, author: found }
      })
      return changed ? patched : current
    })
  }, [messages])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  async function selectSearchResult(target: MessageUserSearchResult) {
    if (searching) return
    setSearching(true)
    setError(null)
    const existingId = directConversationId(threads, userId, target.id)
    try {
      if (existingId) setSelectedId(existingId)
      else await openConversation(target.id)
      setAssistantSelected(false)
      setSearchName('')
      setSearchResults([])
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not start the conversation.')
    } finally {
      setSearching(false)
    }
  }

  async function findConversation(event: React.FormEvent) {
    event.preventDefault()
    const username = searchName.trim()
    if (!username || searching) return
    const results = searchResults.length > 0
      ? searchResults
      : await searchMessageUsers(supabase, username)
    const lowered = username.replace(/^@/, '').toLowerCase()
    const target = results.find((player) => player.username.toLowerCase() === lowered) ?? results[0]
    if (!target) {
      setError(`No available player matching "${username}" was found.`)
      return
    }
    await selectSearchResult(target)
  }

  async function createGroupConversation(event: React.FormEvent) {
    event.preventDefault()
    if (searching) return
    const usernames = groupMembers
      .split(/[\n,]+/)
      .map((username) => username.trim().replace(/^@/, ''))
      .filter(Boolean)
    setSearching(true)
    setError(null)
    try {
      const conversationId = await openGroupConversation(supabase, {
        name: groupName,
        usernames,
      })
      await loadThreads(threadLimit, conversationId, true)
      setSelectedId(conversationId)
      setAssistantSelected(false)
      setGroupName('')
      setGroupMembers('')
      setComposerMode('direct')
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not create the group thread.')
    } finally {
      setSearching(false)
    }
  }

  async function sendMessage(body: string, meta?: ChatSendMeta): Promise<void> {
    if (!selectedId) throw new Error('Select a conversation first.')
    const mentions = meta?.mentions ?? []
    const parent = replyToColumn(replyTo)
    const persisted = await sendDirectMessage(supabase, {
      conversationId: selectedId,
      userId,
      content: body,
      // A HINT only — dm-send re-runs the same sanitizer server-side.
      mentions: serializeMentions(body, mentions),
      replyTo: parent,
    })
    setReplyTo(null)
    setMessages((current) => (
      current.some((message) => message.id === persisted.id)
        ? current
        : [...current, {
            ...persisted,
            reply_to: persisted.reply_to ?? parent,
            // Prefer what we just computed: an older backend drops the column
            // and re-parsing the echo would lose the chips.
            mentionList: mentions,
            author: profile
              ? {
                  id: profile.id,
                  username: profile.username,
                  avatar_url: profile.avatar_url,
                  power_level: profile.power_level,
                  equipped_tag_text: profile.equipped_tag_text,
                  equipped_tag_rarity: profile.equipped_tag_rarity,
                }
              : null,
          }]
    ))
  }

  async function addMembers(event: React.FormEvent) {
    event.preventDefault()
    if (!selectedId || addingMembers) return
    const usernames = newMembers
      .split(/[\n,]+/)
      .map((username) => username.trim())
      .filter(Boolean)
    setAddingMembers(true)
    setError(null)
    try {
      await addConversationMembers(supabase, { conversationId: selectedId, usernames })
      setNewMembers('')
      await loadThreads(threadLimit, selectedId, true)
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not add those players.')
    } finally {
      setAddingMembers(false)
    }
  }

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [selectedId, threads],
  )

  async function loadMoreThreads() {
    if (loadingMoreThreads || !hasMoreThreads) return
    const nextLimit = threadLimit + DIRECT_THREAD_PAGE_SIZE
    setLoadingMoreThreads(true)
    await loadThreads(nextLimit, selectedId ?? initialConversationId ?? null, true)
    setLoadingMoreThreads(false)
  }

  useEffect(() => {
    if (!selectedId) return
    setShowInfo(false)
    void supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .eq('related_id', selectedId)
      .in('kind', ['direct_message', 'group_message'])
      .is('read_at', null)
  }, [selectedId, userId])

  // Reactions come from the same polymorphic store every surface uses.
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages])
  const reactions = useChatReactions({ surface: 'dm', messageIds, userId })

  /** Scroll a quoted parent into view when its preview is clicked. */
  const jumpToMessage = useCallback((messageId: string) => {
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [])

  // Shared live layer, scoped to the OPEN conversation. Same hooks and cadence
  // as the live / tournament / channel chats — DMs get presence and typing
  // without a second implementation.
  const presence = useChatPresence({ scope: 'dm', roomId: selectedThread?.id ?? null, userId })
  const unread = useChatUnread({
    scope: 'dm',
    roomId: selectedThread?.id ?? null,
    userId,
    messages,
    active: Boolean(selectedThread),
  })

  return (
    <div className="grid h-[var(--tko-messages-viewport-height)] min-h-[34rem] overflow-hidden border-y border-dark-border bg-dark-card sm:grid-cols-[19rem_minmax(0,1fr)] sm:rounded-lg sm:border">
      <aside className={`${selectedThread || assistantSelected ? 'hidden sm:flex' : 'flex'} min-h-0 flex-col border-r border-dark-border bg-dark`}>
        <header className="flex min-h-14 items-center justify-between border-b border-dark-border px-4">
          <h1 className="text-xl font-bold text-white">Chats</h1>
          <button type="button" onClick={() => setComposerMode('direct')} aria-label="New message" title="New message" className="flex h-9 w-9 items-center justify-center rounded-full text-accent hover:bg-dark-border">
            <MessageSquare className="h-4 w-4" aria-hidden />
          </button>
        </header>
        <nav className="flex gap-4 border-b border-dark-border px-4 py-3" aria-label="Chat shortcuts">
          <Link to="/reels" className="group flex min-w-0 flex-col items-center gap-1 text-[11px] text-gray-400 hover:text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-kunai bg-dark-card text-kunai group-hover:bg-kunai group-hover:text-white">
              <Clapperboard className="h-5 w-5" aria-hidden />
            </span>
            Reels
          </Link>
          <Link to="/profile" className="group flex min-w-0 flex-col items-center gap-1 text-[11px] text-gray-400 hover:text-white">
            <span className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-accent bg-dark-card text-accent group-hover:bg-accent group-hover:text-dark">
              <UserRound className="h-5 w-5" aria-hidden />
            </span>
            Profile
          </Link>
        </nav>
        <div className="space-y-3 p-3">
        <div className="grid grid-cols-2 rounded-lg border border-dark-border bg-dark p-1">
          <button
            type="button"
            onClick={() => setComposerMode('direct')}
            className={`rounded-md px-2 py-2 text-xs font-semibold ${
              composerMode === 'direct' ? 'bg-accent/15 text-accent' : 'text-gray-500'
            }`}
          >
            Direct
          </button>
          <button
            type="button"
            onClick={() => setComposerMode('group')}
            className={`rounded-md px-2 py-2 text-xs font-semibold ${
              composerMode === 'group' ? 'bg-accent/15 text-accent' : 'text-gray-500'
            }`}
          >
            Group thread
          </button>
        </div>

        {composerMode === 'direct' ? (
          <div className="relative">
            <form onSubmit={findConversation} className="flex gap-2">
              <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
              <input
                value={searchName}
                onChange={(event) => setSearchName(event.target.value)}
                placeholder="Search all players"
                autoComplete="off"
                className="w-full rounded-lg border border-dark-border bg-dark py-2 pl-9 pr-3 text-sm text-white focus:border-accent focus:outline-none"
              />
              </label>
              <button
                type="submit"
                disabled={!searchName.trim() || searching || loadingSearch}
                className="rounded-lg border border-accent px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"
              >
                Message
              </button>
            </form>
            {searchName.trim() && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-dark-border bg-dark-card p-1 shadow-xl">
                {loadingSearch ? (
                  <p className="px-3 py-3 text-xs text-gray-500">Searching players...</p>
                ) : searchResults.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-gray-500">No available players found.</p>
                ) : (
                  searchResults.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => { void selectSearchResult(player) }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-dark-border/40"
                    >
                      <Avatar src={player.avatar_url} name={player.username} seed={player.id} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-white">@{player.username}</span>
                        <PlayerMetaLine
                          powerLevel={player.power_level}
                          className="mt-0.5 max-w-full"
                        />
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={createGroupConversation} className="space-y-2 rounded-lg border border-dark-border bg-dark p-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-400">Thread name</span>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                maxLength={80}
                placeholder="Squad planning"
                className="w-full rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-400">Players</span>
              <textarea
                value={groupMembers}
                onChange={(event) => setGroupMembers(event.target.value)}
                rows={3}
                placeholder="Add at least 2 usernames, separated by commas"
                className="w-full resize-none rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={!groupMembers.trim() || searching}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-dark disabled:opacity-50"
            >
              <UserRoundPlus size={16} aria-hidden />
              Create thread
            </button>
          </form>
        )}

        </div>

        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {loadingThreads ? (
            <p className="px-3 py-4 text-sm text-gray-500">Loading conversations...</p>
          ) : threads.length === 0 ? (
            <p className="px-3 py-4 text-sm text-gray-500">No conversations yet.</p>
          ) : (
            threads.map((thread) => {
              const other = thread.participants.find((participant) => participant.id !== userId)
              return (
                <button
                  key={thread.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(thread.id)
                    setAssistantSelected(false)
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    selectedId === thread.id
                      ? 'bg-accent/15 text-accent'
                      : 'text-gray-300 hover:bg-dark-border/40'
                  }`}
                >
                  {thread.name?.trim() ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                      <UsersRound size={16} aria-hidden />
                    </span>
                  ) : (
                    <Avatar
                      src={other?.avatar_url}
                      name={other?.username}
                      seed={other?.id || thread.id}
                      size={32}
                    />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{formatThreadName(thread, userId)}</span>
                    {!thread.name?.trim() && other && (
                      <PlayerMetaLine
                        title={other.equipped_tag_text}
                        titleRarity={other.equipped_tag_rarity}
                        powerLevel={other.power_level}
                        className="mt-0.5 max-w-full"
                      />
                    )}
                  </span>
                </button>
              )
            })
          )}
          {!loadingThreads && threads.length > 0 && hasMoreThreads && (
            <button
              type="button"
              onClick={() => { void loadMoreThreads() }}
              disabled={loadingMoreThreads}
              className="mt-2 w-full rounded-lg border border-dark-border px-3 py-2 text-xs font-semibold text-gray-300 hover:border-accent/50 disabled:opacity-50"
            >
              {loadingMoreThreads ? 'Loading more chats...' : 'Load more chats'}
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            setSelectedId(null)
            setAssistantSelected(true)
          }}
          className={`m-2 flex items-center gap-3 rounded-lg border px-3 py-2 text-left ${
            assistantSelected
              ? 'border-kunai bg-kunai/10 text-white'
              : 'border-dark-border text-gray-300 hover:border-kunai/60 hover:bg-dark-card'
          }`}
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-kunai text-white">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">Ask TKO</span>
            <span className="block truncate text-[11px] text-gray-500">Assistant</span>
          </span>
        </button>
      </aside>

      <section className={`${selectedThread || assistantSelected ? 'flex' : 'hidden sm:flex'} relative min-w-0 flex-col overflow-hidden bg-dark-card`}>
        {assistantSelected ? (
          <AskTkoConversation onBack={() => setAssistantSelected(false)} />
        ) : selectedThread ? (
          <>
            <header className="flex min-h-14 items-center gap-2 border-b border-dark-border px-3">
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                aria-label="Back to conversations"
                title="Back"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-dark-border hover:text-white sm:hidden"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-semibold text-white">{formatThreadName(selectedThread, userId)}</h2>
                {selectedThread.participantIds.length > 2 && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {selectedThread.participantIds.length} members
                  </p>
                )}
              </div>
              <ChatLiveBar
                members={presence.members}
                supported={presence.supported}
                selfId={userId}
                className="shrink-0 pt-0.5"
              />
              <button
                type="button"
                onClick={() => setShowInfo((value) => !value)}
                aria-label="Conversation information"
                aria-expanded={showInfo}
                title="Conversation information"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent hover:bg-dark-border"
              >
                <Info className="h-4 w-4" aria-hidden />
              </button>
            </header>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {loadingMessages ? (
                <p className="text-center text-sm text-gray-500">Loading messages...</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No messages yet.</p>
              ) : (
                messages.map((message) => {
                  const mine = message.user_id === userId
                  const parent = resolveReplyTarget(message.reply_to, messages, (row) => ({
                    author: row.author?.username ?? 'someone',
                    body: row.content,
                    authorId: row.author?.id ?? null,
                  }))
                  return (
                    <div key={message.id} data-message-id={message.id} className="group">
                      {unread.dividerBeforeId === message.id && <NewMessagesDivider count={unread.count} />}
                      <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] ${mine ? 'text-right' : 'text-left'}`}>
                        <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                           {!mine && message.author && (
                             <Link to={`/profile/${message.author.id}`} className="hover:text-accent">
                               {message.author.username}
                             </Link>
                           )}
                           {!mine && message.author && (
                             <PlayerMetaLine
                               title={message.author.equipped_tag_text}
                               titleRarity={message.author.equipped_tag_rarity}
                               powerLevel={message.author.power_level}
                               className="max-w-[10rem]"
                             />
                           )}
                          <span>{formatMessageTime(message.created_at)}</span>
                          <ReplyButton
                            onClick={() =>
                              setReplyTo({
                                id: message.id,
                                author: message.author?.username ?? 'someone',
                                preview: replyPreview(message.content),
                                authorId: message.author?.id ?? null,
                              })
                            }
                            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
                          />
                          <ReportContentButton
                            reporterId={userId}
                            targetOwnerId={message.user_id}
                            targetType="dm_message"
                            targetId={message.id}
                            className="sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100"
                          />
                        </div>
                        {parent && (
                          <ReplyQuote target={parent} onJump={jumpToMessage} className="mb-1 text-left" />
                        )}
                        <div className={`rounded-lg px-3 py-2 ${
                          mine ? 'bg-accent/15 text-white' : 'bg-dark-border/35 text-gray-200'
                        }`}>
                          <ChatMessageContent
                            body={message.content}
                            userId={userId}
                            mentions={message.mentionList}
                            className="whitespace-pre-wrap break-words text-left"
                          />
                        </div>
                        {reactions.supported && (
                          <ReactionRow
                            tallies={reactions.talliesFor(message.id)}
                            onToggle={(emoji) => reactions.toggle(message.id, emoji)}
                            canReact={Boolean(userId)}
                            className={mine ? 'justify-end' : ''}
                          />
                        )}
                      </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <TypingLine line={presence.typingLine} className="px-4" />
            {/* Delivery is struggling — a status line under the log, never an error. */}
            <ChatConnectionNote status={delivery.status} className="px-4" />
            <ChatComposer
              userId={userId}
              placeholder="Write a message"
              onSend={sendMessage}
              onTyping={presence.notifyTyping}
              replyTo={replyTo}
              onCancelReply={() => setReplyTo(null)}
              mediaRoomId={selectedId}
              className="border-t border-dark-border"
            />
            {showInfo && (
              <aside className="absolute inset-y-0 right-0 z-20 flex w-[min(22rem,92vw)] flex-col border-l border-dark-border bg-dark-card shadow-2xl">
                <header className="flex min-h-14 items-center justify-between border-b border-dark-border px-4">
                  <h3 className="font-semibold text-white">Conversation</h3>
                  <button type="button" onClick={() => setShowInfo(false)} aria-label="Close conversation information" title="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-dark-border hover:text-white">
                    <X className="h-4 w-4" aria-hidden />
                  </button>
                </header>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Members</p>
                  <div className="space-y-2">
                    {selectedThread.participants.map((participant) => (
                      <Link key={participant.id} to={`/profile/${participant.id}`} className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-dark-border/40">
                        <Avatar src={participant.avatar_url} name={participant.username} seed={participant.id} size={36} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-white">{participant.username}</span>
                          <PlayerMetaLine
                            title={participant.equipped_tag_text}
                            titleRarity={participant.equipped_tag_rarity}
                            powerLevel={participant.power_level}
                            className="mt-0.5 max-w-full"
                          />
                        </span>
                      </Link>
                    ))}
                  </div>
                  <form onSubmit={addMembers} className="mt-5 border-t border-dark-border pt-4">
                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-gray-400">Add people</span>
                      <textarea value={newMembers} onChange={(event) => setNewMembers(event.target.value)} rows={3} placeholder="Usernames, separated by commas" className="w-full resize-none rounded-md border border-dark-border bg-dark px-3 py-2 text-sm text-white focus:border-accent focus:outline-none" />
                    </label>
                    <button type="submit" disabled={!newMembers.trim() || addingMembers} className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-3 text-sm font-semibold text-dark disabled:opacity-40">
                      <UserRoundPlus className="h-4 w-4" aria-hidden />
                      Add people
                    </button>
                  </form>
                </div>
              </aside>
            )}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center">
            <div>
              <MessageSquare className="mx-auto h-6 w-6 text-gray-600" aria-hidden />
              <p className="mt-3 text-sm text-gray-400">Choose an existing conversation.</p>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="border-t border-dark-border px-4 py-2 text-xs text-kunai">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}
