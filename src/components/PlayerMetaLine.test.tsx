import TestRenderer from 'react-test-renderer'
import { describe, expect, it } from 'vitest'
import { PlayerMetaLine, PowerLevelBadge, formatCompactPowerLevel } from '@/components/PlayerMetaLine'

describe('PlayerMetaLine', () => {
  it('formats power compactly without losing the exact accessible value', () => {
    expect(formatCompactPowerLevel(999)).toBe('999')
    expect(formatCompactPowerLevel(7_400)).toBe('7.4K')

    const renderer = TestRenderer.create(<PowerLevelBadge powerLevel={7_400} />)
    const badge = renderer.root.findByType('span')
    expect(badge.props['aria-label']).toBe('Power level 7,400')
    expect(renderer.toJSON()).toMatchObject({ children: ['PL ', '7.4K'] })
  })

  it('fits title, role, and power into one metadata line', () => {
    const renderer = TestRenderer.create(
      <PlayerMetaLine
        prefix="Officer"
        title="Village Champion"
        titleRarity="legendary"
        powerLevel={12_500}
      />,
    )
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('Officer')
    expect(text).toContain('Village Champion')
    expect(text).toContain('12.5K')
  })
})
