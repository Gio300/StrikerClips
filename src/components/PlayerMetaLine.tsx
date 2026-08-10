import { TagBadge } from '@/components/TagBadge'
import type { ArtifactRarity } from '@/types/database'

export function formatCompactPowerLevel(powerLevel: number): string {
  const value = Math.max(0, Math.round(powerLevel))
  if (value < 1_000) return value.toLocaleString()
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value).toUpperCase()
}

export function PowerLevelBadge({
  powerLevel,
  className = '',
}: {
  powerLevel?: number | null
  className?: string
}) {
  if (typeof powerLevel !== 'number' || !Number.isFinite(powerLevel)) return null
  const exact = Math.max(0, Math.round(powerLevel))
  return (
    <span
      title={`Power level ${exact.toLocaleString()}`}
      aria-label={`Power level ${exact.toLocaleString()}`}
      className={`inline-flex shrink-0 items-center rounded-sm border border-accent/30 bg-accent/10 px-1 py-px text-[10px] font-semibold leading-none tabular-nums text-accent ${className}`}
    >
      PL {formatCompactPowerLevel(exact)}
    </span>
  )
}

/** A dense public identity line: equipped title plus the player's power. */
export function PlayerMetaLine({
  powerLevel,
  title,
  titleRarity,
  prefix,
  className = '',
}: {
  powerLevel?: number | null
  title?: string | null
  titleRarity?: ArtifactRarity | null
  prefix?: string | null
  className?: string
}) {
  const hasTitle = Boolean(title?.trim())
  const hasPower = typeof powerLevel === 'number' && Number.isFinite(powerLevel)
  if (!prefix && !hasTitle && !hasPower) return null

  return (
    <span className={`flex min-w-0 items-center gap-1 text-[10px] leading-none text-gray-500 ${className}`}>
      {prefix && <span className="shrink-0 truncate">{prefix}</span>}
      {hasTitle && (
        <TagBadge
          artifactText={title}
          rarity={titleRarity}
          className="max-w-[7.5rem] truncate !rounded-sm !px-1 !py-px !text-[9px] !leading-none"
        />
      )}
      {hasPower && <PowerLevelBadge powerLevel={powerLevel} />}
    </span>
  )
}

export default PlayerMetaLine
