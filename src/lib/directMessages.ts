import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, DmMessage } from '@/types/database'

export type DirectMessageClient = Pick<SupabaseClient<Database>, 'from'>
export type DirectConversationClient = Pick<SupabaseClient<Database>, 'functions'>

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

export async function readDirectMessages(
  client: DirectMessageClient,
  conversationId: string,
): Promise<DmMessage[]> {
  if (!conversationId) return []
  const { data, error } = await client
    .from('dm_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message || 'Could not load messages.')
  return (data ?? []) as DmMessage[]
}

export async function sendDirectMessage(
  client: DirectMessageClient,
  input: {
    conversationId: string
    userId: string
    content: string
  },
): Promise<DmMessage> {
  const content = input.content.trim()
  if (!input.conversationId) throw new Error('Select a conversation first.')
  if (!input.userId) throw new Error('Sign in to send a message.')
  if (!content) throw new Error('Write a message first.')
  if (content.length > 1000) throw new Error('Messages must be 1,000 characters or fewer.')

  const { data, error } = await client
    .from('dm_messages')
    .insert({
      conversation_id: input.conversationId,
      user_id: input.userId,
      content,
    })
    .select()
    .single()
  if (error || !data) {
    throw new Error(error?.message || 'The server did not accept the message.')
  }
  return data as DmMessage
}
