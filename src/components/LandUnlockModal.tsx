import { useEffect } from 'react'
import { tierLabel, type ArtifactTier } from '@/lib/conquestMechanics'

/**
 * LandUnlockModal — the celebration screen when your clan takes new land.
 *
 * Fired the moment a clan captures a territory: a full-screen flash showing the
 * land won and the artifact tier that land now produces for you. Purely
 * presentational — the caller decides when to show it and what to pass.
 */
export interface LandUnlock {
  territory: string
  nation: string
  clanName: string
  clanTag: string | null
  tier: ArtifactTier
}

const TIER_GLOW: Record<ArtifactTier, string> = {
  common: '#9aa4b2',
  rare: '#38bdf8',
  epic: '#a855f7',
  legendary: '#f59e0b',
  mythic: '#f43f5e',
}

export function LandUnlockModal({ unlock, onClose }: { unlock: LandUnlock | null; onClose: () => void }) {
  useEffect(() => {
    if (!unlock) return
    const t = setTimeout(onClose, 6000) // auto-dismiss after the moment lands
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [unlock, onClose])

  if (!unlock) return null
  const glow = TIER_GLOW[unlock.tier]

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-[fadeIn_.2s_ease]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative mx-4 w-full max-w-sm rounded-2xl border p-8 text-center"
        style={{ borderColor: glow, boxShadow: `0 0 60px ${glow}66, inset 0 0 40px ${glow}22`, background: 'radial-gradient(circle at 50% 0%, #14203a, #070b16)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* rotating conquest banner glyph */}
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: `${glow}22`, boxShadow: `0 0 30px ${glow}88` }}>
          <span className="text-3xl">🏯</span>
        </div>

        <div className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: glow }}>
          Land unlocked
        </div>
        <h2 className="mt-2 text-3xl font-black text-white">{unlock.territory}</h2>
        <p className="mt-1 text-sm text-gray-400">{unlock.nation}</p>

        <div className="mt-5 rounded-xl border border-dark-border bg-black/30 px-4 py-3">
          <p className="text-sm text-gray-300">
            {unlock.clanTag ? `[${unlock.clanTag}] ` : ''}
            <span className="font-semibold text-white">{unlock.clanName}</span> now holds this land.
          </p>
          <p className="mt-2 text-sm">
            Producing{' '}
            <span className="font-bold" style={{ color: glow }}>{tierLabel(unlock.tier)}</span>{' '}
            artifacts while you hold it.
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="mt-6 w-full rounded-lg py-2.5 font-semibold text-black"
          style={{ background: glow }}
        >
          Claim your reward
        </button>
      </div>

      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}}`}</style>
    </div>
  )
}

export default LandUnlockModal
