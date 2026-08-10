/**
 * LeagueUrlPanel — "Your league's address", the Studio surface where the URL
 * tier becomes something you can SEE (operator 2026-08-04: "users can attach
 * their website name to our app if they pay for that level on TKO for their
 * branding.. or they just get tko.cam/their league name").
 *
 * Three rungs, always all three, in tier order:
 *   1. tko.cam/<slug>      — live for every plan, with a copy button
 *   2. <slug>.tko.cam      — Pro League and up
 *   3. their own domain    — the top plan: claim → TXT record → verify
 *
 * LOCKED DOES NOT MEAN HIDDEN — the same rule the Forge follows. A rung above
 * the league's tier still renders its real address, greyed, with the tier chip
 * and an "Unlock — upgrade your account" CTA underneath, so an owner can see
 * exactly what the next plan buys before deciding to buy it. The CTA points at
 * /leagues/plans (the LEAGUE pricing board), not /upgrade (the member
 * streaming tiers) — two different ladders, two different checkouts.
 *
 * The real gate is server-side: /api/fn/league-url-* checks `leagues.tier` from
 * the database and the host gate in server/index.ts redirects an unentitled
 * hostname down to the path rung. Everything here is honest UI, never the
 * enforcement.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Copy, Globe, Link2, Lock, RefreshCw } from 'lucide-react'
import {
  bestUrlRung,
  canUseUrlRung,
  leagueTier,
  leagueUrlForRung,
  leagueUrlPreview,
  normalizeCustomDomain,
  urlRungTierName,
  type LeagueUrlRung,
} from '@/lib/leagueUrls'
import {
  claimLeagueDomain,
  fetchLeagueUrlState,
  releaseLeagueDomain,
  verifyLeagueDomain,
  type LeagueUrlState,
} from '@/lib/leagueUrlApi'
import type { LeagueConfig } from '@/lib/leagueConfig'

const RUNG_LABEL: Record<LeagueUrlRung, string> = {
  path: 'TKO address',
  subdomain: 'Your own subdomain',
  custom: 'Your own domain',
}

const RUNG_BLURB: Record<LeagueUrlRung, string> = {
  path: 'Included with every plan. Share it today — the whole app opens wearing your league.',
  subdomain: 'A shorter address on TKO, with your league name up front.',
  custom: 'The domain you already own points at your league app. Nothing says TKO.',
}

export function LeagueUrlPanel({
  cfg,
  /**
   * Signed in AND (probably) able to manage this league. The SERVER decides
   * for real — a 403/404 just leaves `state` null and the panel falls back to
   * the draft-derived preview, which is the right thing to show someone who
   * hasn't saved their league yet.
   */
  canManage,
  /** Bumped by the Studio after a save, to re-pull the real state. */
  reloadKey = 0,
}: {
  cfg: LeagueConfig
  canManage: boolean
  reloadKey?: number
}) {
  const [state, setState] = useState<LeagueUrlState | null>(null)
  const [domain, setDomain] = useState('')
  const [busy, setBusy] = useState<'' | 'claim' | 'verify' | 'release'>('')
  const [note, setNote] = useState('')

  const slug = cfg.slug
  // A league row we can manage is what unlocks the rung-3 controls.
  const saved = state !== null

  const load = useCallback(async () => {
    if (!canManage || !slug) {
      setState(null)
      return
    }
    const r = await fetchLeagueUrlState(slug)
    setState(r.state)
    if (r.state) setDomain(r.state.custom_domain)
  }, [canManage, slug])

  useEffect(() => { void load() }, [load, reloadKey])

  // The server's answer is the truth; before a save (or if it's unreachable)
  // the draft still produces an honest preview — leagueUrls.ts is pure.
  const tier = leagueTier(state?.tier ?? cfg.tier)
  // The PAID column, never the draft: `tier` is a Studio radio button, but a
  // rung only unlocks once plan_status says money (or an operator comp) stands
  // behind it. Before the league is saved there is no server answer, so the
  // preview honestly shows the unpaid state.
  const planStatus = state?.plan_status ?? cfg.plan_status ?? 'none'
  const urlFor = (rung: LeagueUrlRung) =>
    state?.rungs?.[rung]?.url ??
    leagueUrlForRung(rung, {
      slug,
      tier,
      planStatus,
      customDomain: state?.custom_domain ?? '',
      customDomainStatus: state?.custom_domain_status ?? 'none',
    })

  async function run(kind: 'claim' | 'verify' | 'release') {
    if (!saved || !slug) return
    setBusy(kind)
    setNote('')
    const r =
      kind === 'claim' ? await claimLeagueDomain(slug, domain)
      : kind === 'verify' ? await verifyLeagueDomain(slug)
      : await releaseLeagueDomain(slug)
    setBusy('')
    if (r.state) {
      setState(r.state)
      setDomain(r.state.custom_domain)
    }
    setNote(
      r.error ||
      (kind === 'claim' ? 'Add the TXT record below at your registrar, then check it.'
        : kind === 'verify' ? 'Verified — your domain is live.'
        : 'Domain released.'),
    )
  }

  const best = bestUrlRung(tier, planStatus)

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-muted">
        Every league gets an address on TKO. Bigger plans get shorter ones.
      </p>

      {(['path', 'subdomain', 'custom'] as LeagueUrlRung[]).map((rung) => {
        const unlocked = canUseUrlRung(rung, tier, planStatus)
        // LOCKED RUNGS STILL SHOW THEIR ADDRESS. An owner weighing an upgrade
        // should read the exact URL the next plan hands them, greyed out —
        // not a dash (the Forge's "see what the tier buys" rule).
        const url = unlocked
          ? urlFor(rung)
          : leagueUrlPreview(rung, slug, state?.custom_domain || cfg.domain)
        return (
          <RungCard
            key={rung}
            rung={rung}
            unlocked={unlocked}
            live={unlocked && rung === best}
            url={url}
          >
            {rung === 'custom' && (
              <CustomDomainFields
                unlocked={unlocked}
                saved={saved}
                busy={busy}
                domain={domain}
                setDomain={setDomain}
                state={state}
                onRun={run}
              />
            )}
          </RungCard>
        )
      })}

      {note && <p className="text-xs text-ink-muted">{note}</p>}
      {!saved && (
        <p className="text-[11px] text-ink-muted/80">
          {canManage
            ? 'Save your league to claim these addresses.'
            : 'Sign in and save your league to claim these addresses.'}
        </p>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────

function RungCard({
  rung,
  unlocked,
  live,
  url,
  children,
}: {
  rung: LeagueUrlRung
  unlocked: boolean
  live: boolean
  url: string | null
  children?: React.ReactNode
}) {
  const Icon = rung === 'custom' ? Globe : Link2
  return (
    <section className="rounded-xl border border-dark-border bg-dark-card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          <Icon size={13} />
          {RUNG_LABEL[rung]}
        </span>
        {live && <span className="pill-chakra text-[10px]">Live</span>}
        {!unlocked && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted/80">
            <Lock size={12} />
            {urlRungTierName(rung)} perk
          </span>
        )}
      </div>

      <div className={unlocked ? '' : 'opacity-60'}>
        <UrlLine url={url} copyable={unlocked && !!url} />
        <p className="mt-1 text-[11px] text-ink-muted/90">{RUNG_BLURB[rung]}</p>
        {children}
      </div>

      {!unlocked && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-chakra/40 bg-chakra/5 px-3 py-2">
          <span className="text-xs text-ink-muted">
            {RUNG_LABEL[rung]} unlocks with {urlRungTierName(rung)}.
          </span>
          <Link
            to="/league-plans"
            className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-dark hover:shadow-glow"
          >
            Unlock — upgrade your account
          </Link>
        </div>
      )}
    </section>
  )
}

/** A monospace address with a copy button (or a placeholder when there isn't one). */
function UrlLine({ url, copyable }: { url: string | null; copyable: boolean }) {
  const [copied, setCopied] = useState(false)
  if (!url) {
    return <div className="truncate rounded-lg bg-black/20 px-2.5 py-1.5 font-mono text-xs text-ink-muted/70">—</div>
  }
  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate rounded-lg bg-black/20 px-2.5 py-1.5 font-mono text-xs text-ink">
        {url.replace(/^https:\/\//, '')}
      </span>
      {copyable && (
        <button
          type="button"
          aria-label="Copy address"
          onClick={() => {
            try {
              void navigator.clipboard?.writeText(url)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            } catch { /* clipboard blocked — the text is selectable anyway */ }
          }}
          className="shrink-0 rounded-lg border border-dark-border p-1.5 text-ink-muted hover:text-ink"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      )}
    </div>
  )
}

/**
 * RUNG 3's flow: type the domain → Claim → publish ONE TXT record → Check.
 * The record is rendered verbatim from the server's answer, so the Studio and
 * the verifier can never disagree about what proof looks like.
 */
function CustomDomainFields({
  unlocked,
  saved,
  busy,
  domain,
  setDomain,
  state,
  onRun,
}: {
  unlocked: boolean
  saved: boolean
  busy: '' | 'claim' | 'verify' | 'release'
  domain: string
  setDomain: (v: string) => void
  state: LeagueUrlState | null
  onRun: (kind: 'claim' | 'verify' | 'release') => void
}) {
  const status = state?.custom_domain_status ?? 'none'
  const record = state?.verification ?? null
  const ready = unlocked && saved
  const clean = normalizeCustomDomain(domain)

  return (
    <div className="mt-2.5 space-y-2">
      <div className="flex gap-2">
        <input
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          disabled={!ready || busy !== ''}
          placeholder="yourleague.com"
          aria-label="Your domain"
          className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-2.5 py-1.5 text-sm text-ink disabled:opacity-60"
        />
        <button
          type="button"
          disabled={!ready || !clean || busy !== ''}
          onClick={() => onRun('claim')}
          className="shrink-0 rounded-lg border border-dark-border px-3 py-1.5 text-xs font-semibold text-ink disabled:opacity-50"
        >
          {busy === 'claim' ? 'Claiming…' : status === 'none' ? 'Claim' : 'Re-check'}
        </button>
      </div>

      {status === 'verified' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink">
          <span className="pill-chakra text-[10px]">Verified</span>
          <span className="text-ink-muted">{state?.custom_domain}</span>
          <button
            type="button"
            disabled={busy !== ''}
            onClick={() => onRun('release')}
            className="ml-auto text-[11px] text-ink-muted underline hover:text-ink"
          >
            Release
          </button>
        </div>
      )}

      {status === 'pending' && record && (
        <div className="space-y-2 rounded-lg border border-dark-border bg-black/20 p-2.5">
          <p className="text-[11px] text-ink-muted">
            Add this record at your domain registrar, then check it. DNS can take
            up to an hour.
          </p>
          <dl className="space-y-1 font-mono text-[11px] text-ink">
            <RecordRow label="Type" value={record.type} />
            <RecordRow label="Name" value={record.name} />
            <RecordRow label="Value" value={record.value} />
          </dl>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy !== ''}
              onClick={() => onRun('verify')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-dark disabled:opacity-50"
            >
              <RefreshCw size={12} className={busy === 'verify' ? 'animate-spin' : ''} />
              {busy === 'verify' ? 'Checking…' : 'Check verification'}
            </button>
            <button
              type="button"
              disabled={busy !== ''}
              onClick={() => onRun('release')}
              className="text-[11px] text-ink-muted underline hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-12 shrink-0 text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-all text-ink">{value}</dd>
    </div>
  )
}
