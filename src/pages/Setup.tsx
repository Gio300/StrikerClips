import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CheckCircle,
  Loader2,
  Mic,
  MicOff,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { useAuth } from '@/hooks/useAuth'
import { useVoiceCommands } from '@/hooks/useVoiceCommands'
import {
  deferOnboarding,
  fetchOnboarding,
  OnboardingApiError,
  sendOnboardingTurn,
  submitOnboardingVideo,
  type OnboardingAction,
  type OnboardingEnvelope,
} from '@/lib/onboardingApi'

const DEFAULT_PROMPT =
  'Tell me your gamer tag and whether you play solo or with a clan. If it is a clan, say whether you belong to it or run it.'

function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/setup')) return '/'
  return raw
}

function actionWasSkipped(action: OnboardingAction): boolean {
  return action.status === 'done'
    && !!action.result
    && typeof action.result === 'object'
    && !Array.isArray(action.result)
    && (action.result as Record<string, unknown>).skipped === true
}

type SetupHandoff = {
  id: string
  title: string
  detail: string
  to: string
  cta: string
}

function actionResult(action: OnboardingAction | undefined): Record<string, unknown> {
  return action?.result && typeof action.result === 'object' && !Array.isArray(action.result)
    ? action.result as Record<string, unknown>
    : {}
}

function resultText(result: Record<string, unknown>, key: string): string {
  return typeof result[key] === 'string' ? result[key] as string : ''
}

function resultCount(result: Record<string, unknown>, key: string): number {
  const count = Number(result[key])
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

/**
 * Convert durable domain results into short, truthful player-facing outcomes.
 * Proposed orchestration rows are intentionally absent: onboarding is a chat,
 * not a JSON review screen. The server executes an explicitly stated identity
 * or clan intent and returns the resulting done/failed state here.
 */
function setupHandoffs(envelope: OnboardingEnvelope): SetupHandoff[] {
  const completed = envelope.actions.filter(
    (action) => action.status === 'done' && !actionWasSkipped(action),
  )
  const clanKinds = ['create_clan', 'claim_clan', 'apply_clan']
  const clanAction = [...completed].reverse().find((action) => clanKinds.includes(action.kind))
  const failedClanAction = [...envelope.actions].reverse().find(
    (action) => action.status === 'failed' && clanKinds.includes(action.kind),
  )
  const clanResult = actionResult(clanAction)
  const factClaimStatus = typeof envelope.state.facts.clan_claim_status === 'string'
    ? envelope.state.facts.clan_claim_status
    : ''
  const factApplicationStatus = typeof envelope.state.facts.clan_application_status === 'string'
    ? envelope.state.facts.clan_application_status
    : ''
  const clanStatus = resultText(clanResult, 'status') || factClaimStatus || factApplicationStatus
  const factClanId = typeof envelope.state.facts.clan_id === 'string' ? envelope.state.facts.clan_id : ''
  const clanId = resultText(clanResult, 'server_id') || factClanId
  const rosterAction = [...completed].reverse().find((action) => action.kind === 'create_roster')
  const rosterResult = actionResult(rosterAction)
  const rosterClanId = resultText(rosterResult, 'server_id') || clanId
  const followed = completed.filter((action) => action.kind === 'follow_player')
  const clanmateFollowAction = [...completed].reverse().find((action) => action.kind === 'follow_clanmates')
  const clanmateFollowResult = actionResult(clanmateFollowAction)
  const followedCount = followed.length + resultCount(clanmateFollowResult, 'followed_count')
  const cards: SetupHandoff[] = []

  if (clanId && (clanAction || clanStatus)) {
    if (clanStatus === 'pending') {
      cards.push({
        id: 'clan',
        title: 'Clan application sent',
        detail: 'A clan leader must approve it before you become a member or use its roster.',
        to: `/boards/${clanId}`,
        cta: 'View clan',
      })
    } else if (clanStatus === 'disputed') {
      cards.push({
        id: 'clan',
        title: 'Clan ownership is under review',
        detail: 'The current owner and clan data stay protected while the claim is reviewed.',
        to: '/settings',
        cta: 'View review',
      })
    } else {
      const manager = factClaimStatus === 'owned'
        || clanAction?.kind === 'create_clan'
        || clanAction?.kind === 'claim_clan'
      cards.push({
        id: 'clan',
        title: manager ? 'Clan created and connected' : 'Clan application approved',
        detail: manager
          ? 'Your clan dashboard and leader tools are ready.'
          : 'Your account is connected to this clan.',
        to: manager ? `/clans/${clanId}/manage` : `/boards/${clanId}`,
        cta: manager ? 'Open clan' : 'View clan',
      })
    }
  } else if (failedClanAction) {
    cards.push({
      id: 'clan-error',
      title: 'I could not finish the clan connection',
      detail: failedClanAction.error || 'Tell me the exact clan name or tag and I can try again.',
      to: '/clans/discover',
      cta: 'Find clan',
    })
  }

  if (rosterAction && rosterClanId) {
    cards.push({
      id: 'roster',
      title: 'Clan roster ready',
      detail: `${resultText(rosterResult, 'name') || 'Your main roster'} is saved with you as captain.`,
      to: `/clans/${rosterClanId}/manage`,
      cta: 'Open roster',
    })
  }

  if (followedCount > 0) {
    cards.push({
      id: 'people',
      title: `${followedCount} clanmate${followedCount === 1 ? '' : 's'} followed`,
      detail: 'You can now find their profiles, clips, and messages more easily.',
      to: '/profile',
      cta: 'View profile',
    })
  } else if (clanId && clanStatus !== 'pending' && clanStatus !== 'disputed') {
    cards.push({
      id: 'people',
      title: 'Meet your clan',
      detail: 'Your clan space has the members and conversations connected to it.',
      to: `/clans/${clanId}/chat`,
      cta: 'Open chat',
    })
  }

  return cards
}

function youtubeUrlFrom(text: string): string | null {
  const match = text.match(/(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/[^\s<>]+/i)
  if (!match) return null
  return (/^https?:\/\//i.test(match[0]) ? match[0] : `https://${match[0]}`)
    .replace(/[),.;!?]+$/, '')
}

function isRevisionConflict(error: unknown): error is OnboardingApiError {
  return error instanceof OnboardingApiError && error.status === 409 && !!error.envelope
}

function assistantPrompt(envelope: OnboardingEnvelope, productName: string): string {
  const proposed = envelope.actions.filter((action) => action.status === 'proposed')
  const onlyDeferredConnections = proposed.length > 0 && proposed.every((action) =>
    action.kind === 'connect_youtube' || action.kind === 'follow_clanmates')
  if (envelope.state.status === 'ready' && onlyDeferredConnections) {
    return `Your basic ${productName} setup is ready. Optional connections can be added later.`
  }
  if (envelope.state.status === 'complete') {
    return envelope.prompt || `You're all set on ${productName}.`
  }
  return envelope.prompt || DEFAULT_PROMPT
}

export function Setup() {
  const { user, refreshUser } = useAuth()
  const { display } = useLeagueTheme()
  const location = useLocation()
  const navigate = useNavigate()
  const queryReturnTo = new URLSearchParams(location.search).get('returnTo')
  const stateReturnTo = (location.state as { returnTo?: string } | null)?.returnTo
  const returnTo = safeReturnTo(queryReturnTo || stateReturnTo)
  const draftKey = `onboarding_draft_${user?.id ?? 'guest'}`

  const [envelope, setEnvelope] = useState<OnboardingEnvelope | null>(null)
  const [draft, setDraft] = useState(() => {
    try { return sessionStorage.getItem(draftKey) ?? '' } catch { return '' }
  })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refreshedCompletion = useRef(false)

  const applyEnvelope = useCallback((next: OnboardingEnvelope) => {
    setEnvelope(next)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      applyEnvelope(await fetchOnboarding())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : `${display.assistantName} could not load your setup.`)
    } finally {
      setLoading(false)
    }
  }, [applyEnvelope, display.assistantName])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    try {
      if (draft) sessionStorage.setItem(draftKey, draft)
      else sessionStorage.removeItem(draftKey)
    } catch { /* A draft is helpful, but never required to use setup. */ }
  }, [draft, draftKey])

  useEffect(() => {
    if (envelope?.state.status !== 'complete' || refreshedCompletion.current) return
    refreshedCompletion.current = true
    void refreshUser()
  }, [envelope?.state.status, refreshUser])

  const voice = useVoiceCommands((transcript) => {
    setDraft((current) => `${current}${current.trim() ? ' ' : ''}${transcript}`)
  })

  const handoffs = useMemo(() => envelope ? setupHandoffs(envelope) : [], [envelope])

  function handleRequestError(requestError: unknown) {
    if (isRevisionConflict(requestError)) {
      applyEnvelope(requestError.envelope!)
      setError('Your setup changed in another tab. I loaded the latest version—send that once more.')
      return
    }
    setError(requestError instanceof Error ? requestError.message : `${display.assistantName} could not save that.`)
  }

  async function answer(raw: string) {
    const text = raw.trim()
    if (!text || !envelope || busy) return
    setBusy(true)
    setError('')
    try {
      const videoUrl = youtubeUrlFrom(text)
      const next = videoUrl
        ? await submitOnboardingVideo(videoUrl, envelope.state.revision)
        : await sendOnboardingTurn(text, envelope.state.revision)
      applyEnvelope(next)
      setDraft('')
    } catch (requestError) {
      handleRequestError(requestError)
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await answer(draft)
  }

  async function leaveSetup() {
    if (busy) return
    if (envelope && envelope.state.status !== 'complete') {
      setBusy(true)
      try {
        await deferOnboarding(envelope.state.revision)
      } catch {
        // Leaving setup must not become a trap during a network outage.
      } finally {
        setBusy(false)
      }
    }
    navigate(returnTo, { replace: true })
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-dark px-5 text-gray-100">
        <div className="flex items-center gap-3 text-sm text-gray-400" role="status">
          <Loader2 className="h-5 w-5 animate-spin text-accent" aria-hidden />
          Opening {display.assistantName}...
        </div>
      </main>
    )
  }

  if (!envelope) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-dark px-5 text-gray-100">
        <section className="w-full max-w-md rounded-2xl border border-dark-border bg-dark-card p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-kunai" aria-hidden />
          <h1 className="mt-3 text-xl font-semibold">Setup is taking a moment</h1>
          <p role="alert" className="mt-2 text-sm text-gray-400">{error}</p>
          <button type="button" onClick={() => void load()} className="btn-primary mt-5 w-full">Try again</button>
          <button type="button" onClick={() => void leaveSetup()} className="mt-4 min-h-11 text-sm text-gray-500 hover:text-gray-300">
            Not now
          </button>
        </section>
      </main>
    )
  }

  const prompt = assistantPrompt(envelope, display.productName)
  const isComplete = envelope.state.status === 'complete'
  const hasSettledOutcome = handoffs.some((handoff) => handoff.id === 'clan')
  const canContinue = isComplete || envelope.state.status === 'ready' || hasSettledOutcome

  return (
    <main className="min-h-screen bg-dark px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] text-gray-100 sm:px-6 sm:py-8">
      <div className="mx-auto flex w-full max-w-xl flex-col">
        <header className="flex items-center justify-between gap-4 py-2">
          <BrandLogo className="text-2xl" />
          {!isComplete && (
            <button
              type="button"
              onClick={() => void leaveSetup()}
              disabled={busy}
              className="min-h-11 rounded-lg px-2 text-xs font-medium text-gray-600 transition-colors hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-accent/60 disabled:opacity-50"
            >
              Not now
            </button>
          )}
        </header>

        <section className="mt-5 rounded-3xl border border-dark-border bg-dark-card p-4 shadow-lg sm:p-6" aria-labelledby="assistant-title">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Sparkles className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h1 id="assistant-title" className="font-semibold text-white">{display.assistantName}</h1>
              <p className="text-xs text-gray-500">Just tell me who you are and where you belong.</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl rounded-tl-sm bg-dark px-4 py-3 text-[15px] leading-6 text-gray-200" aria-live="polite">
            {prompt}
          </div>

          <form onSubmit={submit} className="mt-4">
            <label htmlFor="setup-answer" className="sr-only">Message {display.assistantName}</label>
            <div className="rounded-2xl border border-dark-border bg-dark focus-within:border-accent/60 focus-within:ring-2 focus-within:ring-accent/10">
              <textarea
                id="setup-answer"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type or speak naturally..."
                rows={2}
                maxLength={2_000}
                disabled={busy}
                className="block w-full resize-none bg-transparent px-4 pt-3 text-[16px] text-white placeholder-gray-600 outline-none disabled:opacity-60"
              />
              {voice.interim && <p className="px-4 pb-1 text-xs italic text-gray-500">{voice.interim}</p>}
              <div className="flex items-center justify-between gap-3 p-2">
                <div>
                  {voice.supported && (
                    <button
                      type="button"
                      onClick={voice.listening ? voice.stop : voice.start}
                      disabled={busy}
                      aria-label={voice.listening ? 'Stop listening' : 'Speak your answer'}
                      aria-pressed={voice.listening}
                      className={`flex h-11 w-11 items-center justify-center rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-accent/60 ${
                        voice.listening ? 'bg-kunai/15 text-kunai' : 'text-gray-500 hover:bg-dark-elevated hover:text-gray-200'
                      }`}
                    >
                      {voice.listening ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={busy || !draft.trim()}
                  aria-label="Send message"
                  className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-dark transition-shadow hover:shadow-glow focus:outline-none focus:ring-2 focus:ring-white/60 disabled:opacity-40"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-5 w-5" aria-hidden />}
                </button>
              </div>
            </div>
          </form>

          {error && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-kunai/30 bg-kunai/5 px-3 py-2 text-sm text-gray-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-kunai" aria-hidden />
              {error}
            </p>
          )}
        </section>

        {handoffs.length > 0 && (
          <section className="mt-4 space-y-2" aria-label="Setup outcomes">
            {handoffs.map((handoff) => (
              <Link
                key={handoff.id}
                to={handoff.to}
                className="flex min-h-16 items-center gap-3 rounded-2xl border border-dark-border bg-dark-card px-4 py-3 transition-colors hover:border-accent/60"
              >
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  handoff.id === 'clan-error' ? 'bg-kunai/10 text-kunai' : 'bg-leaf/10 text-leaf'
                }`}>
                  {handoff.id === 'clan-error'
                    ? <AlertCircle className="h-5 w-5" aria-hidden />
                    : handoff.id === 'people'
                      ? <Users className="h-5 w-5" aria-hidden />
                      : <CheckCircle className="h-5 w-5" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{handoff.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-400">{handoff.detail}</span>
                </span>
                <span className="shrink-0 text-xs font-semibold text-accent">{handoff.cta}</span>
              </Link>
            ))}
          </section>
        )}

        {canContinue && (
          <button type="button" onClick={() => void leaveSetup()} disabled={busy} className="btn-primary mt-4 w-full disabled:opacity-50">
            {`Continue to ${display.productName}`}
          </button>
        )}
      </div>
    </main>
  )
}

export const setupTestables = {
  safeReturnTo,
  youtubeUrlFrom,
  setupHandoffs,
  assistantPrompt,
}
