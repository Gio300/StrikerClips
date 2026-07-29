import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BadgePercent,
  Coins,
  Crown,
  Gem,
  Gift,
  ShoppingBag,
  Sparkles,
  Store as StoreIcon,
  Trophy,
  WalletCards,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { DAILY_BONUS_SWEEPS } from '@/lib/sweepstakes'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { TOKEN_PACKS, type TokenPack } from '@/lib/tokenPacks'
import {
  requestCheckout,
  fetchPaymentsConfig,
  canBuyPack,
  PAYMENTS_OFF,
  type PaymentsConfig,
} from '@/lib/payments'
import { CREATOR_PRICE_CENTS, formatUsd } from '@/lib/creatorCommerce'
import { startPaidSweepsCheckout } from '@/lib/creatorCommerceApi'

/**
 * Store - buy Tokens and receive bonus Give Points.
 *
 * BUYING IS REAL. `purchasePack` opens a Stripe Checkout Session via
 * POST /api/checkout and redirects to Stripe. Nothing is credited here: the
 * wallet is credited by the signature-verified webhook (`checkout.session
 * .completed`), which looks the token amount up in the SERVER's own pack
 * catalogue and books a wallet_ledger row. So the client cannot credit itself
 * even if this file were tampered with.
 *
 * THREE HONEST STATES, no fourth:
 *   • payments configured  -> a working "Buy" button
 *   • payments not enabled -> a disabled button and a visible notice
 *   • signed out           -> a sign-in prompt
 * There is deliberately no state in which a button appears to work and hands
 * out a free credit — that was the old "Buy (test)" behaviour and it became a
 * live money-printing bug the moment wallets moved to Postgres.
 *
 * The one credit a user can initiate is the free daily Give Points grant, applied
 * server-side and guarded by a ledger row.
 *
 * Giving-model framing baked into the copy:
 *   • Tokens are a UTILITY currency — bought, spent on platform features, and
 *     NEVER cashable / redeemable for money.
 *   - Give Points are free support points. They build prestige and are never
 *     redeemable for cash.
 *
 * Pack contents come from src/lib/tokenPacks.ts, which server/app.ts mirrors and
 * server/app.test.ts asserts identical — the price shown here and the tokens
 * delivered by the webhook can never drift apart.
 */

function fmtPrice(n: number): string {
  return `$${n.toFixed(2)}`
}

const PACK_ICONS: Record<string, LucideIcon> = {
  starter: Coins,
  plus: Zap,
  pro: Gem,
  mega: Crown,
}

export function Store() {
  const { user } = useAuth()
  const { tokens, sweeps, paid_sweeps_cents: paidSweepsCents, claimDaily, refresh } = useWallet()
  const [flash, setFlash] = useState<string | null>(null)
  const [canClaim, setCanClaim] = useState(true)
  const [claiming, setClaiming] = useState(false)
  const [payments, setPayments] = useState<PaymentsConfig>(PAYMENTS_OFF)
  const [buying, setBuying] = useState<string | null>(null)
  const [buyingCredits, setBuyingCredits] = useState<number | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  // A new sign-in may well have a claim available again.
  useEffect(() => { setCanClaim(true) }, [user?.id])

  // Is billing switched on for this deploy? Decides whether the pack buttons
  // are live or show the "not enabled" state.
  useEffect(() => {
    let alive = true
    void fetchPaymentsConfig().then((cfg) => { if (alive) setPayments(cfg) })
    return () => { alive = false }
  }, [])

  // Coming back from Stripe. The wallet is credited by the WEBHOOK, not by this
  // redirect, so we simply re-read the authoritative balance — and say "should
  // appear" rather than a number, because the webhook may land a beat later.
  useEffect(() => {
    const status = searchParams.get('checkout')
    const creditsStatus = searchParams.get('credits')
    if (!status && !creditsStatus) return
    if (creditsStatus === 'success') {
      void refresh()
      showFlash('Payment received - your paid Sweeps Credits will appear momentarily.')
      const t = setTimeout(() => { void refresh() }, 2500)
      cleanCheckoutParams()
      return () => clearTimeout(t)
    }
    if (creditsStatus === 'cancel') {
      showFlash('Paid-credit checkout cancelled - you were not charged.')
      cleanCheckoutParams()
      return
    }
    if (status === 'success') {
      void refresh()
      showFlash('Payment received — your Tokens will appear in your balance momentarily.')
      // Re-read shortly after: the webhook usually lands within a second or two.
      const t = setTimeout(() => { void refresh() }, 2500)
      cleanCheckoutParams()
      return () => clearTimeout(t)
    }
    if (status === 'cancel') showFlash('Checkout cancelled — you were not charged.')
    cleanCheckoutParams()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  /** Drop the Stripe redirect params so a refresh doesn't re-flash. */
  function cleanCheckoutParams() {
    const next = new URLSearchParams(searchParams)
    next.delete('checkout')
    next.delete('credits')
    next.delete('session_id')
    setSearchParams(next, { replace: true })
  }

  function showFlash(msg: string) {
    setFlash(msg)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 3500)
  }

  // Free daily support grant. The server
  // decides whether today's claim is still available; we just report the answer.
  async function handleClaimDaily() {
    setClaiming(true)
    try {
      const granted = await claimDaily()
      setCanClaim(false)
      showFlash(granted
        ? `Claimed ${DAILY_BONUS_SWEEPS} free Give Points`
        : "Today's free Give Points have already been claimed. Come back tomorrow.")
    } finally {
      setClaiming(false)
    }
  }

  /**
   * Buy a pack. Opens a real Stripe Checkout Session and redirects.
   *
   * NOTHING IS CREDITED HERE. The wallet moves only when Stripe calls our
   * webhook back with a signed `checkout.session.completed`, and even then the
   * token amount is read from the server's catalogue rather than from anything
   * this page sent.
   */
  async function purchasePack(pack: TokenPack) {
    if (!canBuyPack(payments, pack.id)) {
      showFlash('Payments are not enabled on this deploy yet — nothing was charged or credited.')
      return
    }
    setBuying(pack.id)
    try {
      const result = await requestCheckout({ pack: pack.id })
      if (result.ok) {
        window.location.href = result.url
        return
      }
      showFlash(result.notConfigured
        ? 'Payments are not enabled on this deploy yet — nothing was charged or credited.'
        : (result.error || 'Could not start checkout — please try again.'))
    } finally {
      setBuying(null)
    }
  }

  async function purchasePaidSweeps(amountCents: number) {
    setBuyingCredits(amountCents)
    try {
      const result = await startPaidSweepsCheckout(amountCents)
      if (result.ok && result.data?.url) {
        window.location.href = result.data.url
        return
      }
      showFlash(result.error || 'Could not start paid-credit checkout.')
    } finally {
      setBuyingCredits(null)
    }
  }

  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Store</h1>
        <p className="text-gray-400 mb-4">Sign in to view your balance and buy Tokens.</p>
        <Link to="/login" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Sign in</Link>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-6 grid grid-cols-2 gap-1 rounded-lg border border-dark-border bg-dark-card p-1">
        <div className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-dark-elevated text-sm font-semibold text-white">
          <Coins size={17} />
          Wallet & packs
        </div>
        <Link
          to="/shop"
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold text-gray-400 hover:bg-dark-elevated hover:text-white"
        >
          <ShoppingBag size={17} />
          Marketplace
        </Link>
      </div>

      {/* Billing state — say plainly which of the two worlds we're in. */}
      {payments.configured ? (
        <div className="mb-6 rounded-lg border border-leaf/40 bg-leaf/10 px-4 py-2 text-xs text-leaf">
          Secure checkout by Stripe. Tokens are credited to your wallet once your payment is confirmed.
        </div>
      ) : (
        <div className="mb-6 rounded-lg border border-chakra/40 bg-chakra/10 px-4 py-2 text-xs text-chakra">
          Payments are not enabled on this deploy yet — Token packs cannot be purchased. Your free daily
          Give Points below still work.
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-accent">
            <StoreIcon size={15} />
            TKO Wallet
          </div>
          <h1 className="text-2xl font-bold">Tokens & Give Points</h1>
          <p className="text-sm text-gray-500 mt-1">
            Tokens unlock marketplace items and platform features. Give Points support people, clans, and events.
          </p>
        </div>
        {/* Current balance */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-dark-border bg-dark-card px-4 py-2">
            <div className="flex items-center gap-1.5 text-lg font-bold text-accent"><Coins size={17} />{tokens.toLocaleString()}</div>
            <div className="text-[11px] uppercase tracking-wide text-gray-500">Tokens</div>
          </div>
          <div className="rounded-lg border border-trust/40 bg-trust/5 px-4 py-2">
            <div className="flex items-center gap-1.5 text-lg font-bold text-trust">
              <WalletCards size={17} />
              {formatUsd(paidSweepsCents)}
            </div>
            <div className="text-[11px] text-gray-500">Paid Sweeps Credits</div>
          </div>
          <div className="rounded-lg border border-dark-border bg-dark-card px-4 py-2">
            <div className="flex items-center gap-1.5 text-lg font-bold text-leaf"><Gift size={17} />{sweeps.toLocaleString()}</div>
            <div className="text-[11px] text-gray-500">Give Points</div>
          </div>
        </div>
      </div>

      {flash && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {flash}
        </div>
      )}

      {/* Free daily Give Points. */}
      <div className="mb-6 rounded-lg border border-leaf/40 bg-leaf/5 p-5 flex flex-wrap items-center gap-4">
        <Gift size={24} className="shrink-0 text-leaf" />
        <div className="min-w-0">
          <h2 className="font-semibold text-leaf">Claim daily Give Points</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Get {DAILY_BONUS_SWEEPS} free points every day. Give them to clans, tournaments, and creators
            to build your supporter prestige.
          </p>
        </div>
        <button
          onClick={handleClaimDaily}
          disabled={!canClaim || claiming}
          className={`ml-auto shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
            canClaim
              ? 'bg-leaf text-dark hover:bg-leaf/90 disabled:opacity-60'
              : 'border border-leaf/40 bg-leaf/10 text-leaf cursor-default'
          }`}
        >
          {claiming
            ? 'Claiming…'
            : canClaim ? `Claim ${DAILY_BONUS_SWEEPS} points` : 'Claimed today'}
        </button>
      </div>

      <CollapsibleSection
        id="paid-sweeps-credits"
        label="Paid Sweeps Credits"
        hint="30% off eligible creator and clan items"
      >
        <div className="rounded-lg border border-trust/35 bg-trust/5 p-4">
          <div className="flex items-start gap-3">
            <BadgePercent size={22} className="mt-0.5 shrink-0 text-trust" />
            <div>
              <h2 className="font-semibold text-white">Fund your marketplace balance</h2>
              <p className="mt-1 text-sm text-gray-400">
                These purchased credits are separate from free Give Points. Eligible creator and
                clan items cost 30% less when paid with this balance.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {CREATOR_PRICE_CENTS.map((amountCents) => (
              <button
                key={amountCents}
                type="button"
                onClick={() => void purchasePaidSweeps(amountCents)}
                disabled={buyingCredits != null}
                className="min-h-11 rounded-lg border border-trust/45 bg-dark-card px-2 text-sm font-semibold text-trust hover:bg-trust/10 disabled:opacity-50"
              >
                {buyingCredits === amountCents ? 'Opening...' : formatUsd(amountCents)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Paid credits are not cashable and cannot be transferred. Free Give Points never fund
            creator payouts.
          </p>
        </div>
      </CollapsibleSection>

      {/* Token packs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {TOKEN_PACKS.map((pack) => {
          const PackIcon = PACK_ICONS[pack.id] ?? Coins
          return (
          <div
            key={pack.id}
            className="relative rounded-lg border border-dark-border bg-dark-card p-5 flex flex-col hover:border-accent/50 transition-colors"
          >
            {pack.tag && (
              <span className="absolute -top-2 right-4 rounded-full bg-gradient-kunai px-2 py-0.5 text-[10px] font-bold text-dark uppercase tracking-wide">
                {pack.tag}
              </span>
            )}
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <PackIcon size={21} />
              </span>
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-accent">{pack.tokens.toLocaleString()}</span>
                  <span className="text-sm text-gray-400">Tokens</span>
                </div>
                <p className="text-xs text-gray-500">{pack.id[0].toUpperCase() + pack.id.slice(1)} pack</p>
              </div>
            </div>
            <div className="mt-4 space-y-1.5 text-sm">
              <p className="flex items-center gap-2 text-gray-300"><ShoppingBag size={14} className="text-accent" />Spend in creator and clan shops</p>
              <p className="flex items-center gap-2 text-leaf"><Gift size={14} />Includes {pack.bonusSweeps.toLocaleString()} bonus Give Points</p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-lg font-semibold text-white">{fmtPrice(pack.priceUsd)}</span>
              {canBuyPack(payments, pack.id) ? (
                <button
                  onClick={() => purchasePack(pack)}
                  disabled={buying !== null}
                  title={`Buy ${pack.tokens.toLocaleString()} Tokens for ${fmtPrice(pack.priceUsd)}`}
                  className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold hover:shadow-glow disabled:opacity-50"
                >
                  {buying === pack.id ? 'Opening checkout…' : 'Buy'}
                </button>
              ) : (
                <button
                  disabled
                  title="Payments are not enabled on this deploy yet"
                  className="px-4 py-2 rounded-lg border border-dark-border bg-dark-elevated text-gray-500 text-sm font-semibold cursor-not-allowed"
                >
                  Unavailable
                </button>
              )}
            </div>
          </div>
          )
        })}
      </div>

      {/* Oracle predictions — cosmetic-reward guessing, no wager/odds/cash flow. */}
      <div className="mt-8 rounded-lg border border-trust/30 bg-trust/5 p-5">
        <div className="flex items-center gap-2">
          <Sparkles size={19} className="text-trust" />
          <h2 className="text-lg font-semibold">Oracle calls</h2>
        </div>
        <p className="mt-2 text-sm text-gray-400">
          Call the winner of a tournament. Correct calls earn you
          <span className="text-gray-300"> cosmetic gear, power, and Oracle badges</span> — never cash.
          Calls are free; your tier sets how many can be open at once.
        </p>
        <Link
          to="/oracle"
          className="mt-3 inline-flex items-center gap-2 rounded-lg bg-trust px-4 py-2 text-sm font-semibold text-dark hover:brightness-110"
        >
          <Trophy size={16} />
          Open the Oracle hub
        </Link>
      </div>

      {/* What each currency is — plain-language copy (giving/prestige model). */}
      <div className="mt-8">
        <CollapsibleSection id="store-more" label="More" hint="What the currencies are">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-dark-border bg-dark-card p-4">
              <h3 className="font-semibold text-accent mb-1">Tokens</h3>
              <p className="text-gray-400">
                A utility currency you buy. Spend them on team gear, profile customization and platform
                features. Tokens have <span className="text-gray-300">no cash value</span> and are never
                redeemable for money.
              </p>
            </div>
            <div className="rounded-lg border border-dark-border bg-dark-card p-4">
              <h3 className="font-semibold text-leaf mb-1">Give Points</h3>
              <p className="text-gray-400">
                Free points you earn and give. Use them to <span className="text-gray-300">support clans,
                sponsor tournaments, and back creators</span> — you earn supporter prestige for giving.
                They are not cashable and never pay out money.
              </p>
            </div>
          </div>
        </CollapsibleSection>
      </div>

      {/* Disclaimer — giving/prestige model, no cash payouts. */}
      <p className="mt-8 text-xs text-gray-500 text-center">
        Tokens and Give Points have no cash value and never pay out money. TKO
        rewards giving and prestige, not gambling.
      </p>
    </div>
  )
}
