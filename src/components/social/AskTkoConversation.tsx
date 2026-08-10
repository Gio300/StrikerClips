import { useRef, useState } from 'react'
import { ArrowLeft, BookOpen, SendHorizontal, Sparkles } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { bankAnswer } from '@/lib/answerBank'
import { GUIDES } from '@/lib/guides'
import { useAskTko } from '@/components/AskTkoContext'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'

type Line = { id: string; role: 'user' | 'assistant'; text: string }

export function AskTkoConversation({ onBack }: { onBack?: () => void }) {
  const { user, profile } = useAuth()
  const { pathname } = useLocation()
  const { open } = useAskTko()
  const { display } = useLeagueTheme()
  const [lines, setLines] = useState<Line[]>([
    { id: 'welcome', role: 'assistant', text: 'What are you working on?' },
  ])
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [showGuides, setShowGuides] = useState(false)
  const sequence = useRef(0)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    const question = text.trim()
    if (!question || thinking) return
    const id = `${Date.now()}-${sequence.current++}`
    const history = lines
      .filter((line) => line.id !== 'welcome')
      .slice(-8)
      .map(({ role, text: lineText }) => ({ role, text: lineText }))
    setLines((current) => [...current, { id, role: 'user', text: question }])
    setText('')
    setThinking(true)
    try {
      const { data } = await supabase.functions.invoke('ask', {
        body: { question, history, clientContext: { signedIn: Boolean(user), path: pathname } },
      })
      const result = data as { ok?: boolean; answer?: string } | null
      const fallback = bankAnswer(question, {
        power: Number(profile?.power_level ?? 0),
        signedIn: Boolean(user),
      }) || 'I could not reach the live assistant. Try that again in a moment.'
      setLines((current) => [...current, {
        id: `${id}-reply`,
        role: 'assistant',
        text: result?.ok && result.answer?.trim() ? result.answer.trim() : fallback,
      }])
    } catch {
      setLines((current) => [...current, {
        id: `${id}-reply`,
        role: 'assistant',
        text: bankAnswer(question, { power: Number(profile?.power_level ?? 0), signedIn: Boolean(user) })
          || 'I could not reach the live assistant. Try that again in a moment.',
      }])
    } finally {
      setThinking(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex min-h-14 items-center gap-3 border-b border-dark-border px-4">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Back to conversations" title="Back" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-dark-border hover:text-white sm:hidden">
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </button>
        )}
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-kunai text-white">
          <Sparkles className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-white">{display.assistantName}</h2>
          <p className="text-[11px] text-emerald-400">Available</p>
        </div>
        <button type="button" onClick={() => setShowGuides((value) => !value)} aria-label="Open walkthroughs" title="Walkthroughs" className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-dark-border hover:text-white">
          <BookOpen className="h-4 w-4" aria-hidden />
        </button>
      </header>
      {showGuides && (
        <div className="flex gap-2 overflow-x-auto border-b border-dark-border p-3">
          {GUIDES.map((guide) => (
            <button key={guide.id} type="button" onClick={() => open(guide.id)} className="shrink-0 rounded-full border border-dark-border px-3 py-1.5 text-xs font-semibold text-gray-300 hover:border-kunai hover:text-white">
              {guide.title}
            </button>
          ))}
        </div>
      )}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {lines.map((line) => (
          <div key={line.id} className={`flex ${line.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <p className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${line.role === 'user' ? 'bg-accent text-dark' : 'bg-dark-border/50 text-gray-100'}`}>
              {line.text}
            </p>
          </div>
        ))}
        {thinking && <p className="text-xs text-gray-500">Thinking...</p>}
      </div>
      <form onSubmit={send} className="flex items-center gap-2 border-t border-dark-border p-3">
        <input value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} placeholder={`Message ${display.assistantName}`} className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-4 py-2 text-sm text-white placeholder-gray-500 focus:border-accent focus:outline-none" />
        <button type="submit" disabled={!text.trim() || thinking} aria-label="Send message" title="Send" className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-dark disabled:opacity-40">
          <SendHorizontal className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </div>
  )
}
