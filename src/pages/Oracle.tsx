import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { predictionQuota, predictionUpgradeNudge } from '@/lib/tiers'
import {
  oracleBadgesForCorrect,
  nextOracleMilestone,
  BADGES,
} from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import {
  getStats,
  getPredictions,
  subscribePredictions,
  loadPredictions,
  isRewardAssetId,
  type Prediction,
  type PredictionStats,
} from '@/lib/predictions'
import { getOwned, subscribeAssets, loadAssetState, kindLabel, type DigitalAsset } from '@/lib/assets'
import { CollapsibleSection } from '@/components/CollapsibleSection'

/**
 * Oracle hub — the cash-free prediction surface.
 *
 * Shows the signed-in user's prediction quota (used / total for their tier),
 * current streak, accuracy, the Oracle badges they've earned, their open + past
 * calls, and the "locker" of cosmetics WON from correct predictions. Mirrors the
 * Team Shop's locker rendering (see src/pages/Shop.tsx). Everything here is
 * prestige + cosmetics — no wagers, no cash payouts.
 *
 * Predictions live in the `predictions` table and the earned cosmetics in
 * `asset_ownership` (source='reward'), so a streak, a badge and a locker follow
 * the account rather than the browser. Grading happens server-side against the
 * recorded tournament result — see src/lib/predictions.ts.
 */

export function Oracle() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { tier } = useEntitlements()

  const [stats, setStats] = useState<PredictionStats>(() => getStats(userId))
  const [preds, setPreds] = useState<Prediction[]>(() => getPredictions(userId))
  const [rewards, setRewards] = useState<DigitalAsset[]>(
    () => getOwned(userId).filter((a) => isRewardAssetId(a.id)),
  )

  const refresh = useCallback(() => {
    setStats(getStats(userId))
    setPreds(getPredictions(userId))
    setRewards(getOwned(userId).filter((a) => isRewardAssetId(a.id)))
  }, [userId])

  useEffect(() => {
    refresh()
    const unsubP = subscribePredictions(refresh)
    const unsubA = subscribeAssets(refresh)
    // Pull predictions + the locker from the server; both broadcast on arrival.
    void loadPredictions(userId)
    void loadAssetState(userId)
    return () => { unsubP(); unsubA() }
  }, [refresh, userId])

  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Oracle</h1>
        <p className="text-gray-400 mb-4">
          Sign in to call tournament winners and earn cosmetic rewards + Oracle badges.
        </p>
        <Link to="/login" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Sign in</Link>
      </div>
    )
  }

  const quota = predictionQuota(tier)
  const quotaLabel = quota === Infinity ? '∞' : String(quota)
  const earnedBadges = oracleBadgesForCorrect(stats.correctCount)
  const next = nextOracleMilestone(stats.correctCount)
  const atCap = quota !== Infinity && stats.openCount >= quota

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2">
          <span aria-hidden className="text-2xl">🔮</span>
          <h1 className="text-2xl font-bold">Oracle</h1>
          <span className="rounded-full border border-purple-400/40 bg-purple-500/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-purple-200">
            Cosmetic reward · no cash
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-1 max-w-2xl">
          Guess who wins a tournament. Correct calls earn cosmetic gear into your locker and push you up
          the Oracle badge ladder. Your tier caps how many live predictions you can juggle at once — this
          is prestige, never gambling.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        <StatCard label="Predictions used" value={`${stats.openCount}/${quotaLabel}`} tone="accent" />
        <StatCard label="Current streak" value={String(stats.streak)} tone="leaf" />
        <StatCard label="Accuracy" value={`${Math.round(stats.accuracy * 100)}%`} tone="chakra" />
        <StatCard label="Correct calls" value={String(stats.correctCount)} tone="purple" />
      </div>

      {atCap && (
        <div className="mb-8 rounded-lg border border-chakra/40 bg-chakra/10 px-4 py-3 text-sm text-chakra flex flex-wrap items-center gap-2">
          <span>{predictionUpgradeNudge(tier)}</span>
          <Link to="/upgrade" className="text-accent hover:underline">See tiers →</Link>
        </div>
      )}

      {/* Oracle badges */}
      <div className="mb-8">
      <CollapsibleSection id="oracle-badges" label="Stats" count={earnedBadges.length} hint="Oracle badges">
      <div className="rounded-xl border border-dark-border bg-dark-card p-5">
        {earnedBadges.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {earnedBadges.map((b) => (
              <BadgeChip key={b.id} badge={b} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-500">
            No Oracle badges yet — land your first correct call to earn Novice Oracle.
          </p>
        )}
        {next && (
          <p className="text-xs text-gray-500 mt-3">
            {next.minCorrect - stats.correctCount} more correct{' '}
            {next.minCorrect - stats.correctCount === 1 ? 'call' : 'calls'} to earn{' '}
            <span className="text-gray-300 font-medium">{BADGES[next.badgeId]?.label ?? next.badgeId}</span>.
          </p>
        )}
      </div>
      </CollapsibleSection>
      </div>

      {/* Your calls */}
      <h2 className="text-lg font-semibold mb-3">Your calls</h2>
      {preds.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center text-gray-500 mb-8">
          You haven’t made any predictions yet. Open a{' '}
          <Link to="/tournaments" className="text-accent hover:underline">tournament</Link> and call the winner.
        </div>
      ) : (
        <div className="space-y-2 mb-8">
          {preds.map((p) => (
            <div
              key={`${p.tournamentId}-${p.createdAt}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-dark-border bg-dark-card p-3 text-sm"
            >
              <Link to={`/tournaments/${p.tournamentId}`} className="text-accent hover:underline">
                {p.pick.label}
              </Link>
              <PredStatusPill status={p.status} />
              <span className="ml-auto text-xs text-gray-500">
                {new Date(p.resolvedAt ?? p.createdAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Locker — cosmetics won from correct calls (mirrors the Team Shop locker). */}
      <div className="mb-8">
      <CollapsibleSection id="oracle-locker" label="More" count={rewards.length} hint="Oracle locker">
      <p className="text-sm text-gray-500 mb-3">Cosmetics you’ve won by calling it right.</p>
      {rewards.length === 0 ? (
        <p className="text-sm text-gray-600 mb-10">
          Empty for now. Correct predictions drop cosmetic gear here.
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-10">
          {rewards.map((asset) => (
            <div
              key={asset.id}
              className="rounded-xl border border-purple-400/30 bg-dark-card overflow-hidden flex flex-col"
            >
              <div className="aspect-square bg-dark-elevated overflow-hidden">
                <img
                  src={asset.imageUrl}
                  alt={asset.name}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }}
                />
              </div>
              <div className="p-3">
                <span className="text-[10px] uppercase tracking-wide text-gray-500">
                  {asset.teamName} · {kindLabel(asset.kind)}
                </span>
                <h3 className="text-sm font-semibold text-white leading-snug mt-0.5">{asset.name}</h3>
              </div>
            </div>
          ))}
        </div>
      )}
      </CollapsibleSection>
      </div>

      <p className="mt-6 text-xs text-gray-500 text-center">
        Predictions are free and rewards are cosmetic only. Nothing here is a wager, and nothing pays out
        money — TKO rewards prestige, not gambling.
      </p>
    </div>
  )
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone: 'accent' | 'leaf' | 'chakra' | 'purple'
}) {
  const toneClass = {
    accent: 'text-accent',
    leaf: 'text-leaf',
    chakra: 'text-chakra',
    purple: 'text-purple-200',
  }[tone]
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-center">
      <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}

function PredStatusPill({ status }: { status: Prediction['status'] }) {
  const map: Record<Prediction['status'], { cls: string; text: string }> = {
    open: { cls: 'border-purple-400/40 bg-purple-500/10 text-purple-200', text: 'open' },
    correct: { cls: 'border-leaf/40 bg-leaf/10 text-leaf', text: 'correct' },
    wrong: { cls: 'border-kunai/40 bg-kunai/10 text-kunai', text: 'wrong' },
  }
  const m = map[status]
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${m.cls}`}>{m.text}</span>
}
