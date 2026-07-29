import { useEffect, useState } from 'react'
import { BarChart3, Plus, SendHorizontal, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  encodeChatPoll,
  parseChatPoll,
  validateChatPoll,
} from '@/lib/chat'

interface ChatComposerProps {
  userId: string
  placeholder: string
  onSend: (body: string) => Promise<void>
  className?: string
}

type ErrorLike = { message?: string } | null | undefined

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as ErrorLike)?.message
    if (message) return message
  }
  return fallback
}

async function createPollMessage(
  userId: string,
  question: string,
  options: readonly string[],
  send: (body: string) => Promise<void>,
): Promise<void> {
  const validation = validateChatPoll(question, options)
  if (!validation.draft) throw new Error(validation.error || 'Check the poll.')

  const { data: poll, error: pollError } = await supabase
    .from('polls')
    .insert({ user_id: userId, question: validation.draft.question })
    .select()
    .single()
  if (pollError || !poll) throw new Error(pollError?.message || 'Could not create the poll.')

  const { error: optionsError } = await supabase.from('poll_options').insert(
    validation.draft.options.map((text, order) => ({ poll_id: poll.id, text, order })),
  )
  if (optionsError) {
    await supabase.from('polls').delete().eq('id', poll.id)
    throw new Error(optionsError.message || 'Could not save the poll options.')
  }

  try {
    await send(encodeChatPoll(poll.id))
  } catch (error) {
    await supabase.from('polls').delete().eq('id', poll.id)
    throw error
  }
}

export function ChatComposer({
  userId,
  placeholder,
  onSend,
  className = '',
}: ChatComposerProps) {
  const [draft, setDraft] = useState('')
  const [pollOpen, setPollOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendText(event: React.FormEvent) {
    event.preventDefault()
    const body = draft.trim().slice(0, 1000)
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      await onSend(body)
      setDraft('')
    } catch (sendError) {
      setError(errorText(sendError, 'Could not send the message.'))
    } finally {
      setSending(false)
    }
  }

  async function sendPoll(event: React.FormEvent) {
    event.preventDefault()
    if (sending) return
    setSending(true)
    setError(null)
    try {
      await createPollMessage(userId, question, options, onSend)
      setQuestion('')
      setOptions(['', ''])
      setPollOpen(false)
    } catch (sendError) {
      setError(errorText(sendError, 'Could not send the poll.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={className}>
      {pollOpen && (
        <form onSubmit={sendPoll} className="space-y-2 border-b border-dark-border p-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-accent" aria-hidden />
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={200}
              placeholder="Poll question"
              className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setPollOpen(false)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-dark-border/40 hover:text-white"
              aria-label="Close poll"
              title="Close poll"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {options.map((option, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={option}
                onChange={(event) => {
                  const next = [...options]
                  next[index] = event.target.value
                  setOptions(next)
                }}
                maxLength={80}
                placeholder={`Option ${index + 1}`}
                className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 hover:bg-dark-border/40 hover:text-white"
                  aria-label={`Remove option ${index + 1}`}
                  title="Remove option"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setOptions((current) => [...current, ''])}
              disabled={options.length >= 6}
              className="inline-flex items-center gap-1.5 px-2 py-1 text-sm text-accent disabled:opacity-40"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Option
            </button>
            <button
              type="submit"
              disabled={sending}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50"
            >
              Post poll
            </button>
          </div>
        </form>
      )}

      {error && (
        <p role="alert" className="border-b border-dark-border px-4 py-2 text-xs text-kunai">
          {error}
        </p>
      )}

      <form onSubmit={sendText} className="flex items-center gap-2 p-3 sm:p-4">
        <button
          type="button"
          onClick={() => setPollOpen((open) => !open)}
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${
            pollOpen
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-dark-border text-gray-400 hover:text-white'
          }`}
          aria-label="Create poll"
          title="Create poll"
        >
          <BarChart3 className="h-4 w-4" />
        </button>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={1000}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-4 py-2 text-white placeholder-gray-500 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim() || sending}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-dark disabled:opacity-50"
          aria-label="Send message"
          title="Send message"
        >
          <SendHorizontal className="h-4 w-4" />
        </button>
      </form>
    </div>
  )
}

interface PollRow {
  id: string
  question: string
}

interface PollOptionRow {
  id: string
  poll_id: string
  text: string
  order: number
}

interface PollVoteRow {
  id: string
  poll_id: string
  poll_option_id: string
  user_id: string
}

function ConversationPoll({ pollId, userId }: { pollId: string; userId: string | null }) {
  const [poll, setPoll] = useState<PollRow | null>(null)
  const [options, setOptions] = useState<PollOptionRow[]>([])
  const [votes, setVotes] = useState<PollVoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [voting, setVoting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [pollResult, optionsResult, votesResult] = await Promise.all([
        supabase.from('polls').select('id, question').eq('id', pollId).maybeSingle(),
        supabase.from('poll_options').select('*').eq('poll_id', pollId).order('order'),
        supabase.from('poll_votes').select('*').eq('poll_id', pollId),
      ])
      if (cancelled) return
      if (pollResult.error || optionsResult.error || votesResult.error || !pollResult.data) {
        setError('This poll is unavailable.')
      } else {
        setPoll(pollResult.data as PollRow)
        setOptions((optionsResult.data ?? []) as PollOptionRow[])
        setVotes((votesResult.data ?? []) as PollVoteRow[])
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [pollId])

  async function vote(optionId: string) {
    if (!userId || voting) {
      if (!userId) setError('Sign in to vote.')
      return
    }
    const previous = votes.find((voteRow) => voteRow.user_id === userId)
    if (previous?.poll_option_id === optionId) return
    setVoting(true)
    setError(null)

    if (previous) {
      const { error: deleteError } = await supabase
        .from('poll_votes')
        .delete()
        .eq('poll_id', pollId)
        .eq('user_id', userId)
      if (deleteError) {
        setError(deleteError.message || 'Could not change your vote.')
        setVoting(false)
        return
      }
    }

    const { data, error: insertError } = await supabase
      .from('poll_votes')
      .insert({ poll_id: pollId, poll_option_id: optionId, user_id: userId })
      .select()
      .single()
    if (insertError || !data) {
      setError(insertError?.message || 'Could not save your vote.')
    } else {
      setVotes((current) => [
        ...current.filter((voteRow) => voteRow.user_id !== userId),
        data as PollVoteRow,
      ])
    }
    setVoting(false)
  }

  if (loading) {
    return <div className="mt-1 h-20 animate-pulse rounded-lg bg-dark-border/30" />
  }
  if (!poll) {
    return <p className="mt-1 text-sm text-kunai">{error || 'This poll is unavailable.'}</p>
  }

  const total = votes.length
  const myVote = votes.find((voteRow) => voteRow.user_id === userId)?.poll_option_id ?? null
  return (
    <div className="mt-1 w-full max-w-md rounded-lg border border-dark-border bg-dark/60 p-3">
      <div className="mb-3 flex items-start gap-2">
        <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
        <p className="font-medium text-white">{poll.question}</p>
      </div>
      <div className="space-y-2">
        {options.map((option) => {
          const count = votes.filter((voteRow) => voteRow.poll_option_id === option.id).length
          const percentage = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => vote(option.id)}
              disabled={voting}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                myVote === option.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-dark-border text-gray-300 hover:border-gray-500'
              }`}
            >
              <span className="flex items-center justify-between gap-3">
                <span className="min-w-0 break-words">{option.text}</span>
                <span className="shrink-0 text-xs text-gray-500">
                  {percentage}% ({count})
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-gray-500">{total} {total === 1 ? 'vote' : 'votes'}</p>
      {error && <p role="alert" className="mt-2 text-xs text-kunai">{error}</p>}
    </div>
  )
}

export function ChatMessageContent({
  body,
  userId,
  className = 'mt-0.5 break-words text-gray-300',
}: {
  body: string
  userId: string | null
  className?: string
}) {
  const pollId = parseChatPoll(body)
  if (pollId) return <ConversationPoll pollId={pollId} userId={userId} />
  return <p className={className}>{body}</p>
}
