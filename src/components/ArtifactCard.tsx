import { RARITY, CAPABILITY_LABEL, type ArtifactDef } from '@/lib/artifacts'
import { formatPriceCents, type OwnedArtifact } from '@/lib/ownedArtifacts'

/**
 * A single collectible artifact tile — glows in its rarity color.
 *
 * Two shapes share this card:
 *   • a MILESTONE def (the earn-by-playing collection), and
 *   • an OWNED artifact the member actually forged, which additionally carries
 *     the paid Forge extras — creator-authored powers (Pro+), a sale price
 *     (Elite+) and a bundled t-shirt (Legend). Forging wrote those columns from
 *     day one but nothing displayed them, so a forged artifact was invisible to
 *     its owner; `owned` is what makes the Forge produce something visible.
 */
export default function ArtifactCard({
  def,
  locked = false,
  owned = null,
}: {
  def: ArtifactDef
  locked?: boolean
  owned?: OwnedArtifact | null
}) {
  const r = RARITY[def.rarity]
  // Server-derived capabilities (e.g. conquest_power) are absent from the
  // client label map — fall back rather than rendering "undefined".
  const capabilityLabel = CAPABILITY_LABEL[def.capability] ?? String(def.capability)
  const powers = owned?.powers ?? []
  const priceCents = owned?.price_cents ?? null
  const shirt = owned?.shirt ?? null

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
      {owned?.image_url && !locked ? (
        <img
          src={owned.image_url}
          alt=""
          className="mx-auto h-20 w-20 rounded-lg object-cover"
          style={{ boxShadow: `0 0 10px ${r.accent}55` }}
        />
      ) : (
        <div className="text-4xl" style={{ filter: locked ? 'grayscale(1)' : `drop-shadow(0 0 10px ${r.accent})` }}>
          {locked ? '🔒' : r.emoji}
        </div>
      )}
      <div className="mt-2 text-sm font-bold text-white">{def.name}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: r.accent }}>
        {r.label}
      </div>
      {def.capability !== 'none' && (
        <div className="mt-1 text-[11px] text-gray-400">{capabilityLabel}</div>
      )}
      <div className="mt-2 text-[11px] text-gray-500">{def.reason}</div>

      {/* ── the paid Forge extras, only on an artifact this member owns ────── */}
      {powers.length > 0 && (
        <ul className="mt-3 space-y-1 text-left">
          {powers.map((power, index) => (
            <li
              key={`${power.name}-${index}`}
              className="rounded-md border px-2 py-1"
              style={{ borderColor: `${r.accent}44`, background: `${r.accent}0d` }}
            >
              <div className="text-[11px] font-semibold" style={{ color: r.accent }}>
                ⚡ {power.name}
              </div>
              {power.description && (
                <div className="text-[10px] leading-snug text-gray-400">{power.description}</div>
              )}
            </li>
          ))}
        </ul>
      )}

      {priceCents != null && (
        <div
          className="mt-3 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ borderColor: `${r.accent}66`, color: r.accent }}
        >
          {formatPriceCents(priceCents)}
        </div>
      )}

      {shirt && (
        <div
          className="mt-3 flex items-center gap-2 rounded-lg border p-2 text-left"
          style={{ borderColor: '#2a2f3a', background: '#0b0d12' }}
        >
          {shirt.artwork_url && (
            <img src={shirt.artwork_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
          )}
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Paired shirt</div>
            <div className="truncate text-[11px] font-semibold text-white">{shirt.title}</div>
            {shirt.sale_price_cents != null && (
              <div className="text-[10px] text-gray-400">{formatPriceCents(shirt.sale_price_cents)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
