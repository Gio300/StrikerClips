import { describe, it, expect } from 'vitest'
import {
  MAX_CLAN_MEMBERS,
  PLATFORM_FEE,
  can,
  canLeaveClan,
  canManageMember,
  canAssignRank,
  isClanManagerRole,
  rankLevel,
  spotsLeft,
  isFull,
  canJoin,
  feeSplit,
  clanSummary,
  isDiscoverable,
  capUsageLabel,
  recordClanPayment,
  readTreasury,
  readClanLedger,
  CLAN_ROLES,
  type ClanRole,
  type ClanAction,
  type ClanStorage,
} from './clans'

// In-memory storage shim so the settlement scaffold is testable without a DOM.
function memStorage(): ClanStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => {
      m.set(k, v)
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Permission matrix (§5.2)
// ───────────────────────────────────────────────────────────────────────────

describe('clans — permission matrix (can)', () => {
  it('only the leader can edit settings and set dues', () => {
    expect(can('leader', 'edit_settings')).toBe(true)
    expect(can('leader', 'set_dues')).toBe(true)
    for (const r of ['officer', 'recruiter', 'member'] as ClanRole[]) {
      expect(can(r, 'edit_settings')).toBe(false)
      expect(can(r, 'set_dues')).toBe(false)
    }
  })

  it('leader/officer/recruiter can toggle recruiting, invite and approve', () => {
    for (const r of ['leader', 'officer', 'recruiter'] as ClanRole[]) {
      expect(can(r, 'toggle_recruiting')).toBe(true)
      expect(can(r, 'invite')).toBe(true)
      expect(can(r, 'approve')).toBe(true)
    }
    expect(can('member', 'toggle_recruiting')).toBe(false)
    expect(can('member', 'invite')).toBe(false)
  })

  it('recruiter can invite/approve but NOT kick or promote (approve/invite only)', () => {
    expect(can('recruiter', 'kick')).toBe(false)
    expect(can('recruiter', 'promote')).toBe(false)
    expect(can('recruiter', 'demote')).toBe(false)
    // Officers can moderate members.
    expect(can('officer', 'kick')).toBe(true)
    expect(can('officer', 'promote')).toBe(true)
  })

  it('every role (incl. member) can post in normal channels', () => {
    for (const r of CLAN_ROLES) expect(can(r, 'post')).toBe(true)
  })

  it('only leader/officer manage channels and post announcements', () => {
    for (const a of ['manage_channels', 'post_announcement'] as ClanAction[]) {
      expect(can('leader', a)).toBe(true)
      expect(can('officer', a)).toBe(true)
      expect(can('recruiter', a)).toBe(false)
      expect(can('member', a)).toBe(false)
    }
  })

  it('limits the management dashboard to leader/officer', () => {
    expect(isClanManagerRole('leader')).toBe(true)
    expect(isClanManagerRole('officer')).toBe(true)
    expect(isClanManagerRole('recruiter')).toBe(false)
    expect(isClanManagerRole('member')).toBe(false)
    expect(isClanManagerRole(null)).toBe(false)
  })

  it('allows non-leader members to leave while keeping the leader anchored', () => {
    expect(canLeaveClan('leader')).toBe(false)
    expect(canLeaveClan('officer')).toBe(true)
    expect(canLeaveClan('recruiter')).toBe(true)
    expect(canLeaveClan('member')).toBe(true)
    expect(canLeaveClan(null)).toBe(false)
  })
})

describe('clans — rank-relative moderation', () => {
  it('ranks order leader > officer > recruiter > member', () => {
    expect(rankLevel('leader')).toBeGreaterThan(rankLevel('officer'))
    expect(rankLevel('officer')).toBeGreaterThan(rankLevel('recruiter'))
    expect(rankLevel('recruiter')).toBeGreaterThan(rankLevel('member'))
  })

  it('you can only manage members strictly below your rank', () => {
    expect(canManageMember('officer', 'kick', 'member')).toBe(true)
    expect(canManageMember('officer', 'kick', 'recruiter')).toBe(true)
    expect(canManageMember('officer', 'kick', 'officer')).toBe(false) // no peer moderation
    expect(canManageMember('officer', 'kick', 'leader')).toBe(false) // never the leader
    expect(canManageMember('recruiter', 'kick', 'member')).toBe(false) // recruiter can't kick at all
  })

  it('assigning a rank requires the new rank to be below your own (≤ own rank)', () => {
    // Leader can make officers, recruiters, members.
    expect(canAssignRank('leader', 'member', 'officer')).toBe(true)
    // Officer can make recruiters/members but NOT another officer.
    expect(canAssignRank('officer', 'member', 'recruiter')).toBe(true)
    expect(canAssignRank('officer', 'member', 'officer')).toBe(false)
    // Officer can't re-rank a peer officer.
    expect(canAssignRank('officer', 'officer', 'recruiter')).toBe(false)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Cap math (§5.1 / §5.3)
// ───────────────────────────────────────────────────────────────────────────

describe('clans — membership cap', () => {
  it('MAX_CLAN_MEMBERS is 100', () => {
    expect(MAX_CLAN_MEMBERS).toBe(100)
  })

  it('spotsLeft counts down from the cap and clamps at 0', () => {
    expect(spotsLeft(0)).toBe(100)
    expect(spotsLeft(47)).toBe(53)
    expect(spotsLeft(100)).toBe(0)
    expect(spotsLeft(120)).toBe(0) // never negative
  })

  it('isFull is true only at/over the cap', () => {
    expect(isFull(99)).toBe(false)
    expect(isFull(100)).toBe(true)
    expect(isFull(101)).toBe(true)
  })

  it('honors a custom maxMembers', () => {
    expect(spotsLeft(5, 10)).toBe(5)
    expect(isFull(10, 10)).toBe(true)
  })

  it('capUsageLabel renders "47 / 100"', () => {
    expect(capUsageLabel(47)).toBe('47 / 100')
    expect(capUsageLabel(3, 10)).toBe('3 / 10')
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  canJoin (full / not recruiting / can't afford)
// ───────────────────────────────────────────────────────────────────────────

describe('clans — canJoin', () => {
  const openFree = { isRecruiting: true, joinFeeTokens: 0 }
  const openPaid = { isRecruiting: true, joinFeeTokens: 500 }

  it('allows joining an open free clan with room', () => {
    expect(canJoin(openFree, 10, 0)).toEqual({ ok: true })
  })

  it('blocks when the clan is full (even if recruiting)', () => {
    const r = canJoin({ isRecruiting: true, joinFeeTokens: 0 }, 100, 9999)
    expect(r).toEqual({ ok: false, reason: 'full' })
  })

  it('blocks when the clan is not recruiting', () => {
    const r = canJoin({ isRecruiting: false, joinFeeTokens: 0 }, 5, 9999)
    expect(r).toEqual({ ok: false, reason: 'closed' })
  })

  it("blocks when the user can't afford the fee", () => {
    expect(canJoin(openPaid, 5, 499)).toEqual({ ok: false, reason: 'insufficient' })
    expect(canJoin(openPaid, 5, 500)).toEqual({ ok: true }) // exact balance is enough
  })

  it('checks cap → recruiting → affordability in order', () => {
    // Full wins over closed + broke.
    expect(canJoin({ isRecruiting: false, joinFeeTokens: 500 }, 100, 0).ok).toBe(false)
    expect(canJoin({ isRecruiting: false, joinFeeTokens: 500 }, 100, 0)).toEqual({
      ok: false,
      reason: 'full',
    })
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  feeSplit (80 / 20)
// ───────────────────────────────────────────────────────────────────────────

describe('clans — feeSplit', () => {
  it('PLATFORM_FEE is 20%', () => {
    expect(PLATFORM_FEE).toBe(0.2)
  })

  it('splits 100 into 80 clan / 20 platform', () => {
    expect(feeSplit(100)).toEqual({ clan: 80, platform: 20 })
  })

  it('splits 500 into 400 / 100', () => {
    expect(feeSplit(500)).toEqual({ clan: 400, platform: 100 })
  })

  it('always sums back to the gross (no leaked tokens)', () => {
    for (const g of [1, 7, 33, 99, 12345]) {
      const s = feeSplit(g)
      expect(s.clan + s.platform).toBe(g)
    }
  })

  it('handles zero / negative gracefully', () => {
    expect(feeSplit(0)).toEqual({ clan: 0, platform: 0 })
    expect(feeSplit(-50)).toEqual({ clan: 0, platform: 0 })
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Discovery summary helpers
// ───────────────────────────────────────────────────────────────────────────

describe('clans — summary & discovery', () => {
  it('clanSummary exposes the fields a Discovery card needs', () => {
    const s = clanSummary({ name: 'Leaf', isRecruiting: true, joinFeeTokens: 500, maxMembers: 100 }, 53)
    expect(s).toMatchObject({
      name: 'Leaf',
      spotsLeft: 47,
      maxMembers: 100,
      memberCount: 53,
      joinFeeTokens: 500,
      free: false,
      isRecruiting: true,
      isFull: false,
    })
  })

  it('flags a free clan', () => {
    const s = clanSummary({ name: 'Sand', isRecruiting: true, joinFeeTokens: 0 }, 1)
    expect(s.free).toBe(true)
  })

  it('isDiscoverable requires recruiting AND an open seat', () => {
    expect(isDiscoverable({ isRecruiting: true, joinFeeTokens: 0 }, 10)).toBe(true)
    expect(isDiscoverable({ isRecruiting: false, joinFeeTokens: 0 }, 10)).toBe(false)
    expect(isDiscoverable({ isRecruiting: true, joinFeeTokens: 0 }, 100)).toBe(false) // full drops out
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  Settlement scaffold (treasury + ledger)
// ───────────────────────────────────────────────────────────────────────────

describe('clans — settlement scaffold', () => {
  it('credits the clan treasury 80% and books a ledger row on a paid join', () => {
    const store = memStorage()
    const split = recordClanPayment('srv-1', 'user-1', 500, 'join', store)
    expect(split).toEqual({ clan: 400, platform: 100 })
    expect(readTreasury('srv-1', store)).toBe(400)
    const ledger = readClanLedger('srv-1', store)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ clanTokens: 400, platformTokens: 100, grossTokens: 500 })
  })

  it('accrues treasury across multiple payments', () => {
    const store = memStorage()
    recordClanPayment('srv-2', 'a', 500, 'join', store)
    recordClanPayment('srv-2', 'b', 500, 'join', store)
    expect(readTreasury('srv-2', store)).toBe(800)
    expect(readClanLedger('srv-2', store)).toHaveLength(2)
  })

  it('books nothing for a free (0-fee) join', () => {
    const store = memStorage()
    const split = recordClanPayment('srv-3', 'user-1', 0, 'join', store)
    expect(split).toEqual({ clan: 0, platform: 0 })
    expect(readTreasury('srv-3', store)).toBe(0)
    expect(readClanLedger('srv-3', store)).toHaveLength(0)
  })
})
