import { useEffect, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { fetchOnboarding, type OnboardingStatus } from '@/lib/onboardingApi'

const GATE_TIMEOUT_MS = 2_500

export function onboardingNeedsSetup(status: OnboardingStatus): boolean {
  return status === 'new' || status === 'active' || status === 'ready'
}

/**
 * Catch accounts that arrived through email confirmation or an ordinary login
 * instead of the same-tab signup redirect. Deferred and complete accounts go
 * straight home; network or old-backend failures also fail open to the app.
 */
export function OnboardingHomeGate({ userId, children }: { userId: string; children: ReactNode }) {
  const [decision, setDecision] = useState<'checking' | 'home' | 'setup'>('checking')

  useEffect(() => {
    let alive = true
    setDecision('checking')
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), GATE_TIMEOUT_MS)
    })
    Promise.race([fetchOnboarding(), timeout])
      .then((envelope) => {
        if (!alive) return
        setDecision(envelope && onboardingNeedsSetup(envelope.state.status) ? 'setup' : 'home')
      })
      .catch(() => {
        if (alive) setDecision('home')
      })
      .finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId)
      })
    return () => {
      alive = false
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }
  }, [userId])

  if (decision === 'setup') {
    return <Navigate to="/setup" replace state={{ returnTo: '/' }} />
  }
  if (decision === 'checking') {
    return <div className="min-h-[40vh]" aria-label="Checking account setup" />
  }
  return <>{children}</>
}
