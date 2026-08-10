import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Program output empty state', () => {
  it('gives a direct visitor a recovery path instead of an endless waiting screen', () => {
    const source = readFileSync(new URL('./ProgramView.tsx', import.meta.url), 'utf8')
    expect(source).toContain('No live feeds are available yet')
    expect(source).toContain('Back to Live')
    expect(source).toContain('to="/live"')
  })
})
