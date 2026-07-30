import { describe, it, expect, beforeEach } from 'vitest'
import {
  makePrediction,
  cancelPrediction,
  resolvePrediction,
  readPredictions,
  getStats,
  getOpenForTournament,
  canPredict,
  openCount,
  correctCount,
  currentStreak,
  accuracy,
  rewardForCorrect,
  PREDICTION_REWARDS,
  type PredictionStorage,
  type Prediction,
} from './predictions'
import {
  oracleBadgeForCorrect,
  nextOracleMilestone,
  oracleBadgesForCorrect,
} from './badges'
import { getOwned, type AssetStorage } from './assets'

// In-memory storage shim so the core is testable without a DOM/localStorage.
// PredictionStorage + AssetStorage are the same shape, so one shim covers both.
function memStorage(): PredictionStorage & AssetStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => { m.set(k, v) },
  }
}

const U = 'user-1'
const pick = (winnerId: string, label = winnerId) => ({ winnerId, label })

describe('predictions — quota (canPredict)', () => {
  it('free tier allows exactly 1 open prediction', () => {
    expect(canPredict(0, '')).toBe(true)
    expect(canPredict(1, '')).toBe(false)
    expect(canPredict(0, 'free')).toBe(true)
    expect(canPredict(1, 'free')).toBe(false)
  })

  it('ladder widens with tier', () => {
    expect(canPredict(1, 'ad_free')).toBe(true)
    expect(canPredict(2, 'ad_free')).toBe(false)
    expect(canPredict(2, 'pro')).toBe(true)
    expect(canPredict(3, 'pro')).toBe(false)
    expect(canPredict(5, 'supporter')).toBe(true)
    expect(canPredict(6, 'supporter')).toBe(false)
  })

  it('creator is unlimited', () => {
    expect(canPredict(0, 'creator')).toBe(true)
    expect(canPredict(999, 'creator')).toBe(true)
  })
})

describe('predictions — making & enforcing quota', () => {
  let s: PredictionStorage & AssetStorage
  beforeEach(() => { s = memStorage() })

  it('creates an open prediction', () => {
    const res = makePrediction({ userId: U, tournamentId: 't1', pick: pick('w1'), tier: '' }, s, 1000)
    expect(res.ok).toBe(true)
    const all = readPredictions(U, s)
    expect(all).toHaveLength(1)
    expect(all[0].status).toBe('open')
  })

  it('rejects a second open prediction on the SAME tournament', () => {
    makePrediction({ userId: U, tournamentId: 't1', pick: pick('w1'), tier: 'pro' }, s, 1000)
    const res = makePrediction({ userId: U, tournamentId: 't1', pick: pick('w2'), tier: 'pro' }, s, 2000)
    expect(res).toEqual({ ok: false, reason: 'exists' })
  })

  it('enforces the tier quota across DIFFERENT tournaments', () => {
    // Free tier: 1 open allowed.
    expect(makePrediction({ userId: U, tournamentId: 't1', pick: pick('w1'), tier: '' }, s, 1000).ok).toBe(true)
    const blocked = makePrediction({ userId: U, tournamentId: 't2', pick: pick('w2'), tier: '' }, s, 2000)
    expect(blocked).toEqual({ ok: false, reason: 'quota' })
  })

  it('pro tier allows 3 open predictions then blocks the 4th', () => {
    expect(makePrediction({ userId: U, tournamentId: 't1', pick: pick('a'), tier: 'pro' }, s, 1).ok).toBe(true)
    expect(makePrediction({ userId: U, tournamentId: 't2', pick: pick('b'), tier: 'pro' }, s, 2).ok).toBe(true)
    expect(makePrediction({ userId: U, tournamentId: 't3', pick: pick('c'), tier: 'pro' }, s, 3).ok).toBe(true)
    expect(makePrediction({ userId: U, tournamentId: 't4', pick: pick('d'), tier: 'pro' }, s, 4).ok).toBe(false)
  })

  it('cancelling an open prediction frees a slot', () => {
    makePrediction({ userId: U, tournamentId: 't1', pick: pick('w1'), tier: '' }, s, 1000)
    expect(cancelPrediction(U, 't1', s)).toBe(true)
    expect(openCount(readPredictions(U, s))).toBe(0)
    // Now a new one fits under the free cap again.
    expect(makePrediction({ userId: U, tournamentId: 't2', pick: pick('w2'), tier: '' }, s, 2000).ok).toBe(true)
  })

  it('requires a user id', () => {
    expect(makePrediction({ userId: '', tournamentId: 't1', pick: pick('w1'), tier: 'creator' }, s).ok).toBe(false)
  })
})

describe('predictions — resolving correct / wrong', () => {
  let s: PredictionStorage & AssetStorage
  beforeEach(() => { s = memStorage() })

  it('marks a matching pick correct and grants a reward asset', () => {
    makePrediction({ userId: U, tournamentId: 't1', pick: pick('winner-x'), tier: 'creator' }, s, 1000)
    const res = resolvePrediction(U, 't1', 'winner-x', s, 2000)
    expect(res.resolved).toBe(true)
    if (res.resolved) {
      expect(res.status).toBe('correct')
      expect(res.reward).toBeDefined()
    }
    const stats = getStats(U, s)
    expect(stats.correctCount).toBe(1)
    // The reward landed in the user's locker (getOwned resolves it from catalog).
    const owned = getOwned(U, s)
    expect(owned.some((a) => a.id === PREDICTION_REWARDS[0].id)).toBe(true)
  })

  it('marks a non-matching pick wrong with no reward', () => {
    makePrediction({ userId: U, tournamentId: 't1', pick: pick('winner-x'), tier: 'creator' }, s, 1000)
    const res = resolvePrediction(U, 't1', 'someone-else', s, 2000)
    expect(res.resolved).toBe(true)
    if (res.resolved) {
      expect(res.status).toBe('wrong')
      expect(res.reward).toBeUndefined()
    }
    expect(getStats(U, s).correctCount).toBe(0)
    expect(getOwned(U, s)).toHaveLength(0)
  })

  it('is a no-op when there is no open prediction', () => {
    expect(resolvePrediction(U, 't1', 'x', s, 1000)).toEqual({ resolved: false })
  })

  it('does not re-resolve an already-graded prediction', () => {
    makePrediction({ userId: U, tournamentId: 't1', pick: pick('w'), tier: 'creator' }, s, 1000)
    resolvePrediction(U, 't1', 'w', s, 2000)
    // No open prediction remains for t1.
    expect(getOpenForTournament(U, 't1', s)).toBeNull()
    expect(resolvePrediction(U, 't1', 'w', s, 3000)).toEqual({ resolved: false })
    expect(getStats(U, s).correctCount).toBe(1)
  })
})

describe('predictions — streak resets on a wrong result', () => {
  let s: PredictionStorage & AssetStorage
  beforeEach(() => { s = memStorage() })

  it('grows on correct and resets to 0 on wrong', () => {
    makePrediction({ userId: U, tournamentId: 't1', pick: pick('w'), tier: 'creator' }, s, 10)
    resolvePrediction(U, 't1', 'w', s, 100) // correct
    makePrediction({ userId: U, tournamentId: 't2', pick: pick('w'), tier: 'creator' }, s, 20)
    resolvePrediction(U, 't2', 'w', s, 200) // correct
    expect(getStats(U, s).streak).toBe(2)

    makePrediction({ userId: U, tournamentId: 't3', pick: pick('w'), tier: 'creator' }, s, 30)
    resolvePrediction(U, 't3', 'nope', s, 300) // wrong
    expect(getStats(U, s).streak).toBe(0)

    makePrediction({ userId: U, tournamentId: 't4', pick: pick('w'), tier: 'creator' }, s, 40)
    resolvePrediction(U, 't4', 'w', s, 400) // correct
    expect(getStats(U, s).streak).toBe(1)
  })
})

describe('predictions — pure stat helpers', () => {
  const preds: Prediction[] = [
    { tournamentId: 't1', userId: U, pick: pick('w'), createdAt: 1, status: 'correct', resolvedAt: 10 },
    { tournamentId: 't2', userId: U, pick: pick('w'), createdAt: 2, status: 'wrong', resolvedAt: 20 },
    { tournamentId: 't3', userId: U, pick: pick('w'), createdAt: 3, status: 'correct', resolvedAt: 30 },
    { tournamentId: 't4', userId: U, pick: pick('w'), createdAt: 4, status: 'open' },
  ]

  it('counts open/correct and computes accuracy over resolved', () => {
    expect(openCount(preds)).toBe(1)
    expect(correctCount(preds)).toBe(2)
    expect(accuracy(preds)).toBeCloseTo(2 / 3)
  })

  it('accuracy is 0 with nothing resolved', () => {
    expect(accuracy([{ tournamentId: 't', userId: U, pick: pick('w'), createdAt: 1, status: 'open' }])).toBe(0)
  })

  it('current streak counts back from the newest resolved', () => {
    expect(currentStreak(preds)).toBe(1) // t3 correct, preceded by t2 wrong
  })

  it('rewardForCorrect cycles the pool deterministically', () => {
    expect(rewardForCorrect(1).id).toBe(PREDICTION_REWARDS[0].id)
    expect(rewardForCorrect(PREDICTION_REWARDS.length + 1).id).toBe(PREDICTION_REWARDS[0].id)
  })
})

describe('oracle badge progression', () => {
  it('returns the highest earned badge for a cumulative correct count', () => {
    expect(oracleBadgeForCorrect(0)).toBeNull()
    expect(oracleBadgeForCorrect(1)).toBe('novice_oracle')
    expect(oracleBadgeForCorrect(4)).toBe('novice_oracle')
    expect(oracleBadgeForCorrect(5)).toBe('oracle')
    expect(oracleBadgeForCorrect(15)).toBe('adept_oracle')
    expect(oracleBadgeForCorrect(30)).toBe('master_oracle')
    expect(oracleBadgeForCorrect(49)).toBe('master_oracle')
    expect(oracleBadgeForCorrect(50)).toBe('grand_oracle')
    expect(oracleBadgeForCorrect(999)).toBe('grand_oracle')
  })

  it('degrades cleanly on bad input', () => {
    expect(oracleBadgeForCorrect(-3)).toBeNull()
    expect(oracleBadgeForCorrect(NaN)).toBeNull()
  })

  it('nextOracleMilestone points at the next rung, null at the top', () => {
    expect(nextOracleMilestone(0)?.badgeId).toBe('novice_oracle')
    expect(nextOracleMilestone(1)?.badgeId).toBe('oracle')
    expect(nextOracleMilestone(29)?.badgeId).toBe('master_oracle')
    expect(nextOracleMilestone(50)).toBeNull()
  })

  it('oracleBadgesForCorrect returns all earned rungs, prestige-sorted', () => {
    const earned = oracleBadgesForCorrect(30)
    expect(earned.map((b) => b.id)).toContain('master_oracle')
    expect(earned.map((b) => b.id)).toContain('novice_oracle')
    // prestige descending
    for (let i = 1; i < earned.length; i++) {
      expect(earned[i - 1].prestige).toBeGreaterThanOrEqual(earned[i].prestige)
    }
  })
})
