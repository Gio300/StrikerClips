import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVoiceCommands, speak } from '@/hooks/useVoiceCommands'
import { parseCommand, type VoiceIntent } from '@/lib/voiceCommands'
import { useEntitlements } from '@/hooks/useEntitlements'
import { canUse } from '@/lib/tiers'

/**
 * Global floating voice button — say a command from anywhere. Navigation and
 * accessibility work for everyone (accessibility should never be paywalled);
 * live-director controls (all/single/focus/slow-mo/replay/go-live) and clip
 * creation are gated to Pro via `voice_director`.
 *
 * Director actions are dispatched as a `kc:director` CustomEvent so the Live /
 * studio page can react without this component knowing about it.
 */
export function dispatchDirector(action: string, screen?: number) {
  window.dispatchEvent(new CustomEvent('kc:director', { detail: { action, screen } }))
}

const HELP = [
  '“Go to reels / rankings / browser”',
  '“All screens” · “Single screen” · “Focus screen 2”',
  '“Slow-mo” · “Replay that kill” · “Go live”',
  '“Make a clip of my K.O.s / ultimates / flags”',
  '“Read the screen” · “Help”',
]

export function VoiceButton() {
  const navigate = useNavigate()
  const { isPremium } = useEntitlements()
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState<string>('')
  const [note, setNote] = useState<string>('')
  const [showHelp, setShowHelp] = useState(false)
  const [typed, setTyped] = useState('')

  const run = useCallback((transcript: string) => {
    setLast(transcript)
    const intent: VoiceIntent = parseCommand(transcript)
    switch (intent.kind) {
      case 'navigate':
        setNote(`→ ${intent.say}`); speak(intent.say); navigate(intent.path); break
      case 'accessibility':
        if (intent.action === 'help') { setShowHelp(true); setNote('Commands'); speak('Here are the commands') }
        else { const t = document.querySelector('main')?.textContent?.slice(0, 400) ?? ''; speak(t || 'Nothing to read'); setNote('Reading screen') }
        break
      case 'director':
        if (!canUse('voice_director', isPremium)) { setNote('Voice director is a Pro feature'); speak('That is a Pro feature'); break }
        dispatchDirector(intent.action, intent.screen); setNote(intent.say); speak(intent.say); break
      case 'create':
        if (!canUse('voice_director', isPremium)) { setNote('Voice clips are a Pro feature'); speak('That is a Pro feature'); break }
        setNote(intent.say); speak(intent.say); navigate(`/reels/create?want=${intent.category}`); break
      default:
        setNote(`Didn’t catch that — try “help”`); break
    }
  }, [navigate, isPremium])

  const { supported, listening, interim, start, stop } = useVoiceCommands(run)

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-4 z-50 w-[19rem] max-w-[90vw] rounded-xl border border-dark-border bg-dark-card/95 backdrop-blur p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-white">Voice control</span>
            <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-white text-sm">✕</button>
          </div>
          {!supported && (
            <p className="text-xs text-yellow-400 mt-2">Mic isn’t available here — type a command instead.</p>
          )}
          <p className="text-xs text-gray-500 mt-2">{listening ? 'Listening…' : 'Tap the mic, or type below.'}</p>
          {(interim || last) && (
            <p className="text-sm text-gray-200 mt-1 min-h-[1.25rem]">{interim || last}</p>
          )}
          {note && <p className="text-xs text-kunai mt-1">{note}</p>}

          <form
            onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { run(typed.trim()); setTyped('') } }}
            className="mt-3 flex gap-2"
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Type a command…"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-kunai"
            />
            <button type="submit" className="px-3 py-2 rounded-lg bg-kunai text-dark text-sm font-semibold">Run</button>
          </form>

          <button onClick={() => setShowHelp((v) => !v)} className="mt-2 text-xs text-gray-400 hover:text-white">
            {showHelp ? 'Hide commands' : 'What can I say?'}
          </button>
          {showHelp && (
            <ul className="mt-2 space-y-1 text-xs text-gray-400">
              {HELP.map((h) => <li key={h}>{h}</li>)}
            </ul>
          )}
        </div>
      )}

      <button
        aria-label={listening ? 'Stop listening' : 'Voice control'}
        onClick={() => { setOpen(true); if (supported) { listening ? stop() : start() } }}
        className={`fixed bottom-6 right-4 z-50 w-14 h-14 rounded-full shadow-glow flex items-center justify-center transition-colors ${
          listening ? 'bg-red-500 animate-pulse' : 'bg-gradient-kunai'
        }`}
      >
        <svg className="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3z" />
          <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M5 11a7 7 0 0014 0M12 18v3" />
        </svg>
      </button>
    </>
  )
}
