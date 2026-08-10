import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGAL_LINKS } from './LegalFooter'

/**
 * The YouTube API audit regression guard.
 *
 * The compliance failure (2026-08-04) was NOT a missing privacy PAGE — /privacy
 * and /terms both existed and both served 200. It was that no surface a
 * signed-out visitor lands on at `/` linked to them: an audit crawl of
 * https://tko.cam/ found 39 links and zero legal ones. So the thing worth
 * pinning is the LINK, on each landing surface, with text a human auditor
 * reads — which is what these tests do.
 */

const SRC = join(__dirname, '..')
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

describe('LegalFooter — the links Google requires', () => {
  it('spells the policies out in full (an auditor reads the label, not the href)', () => {
    expect(LEGAL_LINKS).toContainEqual({ href: '/privacy', label: 'Privacy Policy' })
    expect(LEGAL_LINKS).toContainEqual({ href: '/terms', label: 'Terms of Service' })
    expect(LEGAL_LINKS).toContainEqual({ href: '/data-deletion', label: 'Data Deletion' })
  })

  it('leads with the privacy policy — the one the policy names', () => {
    expect(LEGAL_LINKS[0].href).toBe('/privacy')
  })

  it('emits real anchors with real hrefs, not router <Link>s', () => {
    const source = read('components/LegalFooter.tsx')
    // The marketing bundle (src/site-main.tsx) mounts <Marketing/> with no
    // <BrowserRouter>, so a react-router <Link> here would throw there — and a
    // crawler wants an href either way.
    expect(source).toMatch(/<a\b[^>]*href=/)
    expect(source).not.toMatch(/from 'react-router-dom'/)
  })

  it('routes every link it advertises', () => {
    const app = read('App.tsx')
    for (const link of LEGAL_LINKS) {
      const path = link.href.replace(/^\//, '')
      expect(app).toContain(`path="${path}"`)
    }
  })
})

describe('LegalFooter — every landing surface carries the row', () => {
  // `/` resolves to one of these three depending on host + auth state
  // (src/App.tsx Home → signedOutLandingPath in src/lib/leagueDomain.ts):
  //   tko.cam signed-out       → /leagues  → LeagueGateway
  //   league domain signed-out → /login    → Login
  //   any host signed-in       → launcher  → HomeMenu
  // Marketing is the standalone site bundle's landing page.
  const SURFACES = [
    'pages/LeagueGateway.tsx',
    'pages/Login.tsx',
    'pages/HomeMenu.tsx',
    'pages/Marketing.tsx',
    'pages/Signup.tsx',
  ]

  for (const surface of SURFACES) {
    it(`${surface} renders LegalLinks/LegalFooter`, () => {
      const source = read(surface)
      expect(source).toMatch(/from '@\/components\/LegalFooter'/)
      expect(source).toMatch(/<Legal(Links|Footer)\b/)
    })
  }

  it('no landing surface still ships the old abbreviated row', () => {
    // The pre-fix labels ("Terms" / "Privacy") were too terse to read as the
    // policies Google asks for, and LeagueGateway had none at all.
    for (const surface of SURFACES) {
      const source = read(surface)
      expect(source).not.toMatch(/>Privacy</)
      expect(source).not.toMatch(/>Terms</)
    }
  })
})
