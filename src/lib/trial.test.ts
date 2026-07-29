import { describe, it, expect } from 'vitest'
import {
  startTrial,
  resolveTrial,
  isTrialActive,
  trialDaysLeft,
  declineTrial,
  withCardOnFile,
  trialFromUser,
  trialState,
  isUserTrialActive,
  startTrialMeta,
  convertTrialMeta,
  declineTrialMeta,
  expireTrialMeta,
  TRIAL_META_KEY,
  TRIAL_DAYS,
} from './trial'
import { entitlementsFromUser } from './entitlements'

const DAY = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000 // fixed base clock
const userWith = (md: Record<string, unknown>) => ({ user_metadata: md })

describe('trial state machine (pure)', () => {
  it('startTrial creates a 7-day active trial', () => {
    const t = startTrial('pro', false, NOW)
    expect(t.tier).toBe('pro')
    expect(t.status).toBe('active')
    expect(t.cardOnFile).toBe(false)
    expect(Date.parse(t.startedAt)).toBe(NOW)
    expect(Date.parse(t.endsAt)).toBe(NOW + TRIAL_DAYS * DAY)
  })

  it('is active across the 7-day window and lapses at endsAt', () => {
    const t = startTrial('supporter', true, NOW)
    expect(isTrialActive(t, NOW)).toBe(true)
    expect(isTrialActive(t, NOW + 6 * DAY)).toBe(true)
    expect(trialDaysLeft(t, NOW)).toBe(TRIAL_DAYS)
    expect(trialDaysLeft(t, NOW + 6 * DAY)).toBe(1)
    // At/after endsAt it is no longer "active".
    expect(isTrialActive(t, NOW + 7 * DAY)).toBe(false)
    expect(trialDaysLeft(t, NOW + 8 * DAY)).toBe(0)
  })

  it('CONVERTS at endsAt when a card is on file', () => {
    const t = startTrial('pro', true, NOW)
    const resolved = resolveTrial(t, NOW + 7 * DAY)
    expect(resolved.status).toBe('converted')
  })

  it('LAPSES (expired) at endsAt when there is no card', () => {
    const t = startTrial('pro', false, NOW)
    const resolved = resolveTrial(t, NOW + 7 * DAY)
    expect(resolved.status).toBe('expired')
  })

  it('does not resolve before endsAt', () => {
    const t = startTrial('pro', true, NOW)
    expect(resolveTrial(t, NOW + 3 * DAY).status).toBe('active')
  })

  it('declined trials stay declined and never convert', () => {
    const t = declineTrial(startTrial('pro', true, NOW))
    expect(t.status).toBe('declined')
    expect(resolveTrial(t, NOW + 30 * DAY).status).toBe('declined')
  })

  it('withCardOnFile toggles the flag', () => {
    const t = startTrial('creator', false, NOW)
    expect(withCardOnFile(t, true).cardOnFile).toBe(true)
  })
})

describe('trial metadata read/write', () => {
  it('startTrialMeta grants the tier via the entitlement path', () => {
    const patch = startTrialMeta('pro', false, NOW)
    expect(patch.reelone_tier).toBe('pro')
    expect(Date.parse(patch.reelone_tier_expires)).toBe(NOW + TRIAL_DAYS * DAY)
    // useEntitlements/entitlementsFromUser grants premium DURING the trial…
    const ent = entitlementsFromUser(userWith(patch), { now: NOW })
    expect(ent.isPremium).toBe(true)
    expect(ent.tier).toBe('pro')
    // …and lapses cleanly once the trial window passes.
    const lapsed = entitlementsFromUser(userWith(patch), { now: NOW + 8 * DAY })
    expect(lapsed.isPremium).toBe(false)
    expect(lapsed.tier).toBe('')
  })

  it('trialFromUser / trialState / isUserTrialActive read the record', () => {
    const user = userWith(startTrialMeta('supporter', true, NOW))
    expect(trialFromUser(user)?.tier).toBe('supporter')
    expect(isUserTrialActive(user, NOW)).toBe(true)
    // trialState resolves to converted after the window (card on file).
    expect(trialState(user, NOW + 8 * DAY)?.status).toBe('converted')
  })

  it('trialFromUser returns null for missing/invalid records', () => {
    expect(trialFromUser(null)).toBeNull()
    expect(trialFromUser(userWith({}))).toBeNull()
    expect(trialFromUser(userWith({ [TRIAL_META_KEY]: { tier: 'nope', status: 'active' } }))).toBeNull()
  })

  it('convertTrialMeta extends the paid entitlement +30 days', () => {
    const record = startTrial('pro', true, NOW)
    const endNow = NOW + 7 * DAY
    const patch = convertTrialMeta(record, endNow)
    expect(patch.reelone_tier).toBe('pro')
    expect(patch[TRIAL_META_KEY].status).toBe('converted')
    // Still premium at the moment of conversion and beyond the old trial end.
    const ent = entitlementsFromUser(userWith(patch), { now: endNow + 5 * DAY })
    expect(ent.isPremium).toBe(true)
  })

  it('declineTrialMeta drops to free immediately', () => {
    const record = startTrial('pro', false, NOW)
    const patch = declineTrialMeta(record)
    expect(patch.reelone_tier).toBe('')
    expect(patch[TRIAL_META_KEY].status).toBe('declined')
    const ent = entitlementsFromUser(userWith(patch), { now: NOW })
    expect(ent.isPremium).toBe(false)
  })

  it('expireTrialMeta marks the record expired', () => {
    const record = startTrial('pro', false, NOW)
    expect(expireTrialMeta(record)[TRIAL_META_KEY].status).toBe('expired')
  })
})
