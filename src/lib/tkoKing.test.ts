import { describe, it, expect } from 'vitest'
import {
  KING_PIT_FORMAT,
  isKingPit,
  TKO_HOST_CODES,
  isHostCode,
  isTkoHost,
  grantHostMeta,
  HOST_META_KEY,
  membershipGrantMeta,
  COMPETITOR_TIER,
  canRegister,
  registrationProgress,
  registrationChannelSettled,
  REGISTRATION_STEP_KEYS,
  REGISTRATION_REQUIRED_STEP_KEYS,
  REGISTRATION_RECOMMENDED_STEP_KEYS,
  REGISTRATION_REQUIRED_COUNT,
  kingPhase,
  isEnrollmentOpen,
  isBattleDecided,
  forfeitOutcome,
  buildTrophyCloset,
  trophyCountLabel,
  COUNT_COMING_SOON,
  KING_SCHEDULE,
  KING_SCHEDULED_PHASES,
  KING_ENROLL_CLOSES,
  scheduledKingPhase,
  scheduledPhaseLabel,
  scheduledPhaseAction,
  nextScheduledPhase,
  phaseStartIso,
  kingPhaseState,
  isScheduledEnrollmentOpen,
  kingTournamentSeed,
  scheduledToLegacyPhase,
  formatCountdown,
  upcomingBattles,
  battleTimingLabel,
  totalRoundsForField,
  roundLabel,
  buildKingBoard,
  canSeeMeetup,
  isMeetupReady,
  normalizeMeetup,
  advancementPrize,
  grantAdvancementPrize,
  prizeNotification,
  KING_CROWN_PRIZE,
  KING_FINALIST_PRIZE,
  KING_SEMIFINALIST_PRIZE,
  KING_PRIZE_ID_PREFIX,
  KING_PRIZE_TABLE,
  type RegistrationChecklist,
  type BattleLike,
} from './tkoKing'

const MS_DAY = 24 * 60 * 60 * 1000
const iso = (deltaDays: number, now = Date.now()) => new Date(now + deltaDays * MS_DAY).toISOString()

describe('tkoKing — format', () => {
  it('detects king_pit format', () => {
    expect(isKingPit({ format: KING_PIT_FORMAT })).toBe(true)
    expect(isKingPit({ format: 'standard' })).toBe(false)
    expect(isKingPit({})).toBe(false)
    expect(isKingPit(null)).toBe(false)
  })
})

describe('tkoKing — host codes + flag', () => {
  it('has exactly 5 distinct host codes in the right format', () => {
    expect(TKO_HOST_CODES).toHaveLength(5)
    expect(new Set(TKO_HOST_CODES).size).toBe(5)
    for (const c of TKO_HOST_CODES) expect(c).toMatch(/^TKO-HOST-[A-Z0-9]{6}$/)
  })

  it('recognizes host codes case-insensitively, trims, rejects others', () => {
    expect(isHostCode(TKO_HOST_CODES[0])).toBe(true)
    expect(isHostCode(`  ${TKO_HOST_CODES[1].toLowerCase()}  `)).toBe(true)
    expect(isHostCode('KILLCAM-EHP6-9SX9')).toBe(false)
    expect(isHostCode('')).toBe(false)
    expect(isHostCode(null)).toBe(false)
  })

  it('reads + grants the tko_host flag', () => {
    expect(isTkoHost(null)).toBe(false)
    expect(isTkoHost({ user_metadata: {} })).toBe(false)
    expect(isTkoHost({ user_metadata: { [HOST_META_KEY]: true } })).toBe(true)
    expect(grantHostMeta()).toEqual({ [HOST_META_KEY]: true })
  })
})

describe('tkoKing — membership grant (+30d ad_free, never downgrades)', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z')

  it('grants ad_free for ~30 days to a free user', () => {
    const patch = membershipGrantMeta({ user_metadata: {} }, now)
    expect(patch).not.toBeNull()
    expect(patch!.reelone_tier).toBe(COMPETITOR_TIER)
    expect(Date.parse(patch!.reelone_tier_expires)).toBe(now + 30 * MS_DAY)
  })

  it('does not downgrade a still-active streaming tier that outlasts 30 days', () => {
    const user = { user_metadata: { reelone_tier: 'pro', reelone_tier_expires: iso(90, now) } }
    expect(membershipGrantMeta(user, now)).toBeNull()
  })

  it('never shortens a longer existing ad_free grant', () => {
    const user = { user_metadata: { reelone_tier: 'ad_free', reelone_tier_expires: iso(50, now) } }
    const patch = membershipGrantMeta(user, now)
    expect(patch).not.toBeNull()
    expect(Date.parse(patch!.reelone_tier_expires)).toBe(now + 50 * MS_DAY)
  })

  it('re-grants when an expired tier is present', () => {
    const user = { user_metadata: { reelone_tier: 'pro', reelone_tier_expires: iso(-5, now) } }
    const patch = membershipGrantMeta(user, now)
    expect(patch).not.toBeNull()
    expect(patch!.reelone_tier).toBe(COMPETITOR_TIER)
    expect(Date.parse(patch!.reelone_tier_expires)).toBe(now + 30 * MS_DAY)
  })
})

describe('tkoKing — registration gate', () => {
  const full: RegistrationChecklist = {
    signedIn: true,
    youtubeConnected: true,
    agreedToStream: true,
    noModAck: true,
    statCheckDone: true,
  }

  it('requires all 4 required steps', () => {
    expect(REGISTRATION_REQUIRED_COUNT).toBe(4)
    expect(canRegister(full)).toBe(true)
    expect(registrationProgress(full)).toBe(4)
    for (const k of REGISTRATION_REQUIRED_STEP_KEYS) {
      expect(canRegister({ ...full, [k]: false })).toBe(false)
    }
  })

  it('does NOT require YouTube — registration completes without a linked channel', () => {
    const noChannel: RegistrationChecklist = { ...full, youtubeConnected: false }
    expect(canRegister(noChannel)).toBe(true)
    // The recommended step never counts toward the required tally.
    expect(registrationProgress(noChannel)).toBe(4)
  })

  it('keeps YouTube out of the required set but still in the rendered set', () => {
    expect(REGISTRATION_REQUIRED_STEP_KEYS).not.toContain('youtubeConnected')
    expect(REGISTRATION_RECOMMENDED_STEP_KEYS).toEqual(['youtubeConnected'])
    expect(REGISTRATION_STEP_KEYS).toContain('youtubeConnected')
    // Every required key is also a rendered key.
    for (const k of REGISTRATION_REQUIRED_STEP_KEYS) {
      expect(REGISTRATION_STEP_KEYS).toContain(k)
    }
  })

  it('settles the channel step via a link OR the "add it later" acknowledgement', () => {
    expect(registrationChannelSettled({ ...full, youtubeConnected: true })).toBe(true)
    expect(registrationChannelSettled({ ...full, youtubeConnected: false })).toBe(false)
    expect(
      registrationChannelSettled({ ...full, youtubeConnected: false, streamPlanAck: true }),
    ).toBe(true)
    // …and the acknowledgement is display-only: it never gates entry.
    expect(canRegister({ ...full, youtubeConnected: false, streamPlanAck: false })).toBe(true)
  })

  it('counts partial progress across the required steps only', () => {
    expect(registrationProgress({ ...full, statCheckDone: false, noModAck: false })).toBe(2)
    expect(registrationProgress({ ...full, youtubeConnected: false })).toBe(4)
  })
})

describe('tkoKing — phases', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z')

  it('closed status is complete', () => {
    expect(kingPhase({ status: 'closed' }, now)).toBe('complete')
  })

  it('walks enroll → scheduling → battles by date', () => {
    const t = { enroll_closes: iso(5, now), start_at: iso(10, now) }
    expect(kingPhase(t, now)).toBe('enroll')
    expect(kingPhase(t, now + 6 * MS_DAY)).toBe('scheduling')
    expect(kingPhase(t, now + 11 * MS_DAY)).toBe('battles')
  })

  it('defaults to enroll with no windows set', () => {
    expect(kingPhase({}, now)).toBe('enroll')
    expect(isEnrollmentOpen({}, now)).toBe(true)
  })

  it('enrollment not open before enroll_opens', () => {
    expect(isEnrollmentOpen({ enroll_opens: iso(2, now) }, now)).toBe(false)
    expect(isEnrollmentOpen({ enroll_opens: iso(-2, now) }, now)).toBe(true)
  })
})

describe('tkoKing — battles + forfeit', () => {
  it('decides on complete or forfeit', () => {
    expect(isBattleDecided('scheduled')).toBe(false)
    expect(isBattleDecided('live')).toBe(false)
    expect(isBattleDecided('complete')).toBe(true)
    expect(isBattleDecided('forfeit')).toBe(true)
  })

  it('a no-show forfeits; the present player wins', () => {
    expect(forfeitOutcome('a', 'b', 'a')).toEqual({ winner: 'b', loser: 'a' })
    expect(forfeitOutcome('a', 'b', 'b')).toEqual({ winner: 'a', loser: 'b' })
    expect(forfeitOutcome('a', 'b', 'c')).toBeNull()
    expect(forfeitOutcome('a', null, 'a')).toBeNull()
  })
})

describe('tkoKing — trophy closet', () => {
  it('aggregates defeats per opponent, most-beaten first', () => {
    const closet = buildTrophyCloset([
      { opponent_id: 'x', beat_count: 2, opponent_username: 'foo' },
      { opponent_id: 'y', beat_count: 5, opponent_username: 'bar' },
      { opponent_id: 'x', beat_count: 1, opponent_username: 'foo' },
    ])
    expect(closet).toHaveLength(2)
    expect(closet[0].opponentId).toBe('y')
    expect(closet[0].beatCount).toBe(5)
    expect(closet[1].opponentId).toBe('x')
    expect(closet[1].beatCount).toBe(3)
  })

  it('shows the count as a coming-soon placeholder for now', () => {
    const [t] = buildTrophyCloset([{ opponent_id: 'x', beat_count: 9 }])
    expect(trophyCountLabel(t)).toBe(COUNT_COMING_SOON)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  THE SCHEDULE — the King runs itself off the calendar, with no organizer.
// ───────────────────────────────────────────────────────────────────────────

const at = (s: string) => Date.parse(s)

describe('tkoKing — KING_SCHEDULE constants', () => {
  it('encodes season 1: enroll 09-07, battles 09-28, finals 10-26, crowned 11-01', () => {
    expect(KING_SCHEDULE.enrollOpens).toBe('2026-09-07T00:00:00.000Z')
    expect(KING_SCHEDULE.battlesStart).toBe('2026-09-28T00:00:00.000Z')
    expect(KING_SCHEDULE.finalsStart).toBe('2026-10-26T00:00:00.000Z')
    expect(KING_SCHEDULE.crownedAt).toBe('2026-11-01T00:00:00.000Z')
  })

  it('opens on a Monday and crowns on a Sunday', () => {
    expect(new Date(KING_SCHEDULE.enrollOpens).getUTCDay()).toBe(1) // Mon
    expect(new Date(KING_SCHEDULE.battlesStart).getUTCDay()).toBe(1) // Mon
    expect(new Date(KING_SCHEDULE.finalsStart).getUTCDay()).toBe(1) // Mon
    expect(new Date(KING_SCHEDULE.crownedAt).getUTCDay()).toBe(0) // Sun
  })

  it('enrollment closes exactly when battles begin — no dead gap', () => {
    expect(KING_ENROLL_CLOSES).toBe(KING_SCHEDULE.battlesStart)
  })

  it('boundaries are strictly increasing', () => {
    const order = [
      KING_SCHEDULE.enrollOpens,
      KING_SCHEDULE.battlesStart,
      KING_SCHEDULE.finalsStart,
      KING_SCHEDULE.crownedAt,
    ].map(at)
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1])
  })
})

describe('tkoKing — phases derive purely from the date', () => {
  const cases: [string, string][] = [
    ['2026-01-01T00:00:00Z', 'preseason'],
    ['2026-09-06T23:59:59Z', 'preseason'],
    ['2026-09-07T00:00:00Z', 'enroll'],
    ['2026-09-14T12:00:00Z', 'enroll'],
    ['2026-09-27T23:59:59Z', 'enroll'],
    ['2026-09-28T00:00:00Z', 'battles'],
    ['2026-10-10T00:00:00Z', 'battles'],
    ['2026-10-25T23:59:59Z', 'battles'],
    ['2026-10-26T00:00:00Z', 'finals'],
    ['2026-10-31T23:59:59Z', 'finals'],
    ['2026-11-01T00:00:00Z', 'crowned'],
    ['2027-05-05T00:00:00Z', 'crowned'],
  ]

  it.each(cases)('%s → %s', (iso, expected) => {
    expect(scheduledKingPhase(at(iso))).toBe(expected)
  })

  it('every phase is one of the five known phases', () => {
    for (const [iso] of cases) {
      expect(KING_SCHEDULED_PHASES).toContain(scheduledKingPhase(at(iso)))
    }
  })

  it('enrollment is open only inside the enrollment window', () => {
    expect(isScheduledEnrollmentOpen(at('2026-09-06T23:59:59Z'))).toBe(false)
    expect(isScheduledEnrollmentOpen(at('2026-09-07T00:00:00Z'))).toBe(true)
    expect(isScheduledEnrollmentOpen(at('2026-09-27T12:00:00Z'))).toBe(true)
    expect(isScheduledEnrollmentOpen(at('2026-09-28T00:00:00Z'))).toBe(false)
  })

  it('walks the phase chain and stops at crowned', () => {
    expect(nextScheduledPhase('preseason')).toBe('enroll')
    expect(nextScheduledPhase('enroll')).toBe('battles')
    expect(nextScheduledPhase('battles')).toBe('finals')
    expect(nextScheduledPhase('finals')).toBe('crowned')
    expect(nextScheduledPhase('crowned')).toBeNull()
  })

  it('maps schedule phases onto the legacy row phase', () => {
    expect(scheduledToLegacyPhase('preseason')).toBe('enroll')
    expect(scheduledToLegacyPhase('enroll')).toBe('enroll')
    expect(scheduledToLegacyPhase('battles')).toBe('battles')
    expect(scheduledToLegacyPhase('finals')).toBe('battles')
    expect(scheduledToLegacyPhase('crowned')).toBe('complete')
  })

  it('a row with no windows still advances on the season calendar', () => {
    expect(kingPhase({}, at('2026-01-01T00:00:00Z'))).toBe('enroll')
    expect(kingPhase({}, at('2026-10-01T00:00:00Z'))).toBe('battles')
    expect(kingPhase({}, at('2026-11-05T00:00:00Z'))).toBe('complete')
  })
})

describe('tkoKing — countdown formatting', () => {
  it('renders days, hours, minutes, seconds', () => {
    expect(formatCountdown(12 * MS_DAY + 4 * 3600_000)).toBe('12d 4h')
    expect(formatCountdown(4 * 3600_000 + 13 * 60_000)).toBe('4h 13m')
    expect(formatCountdown(13 * 60_000 + 20_000)).toBe('13m 20s')
    expect(formatCountdown(9_000)).toBe('9s')
  })

  it('clamps non-positive / invalid durations to "now"', () => {
    expect(formatCountdown(0)).toBe('now')
    expect(formatCountdown(-5000)).toBe('now')
    expect(formatCountdown(NaN)).toBe('now')
  })
})

describe('tkoKing — kingPhaseState (never "no tournament")', () => {
  const samples = [
    '2026-01-01T00:00:00Z',
    '2026-09-07T00:00:00Z',
    '2026-10-01T00:00:00Z',
    '2026-10-27T00:00:00Z',
    '2026-11-01T00:00:00Z',
    '2030-01-01T00:00:00Z',
  ]

  it('ALWAYS reports a running tournament with a label and an action', () => {
    for (const iso of samples) {
      const s = kingPhaseState(at(iso))
      expect(s.running).toBe(true)
      expect(s.label).toBe(scheduledPhaseLabel(s.phase))
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.action).toBe(scheduledPhaseAction(s.phase))
      expect(s.action.length).toBeGreaterThan(0)
      // Nothing anywhere ever says the King isn't running.
      expect(`${s.label} ${s.action}`.toLowerCase()).not.toContain('no tournament')
    }
  })

  it('counts down to the next phase', () => {
    const s = kingPhaseState(at('2026-09-05T00:00:00Z'))
    expect(s.phase).toBe('preseason')
    expect(s.nextPhase).toBe('enroll')
    expect(s.nextAt).toBe(KING_SCHEDULE.enrollOpens)
    expect(s.msUntilNext).toBe(2 * MS_DAY)
    expect(s.countdown).toBe('2d 0h')
  })

  it('counts down from battles to finals week', () => {
    const s = kingPhaseState(at('2026-10-25T00:00:00Z'))
    expect(s.phase).toBe('battles')
    expect(s.nextPhase).toBe('finals')
    expect(s.msUntilNext).toBe(1 * MS_DAY)
    expect(s.countdown).toBe('1d 0h')
  })

  it('has no next phase once the King is crowned', () => {
    const s = kingPhaseState(at('2026-11-02T00:00:00Z'))
    expect(s.phase).toBe('crowned')
    expect(s.nextPhase).toBeNull()
    expect(s.nextAt).toBeNull()
    expect(s.msUntilNext).toBe(0)
    expect(s.countdown).toBe('')
  })

  it('reports the current phase start (preseason has none)', () => {
    expect(phaseStartIso('preseason')).toBeNull()
    expect(phaseStartIso('enroll')).toBe(KING_SCHEDULE.enrollOpens)
    expect(phaseStartIso('battles')).toBe(KING_SCHEDULE.battlesStart)
    expect(phaseStartIso('finals')).toBe(KING_SCHEDULE.finalsStart)
    expect(phaseStartIso('crowned')).toBe(KING_SCHEDULE.crownedAt)
    expect(kingPhaseState(at('2026-10-01T00:00:00Z')).startsAt).toBe(KING_SCHEDULE.battlesStart)
  })
})

describe('tkoKing — the seeded tournament row matches the schedule', () => {
  it('builds a featured king_pit row straight from the constants', () => {
    const seed = kingTournamentSeed('host-1')
    expect(seed.format).toBe(KING_PIT_FORMAT)
    expect(seed.is_featured).toBe(true)
    expect(seed.created_by).toBe('host-1')
    expect(seed.enroll_opens).toBe(KING_SCHEDULE.enrollOpens)
    expect(seed.enroll_closes).toBe(KING_SCHEDULE.battlesStart)
    expect(seed.start_at).toBe(KING_SCHEDULE.battlesStart)
    expect(seed.end_at).toBe(KING_SCHEDULE.crownedAt)
  })

  it('seeds fine with no creator — no host is required to exist', () => {
    expect(kingTournamentSeed().created_by).toBeNull()
  })

  it('the seeded row and the schedule agree on the phase at every sample date', () => {
    const seed = kingTournamentSeed() as { enroll_closes: string; start_at: string }
    for (const iso of ['2026-09-14T00:00:00Z', '2026-10-01T00:00:00Z', '2026-10-28T00:00:00Z']) {
      const rowPhase = kingPhase({ enroll_closes: seed.enroll_closes, start_at: seed.start_at }, at(iso))
      expect(rowPhase).toBe(scheduledToLegacyPhase(scheduledKingPhase(at(iso))))
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  ADVERTISING + THE BOARD
// ───────────────────────────────────────────────────────────────────────────

describe('tkoKing — upcoming battles (advertising)', () => {
  const now = at('2026-08-20T00:00:00Z')
  const battles: BattleLike[] = [
    { id: 'past', player_a: 'a', player_b: 'b', scheduled_at: iso(-1, now), status: 'scheduled' },
    { id: 'soon', player_a: 'c', player_b: 'd', scheduled_at: iso(1, now), status: 'scheduled' },
    { id: 'later', player_a: 'e', player_b: 'f', scheduled_at: iso(3, now), status: 'scheduled' },
    { id: 'live', player_a: 'g', player_b: 'h', scheduled_at: iso(5, now), status: 'live' },
    { id: 'done', player_a: 'i', player_b: 'j', scheduled_at: iso(2, now), status: 'complete', winner: 'i' },
    { id: 'tbd', player_a: 'k', player_b: 'l', scheduled_at: null, status: 'scheduled' },
  ]

  it('puts LIVE first, then the soonest scheduled', () => {
    expect(upcomingBattles(battles, now).map((b) => b.id)).toEqual(['live', 'soon', 'later'])
  })

  it('never advertises decided, past or unscheduled battles', () => {
    const ids = upcomingBattles(battles, now).map((b) => b.id)
    expect(ids).not.toContain('done')
    expect(ids).not.toContain('past')
    expect(ids).not.toContain('tbd')
  })

  it('honours the limit', () => {
    expect(upcomingBattles(battles, now, 1).map((b) => b.id)).toEqual(['live'])
    expect(upcomingBattles(battles, now, 0)).toEqual([])
  })

  it('labels the timing of a battle', () => {
    expect(battleTimingLabel({ id: '1', player_a: 'a', status: 'live' }, now)).toBe('Live now')
    expect(battleTimingLabel({ id: '1', player_a: 'a', status: 'scheduled' }, now)).toBe('Time TBD')
    expect(battleTimingLabel({ id: '1', player_a: 'a', status: 'complete', winner: 'a' }, now)).toBe('Complete')
    expect(
      battleTimingLabel({ id: '1', player_a: 'a', status: 'scheduled', scheduled_at: iso(2, now) }, now),
    ).toBe('In 2d 0h')
  })
})

describe('tkoKing — round labels + field size', () => {
  it('sizes a single-elimination bracket', () => {
    expect(totalRoundsForField(0)).toBe(0)
    expect(totalRoundsForField(1)).toBe(0)
    expect(totalRoundsForField(2)).toBe(1)
    expect(totalRoundsForField(8)).toBe(3)
    expect(totalRoundsForField(16)).toBe(4)
    expect(totalRoundsForField(12)).toBe(4)
  })

  it('names rounds relative to the finish', () => {
    expect(roundLabel(4, 4)).toBe('Final')
    expect(roundLabel(3, 4)).toBe('Semifinal')
    expect(roundLabel(2, 4)).toBe('Quarterfinal')
    expect(roundLabel(1, 4)).toBe('Round of 16')
    expect(roundLabel(1, 5)).toBe('Round of 32')
    expect(roundLabel(2, 1)).toBe('Round 2') // defensive: past the known total
  })
})

describe('tkoKing — the board', () => {
  const regs = [
    { user_id: 'a', username: 'ash' },
    { user_id: 'b', username: 'bo' },
    { user_id: 'c', username: 'cy' },
    { user_id: 'd', username: 'dex' },
  ]
  // A clean 4-person bracket: two semis, then the final.
  const battles: BattleLike[] = [
    { id: 'r1-1', player_a: 'a', player_b: 'b', status: 'complete', winner: 'a', created_at: '2026-08-18T00:00:00Z' },
    { id: 'r1-2', player_a: 'c', player_b: 'd', status: 'complete', winner: 'c', created_at: '2026-08-19T00:00:00Z' },
    { id: 'r2-1', player_a: 'a', player_b: 'c', status: 'complete', winner: 'a', created_at: '2026-09-15T00:00:00Z' },
  ]

  it('derives rounds and labels them', () => {
    const board = buildKingBoard(regs, battles)
    expect(board.fieldSize).toBe(4)
    expect(board.totalRounds).toBe(2)
    expect(board.rounds.map((r) => r.round)).toEqual([1, 2])
    expect(board.rounds.map((r) => r.label)).toEqual(['Semifinal', 'Final'])
    expect(board.rounds[0].battles).toHaveLength(2)
    expect(board.rounds[1].battles).toHaveLength(1)
    expect(board.rounds.every((r) => r.complete)).toBe(true)
  })

  it('crowns the winner of a decided final', () => {
    const board = buildKingBoard(regs, battles)
    expect(board.champion?.userId).toBe('a')
    expect(board.champion?.status).toBe('champion')
    expect(board.champion?.wins).toBe(2)
    expect(board.champion?.roundsCleared).toBe(2)
  })

  it('tracks how far each fighter got', () => {
    const board = buildKingBoard(regs, battles)
    const by = (id: string) => board.fighters.find((f) => f.userId === id)!
    expect(by('b').status).toBe('eliminated')
    expect(by('b').eliminatedInRound).toBe(1)
    expect(by('b').roundsCleared).toBe(0)
    expect(by('c').status).toBe('eliminated')
    expect(by('c').eliminatedInRound).toBe(2)
    expect(by('c').roundsCleared).toBe(1)
    expect(by('c').wins).toBe(1)
    expect(by('c').losses).toBe(1)
  })

  it('sorts the field by how far they got', () => {
    expect(buildKingBoard(regs, battles).fighters.map((f) => f.userId)).toEqual(['a', 'c', 'b', 'd'])
  })

  it('respects an explicit round when one is set', () => {
    const board = buildKingBoard(regs, [
      { id: 'x', player_a: 'a', player_b: 'b', status: 'scheduled', round: 3 },
    ])
    expect(board.rounds[0].round).toBe(3)
  })

  it('handles an empty field without crashing', () => {
    const board = buildKingBoard([], [])
    expect(board.fighters).toEqual([])
    expect(board.rounds).toEqual([])
    expect(board.champion).toBeNull()
    expect(board.fieldSize).toBe(0)
  })

  it('lists registered-but-unpaired Shinobi as still standing', () => {
    const board = buildKingBoard(regs, [])
    expect(board.advancing).toHaveLength(4)
    expect(board.fighters.every((f) => f.status === 'active')).toBe(true)
  })

  it('does not crown anyone while the final is undecided', () => {
    const pending = [...battles.slice(0, 2), { ...battles[2], status: 'scheduled', winner: null }]
    expect(buildKingBoard(regs, pending as BattleLike[]).champion).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  PIT MEET-UP + ARTIFACT PRIZES
// ───────────────────────────────────────────────────────────────────────────

describe('tkoKing — pit meet-up visibility', () => {
  it('only the two fighters and hosts can see the exchange', () => {
    const b = { playerA: 'a', playerB: 'b' }
    expect(canSeeMeetup({ ...b, viewerId: 'a' })).toBe(true)
    expect(canSeeMeetup({ ...b, viewerId: 'b' })).toBe(true)
    expect(canSeeMeetup({ ...b, viewerId: 'c' })).toBe(false)
    expect(canSeeMeetup({ ...b, viewerId: null })).toBe(false)
    expect(canSeeMeetup({ ...b, viewerId: 'c', isHost: true })).toBe(true)
    expect(canSeeMeetup({ ...b, viewerId: null, isHost: true })).toBe(true)
  })

  it('is ready once an in-game name is shared', () => {
    expect(isMeetupReady(null)).toBe(false)
    expect(isMeetupReady({ inGameName: '   ' })).toBe(false)
    expect(isMeetupReady({ inGameName: 'AwakenGio' })).toBe(true)
  })

  it('normalizes and caps the form', () => {
    const d = normalizeMeetup({ inGameName: '  Gio  ', platform: ' PSN ', lobby: '', notes: 'x'.repeat(400) })
    expect(d.inGameName).toBe('Gio')
    expect(d.platform).toBe('PSN')
    expect(d.lobby).toBe('')
    expect(d.notes).toHaveLength(300)
    expect(normalizeMeetup(null)).toEqual({ inGameName: '', platform: '', lobby: '', notes: '' })
  })
})

describe('tkoKing — artifact prizes for advancing', () => {
  it('escalates: round token → semifinalist → finalist → crown', () => {
    expect(advancementPrize(4, 4).id).toBe(KING_CROWN_PRIZE.id)
    expect(advancementPrize(3, 4).id).toBe(KING_FINALIST_PRIZE.id)
    expect(advancementPrize(2, 4).id).toBe(KING_SEMIFINALIST_PRIZE.id)
    expect(advancementPrize(1, 4).name).toBe('Round of 16 Token')
  })

  it('every prize is an earned, never-for-sale King artifact', () => {
    for (const round of [1, 2, 3, 4, 5]) {
      const a = advancementPrize(round, 5)
      expect(a.id.startsWith(KING_PRIZE_ID_PREFIX)).toBe(true)
      expect(a.priceTokens).toBe(0)
      expect(a.teamName).toBe('TKO King')
    }
  })

  it('publishes a prize table biggest-first', () => {
    expect(KING_PRIZE_TABLE[0].asset.id).toBe(KING_CROWN_PRIZE.id)
    expect(KING_PRIZE_TABLE).toHaveLength(4)
  })

  it('writes crown-specific notification copy', () => {
    expect(prizeNotification(KING_CROWN_PRIZE).title).toContain('TKO King')
    expect(prizeNotification(KING_FINALIST_PRIZE).title).toContain('Finalist Banner')
  })

  it('grants into the locker, idempotently', () => {
    const mem = new Map<string, string>()
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v) },
    }
    const first = grantAdvancementPrize('u1', 4, 4, storage)
    expect(first?.asset.id).toBe(KING_CROWN_PRIZE.id)
    expect(first?.alreadyOwned).toBe(false)
    const again = grantAdvancementPrize('u1', 4, 4, storage)
    expect(again?.alreadyOwned).toBe(true)
    expect(grantAdvancementPrize('', 4, 4, storage)).toBeNull()
  })
})
