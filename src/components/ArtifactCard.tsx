import { RARITY, CAPABILITY_LABEL, type ArtifactDef } from '@/lib/artifacts'

/** A single collectible artifact tile — glows in its rarity color. */
export default function ArtifactCard({ def, locked = false }: { def: ArtifactDef; locked?: boolean }) {
  const r = RARITY[def.rarity]
  return (
    <div
      className="relative rounded-xl border p-4 text-center transition"
      style={{
        borderColor: locked ? '#2a2f3a' : r.accent,
        background: locked ? '#0d0f14' : `radial-gradient(circle at 50% 0%, ${r.accent}22, #0d0f14 70%)`,
        boxShadow: locked ? 'none' : `0 0 18px ${r.accent}33`,
        opacity: locked ? 0.5 : 1,
      }}
    >
      <div className="text-4xl" style={{ filter: locked ? 'grayscale(1)' : `drop-shadow(0 0 10px ${r.accent})` }}>
        {locked ? '🔒' : r.emoji}
      </div>
      <div className="mt-2 text-sm font-bold text-white">{def.name}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: r.accent }}>
        {r.label}
      </div>
      {def.capability !== 'none' && (
        <div className="mt-1 text-[11px] text-gray-400">{CAPABILITY_LABEL[def.capability]}</div>
      )}
      <div className="mt-2 text-[11px] text-gray-500">{def.reason}</div>
    </div>
  )
}
