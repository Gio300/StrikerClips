import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useAskTko } from './AskTkoContext'
import { NinjaIcon, type NinjaIconName } from '@/components/ui/NinjaIcon'
import {
  GUIDES,
  getGuide,
  suggestGuide,
  clampStepIndex,
  nextStepIndex,
  prevStepIndex,
  isLastStep,
  type Guide,
} from '@/lib/guides'

/**
 * CommandBar — the "Ask TKO" GUIDED ASSISTANT.
 *
 * Many users get lost in the buttons, so this rescues them. It has three states,
 * all driven by AskTkoContext so they survive navigation (see AskTkoContext.tsx):
 *
 *   • FAB pill (mode 'closed')  — a small floating "Ask TKO" button. Tapping it
 *     opens the panel to the guide that matches the current screen.
 *   • Panel (mode 'open')       — a near-full-screen overlay (phone-first; a tall
 *     right-side panel on wide screens) that WALKS the user through a guide one
 *     big step at a time (Next/Back + progress), or answers a free-text question.
 *   • Docked card (mode 'min')  — a small PiP-style card (mirrors the reel PiP
 *     dock, above the bottom nav) that keeps the guide + step alive while the
 *     user navigates, with a maximize control to restore the panel.
 *
 * The free-text knowledge-base Q&A from before is preserved inside the panel; a
 * conversational LLM slots in behind the same input later.
 */

// ─────────────────────────────────────────────────────────────────────────
//  Free-text knowledge base (unchanged behaviour — now lives inside the panel)
// ─────────────────────────────────────────────────────────────────────────

type QA = { test: RegExp; answer: (ctx: { power: number }) => string }
type ReplySource = 'gemini' | 'offline' | null

const KB: QA[] = [
  {
    test: /\b(what can you do|what do you do|who are you|what are you|help)\b/,
    answer: () =>
      'I answer questions about TKO — your power level, tournaments, stat checks, clips, going live, and the membership tiers. Or pick a step-by-step guide above and I\'ll walk you through it.',
  },
  {
    test: /\b(power ?level|my rank|how strong|my score)\b/,
    answer: ({ power }) =>
      `Your power level is ${power}. You climb it by winning matches, passing stat checks, and having clips picked up. It shows at the top of every screen.`,
  },
  {
    test: /\b(tier|tiers|pricing|price|cost|membership|subscription|plan|perk|perks|pay)\b/,
    answer: () =>
      'Tiers: Free ($0) = watch, clip, and chat. Ad-Free ($1.99/mo) removes ads. Pro ($4.99/mo) adds profile livestreaming and full clip tools. Elite ($9.99/mo) adds clan streams, tournament hosting, and the control room. Legend ($29.99/mo) adds front-page placement, advanced AI, and creator support subscriptions.',
  },
  {
    test: /\b(tournaments?|brackets?|compete)\b/,
    answer: () =>
      'Tournaments are brackets you join to compete. You submit your result and pass a stat check to rank. Browse them under Tournaments.',
  },
  {
    test: /\bstat ?checks?\b/,
    answer: () =>
      'A stat check is a short clip showing your loadout/buffs so the host and other players can verify it — it keeps things fair, no cheating. You post it in the Stat Check Room.',
  },
  {
    test: /\b(make (a )?clip|clips? work|highlight|reel)\b/,
    answer: () =>
      'To make a clip: tap Create, pull in your footage (paste a link, use your squad’s clips, or describe the moment), pick how to combine them, and hit Create reel. It lands in My Clips. Want me to walk you through it? Open the "Make your first clip" guide above.',
  },
  {
    test: /\b(go live|live ?stream|streaming|broadcast)\b/,
    answer: () =>
      'Going live is a paid perk. You choose where it lands — your profile, your clan page, or the front page — with higher placements on higher tiers. Find it under Live → Go Live, or open the "Go live" guide above.',
  },
  {
    test: /\b(clan|chat|board)\b/,
    answer: () =>
      'Clans are your crew — boards and channels to chat and organize. Head to Clans & Chat to join or create one, or open the "Join a clan" guide above.',
  },
  {
    test: /\b(connect|other apps|playstation|xbox|youtube|twitch)\b/,
    answer: () =>
      'Use the Connect screen to link YouTube (and pull your uploads for reels). Open the "Connect your YouTube" guide above and I\'ll walk you through it.',
  },
  {
    test: /\b(register|sign ?up|enter|king|pit)\b/,
    answer: () =>
      'To enter the TKO King you pass 5 quick gates: sign in, connect YouTube, agree to stream, attest no-modding, and do a stat check. Open the "Register for TKO King" guide above and I\'ll take you through each one.',
  },
  {
    test: /\b(artifacts?|rewards?|collectibl|badges?)\b/,
    answer: () =>
      'Artifacts are collectible rewards. You earn them by using the app — uploading clips (1, 5, 15, 40, 100) and recruiting friends (1, 3, 7, 15) — and see your collection and progress under Artifacts (🏆 in the menu). The rare ones let you gift a starter pass to a friend.',
  },
  {
    test: /\b(forge|make an artifact|upload.*art|my art|create an artifact)\b/,
    answer: () =>
      'Forge is where you turn your OWN art into an artifact: open Forge (⚒️ in the menu), upload your image, we render it into a framed, shining artifact, then you name it, pick a rarity, attach a power, and set a price. Selling needs a connected Stripe account so you get paid.',
  },
  {
    test: /\b(gift|starter pass|gift a sub|share.*code)\b/,
    answer: () =>
      'Legend players craft up to 3 artifacts a month that gift a starter pass (an ad-free month — not full Pro, on purpose). You share the artifact’s code; a friend redeems it in Redeem and it unlocks with an animation. Each gift works once, and you can’t gift the same person twice.',
  },
  {
    test: /\b(host|commentary|commentate|add my angle|i was in|re-?render|join.*match)\b/,
    answer: () =>
      'If you were in a match that became a video, connect your YouTube and the system can add your angle and rebuild it with you in it. Hosting lets you add commentary over a match video — Legends can host on any video, and tournament hosts can host their own tournament’s videos.',
  },
  {
    test: /\b(what is tko|about tko)\b/,
    answer: () =>
      'TKO turns your gameplay into highlight reels — every angle of the knockout, one cam. Make clips, compete in tournaments, run clans, and go live.',
  },
]

function answerFor(text: string, power: number): string {
  const t = text.toLowerCase().trim()
  const hit = KB.find((q) => q.test.test(t))
  if (hit) return hit.answer({ power })
  return 'I can tell you about your power level, tournaments, stat checks, making clips, artifacts and forging, going live, clans, and the membership tiers — or pick a step-by-step guide above. What would you like to do?'
}

// ─────────────────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────────────────

export function CommandBar() {
  const { profile } = useAuth()
  const { mode, guideId, open, minimize, close, setGuide } = useAskTko()
  const location = useLocation()
  const navigate = useNavigate()

  const power = (profile?.power_level ?? 0) as number
  const activeGuide = useMemo(() => getGuide(guideId), [guideId])
  const suggested = useMemo(() => suggestGuide(location.pathname), [location.pathname])

  // Step position within the active guide. Resets whenever the guide changes.
  const [step, setStep] = useState(0)
  useEffect(() => { setStep(0) }, [guideId])

  // Free-text chat state.
  const [typed, setTyped] = useState('')
  const [reply, setReply] = useState('')
  const [replySource, setReplySource] = useState<ReplySource>(null)
  const [thinking, setThinking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const ask = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q) return
    setTyped('')
    setReply('')
    setReplySource(null)
    setThinking(true)
    try {
      // Real answer from the AI backend; the built-in guide answer is the
      // instant fallback if the model errors or the user is offline.
      const { data } = await supabase.functions.invoke('ask', { body: { question: q } })
      const response = data as {
        ok?: boolean
        answer?: string
        model?: string
        grounded?: boolean
      } | null
      const ans = response?.ok
        ? response.answer
        : null
      if (ans && ans.trim()) {
        setReply(ans)
        setReplySource('gemini')
      } else {
        setReply(answerFor(q, power))
        setReplySource('offline')
      }
    } catch {
      setReply(answerFor(q, power))
      setReplySource('offline')
    } finally {
      setThinking(false)
    }
  }, [power])

  // Lock body scroll + move focus into the panel while it's expanded.
  useEffect(() => {
    if (mode !== 'open') return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = setTimeout(() => panelRef.current?.focus(), 0)
    return () => { document.body.style.overflow = prev; clearTimeout(t) }
  }, [mode])

  // Esc minimizes the open panel (keeps the guide alive in the dock).
  useEffect(() => {
    if (mode !== 'open') return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') minimize() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, minimize])

  const goToGuide = useCallback((id: string) => { setGuide(id); setReply('') }, [setGuide])

  const followCta = useCallback((to: string) => {
    // Deep-link the user to the screen, and dock the assistant so it rides along
    // and they can pop back to the next step.
    minimize()
    navigate(to)
  }, [minimize, navigate])

  // ── FAB pill (closed) ──────────────────────────────────────────────────────
  if (mode === 'closed') {
    return (
      <button
        aria-label="Ask TKO — get guided help"
        title="Ask TKO"
        onClick={() => open(null)}
        className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 sm:bottom-5 z-50 flex items-center gap-2 rounded-full bg-gradient-kunai text-white shadow-glow px-4 py-2.5 transition-transform hover:scale-105 active:scale-95"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5M21 12a8 8 0 01-11.6 7.1L4 20l1-4.3A8 8 0 1121 12z" />
        </svg>
        <span className="text-sm font-semibold">Ask TKO</span>
      </button>
    )
  }

  // ── Docked PiP-style card (min) ─────────────────────────────────────────────
  if (mode === 'min') {
    const total = activeGuide?.steps.length ?? 0
    const label = activeGuide ? activeGuide.title : 'Ask TKO'
    const sub = activeGuide ? `Step ${clampStepIndex(step, total) + 1} of ${total}` : 'Tap to get help'
    return (
      <div
        className="fixed z-[69] right-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] sm:bottom-4 w-[232px] rounded-xl border border-kunai/40 bg-dark-card shadow-2xl overflow-hidden animate-slide-up"
        role="dialog"
        aria-label={`Ask TKO minimized: ${label}`}
      >
        <div className="flex items-center gap-1 px-2 py-1.5 bg-dark-elevated border-b border-dark-border">
          <NinjaIcon name={(activeGuide?.icon as NinjaIconName) ?? 'sparkle'} size={15} className="shrink-0 text-kunai" />
          <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{label}</span>
          <button
            type="button"
            onClick={() => open()}
            aria-label="Maximize Ask TKO"
            title="Maximize"
            className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:text-kunai hover:bg-dark-border/50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 14v6h6M20 10V4h-6M14 4h6v6M10 20H4v-6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close Ask TKO"
            title="Close"
            className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:text-white hover:bg-dark-border/50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <button type="button" onClick={() => open()} className="block w-full text-left px-3 py-2.5 hover:bg-dark-elevated/50">
          <p className="text-xs text-gray-400">{sub}</p>
          <p className="text-sm font-medium text-white mt-0.5">Tap to continue →</p>
        </button>
      </div>
    )
  }

  // ── Expanded panel (open) ───────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-[75]" role="dialog" aria-modal="true" aria-label="Ask TKO guided help">
      {/* Backdrop — tap to minimize (keeps the guide alive in the dock). */}
      <button
        aria-label="Minimize Ask TKO"
        onClick={minimize}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
      />

      {/* The panel: near-full-screen on phones (from the top safe area down over
          the bottom nav); a tall right-side panel on wide screens. */}
      <div
        ref={panelRef}
        tabIndex={-1}
        className="absolute inset-x-0 bottom-0 top-[env(safe-area-inset-top)] sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[30rem] sm:max-w-[92vw] flex flex-col rounded-t-2xl sm:rounded-t-none sm:rounded-l-2xl border-t sm:border-t-0 sm:border-l border-dark-border bg-dark-card shadow-2xl animate-slide-up focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-border">
          {activeGuide ? (
            <button
              type="button"
              onClick={() => setGuide(null)}
              className="shrink-0 flex items-center gap-1 text-xs text-gray-400 hover:text-white"
              aria-label="Back to all guides"
            >
              <span aria-hidden>‹</span> Guides
            </button>
          ) : (
            <span className="shrink-0 inline-flex items-center gap-1.5 text-sm font-semibold text-white">
              <NinjaIcon name="sparkle" size={16} className="text-kunai" /> Ask TKO
            </span>
          )}
          <div className="min-w-0 flex-1 text-center">
            {activeGuide && <span className="text-sm font-semibold text-white truncate block">{activeGuide.title}</span>}
          </div>
          <button
            type="button"
            onClick={minimize}
            aria-label="Minimize"
            title="Minimize to dock"
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-kunai hover:bg-dark-elevated"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
            </svg>
          </button>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            title="Close"
            className="shrink-0 h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-dark-elevated"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          {activeGuide ? (
            <GuideWalkthrough
              guide={activeGuide}
              step={clampStepIndex(step, activeGuide.steps.length)}
              onNext={() => setStep((s) => nextStepIndex(s, activeGuide.steps.length))}
              onBack={() => setStep((s) => prevStepIndex(s))}
              onCta={followCta}
              onDone={close}
            />
          ) : (
            <GuidePickerAndChat
              suggested={suggested}
              onPick={goToGuide}
              typed={typed}
              setTyped={setTyped}
              reply={reply}
              replySource={replySource}
              thinking={thinking}
              onAsk={ask}
              inputRef={inputRef}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Guide walkthrough — one big step at a time
// ─────────────────────────────────────────────────────────────────────────

function GuideWalkthrough({
  guide,
  step,
  onNext,
  onBack,
  onCta,
  onDone,
}: {
  guide: Guide
  step: number
  onNext: () => void
  onBack: () => void
  onCta: (to: string) => void
  onDone: () => void
}) {
  const total = guide.steps.length
  const current = guide.steps[step]
  const last = isLastStep(step, total)

  return (
    <div className="flex flex-col h-full">
      {/* Progress indicator */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>Step {step + 1} of {total}</span>
          <span>{Math.round(((step + 1) / total) * 100)}%</span>
        </div>
        <div className="flex gap-1" aria-hidden>
          {guide.steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-gradient-kunai' : 'bg-dark-border'}`}
            />
          ))}
        </div>
      </div>

      {/* The step — big and clear */}
      <div className="flex-1">
        <div className="flex items-center gap-3 mb-3">
          <span className="shrink-0 w-10 h-10 rounded-full bg-gradient-kunai text-dark flex items-center justify-center text-lg font-bold">
            {step + 1}
          </span>
          <h2 className="text-xl font-bold text-white leading-tight">{current.title}</h2>
        </div>
        <p className="text-base text-gray-300 leading-relaxed">{current.body}</p>

        {current.cta && (
          <button
            type="button"
            onClick={() => onCta(current.cta!.to)}
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent text-dark font-semibold hover:shadow-glow"
          >
            {current.cta.label}
            <NinjaIcon name="chevron-right" size={18} />
          </button>
        )}
      </div>

      {/* Nav controls */}
      <div className="mt-6 flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={step === 0}
          className="px-4 py-2.5 rounded-xl border border-dark-border text-gray-300 font-medium hover:border-kunai/50 hover:text-white disabled:opacity-40 disabled:hover:border-dark-border"
        >
          ‹ Back
        </button>
        {last ? (
          <button
            type="button"
            onClick={onDone}
            className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-kunai text-white font-semibold hover:opacity-90"
          >
            Done — I've got it
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-gradient-kunai text-white font-semibold hover:opacity-90"
          >
            Next <NinjaIcon name="chevron-right" size={18} />
          </button>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Guide picker + free-text chat (shown when no guide is active)
// ─────────────────────────────────────────────────────────────────────────

function GuidePickerAndChat({
  suggested,
  onPick,
  typed,
  setTyped,
  reply,
  replySource,
  thinking,
  onAsk,
  inputRef,
}: {
  suggested: Guide | undefined
  onPick: (id: string) => void
  typed: string
  setTyped: (v: string) => void
  reply: string
  replySource: ReplySource
  thinking: boolean
  onAsk: (text: string) => void
  inputRef: React.RefObject<HTMLInputElement>
}) {
  const others = suggested ? GUIDES.filter((g) => g.id !== suggested.id) : GUIDES

  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-400">
        Stuck? Pick a walkthrough and I'll guide you step by step — or just ask a question.
      </p>

      {/* Context-suggested guide first */}
      {suggested && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-kunai/80 mb-2">For this screen</p>
          <GuideCard guide={suggested} highlighted onClick={() => onPick(suggested.id)} />
        </div>
      )}

      {/* All (other) guides */}
      <div>
        <p className="text-[11px] uppercase tracking-widest text-gray-500 mb-2">
          {suggested ? 'Other guides' : 'Guides'}
        </p>
        <div className="space-y-2">
          {others.map((g) => (
            <GuideCard key={g.id} guide={g} onClick={() => onPick(g.id)} />
          ))}
        </div>
      </div>

      {/* Free-text Q&A */}
      <div className="pt-1">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-widest text-gray-500">Ask the TKO AI</p>
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${
              replySource === 'offline' ? 'text-amber-300' : 'text-cyan-300'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                replySource === 'offline' ? 'bg-amber-300' : 'bg-cyan-300'
              }`}
              aria-hidden
            />
            {replySource === 'offline'
              ? 'Offline guide response'
              : 'Gemini 2.5 Flash + live TKO data'}
          </span>
        </div>
        {thinking && (
          <div className="mb-2 rounded-lg bg-dark border border-dark-border px-3 py-2 text-sm text-gray-400">
            <span className="inline-flex gap-1">
              <span className="animate-bounce">●</span>
              <span className="animate-bounce [animation-delay:0.15s]">●</span>
              <span className="animate-bounce [animation-delay:0.3s]">●</span>
            </span>
            <span className="ml-2">Ask TKO is thinking…</span>
          </div>
        )}
        {!thinking && reply && (
          <div className="mb-2 rounded-lg bg-dark border border-dark-border px-3 py-2 text-sm text-gray-200 whitespace-pre-wrap">
            {reply}
          </div>
        )}
        <form onSubmit={(e) => { e.preventDefault(); onAsk(typed) }} className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Ask a question…"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-kunai"
          />
          <button type="submit" className="px-3 py-2 rounded-lg bg-gradient-kunai text-white text-sm font-semibold">Ask</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {['My power level', 'How do tournaments work', 'What are stat checks', 'The tiers'].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onAsk(s)}
              className="text-[11px] px-2 py-1 rounded-full border border-dark-border text-gray-400 hover:text-white hover:border-kunai/50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

function GuideCard({ guide, onClick, highlighted = false }: { guide: Guide; onClick: () => void; highlighted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 text-left rounded-xl border px-3 py-3 transition-colors ${
        highlighted
          ? 'border-kunai/50 bg-kunai/10 hover:bg-kunai/15'
          : 'border-dark-border bg-dark hover:border-kunai/40'
      }`}
    >
      <span className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${highlighted ? 'bg-gradient-kunai text-dark' : 'bg-dark-elevated text-kunai'}`}>
        <NinjaIcon name={guide.icon as NinjaIconName} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{guide.title}</span>
        <span className="block text-xs text-gray-400 truncate">{guide.summary}</span>
      </span>
      <NinjaIcon name="chevron-right" size={16} className="shrink-0 text-gray-500" />
    </button>
  )
}
