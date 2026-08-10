import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Crown, Loader2, Mail } from 'lucide-react'
import { BrandLogo } from '@/components/BrandLogo'
import { LegalLinks } from '@/components/LegalFooter'
import { useAuth } from '@/hooks/useAuth'
import {
  LEAGUE_PLANS,
  MEMBER_RENDER_CAPS,
  isLeaguePlanId,
  leaguePlanPriceLabel,
  sellableCapabilities,
  type LeaguePlan,
  type LeaguePlanId,
} from '@/lib/leaguePlans'
import {
  canBuyLeaguePlan,
  captureLeagueLead,
  fetchLeaguePlansConfig,
  startLeagueCheckout,
  LEAGUE_PLANS_OFF,
  type LeaguePlansConfig,
} from '@/lib/leagueCheckout'
import { loadLeagueDraft, saveLeagueDraft, slugify, LEAGUE_SLUG_RE } from '@/lib/leagueConfig'

/**
 * LeaguePlans (`/league-plans`) — the step between "I want a league" and a
 * Stripe Checkout Session. This is the page that closes the gap the operator
 * named: league tiers existed in the schema and on the pricing cards, but there
 * was no way to actually buy one.
 *
 * THE FLOW
 *   gateway "Start your league"  ->  /league-plans?plan=pro
 *      -> (signed out) /signup, then straight back here
 *      -> name + slug + plan  ->  POST /api/league/checkout
 *      -> Stripe Checkout  ->  /studio?checkout=success&league=<slug>
 *
 * NOTHING HERE IS A DEAD END. Every plan renders whether or not Stripe is set
 * up. If the operator has not created the products yet, the same button
 * captures the prospect into `league_leads` and says so honestly, rather than
 * disappearing or throwing a 400. Enterprise deliberately never has a checkout.
 *
 * The bullets come from `sellableCapabilities()`, which filters out anything
 * marked `roadmap` in the catalogue — so this page physically cannot promise a
 * capability the product does not deliver.
 */

export default function LeaguePlans() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const draft = useMemo(() => loadLeagueDraft(), [])
  const [name, setName] = useState(() => (draft.name === 'TKO' ? '' : draft.name))
  const [slugEdited, setSlugEdited] = useState(false)
  const [slug, setSlug] = useState(() => (draft.slug === 'tko' ? '' : draft.slug))
  const [cfg, setCfg] = useState<LeaguePlansConfig>(LEAGUE_PLANS_OFF)
  const [busy, setBusy] = useState<LeaguePlanId | null>(null)
  const [error, setError] = useState('')
  const [captured, setCaptured] = useState<{ plan: string; email: string } | null>(null)

  const preselected = params.get('plan')
  const [selected, setSelected] = useState<LeaguePlanId>(
    isLeaguePlanId(preselected) ? preselected : 'pro',
  )
  const canceled = params.get('checkout') === 'cancel'

  useEffect(() => { void fetchLeaguePlansConfig().then(setCfg) }, [])

  // Keep the slug in step with the name until the owner takes it over — the
  // slug is a URL and the renderer's --league key, so it must stay legal.
  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name))
  }, [name, slugEdited])

  const slugOk = LEAGUE_SLUG_RE.test(slug)
  const detailsOk = name.trim().length > 0 && slugOk

  async function buy(plan: LeaguePlan) {
    setError('')
    if (!user) {
      // Come back here with the plan intact once they have an account.
      navigate('/signup', {
        state: {
          from: `/league-plans?plan=${plan.id}`,
          reason: 'Create your account to start your league — your plan is already picked.',
        },
      })
      return
    }
    if (!detailsOk) {
      setError('Give the league a name first — the slug becomes its address.')
      return
    }
    setBusy(plan.id)
    // Keep the Studio draft in step so the post-checkout Studio opens on the
    // league they just bought rather than an empty default.
    saveLeagueDraft({ name: name.trim(), slug })
    const res = await startLeagueCheckout({ plan: plan.id, leagueName: name.trim(), leagueSlug: slug })
    setBusy(null)
    if (!res.ok) { setError(res.error); return }
    if (res.kind === 'lead') {
      setCaptured({ plan: plan.name, email: user.email || 'your account email' })
      return
    }
    // Leave the SPA for Stripe.
    window.location.href = res.url
  }

  return (
    <div className="min-h-screen bg-dark-bg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link to="/make-a-league"><BrandLogo tko /></Link>
        <Link to="/studio" className="btn-ghost text-sm">Open the Studio</Link>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <section className="py-8 text-center md:py-12">
          <h1 className="text-3xl font-bold tracking-tight text-ink md:text-5xl">
            Start your league
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-muted">
            Pick a plan, name the league, and it is live in the Studio the moment you pay.
            Cancel any time from your billing portal.
          </p>
          {canceled && (
            <p className="mx-auto mt-4 max-w-xl rounded-lg border border-dark-border bg-dark-card/60 p-3 text-sm text-ink-muted">
              Checkout cancelled — nothing was charged. Your league name is still here when
              you are ready.
            </p>
          )}
        </section>

        {/* Identity first: a plan without a league name cannot be checked out. */}
        <section className="card mx-auto mb-8 max-w-2xl p-5">
          <h2 className="mb-3 font-bold text-ink">Your league</h2>
          <label className="block text-sm text-ink-muted" htmlFor="league-name">League name</label>
          <input
            id="league-name"
            className="input mt-1 w-full"
            value={name}
            maxLength={120}
            placeholder="Shinobi Striker League"
            onChange={(e) => setName(e.target.value)}
          />
          <label className="mt-4 block text-sm text-ink-muted" htmlFor="league-slug">Address</label>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-sm text-ink-muted">tko.cam/</span>
            <input
              id="league-slug"
              className="input w-full"
              value={slug}
              maxLength={63}
              placeholder="shinobistrikerleague"
              onChange={(e) => { setSlugEdited(true); setSlug(e.target.value.toLowerCase()) }}
            />
          </div>
          {slug && !slugOk && (
            <p className="mt-2 text-sm text-kunai">
              Lowercase letters, digits and hyphens only, and it can&apos;t start with a hyphen.
            </p>
          )}
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          {LEAGUE_PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              selected={selected === plan.id}
              onSelect={() => setSelected(plan.id)}
              purchasable={canBuyLeaguePlan(cfg, plan.id)}
              busy={busy === plan.id}
              onBuy={() => void buy(plan)}
              leagueName={name}
              leagueSlug={slug}
            />
          ))}
        </section>

        {error && (
          <p className="mx-auto mt-6 max-w-2xl rounded-lg border border-kunai/40 bg-kunai/10 p-3 text-center text-sm text-ink">
            {error}
          </p>
        )}

        {captured && (
          <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-accent/40 bg-accent/10 p-4 text-center">
            <p className="font-semibold text-ink">You&apos;re on the list for {captured.plan}.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Card payments for this plan aren&apos;t switched on yet. We have your details
              ({captured.email}) and your league name — we&apos;ll reach out the moment it opens.
            </p>
          </div>
        )}

        {/* The question every league owner asks next. Members ride the MEMBER
            ladder, so this is identical on every plan — saying so plainly beats
            letting them assume the league plan buys their players' quotas. */}
        <section className="mt-10 rounded-2xl border border-dark-border bg-dark-card/60 p-6">
          <h3 className="section-heading mb-1">What your members get</h3>
          <p className="mb-4 text-sm text-ink-muted">
            Members subscribe on their own account, not yours — every league plan includes the
            same member ladder. Free members ride free.
          </p>
          <div className="grid gap-2 sm:grid-cols-5">
            {MEMBER_RENDER_CAPS.map((m) => (
              <div key={m.label} className="card p-3 text-center">
                <p className="text-xs font-semibold uppercase tracking-widest text-ink-muted">{m.label}</p>
                <p className="mt-1 font-bold text-ink">{m.cap}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  {m.promoted ? 'front-page eligible' : 'own page only'}
                </p>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-10 text-center">
          <LegalLinks />
        </div>
      </main>
    </div>
  )
}

function PlanCard({
  plan, selected, onSelect, purchasable, busy, onBuy, leagueName, leagueSlug,
}: {
  plan: LeaguePlan
  selected: boolean
  onSelect: () => void
  purchasable: boolean
  busy: boolean
  onBuy: () => void
  leagueName: string
  leagueSlug: string
}) {
  const features = sellableCapabilities(plan.id)
  return (
    <div
      className={`card relative flex flex-col p-5 ${selected ? 'border-kunai shadow-kunai' : ''}`}
      onClick={onSelect}
    >
      <h4 className="text-lg font-bold text-ink">{plan.name}</h4>
      <p className="mt-1">
        <span className="text-3xl font-bold text-ink">{leaguePlanPriceLabel(plan)}</span>
        {plan.billingPeriod === 'month' && <span className="text-sm text-ink-muted">/mo</span>}
      </p>
      <p className="mt-2 text-sm text-ink-muted">{plan.blurb}</p>
      <ul className="mt-4 flex-1 space-y-2 text-sm text-ink-muted">
        {features.map((f) => (
          <li key={f.id} className="flex items-start gap-2" title={f.detail}>
            <Check size={15} className="mt-0.5 shrink-0 text-accent" />
            {f.label}
          </li>
        ))}
      </ul>

      {plan.purchasable ? (
        <button type="button" className="btn-primary mt-5 w-full" disabled={busy} onClick={onBuy}>
          {busy
            ? <><Loader2 size={15} className="animate-spin" /> Opening…</>
            : purchasable
              ? <><Crown size={15} /> Get {plan.name}</>
              // Honest label: this button still works, it just captures instead
              // of charging. Pretending it is disabled loses the lead.
              : <><Mail size={15} /> Join the list</>}
        </button>
      ) : (
        <EnterpriseCapture plan={plan} leagueName={leagueName} leagueSlug={leagueSlug} />
      )}
    </div>
  )
}

/**
 * Enterprise has no checkout by design, so the card IS the lead form. Works
 * signed out — asking someone to create an account before we will take their
 * email is how an enterprise lead evaporates.
 */
function EnterpriseCapture({
  plan, leagueName, leagueSlug,
}: { plan: LeaguePlan; leagueName: string; leagueSlug: string }) {
  const { user } = useAuth()
  const [email, setEmail] = useState(user?.email || '')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [msg, setMsg] = useState('')

  async function send() {
    setState('busy')
    const r = await captureLeagueLead({
      email: email.trim(),
      plan: plan.id,
      leagueName: leagueName.trim(),
      leagueSlug: LEAGUE_SLUG_RE.test(leagueSlug) ? leagueSlug : undefined,
    })
    if (r.ok) { setState('done'); return }
    setState('error')
    setMsg(r.error || 'Could not save your details')
  }

  if (state === 'done') {
    return (
      <p className="mt-5 rounded-lg border border-accent/40 bg-accent/10 p-3 text-center text-sm text-ink">
        Got it — we&apos;ll be in touch.
      </p>
    )
  }
  return (
    <div className="mt-5">
      <input
        className="input w-full"
        type="email"
        value={email}
        placeholder="you@yourleague.com"
        onChange={(e) => setEmail(e.target.value)}
      />
      <button
        type="button"
        className="btn-ghost mt-2 w-full"
        disabled={state === 'busy' || !email.trim()}
        onClick={() => void send()}
      >
        {state === 'busy'
          ? <><Loader2 size={15} className="animate-spin" /> Sending…</>
          : <>Talk to us <ArrowRight size={15} /></>}
      </button>
      {state === 'error' && <p className="mt-2 text-xs text-kunai">{msg}</p>}
    </div>
  )
}
