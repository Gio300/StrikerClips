import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { CreatorPayoutsCard } from '@/components/CreatorPayoutsCard'
import { WinningsLedger } from '@/components/WinningsLedger'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'
import {
  GOAL_KINDS,
  goalCurrent,
  goalPercent,
  goalRemaining,
  loadActiveGoals,
  loadCreatorStats,
  removeGoal,
  setGoal,
  type CreatorGoal,
  type CreatorStats,
  type GoalKind,
} from '@/lib/creatorGoals'

/**
 * CREATOR / STREAMER DASHBOARD — /creator.
 *
 * A focused, real-time control panel for creators who run tournaments, host, and
 * stream. GATED to a PAID streaming tier (pro/supporter/creator). Free and the
 * ad-only ad_free tier see an upgrade screen instead — the same gate is enforced
 * server-side on goal-set / creator-stats, so the client gate is only UX.
 *
 * - GOALS: create/edit live goals (followers / sub points / donations / custom),
 *   each with a progress bar of CURRENT/target. CURRENT comes from the live
 *   `creator-stats` aggregate.
 * - STATS: a strip of real numbers, polled every 20s so it feels live.
 * - EARNINGS: reuses CreatorPayoutsCard + WinningsLedger.
 */

const STATS_POLL_MS = 20_000

export function CreatorDashboard() {
  const { user } = useAuth()
  const { isPremium } = useEntitlements()

  // ── PAID GATE ──────────────────────────────────────────────────────────────
  // isPremium is true only for a real paid streaming tier (pro/supporter/creator);
  // free '' and the ad-only ad_free tier resolve to false.
  if (!isPremium) return <UpgradeGate />

  if (!user) return null
  return <Dashboard userId={user.id} />
}

// ─────────────────────────────────────────────────────────────────────────────

function Dashboard({ userId }: { userId: string }) {
  const [goals, setGoals] = useState<CreatorGoal[]>([])
  const [stats, setStats] = useState<CreatorStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null)

  const reloadGoals = useCallback(async () => {
    setGoals(await loadActiveGoals(userId))
  }, [userId])

  const refreshStats = useCallback(async () => {
    const s = await loadCreatorStats()
    if (s) {
      setStats(s)
      setRefreshedAt(Date.now())
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function init() {
      await Promise.all([reloadGoals(), refreshStats()])
      if (!cancelled) setLoading(false)
    }
    void init()
    const timer = window.setInterval(refreshStats, STATS_POLL_MS)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [reloadGoals, refreshStats])

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
        <h1 className="text-2xl font-bold">Creator Dashboard</h1>
        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
          <span className={`h-2 w-2 rounded-full ${stats?.liveNow ? 'bg-leaf animate-pulse' : 'bg-gray-600'}`} />
          {stats?.liveNow ? 'Live now' : 'Offline'}
          {refreshedAt && <span className="text-gray-600">· updates every 20s</span>}
        </span>
      </div>
      <p className="text-gray-400 mb-6">
        Your goals, stats, and earnings — live. Hosting and tournaments run on this plan.
      </p>

      {/* ── STATS STRIP ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard label="Followers" value={stats?.followers} loading={loading} />
        <StatCard label="Gift subs" value={stats?.subPoints} loading={loading} />
        <StatCard label="Tips" value={stats?.donations} loading={loading} />
        <StatCard label="Produced" value={stats?.producedVideos} loading={loading} />
        <StatCard label="Power" value={stats?.powerLevel} loading={loading} />
        <StatCard
          label="Sweeps"
          value={stats ? stats.sweeps.toLocaleString() : undefined}
          loading={loading}
        />
      </div>

      {/* ── GOALS ─────────────────────────────────────────────────────────── */}
      <GoalsPanel goals={goals} stats={stats} onChange={async () => { await reloadGoals(); await refreshStats() }} />

      {/* ── EARNINGS (reused cards) ───────────────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-6 mt-6">
        <CreatorPayoutsCard paidTotalCents={stats?.donationCents ?? 0} pendingDonations={0} />
        <WinningsLedger userId={userId} />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

function GoalsPanel({
  goals,
  stats,
  onChange,
}: {
  goals: CreatorGoal[]
  stats: CreatorStats | null
  onChange: () => Promise<void> | void
}) {
  const [kind, setKind] = useState<GoalKind>('followers')
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Suggest a sensible default target/label for the picked kind from live stats.
  const suggested = useMemo(() => suggestTarget(kind, stats), [kind, stats])

  async function save() {
    const t = Math.floor(Number(target || suggested))
    if (!Number.isFinite(t) || t <= 0) { setError('Enter a positive target.'); return }
    setBusy(true)
    setError(null)
    const saved = await setGoal({ kind, label: label.trim(), target: t })
    setBusy(false)
    if (!saved) { setError('Could not save goal. A paid streaming plan is required.'); return }
    setLabel('')
    setTarget('')
    await onChange()
  }

  async function remove(id: string) {
    setBusy(true)
    await removeGoal(id)
    setBusy(false)
    await onChange()
  }

  return (
    <section className="rounded-xl border border-dark-border bg-dark-card p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold">Goals</h2>
        <span className="text-xs text-gray-500">{goals.length} active</span>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Set live targets your viewers can rally behind. One active goal per type.
      </p>

      {/* Live progress bars */}
      {goals.length === 0 ? (
        <div className="rounded-lg border border-dark-border bg-dark p-6 text-center text-sm text-gray-400 mb-4">
          No goals yet — add your first one below.
        </div>
      ) : (
        <div className="space-y-3 mb-5">
          {goals.map((g) => {
            const current = goalCurrent(g.kind, stats)
            const pct = goalPercent(current, g.target)
            const remaining = goalRemaining(current, g.target)
            const unit = unitFor(g.kind)
            return (
              <div key={g.id} className="rounded-lg border border-dark-border bg-dark p-3">
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-white text-sm truncate">{g.label}</span>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="tabular-nums text-sm text-gray-300">
                      {current != null ? current.toLocaleString() : '—'}
                      <span className="text-gray-500">/{g.target.toLocaleString()}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(g.id)}
                      disabled={busy}
                      className="text-xs text-gray-500 hover:text-kunai disabled:opacity-40"
                      aria-label={`Remove ${g.label}`}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="h-2.5 rounded-full bg-dark-border overflow-hidden">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-gray-400">
                  {g.kind === 'custom'
                    ? 'Custom goal — update the target as you go.'
                    : remaining > 0
                      ? `${remaining.toLocaleString()} ${unit} to go`
                      : 'Goal reached! 🎉'}
                </p>
              </div>
            )
          })}
        </div>
      )}

      {/* Add / edit a goal */}
      <div className="rounded-lg border border-dark-border bg-dark p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">Add or update a goal</p>
        <div className="grid sm:grid-cols-4 gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as GoalKind)}
            className="rounded-md border border-dark-border bg-dark-card px-3 py-2 text-sm text-white"
          >
            {GOAL_KINDS.map((k) => (
              <option key={k.id} value={k.id}>{k.label}</option>
            ))}
          </select>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            maxLength={120}
            className="sm:col-span-2 rounded-md border border-dark-border bg-dark-card px-3 py-2 text-sm text-white placeholder-gray-600"
          />
          <input
            type="number"
            min={1}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={suggested ? String(suggested) : 'Target'}
            className="rounded-md border border-dark-border bg-dark-card px-3 py-2 text-sm text-white placeholder-gray-600"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save goal'}
          </button>
          <span className="text-xs text-gray-500">{GOAL_KINDS.find((k) => k.id === kind)?.hint}</span>
        </div>
        {error && <p className="mt-2 text-xs text-kunai">{error}</p>}
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  UPGRADE GATE (free / ad_free)
// ─────────────────────────────────────────────────────────────────────────────

function UpgradeGate() {
  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="rounded-2xl border border-accent/30 bg-dark-card p-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
          <LockIcon className="h-7 w-7 text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-white">Upgrade to unlock the Creator Dashboard</h1>
        <p className="mt-3 text-gray-400">
          Hosting, tournaments, and goals need a paid plan. Go Pro to run streams, throw
          tournaments, and set live goals your viewers can rally behind.
        </p>
        <ul className="mt-5 mx-auto max-w-sm space-y-2 text-left text-sm text-gray-300">
          {['Live follower / sub / donation goals', 'Real-time creator stats', 'Host & run tournaments', 'Creator payouts'].map((f) => (
            <li key={f} className="flex items-center gap-2">
              <CheckIcon className="h-4 w-4 text-leaf shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        {!IS_MOBILE_STORE_BUILD && (
          <Link
            to="/upgrade"
            className="mt-6 inline-flex rounded-lg bg-accent px-6 py-3 text-sm font-semibold text-dark"
          >
            Upgrade my plan
          </Link>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers + inline SVG (no icon lib)
// ─────────────────────────────────────────────────────────────────────────────

function StatCard({ label, value, loading }: { label: string; value: number | string | undefined; loading: boolean }) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-100">
        {loading && value == null ? <span className="text-gray-600">—</span> : (value ?? 0)}
      </p>
    </div>
  )
}

function unitFor(kind: GoalKind): string {
  switch (kind) {
    case 'followers': return 'followers'
    case 'sub_points': return 'sub points'
    case 'donations': return 'tips'
    case 'custom': return ''
  }
}

/** A sensible default target: a little above the current value for that metric. */
function suggestTarget(kind: GoalKind, stats: CreatorStats | null): number {
  const cur = goalCurrent(kind, stats)
  if (cur == null) return 100
  if (cur <= 0) return 100
  // Round up to a friendly next milestone.
  const step = cur < 100 ? 25 : cur < 1000 ? 100 : 500
  return Math.ceil((cur + step) / step) * step
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
