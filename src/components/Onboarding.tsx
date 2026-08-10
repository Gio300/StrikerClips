import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'

type Step = {
  title: string
  line: string
}

function onboardingSteps(brandName: string): Step[] {
  return [
    {
      title: `Welcome to ${brandName}`,
      line: 'Every angle of the kill, one cam — your gameplay, turned into highlights.',
    },
    {
      title: 'Create',
      line: 'Tap Create in the bottom bar to turn footage from your connected YouTube into a highlight reel.',
    },
    {
      title: 'Join your clan',
      line: 'Open More, then Clans & crews to apply, create a clan, or enter your clan board and chat.',
    },
    {
      title: 'Tournaments',
      line: 'Tap Play to find a tournament. Clan leaders build reusable lineups in Clan tools, then enter them in events.',
    },
    {
      title: 'Activity and help',
      line: 'The top bell shows applications, tournament decisions, and video updates. Use the chat button for conversations and help.',
    },
  ]
}

/** localStorage flag prefix; full key is `kc_onboarded_${user.id}`. */
const FLAG_PREFIX = 'kc_onboarded_'

export function Onboarding() {
  const { user } = useAuth()
  const { league } = useLeagueTheme()
  const brandName = league?.name || 'TKO'
  const steps = onboardingSteps(brandName)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)

  // Decide whether to show, once we know who the user is.
  useEffect(() => {
    if (!user) {
      setOpen(false)
      return
    }
    let already = false
    try {
      already = localStorage.getItem(FLAG_PREFIX + user.id) === '1'
    } catch {
      already = false
    }
    if (already) return

    // Show shortly after mount so it feels like a gentle welcome, not a blocker.
    const t = setTimeout(() => setOpen(true), 600)
    return () => clearTimeout(t)
  }, [user])

  function markDone() {
    if (user) {
      try {
        localStorage.setItem(FLAG_PREFIX + user.id, '1')
      } catch {
        /* ignore storage errors */
      }
    }
    // Persist the seen-flag BEFORE closing so the tour is one-shot even if the
    // component remounts immediately after dismissal.
    setOpen(false)
  }

  function next() {
    if (step >= steps.length - 1) {
      markDone()
    } else {
      setStep((s) => s + 1)
    }
  }

  // Escape dismisses the tour (and marks it seen) so it never traps the user.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') markDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // markDone is a stable local closure; deps intentionally limited to `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!user || !open) return null

  const current = steps[step]
  const isLast = step === steps.length - 1

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-dark/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={`${brandName} welcome tour`}
      onClick={(e) => {
        // Tap outside the card (on the backdrop itself) dismisses + marks seen.
        if (e.target === e.currentTarget) markDone()
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-dark-card border border-dark-border shadow-kunai-lg p-6 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Small brand mark */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-lg bg-gradient-kunai flex items-center justify-center shadow-md">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
            </svg>
          </div>
          <span className="text-xs font-medium uppercase tracking-widest text-gray-400">
            Step {step + 1} of {steps.length}
          </span>
        </div>

        <h2 className="text-xl font-semibold text-white">{current.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-gray-300">{current.line}</p>

        {/* Progress dots */}
        <div className="mt-6 flex items-center gap-2">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? 'w-6 bg-gradient-kunai' : 'w-1.5 bg-dark-border'
              }`}
            />
          ))}
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={markDone}
            className="text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={next}
            className="px-5 py-2 rounded-lg bg-gradient-kunai text-dark text-sm font-semibold hover:shadow-glow transition-shadow"
          >
            {isLast ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
