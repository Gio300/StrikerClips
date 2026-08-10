import { describe, expect, it } from 'vitest'
import {
  battleDecidedAt,
  battleMediaAt,
  battlesAsOf,
  buildReplayTimeline,
  type ReplayBattle,
} from './tournamentReplay'

const T = (minute: number) => `2026-08-01T12:${String(minute).padStart(2, '0')}:00.000Z`

const battle = (over: Partial<ReplayBattle>): ReplayBattle => ({
  id: 'b1',
  tournament_id: 't1',
  player_a: 'alice',
  player_b: 'bob',
  scheduled_at: null,
  status: 'scheduled',
  winner: null,
  round: 1,
  bracket_slot: 0,
  media: null,
  created_at: T(10),
  ...over,
})

const tournament = {
  id: 't1',
  name: 'Summer Cup',
  status: 'closed',
  created_at: T(0),
  start_at: T(5),
  end_at: T(40),
}

describe('buildReplayTimeline', () => {
  it('orders events by time with a stable same-second kind order', () => {
    const events = buildReplayTimeline({
      tournament,
      battles: [
        battle({ id: 'b1', winner: 'alice', status: 'complete', decided_at: T(20) }),
      ],
      entrants: [
        { user_id: 'alice', created_at: T(2) },
        { user_id: 'bob', created_at: T(3) },
      ],
      registrations: [{ user_id: 'cara', registered_at: T(4) }],
      results: [{ winner_profile_id: 'alice', created_at: T(21) }],
      usernames: new Map([
        ['alice', 'Alice'],
        ['bob', 'Bob'],
        ['cara', 'Cara'],
      ]),
    })
    expect(events.map((event) => event.kind)).toEqual([
      'created',
      'entrant_joined',
      'entrant_joined',
      'registered',
      'started',
      'battle_seeded',
      'battle_decided',
      'result_recorded',
      'ended',
    ])
    expect(events[1].label).toContain('Alice')
    expect(events.at(-1)).toMatchObject({ kind: 'ended', at: T(40) })
  })

  it('falls back to created_at for decisions and media on pre-column rows', () => {
    const legacy = battle({
      winner: 'bob',
      status: 'complete',
      decided_at: null,
      media: { a: { clip_urls: ['https://www.youtube.com/watch?v=abcdefghijk'] } },
      media_updated_at: null,
    })
    expect(battleDecidedAt(legacy)).toBe(T(10))
    expect(battleMediaAt(legacy)).toBe(T(10))

    const events = buildReplayTimeline({ tournament, battles: [legacy] })
    const kinds = events.map((event) => event.kind)
    expect(kinds).toContain('battle_decided')
    expect(kinds).toContain('media_attached')
  })

  it('surfaces watch links on the media event at their own moment', () => {
    const events = buildReplayTimeline({
      tournament,
      battles: [
        battle({
          winner: 'alice',
          status: 'complete',
          decided_at: T(20),
          media: {
            a: { live_url: 'https://live.example/a', clip_urls: ['https://www.youtube.com/watch?v=abcdefghijk'] },
          },
          media_updated_at: T(25),
        }),
      ],
    })
    const media = events.find((event) => event.kind === 'media_attached')
    expect(media).toMatchObject({ at: T(25), battleId: 'b1' })
    expect(media?.media).toEqual([
      { url: 'https://live.example/a', kind: 'live', side: 'a' },
      { url: 'https://www.youtube.com/watch?v=abcdefghijk', kind: 'clip', side: 'a' },
    ])
  })

  it('does not emit an ended event for a future end time on a running tournament', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString()
    const events = buildReplayTimeline({
      tournament: { ...tournament, status: 'live', end_at: future },
      battles: [],
    })
    expect(events.some((event) => event.kind === 'ended')).toBe(false)
  })
})

describe('battlesAsOf (the bracket as of the cursor)', () => {
  const decided = battle({
    id: 'b1',
    winner: 'alice',
    status: 'complete',
    decided_at: T(20),
    media: { a: { clip_urls: ['https://www.youtube.com/watch?v=abcdefghijk'] } },
    media_updated_at: T(25),
  })
  const later = battle({ id: 'b2', round: 2, created_at: T(30) })

  it('hides battles that were not seeded yet', () => {
    expect(battlesAsOf([decided, later], T(15)).map((row) => row.id)).toEqual(['b1'])
  })

  it('rewinds a decided battle to scheduled before its decision moment', () => {
    const [asOf15] = battlesAsOf([decided], T(15))
    expect(asOf15.winner).toBeNull()
    expect(asOf15.status).toBe('scheduled')
    expect(asOf15.media).toBeNull()

    const [asOf22] = battlesAsOf([decided], T(22))
    expect(asOf22.winner).toBe('alice')
    expect(asOf22.status).toBe('complete')
    expect(asOf22.media).toBeNull() // links arrive at T(25), not with the win

    const [asOf26] = battlesAsOf([decided], T(26))
    expect(asOf26.media).toEqual(decided.media)
  })

  it('keeps first-round byes decided from the moment they were seeded', () => {
    const bye = battle({ id: 'bye', player_b: null, winner: 'alice', status: 'complete' })
    const [asOfSeed] = battlesAsOf([bye], T(10))
    expect(asOfSeed.winner).toBe('alice')
    expect(asOfSeed.status).toBe('complete')
  })
})
