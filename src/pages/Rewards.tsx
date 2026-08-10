import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useRewards } from '@/hooks/useRewards'
import ArtifactCard from '@/components/ArtifactCard'
import UnlockReveal from '@/components/UnlockReveal'
import { callFn } from '@/lib/backend'
import {
  MILESTONES, RARITY, canCraft, makeGiftCode, LEGEND_MONTHLY_CRAFTS,
  type EarnKind,
} from '@/lib/artifacts'
import {
  normalizeOwnedArtifacts, ownedArtifactDef, type OwnedArtifact,
} from '@/lib/ownedArtifacts'

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

  // THE FORGE COLLECTION — the artifacts this member actually forged, with the
  // paid extras (powers / price / paired shirt) the Forge saved. Scoped to the
  // caller server-side; a failure just leaves the section empty rather than
  // breaking the milestone collection below it.
  const [forged, setForged] = useState<OwnedArtifact[]>([])
  const [forgedLoading, setForgedLoading] = useState(true)
  const [artifactBusy, setArtifactBusy] = useState<string | null>(null)
  const [artifactNotice, setArtifactNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!user) { setForgedLoading(false); return }
    let alive = true
    void (async () => {
      setForgedLoading(true)
      try {
        const result = await callFn<{ ok?: boolean; artifacts?: unknown }>('forge-artifact-list', {})
        if (alive && result?.ok) setForged(normalizeOwnedArtifacts(result.artifacts))
      } catch { /* offline / older server — the section stays empty */ }
      if (alive) setForgedLoading(false)
    })()
    return () => { alive = false }
  }, [user?.id])

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

  async function removeArtifact(artifact: OwnedArtifact) {
    if (!window.confirm(`Remove ${artifact.name} from your artifact collection?`)) return
    setArtifactBusy(artifact.id)
    setArtifactNotice(null)
    const result = await callFn<{ ok?: boolean; error?: string }>('forge-artifact-delete', {
      artifactId: artifact.id,
    })
    setArtifactBusy(null)
    if (!result?.ok) {
      setArtifactNotice(result?.error || 'That artifact could not be removed.')
      return
    }
    setForged((current) => current.filter((item) => item.id !== artifact.id))
    setArtifactNotice(`${artifact.name} was removed.`)
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

      {/* what THIS member forged — the read side of /forge */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Your Forge</h2>
          <Link to="/forge" className="text-xs font-semibold text-accent hover:underline">
            Forge an artifact →
          </Link>
        </div>
        {artifactNotice && (
          <p className="mb-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-gray-200">
            {artifactNotice}
          </p>
        )}
        {forgedLoading ? (
          <div className="rounded-xl border border-dark-border bg-dark p-4 text-sm text-gray-400">
            Loading your forged artifacts…
          </div>
        ) : forged.length === 0 ? (
          <div className="rounded-xl border border-dark-border bg-dark p-4 text-sm text-gray-400">
            You haven’t forged anything yet. Anything you forge — with its powers, price and paired
            shirt — shows up here.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {forged.map((artifact) => (
              <div key={artifact.id} className="space-y-2">
                <ArtifactCard def={ownedArtifactDef(artifact)} owned={artifact} />
                <div className="grid grid-cols-2 gap-2">
                  {artifact.conquest ? (
                    <span className="flex min-h-9 items-center justify-center rounded-md border border-dark-border px-2 text-[11px] text-gray-500">
                      Recipe locked
                    </span>
                  ) : (
                    <Link
                      to={`/forge?edit=${encodeURIComponent(artifact.id)}`}
                      className="flex min-h-9 items-center justify-center gap-1 rounded-md border border-accent/40 px-2 text-xs font-semibold text-accent"
                    >
                      <Pencil size={13} /> Edit
                    </Link>
                  )}
                  <button
                    type="button"
                    disabled={artifactBusy === artifact.id}
                    onClick={() => void removeArtifact(artifact)}
                    className="flex min-h-9 items-center justify-center gap-1 rounded-md border border-red-500/40 px-2 text-xs font-semibold text-red-400 disabled:opacity-50"
                  >
                    <Trash2 size={13} /> {artifactBusy === artifact.id ? 'Removing' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
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
          <Link to="/upgrade" className="mt-4 inline-block rounded-lg border border-accent/50 px-5 py-2.5 text-sm font-semibold text-accent">
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
