import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_ARTIFACT_ART,
  OFFICIAL_ARTIFACT_IDS,
  officialArtifactArt,
  resolveArtifactArt,
} from './officialArtifactArt'

describe('official artifact art', () => {
  it('bundles artwork for every seeded platform item', () => {
    expect(OFFICIAL_ARTIFACT_IDS).toHaveLength(10)
    for (const [id, artwork] of Object.entries(OFFICIAL_ARTIFACT_ART)) {
      expect(id).not.toBe('')
      expect(artwork).toMatch(/\.webp(?:\?|$)/)
      expect(artwork).not.toContain('placehold.co')
    }
  })

  it('uses one forged token image for dynamically named early-round prizes', () => {
    expect(officialArtifactArt('king-prize-round-1')).toMatch(/king-round-token.*\.webp/)
    expect(officialArtifactArt('king-prize-round-99')).toBe(officialArtifactArt('king-prize-round-1'))
  })

  it('preserves creator and clan artwork when an id is not official', () => {
    expect(resolveArtifactArt('creator-listing-1', 'https://cdn.example/item.png'))
      .toBe('https://cdn.example/item.png')
  })
})
