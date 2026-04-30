import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { CreatorPayoutsCard } from '@/components/CreatorPayoutsCard'
import { donationsEnabled } from '@/lib/featureFlags'
import type { Donation, Reel } from '@/types/database'

/**
 * Influencer dashboard.
 *
 * One page that surfaces the metrics a creator actually cares about:
 *   - Following / followers
 *   - How many reels they've made + estimated views
 *   - Tips received (paid donations) + top supporters
 *   - 7-day donation trend (sparkline)
 *   - Stripe payouts card (Tier B; renders a "connect" prompt until enabled)
 *
 * We intentionally compute everything from rows the user already owns —
 * no analytics warehouse, no extra writes.
 */

type DonationRow = Donation & { donor_username?: string; donor_avatar?: string | null }

export function Dashboard() {
  const { user } = useAuth()

  const [followerCount, setFollowerCount] = useState<number | null>(null)
  const [followingCount, setFollowingCount] = useState<number | null>(null)
  const [reels, setReels] = useState<Reel[]>([])
  const [donations, setDonations] = useState<DonationRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) {
      setLoading(false)
      return
    }
    let cancelled = false

    async function load() {
      const [followers, following, reelsRes, donationsRes] = await Promise.all([
        supabase
          .from('follows')
          .select('id', { count: 'exact', head: true })
          .eq('following_id', user!.id),
        supabase
          .from('follows')
          .select('id', { count: 'exact', head: true })
          .eq('follower_id', user!.id),
        supabase
          .from('reels')
          .select('id, title, created_at, combined_video_url, thumbnail, clip_ids, user_id, layout')
          .eq('user_id', user!.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('donations')
          .select('*')
          .eq('creator_id', user!.id)
          .order('created_at', { ascending: false })
          .limit(100),
      ])

      if (cancelled) return

      setFollowerCount(followers.count ?? 0)
      setFollowingCount(following.count ?? 0)
      setReels((reelsRes.data ?? []) as Reel[])

      const donationRows = (donationsRes.data ?? []) as Donation[]
      const donorIds = Array.from(new Set(donationRows.map((d) => d.donor_id).filter(Boolean) as string[]))
      let donorMap = new Map<string, { username: string; avatar_url: string | null }>()
      if (donorIds.length > 0) {
        const { data } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', donorIds)
        donorMap = new Map((data ?? []).map((p) => [p.id, { username: p.username, avatar_url: p.avatar_url }]))
      }
      if (cancelled) return
      setDonations(
        donationRows.map((d) => ({
          ...d,
          donor_username: d.donor_id ? donorMap.get(d.donor_id)?.username : undefined,
          donor_avatar: d.donor_id ? donorMap.get(d.donor_id)?.avatar_url : null,
        })),
      )
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user])

  const paidDonations = useMemo(() => donations.filter((d) => d.status === 'paid'), [donations])
  const totalCents = useMemo(
    () => paidDonations.reduce((acc, d) => acc + d.amount_cents, 0),
    [paidDonations],
  )

  const topSupporters = useMemo(() => {
    const map = new Map<string, { username: string; total_cents: number }>()
    for (const d of paidDonations) {
      if (!d.donor_id) continue
      const prev = map.get(d.donor_id) ?? {
        username: d.donor_username ?? 'fan',
        total_cents: 0,
      }
      map.set(d.donor_id, { ...prev, total_cents: prev.total_cents + d.amount_cents })
    }
    return Array.from(map.entries())
      .map(([donor_id, info]) => ({ donor_id, ...info }))
      .sort((a, b) => b.total_cents - a.total_cents)
      .slice(0, 5)
  }, [paidDonations])

  const weeklyTotals = useMemo(() => buildWeeklyTotals(paidDonations), [paidDonations])

  if (!user) {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Creator Dashboard</h1>
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <Link to="/login" className="text-accent hover:underline">Log in</Link>
          <span className="text-gray-400"> to view your creator metrics.</span>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-1">Creator Dashboard</h1>
      <p className="text-gray-400 mb-6">
        Your reach, your tips, your payouts — all in one place.
      </p>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard label="Followers" value={followerCount} loading={loading} />
        <StatCard label="Following" value={followingCount} loading={loading} />
        <StatCard label="Reels" value={loading ? null : reels.length} loading={loading} />
        <StatCard
          label="Tips earned"
          value={loading ? null : `$${(totalCents / 100).toFixed(2)}`}
          loading={loading}
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left column — payouts + trend */}
        <div className="lg:col-span-2 space-y-6">
          <CreatorPayoutsCard paidTotalCents={totalCents} pendingDonations={donations.filter((d) => d.status === 'pending').length} />

          <div className="rounded-xl border border-dark-border bg-dark-card p-5">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-semibold">7-day tip trend</h2>
              <span className="text-xs text-gray-500">
                {donationsEnabled ? 'Last 7 days of paid tips' : 'Connect Stripe to start receiving tips'}
              </span>
            </div>
            <Sparkline data={weeklyTotals} />
          </div>

          <div className="rounded-xl border border-dark-border bg-dark-card p-5">
            <h2 className="font-semibold mb-4">Recent tips</h2>
            {paidDonations.length === 0 ? (
              <p className="text-gray-400 text-sm">
                No paid tips yet. {donationsEnabled
                  ? 'Share your profile link so fans can support you.'
                  : 'Stripe is not configured on this deploy yet — once it is, your tips will appear here.'}
              </p>
            ) : (
              <ul className="divide-y divide-dark-border">
                {paidDonations.slice(0, 10).map((d) => (
                  <li key={d.id} className="py-2 flex items-center gap-3 text-sm">
                    <span className="font-mono text-accent">${(d.amount_cents / 100).toFixed(2)}</span>
                    <span className="text-gray-200">
                      from{' '}
                      {d.donor_id ? (
                        <Link to={`/profile/${d.donor_id}`} className="text-accent hover:underline">
                          @{d.donor_username ?? 'fan'}
                        </Link>
                      ) : (
                        <span className="text-gray-500">anonymous</span>
                      )}
                    </span>
                    {d.message && <span className="text-gray-400 truncate flex-1">"{d.message}"</span>}
                    <span className="text-xs text-gray-500 ml-auto">
                      {new Date(d.paid_at ?? d.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right column — top supporters + recent reels */}
        <div className="space-y-6">
          <div className="rounded-xl border border-dark-border bg-dark-card p-5">
            <h2 className="font-semibold mb-3">Top supporters</h2>
            {topSupporters.length === 0 ? (
              <p className="text-gray-500 text-sm">No supporters yet.</p>
            ) : (
              <ol className="space-y-2">
                {topSupporters.map((s, idx) => (
                  <li key={s.donor_id} className="flex items-center gap-3 text-sm">
                    <span className="text-gray-500 font-mono w-6">{idx + 1}.</span>
                    <Link to={`/profile/${s.donor_id}`} className="text-accent hover:underline flex-1 truncate">
                      @{s.username}
                    </Link>
                    <span className="font-mono text-gray-300">${(s.total_cents / 100).toFixed(2)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="rounded-xl border border-dark-border bg-dark-card p-5">
            <h2 className="font-semibold mb-3">Latest reels</h2>
            {reels.length === 0 ? (
              <p className="text-gray-500 text-sm">
                You haven't published a reel yet.{' '}
                <Link to="/reels/create" className="text-accent hover:underline">
                  Make your first one
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-2">
                {reels.slice(0, 5).map((r) => (
                  <li key={r.id} className="text-sm">
                    <Link to={`/reels/${r.id}`} className="text-accent hover:underline">
                      {r.title}
                    </Link>
                    <span className="block text-xs text-gray-500">
                      {new Date(r.created_at).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  loading,
}: {
  label: string
  value: number | string | null
  loading: boolean
}) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4">
      <p className="text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-100">
        {loading ? <span className="text-gray-600">—</span> : value ?? 0}
      </p>
    </div>
  )
}

/** Build the last 7 days of paid donation totals for the sparkline. */
function buildWeeklyTotals(donations: Donation[]): { day: string; total: number }[] {
  const out: { day: string; total: number }[] = []
  const today = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    d.setHours(0, 0, 0, 0)
    const next = new Date(d)
    next.setDate(d.getDate() + 1)
    const total = donations
      .filter((don) => {
        const t = don.paid_at ? new Date(don.paid_at).getTime() : null
        return t != null && t >= d.getTime() && t < next.getTime()
      })
      .reduce((acc, don) => acc + don.amount_cents, 0)
    out.push({ day: d.toLocaleDateString(undefined, { weekday: 'short' }), total })
  }
  return out
}

/** Tiny inline SVG sparkline — no chart library, no extra weight. */
function Sparkline({ data }: { data: { day: string; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total))
  const W = 600
  const H = 100
  const stepX = data.length > 1 ? W / (data.length - 1) : W
  const points = data
    .map((d, i) => {
      const x = i * stepX
      const y = H - (d.total / max) * H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24">
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className="text-accent"
        />
        {data.map((d, i) => {
          const x = i * stepX
          const y = H - (d.total / max) * H
          return (
            <circle key={i} cx={x} cy={y} r={3} className="text-accent fill-current" />
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-gray-500 mt-1 font-mono">
        {data.map((d) => (
          <span key={d.day}>
            {d.day}
            {d.total > 0 && (
              <span className="block text-accent">${(d.total / 100).toFixed(0)}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}
