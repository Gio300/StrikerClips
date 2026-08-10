import { describe, it, expect } from 'vitest'
import {
  CANONICAL_ORIGIN,
  CANONICAL_APP_BASE,
  isPublicOrigin,
  shareOrigin,
  canonicalShareUrl,
} from './canonicalUrl'

const loc = (origin: string) => {
  const u = new URL(origin)
  return { protocol: u.protocol, hostname: u.hostname, origin: u.origin }
}

describe('isPublicOrigin', () => {
  it('rejects every private / app-internal origin', () => {
    expect(isPublicOrigin('https:', 'localhost')).toBe(false)
    expect(isPublicOrigin('http:', '127.0.0.1')).toBe(false)
    expect(isPublicOrigin('capacitor:', 'localhost')).toBe(false)
    expect(isPublicOrigin('ionic:', 'localhost')).toBe(false)
    expect(isPublicOrigin('file:', '')).toBe(false)
    expect(isPublicOrigin('https:', '192.168.1.20')).toBe(false)
    expect(isPublicOrigin('https:', '10.0.0.5')).toBe(false)
    expect(isPublicOrigin('https:', '172.20.1.2')).toBe(false)
    expect(isPublicOrigin('https:', 'my-desktop')).toBe(false)
    expect(isPublicOrigin('https:', 'app.localhost')).toBe(false)
  })

  it('accepts real public hosts', () => {
    expect(isPublicOrigin('https:', 'tko.cam')).toBe(true)
    expect(isPublicOrigin('https:', 'shinobistrikerleague.com')).toBe(true)
    expect(isPublicOrigin('https:', 'main.d123.amplifyapp.com')).toBe(true)
    expect(isPublicOrigin('https:', 'staging.tko.cam')).toBe(true)
  })
})

describe('shareOrigin / canonicalShareUrl', () => {
  it('localhost (installed app / dev) falls back to https://tko.cam/app', () => {
    expect(shareOrigin(loc('https://localhost'), '/')).toBe('https://tko.cam/app')
    expect(shareOrigin(loc('http://localhost:5173'), '/')).toBe('https://tko.cam/app')
    expect(shareOrigin(loc('http://127.0.0.1:4173'), '/')).toBe('https://tko.cam/app')
    expect(canonicalShareUrl('/tournaments/abc?chat=1', loc('https://localhost'), '/')).toBe(
      'https://tko.cam/app/tournaments/abc?chat=1',
    )
  })

  it('capacitor origin falls back to the canonical origin', () => {
    expect(
      shareOrigin({ protocol: 'capacitor:', hostname: 'localhost', origin: 'capacitor://localhost' }, '/'),
    ).toBe(`${CANONICAL_ORIGIN}${CANONICAL_APP_BASE}`)
  })

  it('tko.cam web deploy stays on tko.cam and keeps the /app base', () => {
    expect(shareOrigin(loc('https://tko.cam'), '/app/')).toBe('https://tko.cam/app')
    expect(canonicalShareUrl('/tournaments/abc?chat=1', loc('https://tko.cam'), '/app/')).toBe(
      'https://tko.cam/app/tournaments/abc?chat=1',
    )
  })

  it('a league domain keeps its own public domain (base "/")', () => {
    expect(shareOrigin(loc('https://shinobistrikerleague.com'), '/')).toBe(
      'https://shinobistrikerleague.com',
    )
    expect(
      canonicalShareUrl('/watch/xyz', loc('https://www.shinobistrikerleague.com'), '/'),
    ).toBe('https://www.shinobistrikerleague.com/watch/xyz')
  })

  it('never doubles slashes or drops the query string', () => {
    expect(canonicalShareUrl('tournaments/abc?chat=1', loc('https://localhost'), '/')).toBe(
      'https://tko.cam/app/tournaments/abc?chat=1',
    )
    expect(canonicalShareUrl('/reels/1', loc('https://tko.cam'), '/app')).toBe(
      'https://tko.cam/app/reels/1',
    )
  })

  it('no window at all (SSR/tests) falls back to the canonical origin', () => {
    expect(shareOrigin(null, '/')).toBe('https://tko.cam/app')
  })
})

/**
 * RUNG 1 (operator 2026-08-04): a link copied from inside `tko.cam/<slug>`
 * must STAY inside the league. If it didn't, every share from the cheapest
 * league address would silently hand the recipient the plain TKO app — the
 * exact thing the league is paying us not to do.
 */
describe('canonicalShareUrl — the league path prefix travels with the link', () => {
  it('keeps the prefix on tko.cam', () => {
    expect(
      canonicalShareUrl('/tournaments/abc?chat=1', loc('https://tko.cam'), '/', '/shinobistrikerleague'),
    ).toBe('https://tko.cam/shinobistrikerleague/tournaments/abc?chat=1')
  })

  it('survives the private-origin fallback (dev server, installed app)', () => {
    expect(canonicalShareUrl('/reels/1', loc('http://localhost:5889'), '/', '/blaze')).toBe(
      'https://tko.cam/app/blaze/reels/1',
    )
  })

  it('adds nothing when there is no path rung in play (host carries identity)', () => {
    expect(canonicalShareUrl('/reels/1', loc('https://blaze.tko.cam'), '/', '')).toBe(
      'https://blaze.tko.cam/reels/1',
    )
    expect(canonicalShareUrl('/reels/1', loc('https://shinobistrikerleague.com'), '/', '')).toBe(
      'https://shinobistrikerleague.com/reels/1',
    )
  })

  it('the app root of a league is the league address itself', () => {
    expect(canonicalShareUrl('/', loc('https://tko.cam'), '/', '/blaze')).toBe(
      'https://tko.cam/blaze/',
    )
  })
})
