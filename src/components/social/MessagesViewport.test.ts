import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const component = readFileSync(join(__dirname, 'DirectMessages.tsx'), 'utf8')
const styles = readFileSync(join(__dirname, '..', '..', 'index.css'), 'utf8')

describe('mobile messages viewport', () => {
  it('keeps the inbox and composer above the native bottom navigation', () => {
    expect(component).toContain('h-[var(--tko-messages-viewport-height)]')
    expect(styles).toContain('--tko-messages-viewport-height: calc(')
    expect(styles).toContain('7.5rem - var(--tko-safe-area-top)')
    expect(styles).toContain('env(safe-area-inset-bottom, 0px)')
  })
})
