import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useRewards } from '@/hooks/useRewards'
import ArtifactCard from '@/components/ArtifactCard'
import UnlockReveal from '@/components/UnlockReveal'
import {
  MILESTONES, RARITY, canCraft, makeGiftCode, LEGEND_MONTHLY_CRAFTS,
  type EarnKind,
} from '@/lib/artifacts'

const TRACK_LABEL: Record<EarnKind, string> = {
  uploads: 'Clips uploaded',
  referrals: 'Friends recruited',
  paid_referrals: 'Friends who went Pro',
}

export function Rewards() {
  const { user } = useAuth()
  const ent = useEntitlements()
  const { counts, earnedArtifacts, next, loading } = useRewards()
  const [gift, setGift] = useState<string | null>(null)
  const [reveal, setReveal] = useState(false)

  // "Legend" = the top creator tier.
  const isLegend = ent.tier === 'creator'
  const earnedSlugs = new Set(earnedArtifacts.map((d) => d.slug))

  if (!user) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Rewards</h1>
        <p className="text-gray-400 mb-4">Sign in to see your artifacts.</p>
        <Link to="/login" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Sign in</Link>
      </div>
    )
  }

  function craftGift() {
    setGift(makeGiftCode(`${user!.id}-${Date.now()}`))
    setReveal(true)
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Artifacts</h1>
        <p className="text-sm text-gray-400 mt-1">
          Earn artifacts by playing and building the community. Some are pure flex; the rare ones let you
          gift a starter pass to a friend.
        </p>
      </div>

      {/* progress tracks */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(Object.keys(TRACK_LABEL) as EarnKind[]).map((k) => {
          const n = next[k]
          return (
            <div key={k} className="rounded-xl border border-dark-border bg-dark p-4">
              <div className="text-xs uppercase tracking-wide text-gray-500">{TRACK_LABEL[k]}</div>
              <div className="text-2xl font-bold text-white">{loading ? '—' : counts[k]}</div>
              {n ? (
                <>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-dark-border">
                    <div className="h-full rounded-full" style={{
                      width: `${Math.round((n.progress) * 100)}%`,
                      background: RARITY[n.def.rarity].accent,
                    }} />
                  </div>
                  <div className="mt-1 text-[11px] text-gray-400">
                    {n.remaining} more → <span style={{ color: RARITY[n.def.rarity].accent }}>{n.def.name}</span>
                  </div>
                </>
              ) : (
                <div className="mt-2 text-[11px] text-leaf">All unlocked 🏆</div>
              )}
            </div>
          )
        })}
      </div>

      {/* the full collection: earned bright, locked dim */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Collection</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {(Object.keys(MILESTONES) as EarnKind[]).flatMap((k) =>
            MILESTONES[k].map((m) => (
              <ArtifactCard key={m.def.slug} def={m.def} locked={!earnedSlugs.has(m.def.slug)} />
            )),
          )}
        </div>
      </div>

      {/* Legend crafting: gift a sub */}
      <div className="rounded-xl border p-5" style={{ borderColor: '#ff8a1e55', background: '#ff8a1e0d' }}>
        <h2 className="text-lg font-semibold">Craft an artifact {isLegend ? '' : '(Legend only)'}</h2>
        <p className="mt-1 text-sm text-gray-400">
          Legends craft up to {LEGEND_MONTHLY_CRAFTS} artifacts a month. Gift a starter pass to a friend —
          share the artifact, they drop the code into Redeem and unlock it. It grants a lower tier (not Pro),
          works once, and you can’t gift the same person twice.
        </p>
        {isLegend ? (
          <button
            onClick={craftGift}
            disabled={!canCraft(isLegend, 0)}
            className="mt-4 rounded-lg bg-accent px-5 py-2.5 font-semibold text-dark hover:shadow-glow"
          >
            Craft a “Gift Starter Pass” artifact
          </button>
        ) : (
          <Link to="/pricing" className="mt-4 inline-block rounded-lg border border-accent/50 px-5 py-2.5 text-sm font-semibold text-accent">
            Reach Legend to craft
          </Link>
        )}
        {gift && (
          <div className="mt-4 rounded-lg border border-accent/40 bg-dark p-3">
            <div className="text-xs text-gray-400">Share this code — one friend, one time:</div>
            <div className="mt-1 select-all font-mono text-lg tracking-widest text-accent">{gift}</div>
          </div>
        )}
      </div>

      <UnlockReveal
        open={reveal}
        emoji="🎟️"
        accent="#ff8a1e"
        title="ARTIFACT CRAFTED"
        subtitle="Share it with a friend — they redeem the code to unlock a starter pass."
        onClose={() => setReveal(false)}
      />
    </div>
  )
}
