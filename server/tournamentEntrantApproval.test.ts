/* eslint-disable @typescript-eslint/no-explicit-any */
// Tournament entry approval + stat-check visibility — the full operator loop:
//
//   player enters (any door) → entry lands PENDING, never approved —
//   player submits a stat check → the host can SEE it (public read) —
//   host approves via /api/fn/tournament-entrant-review → entrant 'accepted',
//   the pending stat check flips 'approved', the player is notified —
//   a non-host caller gets 403 — a submitter can NOT self-approve either
//   their entry or their own stat check.
//
// Regression for the live incident (2026-08-02): entrant "MrJerry" showed up
// APPROVED with no host action because self-entry wrote status='accepted'
// directly and the server trusted it.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'
type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup').send({
    email, password: 'password123', username, date_of_birth: ADULT_DOB,
  })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

function fn(app: any, who: Who | null, name: string, body: any = {}) {
  const r = request(app).post(`/api/fn/${name}`).send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

describe('tournament entries require explicit host approval', () => {
  const app = makeApp()

  async function setup() {
    const host = await signUp(app, `host-${Math.random().toString(36).slice(2)}@kc.gg`, `host${Math.random().toString(36).slice(2, 8)}`)
    const t = await db(app, host, {
      table: 'tournaments', action: 'insert', single: true,
      values: { name: 'Approval Cup', created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
    })
    expect(t.status).toBe(200)
    return { host, tournamentId: t.body.data.id as string }
  }

  it('self-entry lands PENDING even when the client claims accepted (MrJerry regression)', async () => {
    const { host, tournamentId } = await setup()
    const mrjerry = await signUp(app, 'mrjerry@kc.gg', 'mrjerry')
    const entered = await db(app, mrjerry, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: {
        tournament_id: tournamentId, user_id: mrjerry.id,
        status: 'accepted', // the old self-approval hole
        agreed_to_rules_at: new Date().toISOString(),
      },
    })
    expect(entered.status).toBe(200)
    expect(entered.body.data.status).toBe('pending')

    // ...and they cannot flip it to accepted afterwards either.
    const selfApprove = await db(app, mrjerry, {
      table: 'tournament_entrants', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: entered.body.data.id }],
      values: { status: 'accepted' },
    })
    expect(selfApprove.status).toBe(403)

    // Self-WITHDRAW stays possible (their own exit door).
    const withdraw = await db(app, mrjerry, {
      table: 'tournament_entrants', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: entered.body.data.id }],
      values: { status: 'withdrawn' },
    })
    expect(withdraw.status).toBe(200)
    expect(withdraw.body.data.status).toBe('withdrawn')
    void host
  })

  it('the teammate-invite door also lands PENDING, with invited_by stamped to the inviter', async () => {
    const { tournamentId } = await setup()
    const captain = await signUp(app, 'captain@kc.gg', 'captain')
    const mate = await signUp(app, 'mate@kc.gg', 'mate')

    const own = await db(app, captain, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: { tournament_id: tournamentId, user_id: captain.id, agreed_to_rules_at: new Date().toISOString(), team_name: 'KMH' },
    })
    expect(own.status).toBe(200)
    expect(own.body.data.status).toBe('pending')

    const invite = await db(app, captain, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: { tournament_id: tournamentId, user_id: mate.id, status: 'accepted', team_name: 'KMH' },
    })
    expect(invite.status).toBe(200)
    expect(invite.body.data.status).toBe('pending')
    expect(String(invite.body.data.user_id)).toBe(mate.id)
    expect(String(invite.body.data.invited_by)).toBe(captain.id)

    // A stranger with no entrant row cannot inject entrants for others.
    const stranger = await signUp(app, 'stranger@kc.gg', 'stranger')
    const outsider = await signUp(app, 'outsider@kc.gg', 'outsider')
    const denied = await db(app, stranger, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: { tournament_id: tournamentId, user_id: outsider.id },
    })
    expect(denied.status).toBe(403)
  })

  it('full loop: enter → stat check visible to the host → notify → approve fn → statuses flip → player sees it', async () => {
    const { host, tournamentId } = await setup()
    const kissa = await signUp(app, 'kissatronix@kc.gg', 'kissatronix')

    // 1. Enter + submit the stat check (what EnterTournamentDialog does).
    const entered = await db(app, kissa, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: { tournament_id: tournamentId, user_id: kissa.id, agreed_to_rules_at: new Date().toISOString() },
    })
    expect(entered.status).toBe(200)
    expect(entered.body.data.status).toBe('pending')
    const entrantId = entered.body.data.id as string

    const sub = await db(app, kissa, {
      table: 'stat_check_submissions', action: 'insert', single: true,
      values: {
        user_id: kissa.id, tournament_id: tournamentId,
        video_url: 'https://youtu.be/abcdefghijk', character_name: 'Naruto (Sage)',
        invited_admin_id: null,
      },
    })
    expect(sub.status).toBe(200)
    expect(sub.body.data.status).toBe('pending')

    // ...and the client-side notify() pipeline can write the host's
    // notification (insert:'auth' on notifications).
    const notified = await db(app, kissa, {
      table: 'notifications', action: 'insert', single: true,
      values: {
        user_id: host.id, kind: 'tournament_started',
        title: 'New entrant awaiting your approval',
        link: `/tournaments/${tournamentId}?section=entrants`, actor_id: kissa.id,
      },
    })
    expect(notified.status).toBe(200)

    // 2. VISIBILITY: the host's tournament-page read returns the submission.
    const hostView = await db(app, host, {
      table: 'stat_check_submissions', action: 'select',
      filters: [{ col: 'tournament_id', op: 'eq', val: tournamentId }],
      order: { column: 'created_at', ascending: false },
    })
    expect(hostView.status).toBe(200)
    expect(hostView.body.data).toHaveLength(1)
    expect(hostView.body.data[0].status).toBe('pending')

    // 3. The submitter can NOT approve their own stat check...
    const cheat = await db(app, kissa, {
      table: 'stat_check_submissions', action: 'update', single: true,
      filters: [{ col: 'id', op: 'eq', val: sub.body.data.id }],
      values: { status: 'approved' },
    })
    expect(cheat.status).toBe(403)

    // ...and a random player can't approve the ENTRY through the fn.
    const rando = await signUp(app, 'rando@kc.gg', 'rando')
    const deniedFn = await fn(app, rando, 'tournament-entrant-review', {
      entrantId, decision: 'approve',
    })
    expect(deniedFn.status).toBe(403)

    // 4. The HOST approves through the trusted fn.
    const approved = await fn(app, host, 'tournament-entrant-review', {
      entrantId, decision: 'approve', notes: 'Buffs verified live.',
    })
    expect(approved.status).toBe(200)
    expect(approved.body.ok).toBe(true)
    expect(approved.body.entrant.status).toBe('accepted')

    // 5. The stat check flipped with it, and the PLAYER sees both.
    const myEntry = await db(app, kissa, {
      table: 'tournament_entrants', action: 'select', single: true,
      filters: [{ col: 'id', op: 'eq', val: entrantId }],
    })
    expect(myEntry.body.data.status).toBe('accepted')

    const mySubs = await db(app, kissa, {
      table: 'stat_check_submissions', action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: kissa.id }],
    })
    expect(mySubs.body.data[0].status).toBe('approved')
    expect(String(mySubs.body.data[0].reviewed_by)).toBe(host.id)

    // ...and got a notification about the decision.
    const myNotifs = await db(app, kissa, {
      table: 'notifications', action: 'select',
      filters: [{ col: 'kind', op: 'eq', val: 'tournament_entry_reviewed' }],
    })
    expect(myNotifs.status).toBe(200)
    expect(myNotifs.body.data).toHaveLength(1)
    expect(myNotifs.body.data[0].title).toContain('approved')

    // 6. Re-review is refused (already decided).
    const again = await fn(app, host, 'tournament-entrant-review', {
      entrantId, decision: 'reject',
    })
    expect(again.status).toBe(409)
  })

  it('reject flips the entry to rejected and the stat check to rejected', async () => {
    const { host, tournamentId } = await setup()
    const hammy = await signUp(app, 'hammy@kc.gg', 'hammy')
    const entered = await db(app, hammy, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: { tournament_id: tournamentId, user_id: hammy.id, agreed_to_rules_at: new Date().toISOString() },
    })
    const sub = await db(app, hammy, {
      table: 'stat_check_submissions', action: 'insert', single: true,
      values: { user_id: hammy.id, tournament_id: tournamentId, video_url: 'https://youtu.be/zzzzzzzzzzz' },
    })
    expect(sub.status).toBe(200)

    const rejected = await fn(app, host, 'tournament-entrant-review', {
      entrantId: entered.body.data.id, decision: 'reject', notes: 'Stat check does not match the roster.',
    })
    expect(rejected.status).toBe(200)
    expect(rejected.body.entrant.status).toBe('rejected')

    const after = await db(app, hammy, {
      table: 'stat_check_submissions', action: 'select', single: true,
      filters: [{ col: 'id', op: 'eq', val: sub.body.data.id }],
    })
    expect(after.body.data.status).toBe('rejected')
    expect(after.body.data.review_notes).toBe('Stat check does not match the roster.')
  })

  it('a registered tournament ADMIN can approve; garbage input is rejected', async () => {
    const { host, tournamentId } = await setup()
    const admin = await signUp(app, 'adminrev@kc.gg', 'adminrev')
    const addAdmin = await db(app, host, {
      table: 'tournament_admins', action: 'insert', single: true,
      values: { tournament_id: tournamentId, user_id: admin.id },
    })
    expect(addAdmin.status).toBe(200)

    const player = await signUp(app, 'pending-player@kc.gg', 'pendingplayer')
    const entered = await db(app, player, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: { tournament_id: tournamentId, user_id: player.id, agreed_to_rules_at: new Date().toISOString() },
    })

    const bad = await fn(app, admin, 'tournament-entrant-review', { entrantId: 'not-a-uuid', decision: 'approve' })
    expect(bad.status).toBe(400)
    const badDecision = await fn(app, admin, 'tournament-entrant-review', { entrantId: entered.body.data.id, decision: 'maybe' })
    expect(badDecision.status).toBe(400)

    const ok = await fn(app, admin, 'tournament-entrant-review', {
      entrantId: entered.body.data.id, decision: 'approve',
    })
    expect(ok.status).toBe(200)
    expect(ok.body.entrant.status).toBe('accepted')
  })

  // A stat check with no tournament_id can NEVER reach a review queue: every
  // reviewer surface is keyed by that column. The Stat Check Room used to
  // write exactly that row — the submitter saw "posted", the host never saw
  // anything, and the clip sat unreadable forever. The tournament is now part
  // of what makes the row valid, enforced server-side so no client can skip it.
  it('a stat check ALWAYS carries the tournament it is for', async () => {
    const { host, tournamentId } = await setup()
    const player = await signUp(app, 'orphan@kc.gg', 'orphanplayer')

    const orphan = await db(app, player, {
      table: 'stat_check_submissions', action: 'insert', single: true,
      values: { user_id: player.id, video_url: 'https://youtu.be/abc12345678' },
    })
    expect(orphan.status).toBe(400)
    expect(String(orphan.body.error)).toMatch(/tournament/i)

    // An explicit null is the same orphan by another name.
    const nulled = await db(app, player, {
      table: 'stat_check_submissions', action: 'insert', single: true,
      values: { user_id: player.id, video_url: 'https://youtu.be/abc12345678', tournament_id: null },
    })
    expect(nulled.status).toBe(400)

    // With the tournament named it lands — and the HOST can see it, which is
    // the whole point of carrying the id.
    const attached = await db(app, player, {
      table: 'stat_check_submissions', action: 'insert', single: true,
      values: {
        user_id: player.id,
        tournament_id: tournamentId,
        video_url: 'https://youtu.be/abc12345678',
        character_name: 'Naruto (Sage)',
      },
    })
    expect(attached.status).toBe(200)
    expect(String(attached.body.data.tournament_id)).toBe(tournamentId)

    const queue = await db(app, host, {
      table: 'stat_check_submissions', action: 'select',
      filters: [{ col: 'tournament_id', op: 'eq', val: tournamentId }],
    })
    expect(queue.status).toBe(200)
    expect((queue.body.data as any[]).map((row) => String(row.id))).toContain(
      String(attached.body.data.id),
    )
    // Nothing orphaned was stored along the way.
    const all = await db(app, host, { table: 'stat_check_submissions', action: 'select' })
    expect((all.body.data as any[]).every((row) => row.tournament_id)).toBe(true)
  })

  it('the public tournament page reads work signed-out (share-link recipient)', async () => {
    const { tournamentId } = await setup()
    for (const table of ['tournaments', 'stat_check_submissions', 'tournament_results', 'tournament_admins'] as const) {
      const r = await db(app, null, {
        table, action: 'select',
        filters: [{ col: table === 'tournaments' ? 'id' : 'tournament_id', op: 'eq', val: tournamentId }],
      })
      expect(r.status, `${table} must be publicly readable`).toBe(200)
    }
  })
})
