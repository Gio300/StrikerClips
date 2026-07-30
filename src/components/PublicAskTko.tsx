import { FormEvent, useEffect, useRef, useState } from 'react'
import {
  ExternalLink,
  Loader2,
  MessageCircle,
  Send,
  Sparkles,
  X,
} from 'lucide-react'

type Message = {
  id: number
  role: 'user' | 'assistant'
  text: string
}

const ENDPOINT =
  import.meta.env.VITE_PUBLIC_ASK_URL ||
  'https://tko-public-ask-365406931355.us-central1.run.app/ask'

const STARTERS = [
  'What is synchronized squad view?',
  'How does Shinobi Conquest work?',
  'How do I get TKO?',
]

const WELCOME: Message = {
  id: 0,
  role: 'assistant',
  text: 'Ask me about TKO features, the videos, or how to get the app. Personal stats, rooms, and tournament details stay inside TKO after you sign in.',
}

export function PublicAskTko({
  appHref,
}: {
  appHref: (path?: string) => string
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, sending])

  async function ask(text: string) {
    const question = text.trim()
    if (!question || sending) return

    const userMessage: Message = { id: Date.now(), role: 'user', text: question }
    const history = messages
      .filter((message) => message.id !== WELCOME.id)
      .slice(-6)
      .map(({ role, text: messageText }) => ({ role, text: messageText }))

    setMessages((current) => [...current, userMessage])
    setInput('')
    setSending(true)

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question, history }),
      })
      const data = (await response.json()) as {
        ok?: boolean
        answer?: string
        error?: string
      }
      if (!response.ok || !data.ok || !data.answer) {
        throw new Error(data.error || 'Ask TKO could not answer that.')
      }
      setMessages((current) => [
        ...current,
        { id: Date.now() + 1, role: 'assistant', text: data.answer! },
      ])
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: Date.now() + 1,
          role: 'assistant',
          text:
            error instanceof Error
              ? error.message
              : 'Ask TKO is taking a quick break. The Features and Watch sections are still available.',
        },
      ])
    } finally {
      setSending(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void ask(input)
  }

  return (
    <>
      {open && (
        <section
          role="dialog"
          aria-label="Ask TKO public website assistant"
          className="fixed inset-x-3 bottom-20 z-50 flex max-h-[min(650px,calc(100dvh-6rem))] flex-col overflow-hidden rounded-lg border border-dark-border bg-dark-card shadow-2xl sm:inset-x-auto sm:right-5 sm:w-[390px]"
        >
          <header className="flex items-center justify-between border-b border-dark-border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-kunai/15 text-kunai">
                <Sparkles size={18} aria-hidden />
              </span>
              <div className="[&>p]:hidden">
                <h2 className="font-semibold text-white">Ask TKO</h2>
                <span className="block text-[11px] text-gray-500">
                  Gemini 2.5 Pro | public guide
                </span>
                <p className="text-[11px] text-gray-500">Gemini 2.5 Pro · public guide</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 hover:bg-dark-elevated hover:text-white"
              aria-label="Close Ask TKO"
            >
              <X size={19} />
            </button>
          </header>

          <nav className="flex gap-1 border-b border-dark-border px-3 py-2 text-xs" aria-label="Public TKO sections">
            <a href="#features" className="rounded-lg px-3 py-2 text-gray-300 hover:bg-dark-elevated hover:text-white">
              Features
            </a>
            <a href="#showcase" className="rounded-lg px-3 py-2 text-gray-300 hover:bg-dark-elevated hover:text-white">
              Watch
            </a>
            <a href="#get" className="rounded-lg px-3 py-2 text-gray-300 hover:bg-dark-elevated hover:text-white">
              Get app
            </a>
          </nav>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[88%] rounded-lg px-3 py-2.5 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'ml-auto bg-kunai text-white'
                    : 'border border-dark-border bg-dark text-gray-200'
                }`}
              >
                {message.text}
              </div>
            ))}

            {messages.length === 1 && (
              <div className="space-y-2 pt-1">
                {STARTERS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => void ask(starter)}
                    className="block w-full rounded-lg border border-dark-border px-3 py-2 text-left text-xs text-gray-300 hover:border-accent/50 hover:bg-dark-elevated hover:text-white"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            )}

            {sending && (
              <div className="flex max-w-[88%] items-center gap-2 rounded-lg border border-dark-border bg-dark px-3 py-2.5 text-sm text-gray-400">
                <Loader2 size={16} className="animate-spin" />
                Ask TKO is thinking
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-dark-border p-3">
            <form onSubmit={submit} className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                maxLength={500}
                placeholder="Ask about TKO..."
                className="field min-w-0 flex-1"
                disabled={sending}
                aria-label="Question for Ask TKO"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kunai text-white hover:bg-kunai-dark disabled:cursor-not-allowed disabled:opacity-40"
                aria-label="Send question"
              >
                <Send size={17} />
              </button>
            </form>
            <a
              href={appHref('/')}
              className="mt-2 inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-accent hover:text-white"
            >
              Open TKO for personal stats and rooms
              <ExternalLink size={13} />
            </a>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="fixed bottom-5 right-5 z-50 inline-flex min-h-12 items-center gap-2 rounded-lg border border-kunai/50 bg-kunai px-4 py-3 font-semibold text-white shadow-xl transition-colors hover:bg-kunai-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kunai/70"
        aria-expanded={open}
        aria-label={open ? 'Close Ask TKO' : 'Open Ask TKO'}
      >
        <MessageCircle size={19} aria-hidden />
        Ask TKO
      </button>
    </>
  )
}
