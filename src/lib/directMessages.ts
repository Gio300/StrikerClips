import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, DmMessage } from '@/types/database'
import { MESSAGE_BACKFILL_LIMIT, orderOldestFirst } from '@/lib/chatMessages'

export type DirectMessageClient = Pick<SupabaseClient<Database>, 'from' | 'functions'>
export type DirectConversationClient = Pick<SupabaseClient<Database>, 'functions'>

export type MessageUserSearchResult = {
  id: string
  username: string
  avatar_url: string | null
  power_level: number | null
}

export async function searchMessageUsers(
  client: DirectConversationClient,
  query: string,
): Promise<MessageUserSearchResult[]> {
  const value = query.trim().replace(/^@/, '')
  if (!value) return []
  const { data, error } = await client.functions.invoke('dm-user-search', {
    body: { query: value },
  })
  const response = data as {
    ok?: boolean
    users?: MessageUserSearchResult[]
    error?: string
  } | null
  if (error || response?.ok === false) {
    throw new Error(response?.error || error?.message || 'Could not search players.')
  }
  return Array.isArray(response?.users) ? response.users : []
}

export async function openDirectConversation(
  client: DirectConversationClient,
  targetUserId: string,
): Promise<string> {
  const target = targetUserId.trim()
  if (!target) throw new Error('Choose a player first.')
  const { data, error } = await client.functions.invoke('dm-open', {
    body: { targetUserId: target },
  })
  const response = data as {
    ok?: boolean
    conversation_id?: string
    error?: string
  } | null
  if (error || response?.ok === false || !response?.conversation_id) {
    throw new Error(response?.error || error?.message || 'Could not start the conversation.')
  }
  return response.conversation_id
}

export async function openGroupConversation(
  client: DirectConversationClient,
  input: { name: string; usernames: string[] },
): Promise<string> {
  const name = input.name.trim()
  const usernames = [...new Map(
    input.usernames
      .map((username) => username.trim())
      .filter(Boolean)
      .map((username) => [username.toLowerCase(), username]),
  ).values()]
  if (name.length > 80) throw new Error('Group names must be 80 characters or fewer.')
  if (usernames.length < 2) throw new Error('Choose at least two other players.')
  if (usernames.length > 24) throw new Error('Group threads support up to 25 people.')

  const { data, error } = await client.functions.invoke('dm-group-open', {
    body: { name, usernames },
  })
  const response = data as {
    ok?: boolean
    conversation_id?: string
    error?: string
  } | null
  if (error || response?.ok === false || !response?.conversation_id) {
    throw new Error(response?.error || error?.message || 'Could not create the group thread.')
  }
  return response.conversation_id
}

export async function addConversationMembers(
  client: DirectConversationClient,
  input: { conversationId: string; usernames: string[] },
): Promise<number> {
  const usernames = [...new Map(
    input.usernames
      .map((username) => username.trim().replace(/^@/, ''))
      .filter(Boolean)
      .map((username) => [username.toLowerCase(), username]),
  ).values()]
  if (!input.conversationId) throw new Error('Open a conversation first.')
  if (usernames.length === 0) throw new Error('Choose at least one player.')
  const { data, error } = await client.functions.invoke('dm-members-add', {
    body: { conversationId: input.conversationId, usernames },
  })
  const response = data as { ok?: boolean; participant_count?: number; error?: string } | null
  if (error || response?.ok === false) {
    throw new Error(response?.error || error?.message || 'Could not add those players.')
  }
  return Number(response?.participant_count ?? 0)
}

/**
 * The most recent `limit` messages in a thread, oldest-first for rendering.
 *
 * READS FROM THE NEWEST END, and the direction matters. This used to be an
 * UNBOUNDED oldest-first select: a long thread returned its whole history (the
 * server's row cap was the only brake), the incremental poll's cursor was then
 * seeded at the thread's FIRST message, and the poll walked forward replaying
 * ancient messages as if they were arriving live — auto-scroll and unread
 * dividers firing on years-old lines. Taking the tail costs one indexed read on
 * (conversation_id, created_at) and opens the thread where the user left it.
 *
 * The rows are flipped back to oldest-first here (orderOldestFirst) so every
 * caller still receives a log in reading order.
 */
export async function readDirectMessages(
  client: DirectMessageClient,
  conversationId: string,
  limit: number = MESSAGE_BACKFILL_LIMIT,
): Promise<DmMessage[]> {
  if (!conversationId) return []
  const { data, error } = await client
    .from('dm_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(error.message || 'Could not load messages.')
  return orderOldestFirst((data ?? []) as DmMessage[])
}

export async function sendDirectMessage(
  client: DirectMessageClient,
  input: {
    conversationId: string
    userId: string
    content: string
    /**
     * Structural @mentions in the storage shape. Optional, and only ever a
     * HINT: dm-send re-runs the same sanitizer against the content it accepted
     * and drops anything whose offsets don't literally read "@username".
     */
    mentions?: unknown
    /** Parent message id — the server verifies it belongs to this conversation. */
    replyTo?: string | null
  },
): Promise<DmMessage> {
  const content = input.content.trim()
  if (!input.conversationId) throw new Error('Select a conversation first.')
  if (!input.userId) throw new Error('Sign in to send a message.')
  if (!content) throw new Error('Write a message first.')
  if (content.length > 1000) throw new Error('Messages must be 1,000 characters or fewer.')

  const { data, error } = await client.functions.invoke('dm-send', {
    body: {
      conversationId: input.conversationId,
      content,
      // The real server derives the sender from the auth token and ignores this
      // field (server/app.ts dm-send only reads conversationId/content); the
      // mock backend uses it to attribute the message when no session exists.
      userId: input.userId,
      mentions: input.mentions ?? [],
      replyTo: input.replyTo ?? null,
    },
  })
  const response = data as { ok?: boolean; message?: DmMessage; error?: string } | null
  if (error || response?.ok === false || !response?.message) {
    throw new Error(response?.error || error?.message || 'The server did not accept the message.')
  }
  return response.message
}
