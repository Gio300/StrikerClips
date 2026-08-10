/**
 * The URL identity ladder (operator 2026-08-04). Three things this suite
 * exists to prevent:
 *   1. a league slug eating one of the app's own routes (`/tournaments`),
 *   2. a tier getting an address it did not pay for, and
 *   3. an infrastructure subdomain being mistaken for a league.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  bestUrlRung,
  canUseUrlRung,
  decideHostGate,
  domainVerificationRecord,
  isClaimableCustomDomain,
  isReservedLeaguePath,
  isReservedSubdomain,
  leaguePathPrefix,
  leagueTier,
  leagueTierLevel,
  leagueUrlForRung,
  normalizeCustomDomain,
  normalizeHost,
  pathLeagueSlug,
  primaryLeagueUrl,
  RUNG_MIN_TIER,
  stripLeaguePathPrefix,
  subdomainLeagueSlug,
  txtRecordsProve,
  urlRungTierName,
  type LeagueUrlIdentity,
} from './leagueUrls'

const TOKEN = 'a'.repeat(32)

describe('leagueUrls — the tier → rung entitlement table', () => {
  const PAID = 'active'

  it('path is free with every plan — and with NO plan at all', () => {
    expect(RUNG_MIN_TIER.path).toBe('starter')
    for (const tier of ['starter', 'pro', 'dynasty', 'enterprise', 'nonsense', undefined]) {
      expect(canUseUrlRung('path', tier, PAID)).toBe(true)
      // "or they just get tko.cam/their league name" — an UNPAID draft keeps
      // its address. Rung 1 is the operator's explicit no-pay option.
      expect(canUseUrlRung('path', tier, 'none')).toBe(true)
    }
  })

  it('subdomain is Pro League and up', () => {
    expect(canUseUrlRung('subdomain', 'starter', PAID)).toBe(false)
    expect(canUseUrlRung('subdomain', 'pro', PAID)).toBe(true)
    expect(canUseUrlRung('subdomain', 'dynasty', PAID)).toBe(true)
    expect(canUseUrlRung('subdomain', 'enterprise', PAID)).toBe(true)
  })

  it('a custom domain is the TOP plan only (Dynasty, and Enterprise above it)', () => {
    expect(canUseUrlRung('custom', 'starter', PAID)).toBe(false)
    expect(canUseUrlRung('custom', 'pro', PAID)).toBe(false)
    expect(canUseUrlRung('custom', 'dynasty', PAID)).toBe(true)
    expect(canUseUrlRung('custom', 'enterprise', PAID)).toBe(true)
  })

  it('AN UNPAID ROW BUYS NOTHING — tier alone is a design document', () => {
    // leagues.tier is editable from the Studio; plan_status is webhook-only.
    for (const status of ['none', 'past_due', 'canceled', undefined, '']) {
      expect(canUseUrlRung('subdomain', 'enterprise', status)).toBe(false)
      expect(canUseUrlRung('custom', 'enterprise', status)).toBe(false)
    }
    // An operator comp counts, exactly like a live subscription.
    expect(canUseUrlRung('custom', 'dynasty', 'comped')).toBe(true)
  })

  it('unknown tiers fall to the cheapest — never accidentally generous', () => {
    expect(leagueTier('PRO')).toBe('pro')
    expect(leagueTier('platinum')).toBe('starter')
    expect(leagueTier(null)).toBe('starter')
    expect(leagueTierLevel('enterprise')).toBeGreaterThan(leagueTierLevel('dynasty'))
    expect(leagueTierLevel('dynasty')).toBeGreaterThan(leagueTierLevel('pro'))
    expect(leagueTierLevel('pro')).toBeGreaterThan(leagueTierLevel('starter'))
  })

  it('names the plan that unlocks each rung (the Studio CTA copy)', () => {
    expect(urlRungTierName('subdomain')).toBe('Pro League')
    expect(urlRungTierName('custom')).toBe('Dynasty')
  })

  it('bestUrlRung is what a plan actually delivers', () => {
    expect(bestUrlRung('starter', PAID)).toBe('path')
    expect(bestUrlRung('pro', PAID)).toBe('subdomain')
    expect(bestUrlRung('dynasty', PAID)).toBe('custom')
    expect(bestUrlRung('dynasty', 'none')).toBe('path')
  })
})

describe('leagueUrls — RUNG 1, the path prefix', () => {
  it('resolves a slug-shaped first segment', () => {
    expect(pathLeagueSlug('/shinobistrikerleague', '')).toBe('shinobistrikerleague')
    expect(pathLeagueSlug('/shinobistrikerleague/', '')).toBe('shinobistrikerleague')
    expect(pathLeagueSlug('/blaze/reels/123', '')).toBe('blaze')
    expect(pathLeagueSlug('/BLAZE', '')).toBe('blaze')
  })

  it('NEVER eats one of the app\'s own routes', () => {
    for (const route of [
      '/tournaments/abc', '/reels', '/live', '/studio', '/leagues', '/make-a-league',
      '/marketing', '/forge', '/profile/xyz', '/stat-check-room', '/api/league/x/config',
      '/assets/index-abc.js', '/icons/192.png', '/upgrade', '/login', '/settings',
      '/forgot-password', '/reset-password?token=one-time-code', '/session-bridge',
      '/roster-invite?token=invite-code', '/privacy-settings', '/villages/leaf',
    ]) {
      expect(pathLeagueSlug(route, '')).toBeNull()
    }
    expect(isReservedLeaguePath('tournaments')).toBe(true)
    expect(isReservedLeaguePath('shinobistrikerleague')).toBe(false)
  })

  it('reserves every top-level route currently registered by App', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    const paths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1])
    const roots = paths
      .map((path) => path.replace(/^\/+/, '').split('/')[0])
      .filter((root) => root && root !== '*')
    for (const root of roots) {
      expect(isReservedLeaguePath(root), `App route /${root} must be reserved`).toBe(true)
    }
  })

  it('rejects anything that is not a clean slug', () => {
    expect(pathLeagueSlug('/', '')).toBeNull()
    expect(pathLeagueSlug('', '')).toBeNull()
    expect(pathLeagueSlug('/-leading-hyphen', '')).toBeNull()
    expect(pathLeagueSlug('/has_underscore', '')).toBeNull()
    expect(pathLeagueSlug('/has.dot', '')).toBeNull()
    expect(pathLeagueSlug('/sw.js', '')).toBeNull()
    expect(pathLeagueSlug(`/${'x'.repeat(80)}`, '')).toBeNull()
  })

  it('honours the bundle base path (the legacy /app deploy)', () => {
    expect(pathLeagueSlug('/app/blaze/reels', '/app/')).toBe('blaze')
    expect(pathLeagueSlug('/app/tournaments', '/app/')).toBeNull()
    // Without the base stripped, '/app' itself is reserved, so no false match.
    expect(pathLeagueSlug('/app/blaze', '')).toBeNull()
  })

  it('the prefix survives navigation and can be stripped back off', () => {
    expect(leaguePathPrefix('/blaze/reels/1', '')).toBe('/blaze')
    expect(leaguePathPrefix('/reels/1', '')).toBe('')
    expect(stripLeaguePathPrefix('/blaze/reels/1', '')).toBe('/reels/1')
    expect(stripLeaguePathPrefix('/blaze', '')).toBe('/')
    expect(stripLeaguePathPrefix('/reels/1', '')).toBe('/reels/1')
    expect(stripLeaguePathPrefix('/app/blaze/reels', '/app/')).toBe('/app/reels')
  })
})

describe('leagueUrls — RUNG 2, the subdomain', () => {
  it('resolves <slug>.tko.cam', () => {
    expect(subdomainLeagueSlug('blaze.tko.cam')).toBe('blaze')
    expect(subdomainLeagueSlug('BLAZE.TKO.CAM')).toBe('blaze')
    expect(subdomainLeagueSlug('shinobistrikerleague.tko.cam')).toBe('shinobistrikerleague')
  })

  it('the apex and www are not leagues', () => {
    expect(subdomainLeagueSlug('tko.cam')).toBeNull()
    expect(subdomainLeagueSlug('www.tko.cam')).toBeNull()
  })

  it('INFRASTRUCTURE labels can never be taken over by a league', () => {
    for (const label of ['api', 'cdn', 'static', 'mail', 'admin', 'status', 'auth', 'webhook']) {
      expect(isReservedSubdomain(label)).toBe(true)
      expect(subdomainLeagueSlug(`${label}.tko.cam`)).toBeNull()
    }
  })

  it('only one label deep, and only on tko.cam', () => {
    expect(subdomainLeagueSlug('a.b.tko.cam')).toBeNull()
    expect(subdomainLeagueSlug('blaze.example.com')).toBeNull()
  })
})

describe('leagueUrls — RUNG 3, claiming a real domain', () => {
  it('reads whatever the owner pasted into a bare hostname', () => {
    expect(normalizeCustomDomain('https://WWW.Blaze.GG/join?x=1')).toBe('blaze.gg')
    expect(normalizeCustomDomain('  blaze.gg.  ')).toBe('blaze.gg')
    expect(normalizeCustomDomain('http://shinobistrikerleague.com')).toBe('shinobistrikerleague.com')
  })

  it('refuses what can never be a claimable domain', () => {
    // tko.cam and its subdomains are rungs 1/2 — handed out by tier, not claimed.
    expect(normalizeCustomDomain('tko.cam')).toBe('')
    expect(normalizeCustomDomain('blaze.tko.cam')).toBe('')
    expect(normalizeCustomDomain('localhost')).toBe('')
    expect(normalizeCustomDomain('192.168.1.5')).toBe('')
    expect(normalizeCustomDomain('nodot')).toBe('')
    expect(normalizeCustomDomain('')).toBe('')
    expect(isClaimableCustomDomain('blaze.gg')).toBe(true)
    expect(isClaimableCustomDomain('a.local')).toBe(false)
  })

  it('the TXT challenge is one exact record', () => {
    const rec = domainVerificationRecord('blaze.gg', TOKEN)
    expect(rec).toEqual({
      host: '_tko-verify.blaze.gg',
      name: '_tko-verify',
      type: 'TXT',
      value: `tko-verify=${TOKEN}`,
    })
    expect(domainVerificationRecord('blaze.gg', 'short')).toBeNull()
    expect(domainVerificationRecord('tko.cam', TOKEN)).toBeNull()
  })

  it('proof survives registrar quoting/chunking — and nothing else passes', () => {
    expect(txtRecordsProve([`tko-verify=${TOKEN}`], TOKEN)).toBe(true)
    expect(txtRecordsProve([`"tko-verify=${TOKEN}"`], TOKEN)).toBe(true)
    expect(txtRecordsProve(['v=spf1 -all', ` tko-verify=${TOKEN} `], TOKEN)).toBe(true)
    expect(txtRecordsProve([`tko-verify=${'b'.repeat(32)}`], TOKEN)).toBe(false)
    expect(txtRecordsProve([TOKEN], TOKEN)).toBe(false) // prefix required
    expect(txtRecordsProve([], TOKEN)).toBe(false)
    expect(txtRecordsProve([`tko-verify=${TOKEN}`], 'bad')).toBe(false)
  })
})

describe('leagueUrls — the addresses a league actually has', () => {
  const base: LeagueUrlIdentity = {
    slug: 'blaze', tier: 'starter', planStatus: 'active',
    customDomain: '', customDomainStatus: 'none',
  }

  it('starter gets exactly one address', () => {
    expect(leagueUrlForRung('path', base)).toBe('https://tko.cam/blaze')
    expect(leagueUrlForRung('subdomain', base)).toBeNull()
    expect(leagueUrlForRung('custom', base)).toBeNull()
    expect(primaryLeagueUrl(base)).toBe('https://tko.cam/blaze')
  })

  it('pro adds the subdomain and prefers it', () => {
    const pro = { ...base, tier: 'pro' as const }
    expect(leagueUrlForRung('subdomain', pro)).toBe('https://blaze.tko.cam')
    expect(primaryLeagueUrl(pro)).toBe('https://blaze.tko.cam')
  })

  it('a PENDING custom domain is not an address yet', () => {
    const ent = {
      ...base, tier: 'dynasty' as const,
      customDomain: 'blaze.gg', customDomainStatus: 'pending' as const,
    }
    expect(leagueUrlForRung('custom', ent)).toBeNull()
    expect(primaryLeagueUrl(ent)).toBe('https://blaze.tko.cam')
  })

  it('a VERIFIED custom domain wins', () => {
    const ent = {
      ...base, tier: 'dynasty' as const,
      customDomain: 'blaze.gg', customDomainStatus: 'verified' as const,
    }
    expect(leagueUrlForRung('custom', ent)).toBe('https://blaze.gg')
    expect(primaryLeagueUrl(ent)).toBe('https://blaze.gg')
  })
})

describe('leagueUrls — the host gate (where the tier becomes real)', () => {
  const league = (over: Partial<LeagueUrlIdentity>): LeagueUrlIdentity => ({
    slug: 'blaze', tier: 'starter', planStatus: 'active',
    customDomain: '', customDomainStatus: 'none', ...over,
  })

  it('the apex and unrelated hosts pass straight through', () => {
    expect(decideHostGate('tko.cam', () => null)).toEqual({ action: 'pass' })
    expect(decideHostGate('www.tko.cam', () => null)).toEqual({ action: 'pass' })
    expect(decideHostGate('api.tko.cam', () => league({}))).toEqual({ action: 'pass' })
    expect(decideHostGate('random-site.com', () => null)).toEqual({ action: 'pass' })
  })

  it('a Pro league is SERVED on its subdomain', () => {
    expect(decideHostGate('blaze.tko.cam', () => league({ tier: 'pro' }))).toEqual({
      action: 'serve', slug: 'blaze', rung: 'subdomain',
    })
  })

  it('a Starter league on a subdomain is redirected DOWN to its path, not refused', () => {
    expect(decideHostGate('blaze.tko.cam', () => league({ tier: 'starter' }))).toEqual({
      action: 'redirect', slug: 'blaze', to: '/blaze', reason: 'tier',
    })
  })

  it('an unknown subdomain is not an error — the app boots stock', () => {
    expect(decideHostGate('nosuchleague.tko.cam', () => null)).toEqual({ action: 'pass' })
  })

  it('a verified top-plan domain is served; a Pro one is redirected', () => {
    const verified = league({ tier: 'dynasty', customDomain: 'blaze.gg', customDomainStatus: 'verified' })
    expect(decideHostGate('blaze.gg', () => verified)).toEqual({
      action: 'serve', slug: 'blaze', rung: 'custom',
    })
    const downgraded = league({ tier: 'pro', customDomain: 'blaze.gg', customDomainStatus: 'verified' })
    expect(decideHostGate('blaze.gg', () => downgraded)).toEqual({
      action: 'redirect', slug: 'blaze', to: '/blaze', reason: 'tier',
    })
  })

  it('an UNVERIFIED claim never serves — you cannot point DNS at us and win', () => {
    const pending = league({ tier: 'dynasty', customDomain: 'blaze.gg', customDomainStatus: 'pending' })
    expect(decideHostGate('blaze.gg', () => pending)).toEqual({
      action: 'redirect', slug: 'blaze', to: '/blaze', reason: 'unverified',
    })
  })

  it('normalizes the host before deciding (www, case, trailing dot, port)', () => {
    expect(normalizeHost('WWW.Blaze.TKO.cam:443.')).toBe('blaze.tko.cam')
    expect(decideHostGate('WWW.blaze.tko.cam', () => league({ tier: 'pro' }))).toEqual({
      action: 'serve', slug: 'blaze', rung: 'subdomain',
    })
  })
})
