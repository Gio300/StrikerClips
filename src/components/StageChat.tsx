import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'

/**
 * StageChat — a compact, self-contained chat pane for surfaces that DON'T
 * have a Supabase `stream_id` to bind to (the client-side Live dashboard and
 * the synced reel stage). It mirrors StreamChat / TournamentChat's look and
 * feel — header, scrollback, log-in-gated composer — but keeps messages local
 * to the session so it works fully standalone with no backend.
 *
 * When a real stream id exists (Live multi-view, ProgramView, /watch), keep
 * using StreamChat; this is the lightweight sibling for the rest.
 */

type StageMessage = { id: string; author: string; content: string; self: boolean }

let _seq = 0

export function StageChat({
  title,
  className = '',
  heightClass = 'h-full',
}: {
  title?: string | null
  className?: string
  heightClass?: string
}) {
  const { user, profile } = useAuth()
  const [messages, setMessages] = useState<StageMessage[]>([])
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const content = draft.trim().slice(0, 500)
    if (!content) return
    const myName =
      profile?.username ??
      ((user?.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined) ??
      'you'
    setMessages((prev) => [
      ...prev,
      { id: `stage-${Date.now()}-${_seq++}`, author: myName, content, self: true },
    ])
    setDraft('')
  }

  return (
    <div
      className={`flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden ${heightClass} ${className}`}
    >
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400 flex items-center justify-between">
        <span>Chat</span>
        {title && <span className="truncate text-gray-500 ml-2">{title}</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">
            Chat is live for this session. Say something.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="leading-snug">
              <span className="text-accent font-semibold mr-1.5">{m.author}</span>
              <span className="text-gray-200 break-words">{m.content}</span>
            </div>
          ))
        )}
      </div>
      <form onSubmit={handleSend} className="border-t border-dark-border p-2 flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="Say something nice…"
          className="flex-1 px-3 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  )
}

export default StageChat
