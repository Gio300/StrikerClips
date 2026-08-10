import { describe, it, expect } from 'vitest'
import { splashVideoFor } from './Splash'
import { leagueSplashVideoFor } from './LeagueWatermark'

// THE splash selection rule (operator 2026-08-03): a league's bundled motion
// splash plays ONLY when the app is served AS that league (domain takeover /
// ?league= preview) and the user hasn't asked for reduced motion. tko.cam,
// unknown leagues, and reduced-motion users keep the static lockup.

describe('Splash — splashVideoFor (video vs static selection)', () => {
  it('a domain-league with a bundled video gets the motion splash', () => {
    expect(splashVideoFor('shinobistrikerleague', false)).toMatch(
      /\/leagues\/shinobistrikerleague-splash\.mp4$/,
    )
  })

  it('tko.cam (no domain league) stays on the static lockup', () => {
    expect(splashVideoFor(null, false)).toBeNull()
  })

  it('a league without a bundled video stays on the static lockup', () => {
    expect(splashVideoFor('blaze', false)).toBeNull()
  })

  it('prefers-reduced-motion forces the static lockup even with a video', () => {
    expect(splashVideoFor('shinobistrikerleague', true)).toBeNull()
  })
})

describe('LeagueWatermark — leagueSplashVideoFor (bundled manifest)', () => {
  it('resolves SSL to its public asset under the deploy base', () => {
    const src = leagueSplashVideoFor('shinobistrikerleague')
    expect(src).toMatch(/\/leagues\/shinobistrikerleague-splash\.mp4$/)
  })

  it('unknown / missing slugs resolve to null (fail-soft to static)', () => {
    expect(leagueSplashVideoFor('nosuchleague')).toBeNull()
    expect(leagueSplashVideoFor(null)).toBeNull()
    expect(leagueSplashVideoFor(undefined)).toBeNull()
  })
})
