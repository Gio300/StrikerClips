import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('profile power evidence explanation', () => {
  it('explains both anti-screenshot scoring and intentional downward recalculation', () => {
    const source = readFileSync(new URL('./ProfileCreatorTab.tsx', import.meta.url), 'utf8')
    expect(source).toContain('Screenshots and manual result forms do not add power')
    expect(source).toContain('A recalculation can lower the total')
    expect(source).toContain('legacy or unverified points are removed')
  })
})
