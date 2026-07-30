import { describe, it, expect } from 'vitest'
import {
  AUTO_LINK_THRESHOLD,
  battleIsNow,
  bestCandidateForStream,
  buildSessionRecord,
  candidatesForStream,
  handleOf,
  isLiveAt,
  linkBadge,
  linkCandidates,
  linkNotification,
  linkNotifyTargets,
  liveOverlapWindow,
  pairKey,
  reasonLabel,
  shouldAutoLink,
  stageFromStreams,
  stageTitle,
  suggestStages,
  type LiveStreamFact,
  type RelationshipFacts,
} from './liveLink'

const NOW = 1_700_000_000_000

function stream(over: Partial<LiveStreamFact> & { streamId: string; userId: string }): LiveStreamFact {
  return {
    username: over.userId,
    title: 'Live run',
    startedAt: NOW - 10 * 60_000,
    ...over,
  }
}

const rex = stream({ streamId: 's-rex', userId: 'u-rex', username: 'rex' })
const kai = stream({ streamId: 's-kai', userId: 'u-kai', username: 'kai' })
const nova = stream({ streamId: 's-nova', userId: 'u-nova', username: 'nova' })
const zed = stream({ streamId: 's-zed', userId: 'u-zed', username: 'zed' })

const opts = { now: NOW }

// ───────────────────────────────────────────────────────────────────────────
//  Small helpers
// ───────────────────────────────────────────────────────────────────────────

describe('helpers', () => {
  it('pairKey is order independent', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'))
  })

  it('isLiveAt honors an end time', () => {
    expect(isLiveAt(rex, NOW)).toBe(true)
    expect(isLiveAt({ ...rex, endedAt: NOW - 1000 }, NOW)).toBe(false)
    expect(isLiveAt({ ...rex, startedAt: NOW + 5000 }, NOW)).toBe(false)
  })

  it('handleOf prefers the username and falls back to the id', () => {
    expect(handleOf(rex)).toBe('@rex')
    expect(handleOf({ ...rex, username: null })).toBe('@u-rex')
    expect(handleOf({ ...rex, username: '@rex' })).toBe('@rex')
  })

  it('battleIsNow: live always, decided never, scheduled within the window', () => {
    const base = { battleId: 'b1', playerA: 'u-rex', playerB: 'u-kai' }
    expect(battleIsNow({ ...base, status: 'live', scheduledAt: NOW - 99e9 }, NOW)).toBe(true)
    expect(battleIsNow({ ...base, status: 'complete' }, NOW)).toBe(false)
    expect(battleIsNow({ ...base, status: 'forfeit' }, NOW)).toBe(false)
    // play-anytime (no scheduled time) counts as now
    expect(battleIsNow({ ...base, status: 'scheduled', scheduledAt: null }, NOW)).toBe(true)
    expect(battleIsNow({ ...base, status: 'scheduled', scheduledAt: NOW + 30 * 60_000 }, NOW)).toBe(true)
    expect(battleIsNow({ ...base, status: 'scheduled', scheduledAt: NOW + 5 * 60 * 60_000 }, NOW)).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Each reason
// ───────────────────────────────────────────────────────────────────────────

describe('link reasons', () => {
  it('scheduled_battle is found for the two fighters of a battle happening now', () => {
    const facts: RelationshipFacts = {
      battles: [
        {
          battleId: 'b1',
          tournamentId: 't-king',
          playerA: 'u-rex',
          playerB: 'u-kai',
          status: 'scheduled',
          scheduledAt: NOW,
        },
      ],
    }
    const [c] = linkCandidates([rex, kai], facts, opts)
    expect(c.reason).toBe('scheduled_battle')
    expect(c.battleId).toBe('b1')
    expect(c.tournamentId).toBe('t-king')
    expect(c.label).toBe('Scheduled TKO King battle')
    expect(c.autoLink).toBe(true)
    expect(c.confidence).toBeGreaterThanOrEqual(0.97)
  })

  it('a DECIDED battle does not produce a scheduled_battle link', () => {
    const facts: RelationshipFacts = {
      battles: [{ battleId: 'b1', playerA: 'u-rex', playerB: 'u-kai', status: 'complete' }],
    }
    const [c] = linkCandidates([rex, kai], facts, opts)
    expect(c.reason).toBe('concurrent_only')
  })

  it('same_clan when both are in one clan', () => {
    const facts: RelationshipFacts = {
      clansByUser: { 'u-rex': ['c-1'], 'u-kai': ['c-1'] },
    }
    const [c] = linkCandidates([rex, kai], facts, opts)
    expect(c.reason).toBe('same_clan')
    expect(c.clanId).toBe('c-1')
    expect(c.label).toBe('Same clan')
    expect(c.autoLink).toBe(true)
  })

  it('teammates when the same clan is also in the same tournament', () => {
    const facts: RelationshipFacts = {
      clansByUser: { 'u-rex': ['c-1'], 'u-kai': ['c-1'] },
      tournamentsByUser: { 'u-rex': ['t-king'], 'u-kai': ['t-king'] },
    }
    const [c] = linkCandidates([rex, kai], facts, opts)
    expect(c.reason).toBe('teammates')
    expect(c.reasons).toEqual(['teammates', 'same_clan', 'same_tournament'])
    expect(c.clanId).toBe('c-1')
    expect(c.tournamentId).toBe('t-king')
    expect(c.autoLink).toBe(true)
  })

  it('same_tournament when both are registered in one running tournament', () => {
    const facts: RelationshipFacts = {
      tournamentsByUser: { 'u-rex': ['t-king'], 'u-kai': ['t-king', 't-other'] },
    }
    const [c] = linkCandidates([rex, kai], facts, opts)
    expect(c.reason).toBe('same_tournament')
    expect(c.label).toBe('Both in TKO King')
    expect(c.autoLink).toBe(true)
  })

  it('mutual_follow only when BOTH directions exist', () => {
    const oneWay: RelationshipFacts = { followsByUser: { 'u-rex': ['u-kai'] } }
    expect(linkCandidates([rex, kai], oneWay, opts)[0].reason).toBe('concurrent_only')

    const mutual: RelationshipFacts = {
      followsByUser: { 'u-rex': ['u-kai'], 'u-kai': ['u-rex'] },
    }
    const [c] = linkCandidates([rex, kai], mutual, opts)
    expect(c.reason).toBe('mutual_follow')
    expect(c.confidence).toBeLessThan(AUTO_LINK_THRESHOLD)
    expect(c.autoLink).toBe(false)
  })

  it('concurrent_only is the fallback and is the weakest signal', () => {
    const [c] = linkCandidates([rex, kai], {}, opts)
    expect(c.reason).toBe('concurrent_only')
    expect(c.reasons).toEqual(['concurrent_only'])
    expect(c.confidence).toBeLessThan(AUTO_LINK_THRESHOLD)
  })

  it('falls back to the context each streamer declared when going live', () => {
    const a = stream({ streamId: 's-a', userId: 'u-a', clanId: 'c-9' })
    const b = stream({ streamId: 's-b', userId: 'u-b', clanId: 'c-9' })
    expect(linkCandidates([a, b], {}, opts)[0].reason).toBe('same_clan')

    const c1 = stream({ streamId: 's-c', userId: 'u-c', tournamentId: 't-9' })
    const d1 = stream({ streamId: 's-d', userId: 'u-d', tournamentId: 't-9' })
    expect(linkCandidates([c1, d1], {}, opts)[0].reason).toBe('same_tournament')
  })

  it('two angles from the same user are not a relationship link', () => {
    const one = stream({ streamId: 's-1', userId: 'u-rex' })
    const two = stream({ streamId: 's-2', userId: 'u-rex' })
    expect(linkCandidates([one, two], {}, opts)).toHaveLength(0)
  })

  it('streams that already ended are ignored', () => {
    const done = { ...kai, endedAt: NOW - 60_000 }
    expect(linkCandidates([rex, done], {}, opts)).toHaveLength(0)
  })

  it('reasonLabel covers every reason', () => {
    expect(reasonLabel('scheduled_battle')).toBe('Scheduled TKO King battle')
    expect(reasonLabel('same_clan')).toBe('Same clan')
    expect(reasonLabel('same_tournament')).toBe('Both in TKO King')
    expect(reasonLabel('teammates')).toContain('Teammates')
    expect(reasonLabel('mutual_follow')).toContain('follow')
    expect(reasonLabel('concurrent_only')).toBe('Live at the same time')
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Ranking
// ───────────────────────────────────────────────────────────────────────────

describe('ranking', () => {
  const facts: RelationshipFacts = {
    // rex vs kai — a real scheduled battle (strongest)
    battles: [
      { battleId: 'b1', tournamentId: 't-king', playerA: 'u-rex', playerB: 'u-kai', status: 'live' },
    ],
    // nova shares a clan with zed (strong)
    clansByUser: { 'u-nova': ['c-1'], 'u-zed': ['c-1'] },
    // zed + rex just follow each other (weak)
    followsByUser: { 'u-zed': ['u-rex'], 'u-rex': ['u-zed'] },
  }

  it('orders scheduled_battle > same_clan > mutual_follow > concurrent_only', () => {
    const ranked = linkCandidates([rex, kai, nova, zed], facts, opts)
    const order = ranked.map((c) => c.reason)
    expect(order[0]).toBe('scheduled_battle')
    expect(order.indexOf('same_clan')).toBeLessThan(order.indexOf('mutual_follow'))
    expect(order.indexOf('mutual_follow')).toBeLessThan(order.lastIndexOf('concurrent_only'))
    // confidence is monotonically non-increasing
    const conf = ranked.map((c) => c.confidence)
    expect([...conf].sort((a, b) => b - a)).toEqual(conf)
  })

  it('is deterministic regardless of input order', () => {
    const a = linkCandidates([rex, kai, nova, zed], facts, opts).map((c) => c.key)
    const b = linkCandidates([zed, nova, kai, rex], facts, opts).map((c) => c.key)
    expect(b).toEqual(a)
  })

  it('candidatesForStream / bestCandidateForStream pick the strongest link for a card', () => {
    const ranked = linkCandidates([rex, kai, nova, zed], facts, opts)
    expect(candidatesForStream(ranked, 's-rex').length).toBe(3)
    const best = bestCandidateForStream(ranked, 's-rex')
    expect(best?.reason).toBe('scheduled_battle')
    expect(linkBadge(best!, 's-rex')).toBe('⚔ Scheduled battle vs @kai')
    expect(linkBadge(best!, 's-kai')).toBe('⚔ Scheduled battle vs @rex')
    expect(bestCandidateForStream(ranked, 's-nope')).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Auto-link threshold — the safety rule
// ───────────────────────────────────────────────────────────────────────────

describe('shouldAutoLink', () => {
  it('is true for the strong, relationship-backed signals', () => {
    expect(shouldAutoLink({ reason: 'scheduled_battle', confidence: 0.97 })).toBe(true)
    expect(shouldAutoLink({ reason: 'teammates', confidence: 0.89 })).toBe(true)
    expect(shouldAutoLink({ reason: 'same_clan', confidence: 0.8 })).toBe(true)
    expect(shouldAutoLink({ reason: 'same_tournament', confidence: 0.65 })).toBe(true)
  })

  it('is false for weak signals, even mutual follow', () => {
    expect(shouldAutoLink({ reason: 'mutual_follow', confidence: 0.55 })).toBe(false)
    expect(shouldAutoLink({ reason: 'concurrent_only', confidence: 0.2 })).toBe(false)
  })

  it('respects the confidence floor even for an allowed reason', () => {
    expect(shouldAutoLink({ reason: 'same_tournament', confidence: 0.4 })).toBe(false)
  })

  it('TWO UNRELATED CONCURRENT STREAMERS ARE NEVER AUTO-LINKED', () => {
    const ranked = linkCandidates([rex, kai], {}, opts)
    expect(ranked).toHaveLength(1)
    expect(ranked[0].reason).toBe('concurrent_only')
    expect(ranked[0].autoLink).toBe(false)
    expect(shouldAutoLink(ranked[0])).toBe(false)
    expect(suggestStages(ranked)).toHaveLength(0)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Stages
// ───────────────────────────────────────────────────────────────────────────

describe('suggestStages', () => {
  it('seeds the strongest pair first and never reuses a stream', () => {
    const facts: RelationshipFacts = {
      battles: [{ battleId: 'b1', playerA: 'u-rex', playerB: 'u-kai', status: 'live' }],
      clansByUser: { 'u-nova': ['c-1'], 'u-zed': ['c-1'] },
    }
    const stages = suggestStages(linkCandidates([rex, kai, nova, zed], facts, opts))
    expect(stages).toHaveLength(2)
    expect(stages[0].reason).toBe('scheduled_battle')
    expect(stages[0].streams.map((s) => s.streamId).sort()).toEqual(['s-kai', 's-rex'])
    expect(stages[0].title).toContain('vs')
    expect(stages[1].reason).toBe('same_clan')
    const all = stages.flatMap((s) => s.streams.map((x) => x.streamId))
    expect(new Set(all).size).toBe(all.length)
  })

  it('grows a clan stage past a pair but caps at 8 angles', () => {
    const clan = ['u-a', 'u-b', 'u-c', 'u-d', 'u-e', 'u-f', 'u-g', 'u-h', 'u-i']
    const streams = clan.map((u, i) => stream({ streamId: `s-${i}`, userId: u, username: u }))
    const clansByUser = Object.fromEntries(clan.map((u) => [u, ['c-1']]))
    const stages = suggestStages(linkCandidates(streams, { clansByUser }, opts))
    expect(stages[0].streams.length).toBe(8)
    expect(stages[0].title).toBe('Same clan — 8 angles')
  })

  it('honors a smaller maxAngles', () => {
    const clan = ['u-a', 'u-b', 'u-c']
    const streams = clan.map((u, i) => stream({ streamId: `s-${i}`, userId: u, username: u }))
    const clansByUser = Object.fromEntries(clan.map((u) => [u, ['c-1']]))
    const stages = suggestStages(linkCandidates(streams, { clansByUser }, opts), { maxAngles: 2 })
    expect(stages[0].streams.length).toBe(2)
  })

  it('stageFromStreams inherits the strongest link inside a hand-picked set', () => {
    const facts: RelationshipFacts = {
      battles: [{ battleId: 'b1', tournamentId: 't-king', playerA: 'u-rex', playerB: 'u-kai', status: 'live' }],
    }
    const ranked = linkCandidates([rex, kai, nova], facts, opts)
    const s = stageFromStreams([rex, kai, nova], ranked)!
    expect(s.reason).toBe('scheduled_battle')
    expect(s.battleId).toBe('b1')
    expect(s.streams).toHaveLength(3)
  })

  it('stageFromStreams falls back to concurrent_only and needs 2+ feeds', () => {
    expect(stageFromStreams([rex], [])).toBeNull()
    const s = stageFromStreams([rex, kai], [])!
    expect(s.reason).toBe('concurrent_only')
    expect(s.title).toBe('Live at the same time — 2 angles')
  })

  it('stageFromStreams caps at 8 angles', () => {
    const nine = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((u) => stream({ streamId: `s-${u}`, userId: `u-${u}` }))
    expect(stageFromStreams(nine, [])!.streams).toHaveLength(8)
  })

  it('stageTitle reads as a battle for a scheduled pair', () => {
    expect(stageTitle('scheduled_battle', [rex, kai])).toBe('@rex vs @kai — both angles')
    expect(stageTitle('same_tournament', [rex, kai, nova])).toBe('Both in TKO King — 3 angles')
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Notifications
// ───────────────────────────────────────────────────────────────────────────

describe('notifications', () => {
  it('uses the battle copy when both fighters are live', () => {
    const n = linkNotification({ reason: 'scheduled_battle', streams: [rex, kai], title: 'x' })
    expect(n.title).toBe('Both fighters are live')
    expect(n.body).toBe('Both fighters are live — watch the battle from both angles.')
  })

  it('has distinct copy per link kind', () => {
    expect(linkNotification({ reason: 'same_clan', streams: [rex, kai], title: 'x' }).title).toBe('Your clan is live')
    expect(linkNotification({ reason: 'same_tournament', streams: [rex, kai], title: 'x' }).title).toBe('TKO King is live')
    expect(linkNotification({ reason: 'mutual_follow', streams: [rex, kai], title: 'x' }).title).toBe('Streams linked')
  })

  it('targets both streamers and their followers, deduped', () => {
    const t = linkNotifyTargets(
      { reason: 'scheduled_battle', streams: [rex, kai] },
      { followersByUser: { 'u-rex': ['u-f1', 'u-f2', 'u-kai'], 'u-kai': ['u-f2', 'u-f3'] } },
    )
    expect(t.streamers).toEqual(['u-rex', 'u-kai'])
    // u-kai is a streamer, u-f2 follows both — each appears once, in one bucket
    expect(t.followers).toEqual(['u-f1', 'u-f2', 'u-f3'])
    expect(t.all).toEqual(['u-rex', 'u-kai', 'u-f1', 'u-f2', 'u-f3'])
    expect(new Set(t.all).size).toBe(t.all.length)
  })

  it('adds the clan for a clan link only', () => {
    const audience = { clanMembersByClan: { 'c-1': ['u-rex', 'u-m1', 'u-m2'] } }
    const clanLink = linkNotifyTargets({ reason: 'same_clan', streams: [rex, kai], clanId: 'c-1' }, audience)
    expect(clanLink.clan).toEqual(['u-m1', 'u-m2'])

    const battleLink = linkNotifyTargets(
      { reason: 'scheduled_battle', streams: [rex, kai], clanId: 'c-1' },
      audience,
    )
    expect(battleLink.clan).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Session capture for later assembly
// ───────────────────────────────────────────────────────────────────────────

describe('session capture', () => {
  it('liveOverlapWindow is the span where EVERY member was live', () => {
    const a = stream({ streamId: 'a', userId: 'ua', startedAt: NOW - 60 * 60_000, endedAt: NOW - 5 * 60_000 })
    const b = stream({ streamId: 'b', userId: 'ub', startedAt: NOW - 30 * 60_000 })
    const w = liveOverlapWindow([a, b], NOW)
    expect(w.startMs).toBe(NOW - 30 * 60_000)
    expect(w.endMs).toBe(NOW - 5 * 60_000)
    expect(w.durationMs).toBe(25 * 60_000)
  })

  it('never returns a negative duration', () => {
    const a = stream({ streamId: 'a', userId: 'ua', startedAt: NOW, endedAt: NOW })
    const b = stream({ streamId: 'b', userId: 'ub', startedAt: NOW - 1000, endedAt: NOW - 500 })
    expect(liveOverlapWindow([a, b], NOW).durationMs).toBe(0)
    expect(liveOverlapWindow([], NOW)).toEqual({ startMs: 0, endMs: 0, durationMs: 0 })
  })

  it('buildSessionRecord captures the member streams + window for a later combined clip', () => {
    const a = stream({ streamId: 's-a', userId: 'u-a', startedAt: NOW - 40 * 60_000 })
    const b = stream({ streamId: 's-b', userId: 'u-b', startedAt: NOW - 20 * 60_000, endedAt: NOW - 2 * 60_000 })
    const rec = buildSessionRecord({
      groupId: 'g-1',
      streams: [a, b],
      reason: 'scheduled_battle',
      battleId: 'b1',
      tournamentId: 't-king',
      now: NOW,
    })
    expect(rec).toEqual({
      groupId: 'g-1',
      streamIds: ['s-a', 's-b'],
      userIds: ['u-a', 'u-b'],
      reason: 'scheduled_battle',
      battleId: 'b1',
      tournamentId: 't-king',
      startedAtMs: NOW - 20 * 60_000,
      endedAtMs: NOW - 2 * 60_000,
      durationMs: 18 * 60_000,
    })
  })

  it('defaults the optional context to null', () => {
    const rec = buildSessionRecord({ groupId: 'g', streams: [rex], now: NOW })
    expect(rec.reason).toBeNull()
    expect(rec.battleId).toBeNull()
    expect(rec.tournamentId).toBeNull()
  })
})
