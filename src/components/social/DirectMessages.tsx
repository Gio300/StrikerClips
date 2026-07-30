import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MessageSquare, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  openDirectConversation,
  readDirectMessages,
  sendDirectMessage,
} from '@/lib/directMessages'
import { directConversationId, type SocialProfile } from '@/lib/social'
import type { DmConversation, DmMessage } from '@/types/database'
import { ChatComposer, ChatMessageContent } from './ChatPoll'

interface DirectThread extends DmConversation {
  participantIds: string[]
  participants: SocialProfile[]
}

interface EnrichedDmMessage extends DmMessage {
  author: SocialProfile | null
}

function formatThreadName(thread: DirectThread, viewerId: string): string {
  const others = thread.participants.filter((participant) => participant.id !== viewerId)
  if (others.length > 0) return others.map((participant) => participant.username).join(', ')
  return thread.name?.trim() || 'Private conversation'
}

function formatMessageTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
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
  const [messages, setMessages] = useState<EnrichedDmMessage[]>([])
  const [searchName, setSearchName] = useState('')
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoOpenTarget = useRef<string | null>(null)

  const loadThreads = useCallback(async () => {
    setLoadingThreads(true)
    setError(null)
    try {
      const { data: memberships, error: membershipsError } = await supabase
        .from('dm_participants')
        .select('conversation_id')
        .eq('user_id', userId)
      if (membershipsError) {
        throw new Error(membershipsError.message || 'Could not load your conversations.')
      }
      const conversationIds = [
        ...new Set((memberships ?? []).map((membership) => membership.conversation_id)),
      ]
      if (conversationIds.length === 0) {
        setThreads([])
        return
      }

      const { data: conversations, error: conversationsError } = await supabase
        .from('dm_conversations')
        .select('*')
        .in('id', conversationIds)
      if (conversationsError) {
        throw new Error(conversationsError.message || 'Could not load your conversations.')
      }

      const participantRows = await Promise.all(
        ((conversations ?? []) as DmConversation[]).map(async (conversation) => {
          const { data, error: participantsError } = await supabase
            .from('dm_participants')
            .select('user_id')
            .eq('conversation_id', conversation.id)
          if (participantsError) {
            throw new Error(participantsError.message || 'Could not load conversation members.')
          }
          return {
            conversation,
            participantIds: [...new Set((data ?? []).map((participant) => participant.user_id))],
          }
        }),
      )

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
    } catch (loadError) {
      setThreads([])
      setError(loadError instanceof Error ? loadError.message : 'Could not load your conversations.')
    } finally {
      setLoadingThreads(false)
    }
  }, [userId])

  useEffect(() => {
    void loadThreads()
  }, [loadThreads])

  const openConversation = useCallback(async (otherUserId: string) => {
    const conversationId = await openDirectConversation(supabase, otherUserId)
    await loadThreads()
    setSelectedId(conversationId)
    return conversationId
  }, [loadThreads])

  useEffect(() => {
    if (loadingThreads) return

    if (initialConversationId) {
      if (threads.some((thread) => thread.id === initialConversationId)) {
        setSelectedId(initialConversationId)
      } else {
        setError('That conversation is unavailable or you are not a participant.')
      }
      return
    }

    if (!targetUserId) return
    const existingId = directConversationId(threads, userId, targetUserId)
    if (existingId) {
      setSelectedId(existingId)
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

  const loadMessages = useCallback(async () => {
    if (!selectedId) {
      setMessages([])
      return
    }
    setLoadingMessages(true)
    setError(null)
    try {
      const rows = await readDirectMessages(supabase, selectedId)
      const profiles = await profileMap(rows.map((message) => message.user_id))
      setMessages(rows.map((message) => ({
        ...message,
        author: profiles.get(message.user_id) ?? null,
      })))
    } catch (loadError) {
      setMessages([])
      setError(loadError instanceof Error ? loadError.message : 'Could not load messages.')
    } finally {
      setLoadingMessages(false)
    }
  }, [selectedId])

  useEffect(() => {
    void loadMessages()
    if (!selectedId) return
    const channel = supabase
      .channel(`dm:${selectedId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'dm_messages',
          filter: `conversation_id=eq.${selectedId}`,
        },
        loadMessages,
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadMessages, selectedId])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages])

  async function findConversation(event: React.FormEvent) {
    event.preventDefault()
    const username = searchName.trim()
    if (!username || searching) return
    setSearching(true)
    setError(null)
    // Partial, case-insensitive match so "Mr" finds "MrBeast". Fetch a small set
    // and prefer an exact (case-insensitive) hit, otherwise take the first.
    const { data: matches, error: targetError } = await supabase
      .from('profiles')
      .select('id, username')
      .ilike('username', `%${username}%`)
      .limit(10)
    const lowered = username.toLowerCase()
    const target =
      (matches ?? []).find((m) => (m.username ?? '').toLowerCase() === lowered) ??
      (matches ?? [])[0] ??
      null
    if (targetError || !target) {
      setError(targetError?.message || `No player matching "${username}" was found.`)
      setSearching(false)
      return
    }
    if (target.id === userId) {
      setError('Choose another player.')
      setSearching(false)
      return
    }
    const existingId = directConversationId(threads, userId, target.id)
    if (existingId) {
      setSelectedId(existingId)
      setSearchName('')
    } else {
      try {
        await openConversation(target.id)
        setSearchName('')
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : 'Could not start the conversation.')
      }
    }
    setSearching(false)
  }

  async function sendMessage(body: string): Promise<void> {
    if (!selectedId) throw new Error('Select a conversation first.')
    const persisted = await sendDirectMessage(supabase, {
      conversationId: selectedId,
      userId,
      content: body,
    })
    setMessages((current) => (
      current.some((message) => message.id === persisted.id)
        ? current
        : [...current, {
            ...persisted,
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

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedId) ?? null,
    [selectedId, threads],
  )

  return (
    <div className="grid min-h-[32rem] gap-4 sm:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="space-y-3">
        <form onSubmit={findConversation} className="flex gap-2">
          <label className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-500" />
            <input
              value={searchName}
              onChange={(event) => setSearchName(event.target.value)}
              placeholder="Find by username"
              className="w-full rounded-lg border border-dark-border bg-dark py-2 pl-9 pr-3 text-sm text-white focus:border-accent focus:outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={!searchName.trim() || searching}
            className="rounded-lg border border-accent px-3 py-2 text-sm font-medium text-accent disabled:opacity-50"
          >
            Find
          </button>
        </form>

        <div className="max-h-64 space-y-1 overflow-y-auto sm:max-h-[28rem]">
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
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                    selectedId === thread.id
                      ? 'bg-accent/15 text-accent'
                      : 'text-gray-300 hover:bg-dark-border/40'
                  }`}
                >
                  <Avatar
                    src={other?.avatar_url}
                    name={other?.username}
                    seed={other?.id || thread.id}
                    size={32}
                  />
                  <span className="min-w-0 truncate">{formatThreadName(thread, userId)}</span>
                </button>
              )
            })
          )}
        </div>
      </aside>

      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-dark-border bg-dark-card">
        {selectedThread ? (
          <>
            <header className="border-b border-dark-border px-4 py-3">
              <h2 className="font-semibold text-white">{formatThreadName(selectedThread, userId)}</h2>
            </header>
            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
              {loadingMessages ? (
                <p className="text-center text-sm text-gray-500">Loading messages...</p>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-gray-500">No messages yet.</p>
              ) : (
                messages.map((message) => {
                  const mine = message.user_id === userId
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] ${mine ? 'text-right' : 'text-left'}`}>
                        <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                          {!mine && message.author && (
                            <Link to={`/profile/${message.author.id}`} className="hover:text-accent">
                              {message.author.username}
                            </Link>
                          )}
                          <span>{formatMessageTime(message.created_at)}</span>
                        </div>
                        <div className={`rounded-lg px-3 py-2 ${
                          mine ? 'bg-accent/15 text-white' : 'bg-dark-border/35 text-gray-200'
                        }`}>
                          <ChatMessageContent
                            body={message.content}
                            userId={userId}
                            className="whitespace-pre-wrap break-words text-left"
                          />
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
            <ChatComposer
              userId={userId}
              placeholder="Write a message"
              onSend={sendMessage}
              className="border-t border-dark-border"
            />
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
