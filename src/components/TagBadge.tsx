/**
 * TagBadge — the one place that decides which badge shows next to a name.
 *
 * "The tag that gets shown off, everywhere." A user's EQUIPPED ARTIFACT TAG
 * always wins: when `equipped_tag_text` is set we render a distinct, rarity-keyed
 * gradient pill. With no artifact tag equipped we fall back to the plain clan
 * `[TAG]` badge. With neither, we render nothing.
 *
 * Use this component in every spot a name is shown (chat, profile header,
 * search/Discover, leaderboards) so the look stays consistent. Tailwind core
 * utilities only; the gradients use core from-/to- gradient stops.
 */

import { formatTag } from '@/lib/identity'
import type { ArtifactRarity } from '@/types/database'

/** Anything shaped like a profile row (or an enriched chat message). */
export interface TagBearer {
  equipped_tag_text?: string | null
  equipped_tag_rarity?: ArtifactRarity | null
  /** The user's clan tag, used only as a fallback when no artifact tag is set. */
  clan_tag?: string | null
}

const RARITY_PILL: Record<ArtifactRarity, string> = {
  common: 'bg-gradient-to-r from-gray-500 to-gray-600 text-white ring-1 ring-white/10',
  rare: 'bg-gradient-to-r from-sky-500 to-cyan-500 text-white ring-1 ring-cyan-200/30',
  epic: 'bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white ring-1 ring-fuchsia-200/30',
  legendary: 'bg-gradient-to-r from-amber-400 to-orange-500 text-black ring-1 ring-amber-200/50',
}

export interface TagBadgeProps {
  /** Artifact tag text (preferred). */
  artifactText?: string | null
  /** Rarity for the artifact pill's look. */
  rarity?: ArtifactRarity | null
  /** Clan tag fallback (rendered only when there's no artifact tag). */
  clanTag?: string | null
  /** Extra classes (margins, etc). */
  className?: string
}

/**
 * Low-level badge. Prefer <ProfileTagBadge/> when you have a profile-ish object.
 */
export function TagBadge({ artifactText, rarity, clanTag, className = '' }: TagBadgeProps) {
  const text = (artifactText ?? '').trim()
  if (text) {
    const pill = RARITY_PILL[(rarity ?? 'common') as ArtifactRarity] ?? RARITY_PILL.common
    return (
      <span
        title={`Artifact tag${rarity ? ` · ${rarity}` : ''}`}
        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide align-middle ${pill} ${className}`}
      >
        {text}
      </span>
    )
  }
  const badge = formatTag(clanTag)
  if (!badge) return null
  return (
    <span className={`text-accent text-xs font-semibold align-middle ${className}`}>{badge}</span>
  )
}

/**
 * Convenience wrapper: pass any profile-shaped object (or enriched message) and
 * it picks the equipped artifact tag, falling back to the clan tag.
 */
export function ProfileTagBadge({ user, className }: { user: TagBearer | null | undefined; className?: string }) {
  if (!user) return null
  return (
    <TagBadge
      artifactText={user.equipped_tag_text}
      rarity={user.equipped_tag_rarity ?? undefined}
      clanTag={user.clan_tag}
      className={className}
    />
  )
}
