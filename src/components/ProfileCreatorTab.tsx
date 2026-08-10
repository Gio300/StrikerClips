import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  goalCurrent,
  goalPercent,
  goalRemaining,
  loadActiveGoals,
  loadCreatorStats,
  type CreatorGoal,
  type CreatorStats,
  type GoalKind,
} from '@/lib/creatorGoals'

/**
 * PROFILE "STATS" TAB — a read-friendly surface for creator goals + stats that
 * lives next to About on the profile page. It REUSES the creatorGoals lib (the
 * same data as the full Creator Dashboard at /creator) without touching it:
 *
 * - OWN profile + PAID streaming tier (isPremium): live stats strip + goals with
 *   real-time progress bars (polled every 20s), plus a link to the full dashboard
 *   to add / edit goals.
 * - OWN profile + free / ad_free: a compact upgrade prompt → /upgrade.
 * - SOMEONE ELSE'S profile: their PUBLIC goals (creator_goals is public-read) as
 *   read-only progress bars — no private stats.
 */

const STATS_POLL_MS = 20_000

export function ProfileCreatorTab({
  userId,
  isOwnProfile,
  isPremium,
  powerLevel,
}: {
  userId: string
  isOwnProfile: boolean
  isPremium: boolean
  powerLevel: number
}) {
  const [goals, setGoals] = useState<CreatorGoal[]>([])
  const [stats, setStats] = useState<CreatorStats | null>(null)
  const [loading, setLoading] = useState(true)

  // Live private stats only exist for the signed-in creator on a paid plan; the
  // server aggregate is paid-gated and self-only, so other profiles show goals
  // (public-read) with no current value.
  const showStats = isOwnProfile && isPremium

  useEffect(() => {
    if (isOwnProfile && !isPremium) {
      setLoading(false)
      return
    }
    let cancelled = false
    let timer: number | undefined
    async function init() {
      const tasks: Promise<unknown>[] = [
        loadActiveGoals(userId).then((g) => { if (!cancelled) setGoals(g) }),
      ]
      if (showStats) {
        tasks.push(loadCreatorStats().then((s) => { if (!cancelled && s) setStats(s) }))
      }
      await Promise.all(tasks)
      if (!cancelled) setLoading(false)
    }
    void init()
    if (showStats) {
      timer = window.setInterval(async () => {
        const s = await loadCreatorStats()
        if (!cancelled && s) setStats(s)
      }, STATS_POLL_MS)
    }
    return () => { cancelled = true; if (timer) window.clearInterval(timer) }
  }, [userId, isOwnProfile, isPremium, showStats])

  // Free / ad_free on your OWN profile — compact upgrade nudge.
  if (isOwnProfile && !isPremium) {
    return (
      <div className="space-y-4">
        <PowerEvidenceCard powerLevel={powerLevel} />
        <div className="rounded-2xl border border-accent/30 bg-dark-card p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
            <LockIcon className="h-6 w-6 text-accent" />
          </div>
          <h2 className="text-lg font-bold text-white">Unlock creator goals &amp; stats</h2>
          <p className="mt-2 text-sm text-gray-400">
            Set live follower / sub / donation goals your viewers can rally behind, and watch your
            real-time creator stats. Available on a paid streaming plan.
          </p>
          <Link
            to="/upgrade"
            className="mt-4 inline-flex rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-dark"
          >
            Upgrade to unlock
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PowerEvidenceCard powerLevel={powerLevel} />

      {/* ── STATS STRIP (own + paid only) ─────────────────────────────────── */}
      {showStats && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
      )}

      {/* ── GOALS ─────────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-dark-border bg-dark-card p-5">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold">Goals</h2>
          <span className="text-xs text-gray-500">{goals.length} active</span>
        </div>
        <p className="text-sm text-gray-400 mb-4">
          {isOwnProfile
            ? 'Live targets your viewers can rally behind.'
            : 'Live targets this creator is chasing — cheer them on.'}
        </p>

        {loading ? (
          <div className="rounded-lg border border-dark-border bg-dark p-6 text-center text-sm text-gray-500">
            Loading goals…
          </div>
        ) : goals.length === 0 ? (
          <div className="rounded-lg border border-dark-border bg-dark p-6 text-center text-sm text-gray-400">
            {isOwnProfile ? 'No goals yet — add one in the Creator Dashboard.' : 'No active goals right now.'}
          </div>
        ) : (
          <div className="space-y-3">
            {goals.map((g) => {
              const current = goalCurrent(g.kind, stats)
              const pct = goalPercent(current, g.target)
              const remaining = goalRemaining(current, g.target)
              const unit = unitFor(g.kind)
              return (
                <div key={g.id} className="rounded-lg border border-dark-border bg-dark p-3">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="font-semibold text-white text-sm truncate">{g.label}</span>
                    <span className="tabular-nums text-sm text-gray-300 shrink-0">
                      {current != null ? current.toLocaleString() : '—'}
                      <span className="text-gray-500">/{g.target.toLocaleString()}</span>
                    </span>
                  </div>
                  <div className="h-2.5 rounded-full bg-dark-border overflow-hidden">
                    <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                  </div>
                  {/* Progress copy only when we have a live current value (own + paid). */}
                  {current != null && (
                    <p className="mt-1.5 text-xs text-gray-400">
                      {g.kind === 'custom'
                        ? 'Custom goal.'
                        : remaining > 0
                          ? `${remaining.toLocaleString()} ${unit} to go`
                          : 'Goal reached! 🎉'}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Own + paid: jump to the full dashboard to add / edit goals + earnings. */}
        {showStats && (
          <Link
            to="/creator"
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            Open Creator Dashboard →
          </Link>
        )}
      </section>
    </div>
  )
}

function PowerEvidenceCard({ powerLevel }: { powerLevel: number }) {
  return (
    <section className="rounded-xl border border-dark-border bg-dark-card p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Power level</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-white">{Math.max(0, powerLevel).toLocaleString()}</p>
        </div>
        <span className="rounded-md border border-leaf/30 bg-leaf/10 px-2 py-1 text-[11px] font-semibold text-leaf">
          Verified activity only
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-gray-400">
        Power is recalculated from verified match outcomes, produced multi-angle videos,
        verified combat stats, eligible battles detected from your connected YouTube, and
        Oracle points. Screenshots and manual result forms do not add power.
      </p>
      <p className="mt-2 text-xs leading-5 text-gray-500">
        A recalculation can lower the total when legacy or unverified points are removed, or when
        a verified loss or death is added. That is intentional—the displayed number follows the
        current evidence instead of preserving an inflated older total.
      </p>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers + inline SVG (mirrors CreatorDashboard's cards; no icon lib)
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

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
