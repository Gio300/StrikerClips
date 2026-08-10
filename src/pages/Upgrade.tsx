import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CreditCard, ShieldCheck, Sparkles } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { ManageSubscriptionPanel } from '@/components/ManageSubscriptionPanel'
import { FEATURE_LABELS, LEVEL_TIER_NAME } from '@/lib/tiers'
import {
  requestCheckout,
  startTrialCheckout,
  chargeTrialConversion,
  fetchPaymentsConfig,
  canBuyTier,
  PAYMENTS_OFF,
  type PaymentsConfig,
} from '@/lib/payments'
import { supabase } from '@/lib/supabase'
import {
  trialFromUser,
  trialState,
  isTrialActive,
  trialDaysLeft,
  convertTrialMeta,
  declineTrialMeta,
  expireTrialMeta,
  trialTierName,
} from '@/lib/trial'

type Tier = {
  key: '' | 'pro' | 'supporter' | 'creator'
  name: string
  priceUsd: number
  blurb: string
  perks: string[]
  highlight?: boolean
}

const F = FEATURE_LABELS

/**
 * THE SHOP. Retired rungs are absent here, not disabled — see RETIRED_TIERS in
 * server/app.ts.
 *
 * `ad_free` ($1.99/mo) was retired in 2026-08: Stripe's flat $0.30 was 15.1
 * points of an 18.0% total fee at that price, and any SKU under $4.23 pays
 * Stripe over 10%. $4.99 Pro is the entry paid tier and already includes no
 * ads. Anyone still HOLDING `ad_free` keeps it — the entitlement, the quota
 * tables and the renewal path are all untouched; only the sale is gone. Their
 * plan is named and cancellable in the ManageSubscriptionPanel below.
 */
const TIERS: Tier[] = [
  {
    key: '',
    name: 'Free',
    priceUsd: 0,
    blurb: 'Watch, chat, and build your own reels by hand.',
    perks: [F.watch, F.basic_reel, F.clans_chat, F.browser, F.redeem],
  },
  {
    key: 'pro',
    name: LEVEL_TIER_NAME[1],
    priceUsd: 4.99,
    blurb: 'Fast automatic Shorts without the premium production cost.',
    perks: [
      // Ads-off leads the list now that it is no longer sold on its own rung.
      // hidesAds() has always been true for every paid tier, so this is not a
      // new promise — it is the old $1.99 promise, stated where people buy.
      'No ads anywhere',
      'Automatic vertical Quick Cuts (up to 24 seconds)',
      'One hype voice moment per cut',
      'Manual multi-angle director tools',
      F.slow_mo,
      F.music_library,
      F.no_ad_gate,
      'Live stream on your profile',
    ],
    highlight: true,
  },
  {
    key: 'supporter',
    name: LEVEL_TIER_NAME[2],
    priceUsd: 9.99,
    blurb: 'Richer short-form edits for active players and teams.',
    perks: [
      'Automatic Enhanced Cuts (up to 42 seconds)',
      'Two synchronized angles and two voice moments',
      F.voice_director,
      F.auto_publish,
      F.live_studio,
      'Stream on your clan page',
      'Everything in Pro',
    ],
  },
  {
    key: 'creator',
    name: LEVEL_TIER_NAME[3],
    priceUsd: 29.99,
    blurb: 'Full premium match production for serious creators.',
    perks: [
      'Full-length Coach Dee strategy cuts',
      'Up to four synchronized angles',
      F.ai_commentary,
      'Front-page live placement',
      'Creator support subscriptions',
      'Everything in Elite',
    ],
  },
]

function fmtPrice(value: number): string {
  return value === 0 ? '$0' : `$${value.toFixed(2)}`
}

export function Upgrade() {
  const { user, refreshUser } = useAuth()
  const { tier: currentTier } = useEntitlements()
  const [flash, setFlash] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [payments, setPayments] = useState<PaymentsConfig>(PAYMENTS_OFF)
  const [trialBusy, setTrialBusy] = useState(false)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resolvedRef = useRef(false)

  const activeTrial = trialState(user)
  const trialRunning = isTrialActive(activeTrial)

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  useEffect(() => {
    let alive = true
    void fetchPaymentsConfig().then((config) => {
      if (alive) setPayments(config)
    })
    return () => {
      alive = false
    }
  }, [])

  // Coming back from the Stripe billing portal. Whatever was changed there
  // reaches us as a webhook, so re-read the user rather than leaving a cancelled
  // plan showing as active.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('billing') !== 'done') return
    void refreshUser()
    setFlash('Billing updated. Changes you made in Stripe are reflected on your account.')
  }, [refreshUser])

  useEffect(() => {
    if (resolvedRef.current) return
    const raw = trialFromUser(user)
    if (!raw || raw.status !== 'active' || Date.parse(raw.endsAt) > Date.now()) return

    resolvedRef.current = true
    void (async () => {
      try {
        if (raw.cardOnFile) {
          const result = await chargeTrialConversion({ tier: raw.tier })
          await supabase.auth.updateUser({
            data: result.ok ? convertTrialMeta(raw) : expireTrialMeta(raw),
          })
        } else {
          await supabase.auth.updateUser({ data: expireTrialMeta(raw) })
        }
        await refreshUser()
      } catch {
        resolvedRef.current = false
      }
    })()
  }, [user, refreshUser])

  function showFlash(message: string) {
    setFlash(message)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 3500)
  }

  async function startStripeTrial(tier: Tier) {
    if (!canBuyTier(payments, tier.key)) {
      showFlash('Membership checkout is temporarily unavailable. Nothing was charged.')
      return
    }

    setTrialBusy(true)
    try {
      const result = await startTrialCheckout({ tier: tier.key, trialDays: payments.trialDays })
      if (result.ok) {
        window.location.href = result.url
        return
      }
      showFlash(
        ('error' in result && result.error) || 'Could not start the trial. Please try again.',
      )
    } finally {
      setTrialBusy(false)
    }
  }

  async function declineActiveTrial() {
    const raw = trialFromUser(user)
    if (!raw) return

    setTrialBusy(true)
    try {
      await supabase.auth.updateUser({ data: declineTrialMeta(raw) })
      await refreshUser()
      showFlash('Trial cancelled. Your account is back on Free.')
    } finally {
      setTrialBusy(false)
    }
  }

  async function startCheckout(tier: Tier) {
    if (!canBuyTier(payments, tier.key)) {
      showFlash('Membership checkout is temporarily unavailable. Nothing was charged.')
      return
    }

    setBusyKey(tier.key)
    try {
      const result = await requestCheckout({ tier: tier.key })
      if (result.ok) {
        window.location.href = result.url
        return
      }
      showFlash(
        ('error' in result && result.error) || 'Could not start checkout. Please try again.',
      )
    } finally {
      setBusyKey(null)
    }
  }

  function renderTier(tier: Tier, compact = false) {
    const isCurrent = (currentTier || '') === tier.key
    const isFree = tier.key === ''

    return (
      <article
        key={tier.name}
        className={`relative flex rounded-lg border bg-dark-card ${
          compact ? 'min-h-44 flex-col p-4 sm:flex-row sm:items-start sm:gap-5' : 'min-h-[410px] flex-col p-5'
        } ${tier.highlight ? 'border-kunai/70' : 'border-dark-border'}`}
      >
        {tier.highlight && (
          <span className="absolute right-3 top-3 rounded-full bg-kunai/15 px-2 py-1 text-[10px] font-bold uppercase text-kunai">
            Most popular
          </span>
        )}

        <div className={compact ? 'min-w-40' : ''}>
          <h2 className="text-lg font-bold text-white">{tier.name}</h2>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="text-3xl font-bold text-white">{fmtPrice(tier.priceUsd)}</span>
            {!isFree && <span className="text-xs text-gray-500">/month</span>}
          </div>
          <p className="mt-2 text-sm text-gray-400">{tier.blurb}</p>
        </div>

        <ul className={`${compact ? 'mt-4 sm:mt-0' : 'mt-5'} flex-1 space-y-2 text-sm text-gray-300`}>
          {tier.perks.map((perk) => (
            <li key={perk} className="flex gap-2">
              <Check size={15} className="mt-0.5 shrink-0 text-leaf" />
              <span>{perk}</span>
            </li>
          ))}
        </ul>

        <div className={`${compact ? 'mt-4 sm:ml-auto sm:mt-0 sm:w-40' : 'mt-6'} shrink-0`}>
          {isFree ? (
            <div className="rounded-lg border border-dark-border px-3 py-2 text-center text-xs text-gray-500">
              Included
            </div>
          ) : isCurrent ? (
            <div className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-2 text-center text-xs font-semibold text-accent">
              Current tier
            </div>
          ) : canBuyTier(payments, tier.key) ? (
            <div className="space-y-2">
              <button
                onClick={() => startCheckout(tier)}
                disabled={busyKey === tier.key || trialBusy}
                className={tier.highlight ? 'btn-primary w-full' : 'btn-ghost w-full'}
              >
                {busyKey === tier.key ? 'Opening...' : 'Subscribe'}
              </button>
              {!trialRunning && (
                <button
                  onClick={() => startStripeTrial(tier)}
                  disabled={trialBusy || busyKey === tier.key}
                  className="w-full rounded-lg px-2 py-2 text-xs font-semibold text-leaf transition-colors hover:bg-leaf/10 disabled:opacity-50"
                >
                  {trialBusy ? 'Opening...' : `${payments.trialDays}-day trial`}
                </button>
              )}
            </div>
          ) : (
            <button
              disabled
              title="Membership checkout is temporarily unavailable"
              className="w-full cursor-not-allowed rounded-lg border border-dark-border bg-dark-elevated px-3 py-2 text-sm font-semibold text-gray-500"
            >
              Unavailable
            </button>
          )}
        </div>
      </article>
    )
  }

  return (
    <div className="page-shell">
      <header className="mb-6 border-b border-dark-border pb-5">
        <div className="flex items-center gap-2 text-kunai">
          <Sparkles size={16} />
          <span className="text-xs font-semibold uppercase">Memberships</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Choose the tools you need.</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-400">
          Start free, or go Pro to drop the ads and unlock the studio, live placement, and creator tools.
        </p>
      </header>

      <div className="mb-6 flex items-start gap-3 rounded-lg border border-dark-border bg-dark-card px-4 py-3">
        {payments.configured ? (
          <>
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-leaf" />
            <p className="text-sm text-gray-400">
              Secure checkout is handled by Stripe. TKO never sees or stores your card details. Cancel anytime.
            </p>
          </>
        ) : (
          <>
            <CreditCard size={18} className="mt-0.5 shrink-0 text-chakra" />
            <p className="text-sm text-gray-400">
              Membership checkout is temporarily unavailable. A{' '}
              <Link to="/redeem" className="text-accent hover:underline">redeem code</Link> can still grant access.
            </p>
          </>
        )}
      </div>

      {flash && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {flash}
        </div>
      )}

      {/* Self-serve cancellation. Sits ABOVE the tier grid on purpose: a
          subscriber looking for the exit must not have to scroll past four
          upsells to find it (FTC negative-option rule / state ARL statutes). */}
      <ManageSubscriptionPanel className="mb-6" returnTo="/upgrade" />

      {trialRunning && activeTrial && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-leaf/40 bg-leaf/10 px-4 py-3">
          <div className="text-sm text-leaf">
            <span className="font-semibold">{trialTierName(activeTrial.tier)} trial active</span>
            {' · '}
            {trialDaysLeft(activeTrial)} day{trialDaysLeft(activeTrial) === 1 ? '' : 's'} left
            <span className="mt-0.5 block text-xs text-leaf/80">
              {activeTrial.cardOnFile
                ? 'Your paid month begins when the trial ends unless you cancel.'
                : 'No card is on file, so access returns to Free when the trial ends.'}
            </span>
          </div>
          <button
            onClick={declineActiveTrial}
            disabled={trialBusy}
            className="btn-ghost shrink-0 text-sm"
          >
            {trialBusy ? 'Cancelling...' : 'Cancel trial'}
          </button>
        </div>
      )}

      <section className="mb-8">
        <div className="mb-3">
          <h2 className="section-heading">Watch and browse</h2>
          <p className="mt-1 text-sm text-gray-500">Simple access for viewers and occasional creators.</p>
        </div>
        <div className="grid gap-3">
          {TIERS.slice(0, 1).map((tier) => renderTier(tier, true))}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="section-heading">Create, host, and grow</h2>
          <p className="mt-1 text-sm text-gray-500">The full TKO creation and community ladder.</p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
          {TIERS.slice(1).map((tier) => renderTier(tier))}
        </div>
      </section>

      <p className="mt-8 text-center text-sm text-gray-400">
        Have a code?{' '}
        <Link to="/redeem" className="text-accent hover:underline">Redeem a pass</Link>
        {' '}without entering a card.
      </p>
    </div>
  )
}
