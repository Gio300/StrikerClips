import akatsukiHomeJersey from '@/assets/marketplace/official/akatsuki-home-jersey.webp'
import hiddenLeafAwayJersey from '@/assets/marketplace/official/hidden-leaf-away-jersey.webp'
import sandSiblingsProKit from '@/assets/marketplace/official/sand-siblings-pro-kit.webp'
import oracleCrystalBallEmote from '@/assets/marketplace/official/oracle-crystal-ball-emote.webp'
import oracleVioletBadgeSkin from '@/assets/marketplace/official/oracle-violet-badge-skin.webp'
import oracleStarfallEmote from '@/assets/marketplace/official/oracle-starfall-emote.webp'
import oracleAstralBadgeSkin from '@/assets/marketplace/official/oracle-astral-badge-skin.webp'
import kingCrown from '@/assets/marketplace/official/king-crown.webp'
import kingFinalistBanner from '@/assets/marketplace/official/king-finalist-banner.webp'
import kingSemifinalistSigil from '@/assets/marketplace/official/king-semifinalist-sigil.webp'
import kingRoundToken from '@/assets/marketplace/official/king-round-token.webp'

/**
 * Bundled art for platform-created marketplace items. Production databases may
 * still contain the old placehold.co URLs, so known stable ids intentionally
 * win over the row value. Creator and clan listings always keep their own art.
 */
export const OFFICIAL_ARTIFACT_ART = {
  'seed-akatsuki-jersey': akatsukiHomeJersey,
  'seed-leaf-village-jersey': hiddenLeafAwayJersey,
  'seed-sand-jersey': sandSiblingsProKit,
  'oracle-reward-crystal-emote': oracleCrystalBallEmote,
  'oracle-reward-violet-skin': oracleVioletBadgeSkin,
  'oracle-reward-starfall-emote': oracleStarfallEmote,
  'oracle-reward-astral-skin': oracleAstralBadgeSkin,
  'king-prize-crown': kingCrown,
  'king-prize-finalist': kingFinalistBanner,
  'king-prize-semifinalist': kingSemifinalistSigil,
} as const

export const OFFICIAL_ARTIFACT_IDS = Object.keys(OFFICIAL_ARTIFACT_ART)

export function officialArtifactArt(id: string): string | undefined {
  if (id.startsWith('king-prize-round-')) return kingRoundToken
  return OFFICIAL_ARTIFACT_ART[id as keyof typeof OFFICIAL_ARTIFACT_ART]
}

export function resolveArtifactArt(id: string, fallback = ''): string {
  return officialArtifactArt(id) ?? fallback
}
