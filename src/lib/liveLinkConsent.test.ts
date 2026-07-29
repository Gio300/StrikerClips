import { describe, it, expect } from 'vitest'
import {
  AUTO_LINK_MODE_COPY,
  DEFAULT_AUTO_LINK_MODE,
  LINK_OPT_OUT_COPY,
  combineAutoLinkModes,
  linkCandidates,
  linkDecision,
  linkNotifyTargets,
  modeForOptOut,
  normalizeAutoLinkMode,
  pendingLinkCandidates,
  proposedStages,
  removeStreamFromStage,
  removeUserFromStage,
  shouldAutoLink,
  stageFromStreams,
  suggestStages,
  type AutoLinkMode,
  type LiveStreamFact,
  type RelationshipFacts,
} from './liveLink'
import { planReelNotifications } from './reelParticipants'
import type { BlockFact } from './blocking'

const NOW = 1_700_000_000_000
const opts = { now: NOW }

function stream(streamId: string, userId: string, username: string): LiveStreamFact {
  return { streamId, userId, username, title: 'Live run', startedAt: NOW - 10 * 60_000 }
}

const rex = stream('s-rex', 'u-rex', 'rex')
const kai = stream('s-kai', 'u-kai', 'kai')
const nova = stream('s-nova', 'u-nova', 'nova')

/** A scheduled battle between rex and kai — the strongest possible signal. */
const battleFacts: RelationshipFacts = {
  battles: [{ battleId: 'b-1', tournamentId: 't-1', playerA: 'u-rex', playerB: 'u-kai', status: 'live' }],
}

const block = (blockerId: string, blockedId: string, hideInSharedLives = false): BlockFact => ({
  blockerId,
  blockedId,
  hideInSharedLives,
})

const withModes = (modes: Record<string, AutoLinkMode>): RelationshipFacts => ({
  ...battleFacts,
  autoLinkModes: modes,
})

const pair = (facts: RelationshipFacts) => linkCandidates([rex, kai], facts, opts)[0]

// ───────────────────────────────────────────────────────────────────────────
//  The preference model
// ───────────────────────────────────────────────────────────────────────────

describe('autoLinkMode — the preference itself', () => {
  it('defaults to auto, and anything unrecognised reads as auto', () => {
    expect(DEFAULT_AUTO_LINK_MODE).toBe('auto')
    expect(normalizeAutoLinkMode(undefined)).toBe('auto')
    expect(normalizeAutoLinkMode(null)).toBe('auto')
    expect(normalizeAutoLinkMode('')).toBe('auto')
    expect(normalizeAutoLinkMode('nonsense')).toBe('auto')
    expect(normalizeAutoLinkMode('ask')).toBe('ask')
    expect(normalizeAutoLinkMode('off')).toBe('off')
  })

  it('takes the STRICTER of the two: off > ask > auto', () => {
    expect(combineAutoLinkModes('auto', 'auto')).toBe('auto')
    expect(combineAutoLinkModes('auto', 'ask')).toBe('ask')
    expect(combineAutoLinkModes('ask', 'auto')).toBe('ask')
    expect(combineAutoLinkModes('ask', 'ask')).toBe('ask')
    expect(combineAutoLinkModes('auto', 'off')).toBe('off')
    expect(combineAutoLinkModes('off', 'auto')).toBe('off')
    expect(combineAutoLinkModes('ask', 'off')).toBe('off')
    expect(combineAutoLinkModes('off', 'off')).toBe('off')
  })

  it('has plain-language copy for every mode', () => {
    expect(AUTO_LINK_MODE_COPY.auto.help).toMatch(/multi-angle/i)
    expect(AUTO_LINK_MODE_COPY.ask.label).toBe('Ask me first')
    expect(AUTO_LINK_MODE_COPY.off.help).toMatch(/never/i)
  })
})

describe('linkDecision — precedence', () => {
  it('a block beats everything, including two people on auto', () => {
    expect(linkDecision({ signal: true, mode: 'auto', blocked: true })).toBe('blocked')
    expect(linkDecision({ signal: false, mode: 'off', blocked: true })).toBe('blocked')
  })

  it('a weak signal never links no matter how willing everyone is', () => {
    expect(linkDecision({ signal: false, mode: 'auto', blocked: false })).toBe('weak')
  })

  it('otherwise the combined preference decides', () => {
    expect(linkDecision({ signal: true, mode: 'auto', blocked: false })).toBe('auto')
    expect(linkDecision({ signal: true, mode: 'ask', blocked: false })).toBe('ask')
    expect(linkDecision({ signal: true, mode: 'off', blocked: false })).toBe('off')
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Every combination, end to end through the engine
// ───────────────────────────────────────────────────────────────────────────

describe('pref combinations through linkCandidates', () => {
  it('auto + auto → links automatically (today’s behaviour, unchanged)', () => {
    const c = pair(withModes({ 'u-rex': 'auto', 'u-kai': 'auto' }))
    expect(c.reason).toBe('scheduled_battle')
    expect(c.decision).toBe('auto')
    expect(c.autoLink).toBe(true)
    expect(c.pending).toBe(false)
    expect(c.mode).toBe('auto')
  })

  it('nobody set a preference at all → still links (auto is the default)', () => {
    const c = pair(battleFacts)
    expect(c.autoLink).toBe(true)
    expect(c.mode).toBe('auto')
  })

  it('auto + ask → PENDING: proposed, nothing joins yet', () => {
    const c = pair(withModes({ 'u-rex': 'auto', 'u-kai': 'ask' }))
    expect(c.decision).toBe('ask')
    expect(c.pending).toBe(true)
    expect(c.autoLink).toBe(false)
  })

  it('auto + off → no link at all, and it is not pending either', () => {
    const c = pair(withModes({ 'u-rex': 'auto', 'u-kai': 'off' }))
    expect(c.decision).toBe('off')
    expect(c.autoLink).toBe(false)
    expect(c.pending).toBe(false)
  })

  it('off + off → no link', () => {
    const c = pair(withModes({ 'u-rex': 'off', 'u-kai': 'off' }))
    expect(c.decision).toBe('off')
    expect(c.autoLink).toBe(false)
  })

  it('ask + off → the stricter wins: off, not a proposal', () => {
    const c = pair(withModes({ 'u-rex': 'ask', 'u-kai': 'off' }))
    expect(c.decision).toBe('off')
    expect(c.pending).toBe(false)
  })

  it('ask + ask → one proposal, not two links', () => {
    const c = pair(withModes({ 'u-rex': 'ask', 'u-kai': 'ask' }))
    expect(c.pending).toBe(true)
    expect(pendingLinkCandidates([rex, kai], withModes({ 'u-rex': 'ask', 'u-kai': 'ask' }), opts)).toHaveLength(1)
  })

  it('an opt-out does NOT rescue a weak signal — pending only ever means "would have linked"', () => {
    // No battle, no clan, no tournament: concurrent_only, which never qualifies.
    const c = linkCandidates([rex, nova], { autoLinkModes: { 'u-rex': 'ask' } }, opts)[0]
    expect(c.reason).toBe('concurrent_only')
    expect(c.decision).toBe('weak')
    expect(c.pending).toBe(false)
  })
})

describe('shouldAutoLink honours both prefs and the block', () => {
  const strong = { reason: 'scheduled_battle' as const, confidence: 0.97 }

  it('with no context it answers the signal question alone (back-compatible)', () => {
    expect(shouldAutoLink(strong)).toBe(true)
    expect(shouldAutoLink({ reason: 'mutual_follow', confidence: 0.55 })).toBe(false)
  })

  it('either side on off is enough to stop it', () => {
    expect(shouldAutoLink(strong, { modeA: 'auto', modeB: 'auto' })).toBe(true)
    expect(shouldAutoLink(strong, { modeA: 'off', modeB: 'auto' })).toBe(false)
    expect(shouldAutoLink(strong, { modeA: 'auto', modeB: 'off' })).toBe(false)
    expect(shouldAutoLink(strong, { modeA: 'ask', modeB: 'auto' })).toBe(false)
  })

  it('a block stops it even when both are on auto', () => {
    expect(shouldAutoLink(strong, { modeA: 'auto', modeB: 'auto', blocked: true })).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Blocks in the engine
// ───────────────────────────────────────────────────────────────────────────

describe('a blocked pair NEVER links', () => {
  it('is refused even for a live scheduled battle with both on auto', () => {
    const c = pair({ ...battleFacts, blocks: [block('u-rex', 'u-kai')] })
    expect(c.reason).toBe('scheduled_battle')
    expect(c.confidence).toBeGreaterThan(0.9)
    expect(c.blocked).toBe(true)
    expect(c.decision).toBe('blocked')
    expect(c.autoLink).toBe(false)
    expect(c.pending).toBe(false)
  })

  it('is refused in the other direction too — the blocked person can’t force it', () => {
    const c = pair({ ...battleFacts, blocks: [block('u-kai', 'u-rex')] })
    expect(c.blocked).toBe(true)
    expect(c.autoLink).toBe(false)
  })

  it('produces no stage', () => {
    const facts = { ...battleFacts, blocks: [block('u-rex', 'u-kai')] }
    expect(suggestStages(linkCandidates([rex, kai], facts, opts))).toEqual([])
    expect(proposedStages(linkCandidates([rex, kai], facts, opts))).toEqual([])
  })
})

describe('hide_in_shared_lives in the engine', () => {
  const clanFacts = (blocks: BlockFact[]): RelationshipFacts => ({
    clansByUser: { 'u-rex': ['c-1'], 'u-kai': ['c-1'], 'u-nova': ['c-1'] },
    blocks,
  })

  it('false: they may still land on the same stage via a third clanmate', () => {
    const cands = linkCandidates([rex, kai, nova], clanFacts([block('u-rex', 'u-kai', false)]), opts)
    const stages = suggestStages(cands)
    const members = stages[0]?.streams.map((s) => s.userId) ?? []
    expect(members).toContain('u-rex')
    expect(members).toContain('u-kai')
    // …but the rex/kai pair itself was never an auto-link.
    const rexKai = cands.find((c) => c.hidden === false && c.blocked)!
    expect(rexKai.autoLink).toBe(false)
  })

  it('true: they are never put on the same stage, even via a third clanmate', () => {
    const cands = linkCandidates([rex, kai, nova], clanFacts([block('u-rex', 'u-kai', true)]), opts)
    for (const stage of suggestStages(cands)) {
      const members = stage.streams.map((s) => s.userId)
      expect(members.includes('u-rex') && members.includes('u-kai')).toBe(false)
    }
  })

  it('true: a hand-picked stage drops the conflicting angle too', () => {
    const blocks = [block('u-rex', 'u-kai', true)]
    const stage = stageFromStreams([rex, kai, nova], [], { blocks })!
    expect(stage.streams.map((s) => s.userId)).toEqual(['u-rex', 'u-nova'])
  })

  it('false: a hand-picked stage may still combine them', () => {
    const stage = stageFromStreams([rex, kai], [], { blocks: [block('u-rex', 'u-kai', false)] })!
    expect(stage.streams.map((s) => s.userId)).toEqual(['u-rex', 'u-kai'])
  })

  it('returns null when hiding leaves fewer than two angles', () => {
    expect(stageFromStreams([rex, kai], [], { blocks: [block('u-rex', 'u-kai', true)] })).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Leaving a stage — it must collapse, not break
// ───────────────────────────────────────────────────────────────────────────

describe('removing a member collapses the stage gracefully', () => {
  const three = suggestStages(
    linkCandidates(
      [rex, kai, nova],
      { clansByUser: { 'u-rex': ['c-1'], 'u-kai': ['c-1'], 'u-nova': ['c-1'] } },
      opts,
    ),
  )[0]

  it('a 3-up loses one angle and carries on as a 2-up', () => {
    expect(three.streams).toHaveLength(3)
    const next = removeStreamFromStage(three, 's-kai')!
    expect(next.streams.map((s) => s.streamId).sort()).toEqual(['s-nova', 's-rex'])
    // Re-keyed and re-titled for the new cast, so viewers see the truth.
    expect(next.key).not.toBe(three.key)
    expect(next.title).toContain('2 angles')
  })

  it('a 2-up has no stage left — null, so viewers go to the single stream', () => {
    const two = removeStreamFromStage(three, 's-kai')!
    expect(removeStreamFromStage(two, two.streams[0].streamId)).toBeNull()
  })

  it('removing someone who isn’t there is a no-op, not a collapse', () => {
    expect(removeStreamFromStage(three, 's-nobody')).toBe(three)
  })

  it('removes every angle a person contributed', () => {
    const next = removeUserFromStage(three, 'u-kai')!
    expect(next.streams.some((s) => s.userId === 'u-kai')).toBe(false)
  })
})

describe('the notification opt-out choices', () => {
  it('"don’t connect me" alone changes nothing about future links', () => {
    expect(modeForOptOut('disconnect')).toBeNull()
    expect(LINK_OPT_OUT_COPY.disconnect.help).toMatch(/Everyone else keeps watching/i)
  })

  it('the other two set the preference as well', () => {
    expect(modeForOptOut('ask_next_time')).toBe('ask')
    expect(modeForOptOut('never_again')).toBe('off')
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Nobody is notified about someone they blocked
// ───────────────────────────────────────────────────────────────────────────

describe('linkNotifyTargets skips blocked people', () => {
  const stage = { reason: 'scheduled_battle' as const, streams: [rex, kai], clanId: undefined }

  it('a follower who blocked one of the streamers is not pinged', () => {
    const targets = linkNotifyTargets(stage, {
      followersByUser: { 'u-rex': ['u-fan', 'u-hater'] },
      blocks: [block('u-hater', 'u-rex')],
    })
    expect(targets.followers).toEqual(['u-fan'])
    expect(targets.all).not.toContain('u-hater')
  })

  it('nor is a follower one of the streamers blocked', () => {
    const targets = linkNotifyTargets(stage, {
      followersByUser: { 'u-rex': ['u-fan', 'u-pest'] },
      blocks: [block('u-rex', 'u-pest')],
    })
    expect(targets.followers).toEqual(['u-fan'])
  })

  it('clanmates get the same treatment', () => {
    const clanStage = { reason: 'same_clan' as const, streams: [rex, kai], clanId: 'c-1' }
    const targets = linkNotifyTargets(clanStage, {
      clanMembersByClan: { 'c-1': ['u-mate', 'u-hater'] },
      blocks: [block('u-hater', 'u-kai')],
    })
    expect(targets.clan).toEqual(['u-mate'])
  })

  it('with no blocks everyone is told, exactly as before', () => {
    const targets = linkNotifyTargets(stage, { followersByUser: { 'u-rex': ['u-fan'] } })
    expect(targets.all).toEqual(['u-rex', 'u-kai', 'u-fan'])
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  THE COST OF BLOCKING — clip cast + notifications
// ───────────────────────────────────────────────────────────────────────────

describe('a blocked user is excluded from the combined clip', () => {
  const UP = 'u-uploader'

  it('drops them from the cast AND the notifications — no row, no ping, no clip', () => {
    const plan = planReelNotifications(
      UP,
      [{ userId: UP, clipId: 'c1' }, { userId: 'u-rex', clipId: 'c2' }, { userId: 'u-kai', clipId: 'c3' }],
      [block(UP, 'u-kai')],
    )
    expect(plan.cast.map((c) => c.userId)).toEqual([UP, 'u-rex'])
    expect(plan.recipients.map((c) => c.userId)).toEqual(['u-rex'])
    expect(plan.excluded.map((c) => c.userId)).toEqual(['u-kai'])
  })

  it('works the other way round too — the person who blocked YOU loses it as well', () => {
    const plan = planReelNotifications(
      UP,
      [{ userId: UP }, { userId: 'u-kai' }],
      [block('u-kai', UP)],
    )
    expect(plan.cast.map((c) => c.userId)).toEqual([UP])
    expect(plan.recipients).toEqual([])
    expect(plan.excluded.map((c) => c.userId)).toEqual(['u-kai'])
    // One person left, so it isn't a multi-angle reel any more.
    expect(plan.isMultiAngle).toBe(false)
  })

  it("THE FOUNDER'S CASE: you blocked them, you beat them, you don't get that clip", () => {
    // kai assembled the reel of the match. rex blocked kai earlier.
    const plan = planReelNotifications(
      'u-kai',
      [{ userId: 'u-kai', clipId: 'kai-angle' }, { userId: 'u-rex', clipId: 'rex-angle' }],
      [block('u-rex', 'u-kai')],
    )
    expect(plan.cast.map((c) => c.userId)).toEqual(['u-kai'])
    expect(plan.excluded.map((c) => c.userId)).toEqual(['u-rex'])
    // rex is told nothing — the clip simply never reaches them.
    expect(plan.recipients).toEqual([])
  })

  it('a hide_in_shared_lives=false block still costs the clip', () => {
    const plan = planReelNotifications(
      UP,
      [{ userId: UP }, { userId: 'u-kai' }],
      [block(UP, 'u-kai', false)],
    )
    expect(plan.excluded.map((c) => c.userId)).toEqual(['u-kai'])
  })

  it('never drops the uploader from their own reel', () => {
    const plan = planReelNotifications(
      UP,
      [{ userId: 'u-rex' }, { userId: UP }],
      [block('u-rex', UP)],
    )
    expect(plan.cast.map((c) => c.userId)).toEqual([UP])
    expect(plan.excluded.map((c) => c.userId)).toEqual(['u-rex'])
  })

  it('applies pairwise among participants, first appearance winning', () => {
    const plan = planReelNotifications(
      UP,
      [{ userId: UP }, { userId: 'u-rex' }, { userId: 'u-kai' }],
      [block('u-rex', 'u-kai')],
    )
    expect(plan.cast.map((c) => c.userId)).toEqual([UP, 'u-rex'])
    expect(plan.excluded.map((c) => c.userId)).toEqual(['u-kai'])
  })

  it('with no blocks the plan is exactly what it always was', () => {
    const plan = planReelNotifications(UP, [{ userId: UP }, { userId: 'u-rex' }, { userId: 'u-kai' }])
    expect(plan.cast.map((c) => c.userId)).toEqual([UP, 'u-rex', 'u-kai'])
    expect(plan.excluded).toEqual([])
    expect(plan.isMultiAngle).toBe(true)
  })
})
