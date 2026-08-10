import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8')

describe('More > Account & payouts', () => {
  it('puts direct YouTube and Stripe destinations in the phone More menu', () => {
    const mobile = read('components/BottomNav.tsx')
    expect(mobile).toContain("to: '/settings#youtube', label: 'Change YouTube URL'")
    expect(mobile).toContain("to: '/settings#payouts', label: 'Connect Stripe / get paid'")
    expect(read('components/Sidebar.tsx')).toContain("to: '/settings', label: 'Account & payouts'")
  })

  it('keeps YouTube correction and Stripe payout onboarding on the same account screen', () => {
    const settings = read('pages/Settings.tsx')
    expect(settings).toContain('<YouTubeChannelSettings')
    expect(settings).toContain('<CreatorPayoutsCard')
    expect(settings).toContain('id="youtube"')
    expect(settings).toContain('id="payouts"')
    expect(settings).toContain('scrollIntoView')
  })

  it('uses the existing server-backed save and Stripe Connect flows', () => {
    const youtube = read('components/YouTubeChannelSettings.tsx')
    const payouts = read('components/CreatorPayoutsCard.tsx')
    expect(youtube).toContain('saveConnectedYouTubeChannel')
    expect(youtube).toContain('disconnectYouTubeChannel')
    expect(payouts).toContain('fetchConnectStatus')
    expect(payouts).toContain('startConnectOnboarding')
    expect(payouts).toContain('certifyCreatorTaxProfile')
  })
})
