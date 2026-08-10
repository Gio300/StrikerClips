import { describe, expect, it, vi } from 'vitest'
import { mockSupabase } from './mockSupabase'
import {
  addConversationMembers,
  readDirectMessages,
  openDirectConversation,
  openGroupConversation,
  sendDirectMessage,
  type DirectConversationClient,
  type DirectMessageClient,
} from './directMessages'

const client = mockSupabase as DirectMessageClient

describe('direct messages data round trip', () => {
  it('opens a server-owned conversation and returns its persisted id', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, conversation_id: 'conversation-123' },
      error: null,
    })
    const functionClient = {
      functions: { invoke },
    } as unknown as DirectConversationClient

    await expect(openDirectConversation(functionClient, 'target-456')).resolves.toBe('conversation-123')
    expect(invoke).toHaveBeenCalledWith('dm-open', {
      body: { targetUserId: 'target-456' },
    })
  })

  it('surfaces a rejected conversation instead of pretending it opened', async () => {
    const functionClient = {
      functions: {
        invoke: vi.fn().mockResolvedValue({
          data: { ok: false, error: 'This conversation is unavailable.' },
          error: null,
        }),
      },
    } as unknown as DirectConversationClient

    await expect(openDirectConversation(functionClient, 'target-456')).rejects.toThrow(
      'This conversation is unavailable.',
    )
  })

  it('creates a named group thread through the server-owned endpoint', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, conversation_id: 'group-123' },
      error: null,
    })
    const functionClient = {
      functions: { invoke },
    } as unknown as DirectConversationClient

    await expect(openGroupConversation(functionClient, {
      name: 'Tournament crew',
      usernames: ['Alice', '@Bob'.replace('@', ''), 'alice'],
    })).resolves.toBe('group-123')
    expect(invoke).toHaveBeenCalledWith('dm-group-open', {
      body: { name: 'Tournament crew', usernames: ['alice', 'Bob'] },
    })
  })

  it('adds deduplicated usernames through the server-owned member endpoint', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: { ok: true, participant_count: 4 },
      error: null,
    })
    const functionClient = {
      functions: { invoke },
    } as unknown as DirectConversationClient

    await expect(addConversationMembers(functionClient, {
      conversationId: 'conversation-123',
      usernames: ['@Alice', 'alice', ' Bob '],
    })).resolves.toBe(4)
    expect(invoke).toHaveBeenCalledWith('dm-members-add', {
      body: { conversationId: 'conversation-123', usernames: ['alice', 'Bob'] },
    })
  })

  it('persists a two-user send/read/reply flow', async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const userA = `dm-user-a-${suffix}`
    const userB = `dm-user-b-${suffix}`
    const { data: conversation } = await client
      .from('dm_conversations')
      .insert({ name: null })
      .select()
      .single()
    expect(conversation).not.toBeNull()

    await client.from('dm_participants').insert([
      { conversation_id: conversation!.id, user_id: userA },
      { conversation_id: conversation!.id, user_id: userB },
    ])

    const sentByA = await sendDirectMessage(client, {
      conversationId: conversation!.id,
      userId: userA,
      content: '  Ready for the match?  ',
    })
    expect(sentByA.content).toBe('Ready for the match?')

    const readByB = await readDirectMessages(client, conversation!.id)
    expect(readByB).toEqual([
      expect.objectContaining({
        id: sentByA.id,
        user_id: userA,
        content: 'Ready for the match?',
      }),
    ])

    await new Promise((resolve) => setTimeout(resolve, 2))
    const sentByB = await sendDirectMessage(client, {
      conversationId: conversation!.id,
      userId: userB,
      content: 'Ready.',
    })

    const readByA = await readDirectMessages(client, conversation!.id)
    expect(readByA.map((message) => [message.user_id, message.content])).toEqual([
      [userA, 'Ready for the match?'],
      [userB, 'Ready.'],
    ])
    expect(readByA[1].id).toBe(sentByB.id)
  })
})
