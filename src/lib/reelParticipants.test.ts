import { describe, it, expect } from 'vitest'
import { planReelNotifications, participantNotification } from './reelParticipants'

const U = {
  uploader: 'user-uploader',
  ann: 'user-ann',
  ben: 'user-ben',
  cal: 'user-cal',
}

describe('planReelNotifications — who gets told', () => {
  it('notifies every participant except the uploader', () => {
    const plan = planReelNotifications(U.uploader, [
      { userId: U.uploader, clipId: 'c1' },
      { userId: U.ann, clipId: 'c2' },
      { userId: U.ben, clipId: 'c3' },
    ])
    expect(plan.recipients.map((r) => r.userId)).toEqual([U.ann, U.ben])
    expect(plan.cast.map((c) => c.userId)).toEqual([U.uploader, U.ann, U.ben])
    expect(plan.isMultiAngle).toBe(true)
  })

  it('adds the uploader to the cast even when their own clip was not listed', () => {
    const plan = planReelNotifications(U.uploader, [{ userId: U.ann, clipId: 'c2' }])
    expect(plan.cast.map((c) => c.userId)).toEqual([U.ann, U.uploader])
    expect(plan.recipients.map((r) => r.userId)).toEqual([U.ann])
  })

  it('never notifies the uploader about their own reel', () => {
    const plan = planReelNotifications(U.uploader, [
      { userId: U.uploader, clipId: 'c1' },
      { userId: U.uploader, clipId: 'c2' },
    ])
    expect(plan.recipients).toEqual([])
  })
})

describe('planReelNotifications — dedupe', () => {
  it('notifies a person ONCE even when they contributed several angles', () => {
    const plan = planReelNotifications(U.uploader, [
      { userId: U.ann, clipId: 'c1' },
      { userId: U.ann, clipId: 'c2' },
      { userId: U.ann, clipId: 'c3' },
      { userId: U.ben, clipId: 'c4' },
    ])
    expect(plan.recipients.map((r) => r.userId)).toEqual([U.ann, U.ben])
    expect(plan.recipients.filter((r) => r.userId === U.ann)).toHaveLength(1)
    // The cast list is one row per person too — no duplicate DB rows.
    expect(plan.cast.map((c) => c.userId)).toEqual([U.ann, U.ben, U.uploader])
  })

  it('keeps the first clip but backfills a username seen on a later duplicate', () => {
    const plan = planReelNotifications(U.uploader, [
      { userId: U.ann, clipId: 'c1' },
      { userId: U.ann, clipId: 'c2', username: 'ann' },
    ])
    const ann = plan.cast.find((c) => c.userId === U.ann)!
    expect(ann.clipId).toBe('c1')
    expect(ann.username).toBe('ann')
  })

  it('treats whitespace-padded ids as the same person', () => {
    const plan = planReelNotifications(U.uploader, [
      { userId: U.ann },
      { userId: `  ${U.ann}  ` },
    ])
    expect(plan.recipients).toHaveLength(1)
    expect(plan.recipients[0].userId).toBe(U.ann)
  })

  it('drops blank participant ids instead of creating orphan rows', () => {
    const plan = planReelNotifications(U.uploader, [
      { userId: '' },
      { userId: '   ' },
      { userId: U.cal },
    ])
    expect(plan.cast.map((c) => c.userId)).toEqual([U.cal, U.uploader])
  })
})

describe('planReelNotifications — multi-angle gate', () => {
  it('is not multi-angle when only the uploader appears', () => {
    const plan = planReelNotifications(U.uploader, [{ userId: U.uploader, clipId: 'c1' }])
    expect(plan.isMultiAngle).toBe(false)
    expect(plan.recipients).toEqual([])
  })

  it('is not multi-angle for an empty candidate list', () => {
    expect(planReelNotifications(U.uploader, []).isMultiAngle).toBe(false)
  })

  it('is multi-angle as soon as a second distinct person appears', () => {
    expect(planReelNotifications(U.uploader, [{ userId: U.ann }]).isMultiAngle).toBe(true)
  })

  it('handles a missing uploader id without inventing a cast member', () => {
    const plan = planReelNotifications('', [{ userId: U.ann }, { userId: U.ben }])
    expect(plan.cast.map((c) => c.userId)).toEqual([U.ann, U.ben])
    expect(plan.recipients.map((r) => r.userId)).toEqual([U.ann, U.ben])
  })
})

describe('participantNotification', () => {
  it('links to the reel and says you are in it', () => {
    const n = participantNotification('Round 3 comeback', 'reel-9')
    expect(n.kind).toBe('reel_participant')
    expect(n.link).toBe('/reels/reel-9')
    expect(n.relatedId).toBe('reel-9')
    expect(n.body).toContain("you're in it")
    expect(n.body).toContain('Round 3 comeback')
  })

  it('falls back to generic copy when the reel has no title', () => {
    expect(participantNotification('   ', 'reel-9').body).toContain('your match')
  })
})
