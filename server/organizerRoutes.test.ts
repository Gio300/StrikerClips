import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import type { RosterInviteEmail } from './authEmail'

const ADULT_DOB = '1990-01-01'

type Account = { id: string; token: string; email: string; username: string }

async function signUp(app: ReturnType<typeof createApp>, email: string, username: string): Promise<Account> {
  const response = await request(app)
    .post('/api/auth/signup')
    .send({ email, username, password: 'password123', date_of_birth: ADULT_DOB })
  expect(response.status).toBe(200)
  return { id: response.body.user.id, token: response.body.token, email, username }
}

const as = (account: Account) => ({ Authorization: `Bearer ${account.token}` })

describe('organizer clan and tournament rosters', () => {
  let pool: ReturnType<typeof makeDb>
  let deliveries: RosterInviteEmail[]
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    pool = makeDb()
    deliveries = []
    app = createApp(pool, {
      sendRosterInviteEmail: async (message) => { deliveries.push(message) },
    })
  })

  async function clan(owner: Account, name = 'Hidden Leaf', fee = 0): Promise<string> {
    const inserted = await pool.query(
      `insert into servers (name,owner_id,kind,join_fee_tokens,treasury_tokens)
       values ($1,$2,'clan',$3,0) returning id`,
      [name, owner.id, fee],
    )
    const serverId = inserted.rows[0].id
    await pool.query(
      `insert into clan_members (server_id,user_id,role) values ($1,$2,'leader')`,
      [serverId, owner.id],
    )
    await pool.query(
      `insert into server_members (server_id,user_id,role) values ($1,$2,'leader')`,
      [serverId, owner.id],
    )
    return serverId
  }

  async function addClanMember(serverId: string, member: Account): Promise<void> {
    await pool.query(
      `insert into clan_members (server_id,user_id,role) values ($1,$2,'member')`,
      [serverId, member.id],
    )
    await pool.query(
      `insert into server_members (server_id,user_id,role) values ($1,$2,'member')`,
      [serverId, member.id],
    )
  }

  it('lets a closed clan review applications and settles the agreed join fee atomically', async () => {
    const leader = await signUp(app, 'leader@example.com', 'leaflead')
    const applicant = await signUp(app, 'applicant@example.com', 'newleaf')
    const serverId = await clan(leader, 'Closed Clan', 100)
    await pool.query(
      `insert into wallets (user_id,tokens,sweeps,paid_sweeps_cents) values ($1,250,0,0)`,
      [applicant.id],
    )

    const applied = await request(app)
      .post(`/api/organizer/clans/${serverId}/applications`)
      .set(as(applicant))
      .send({ message: 'I play healer.' })
    expect(applied.status).toBe(201)
    expect(applied.body.application.status).toBe('pending')
    expect((await pool.query('select tokens from wallets where user_id=$1', [applicant.id])).rows[0].tokens).toBe(250)

    const dashboard = await request(app)
      .get(`/api/organizer/clans/${serverId}/dashboard`)
      .set(as(leader))
    expect(dashboard.status).toBe(200)
    expect(dashboard.body.applications[0].username).toBe('newleaf')

    const managed = await request(app)
      .get('/api/organizer/clans/mine')
      .set(as(leader))
    expect(managed.status).toBe(200)
    expect(managed.body.clans).toEqual([
      expect.objectContaining({ id: serverId, name: 'Closed Clan' }),
    ])

    const approved = await request(app)
      .post(`/api/organizer/clan-applications/${applied.body.application.id}/review`)
      .set(as(leader))
      .send({ decision: 'approve' })
    expect(approved.status).toBe(200)
    expect(approved.body.payment.charged).toBe(100)

    const membership = await pool.query(
      'select * from clan_members where server_id=$1 and user_id=$2',
      [serverId, applicant.id],
    )
    const wallet = await pool.query('select tokens from wallets where user_id=$1', [applicant.id])
    const treasury = await pool.query('select treasury_tokens from servers where id=$1', [serverId])
    expect(membership.rows).toHaveLength(1)
    expect(wallet.rows[0].tokens).toBe(150)
    expect(treasury.rows[0].treasury_tokens).toBe(80)
  })

  it('sends a hashed email invitation and only the matching account can accept it', async () => {
    const leader = await signUp(app, 'captain@example.com', 'captain')
    const invitee = await signUp(app, 'fighter@example.com', 'fighter')
    const stranger = await signUp(app, 'stranger@example.com', 'stranger')
    const serverId = await clan(leader)
    const created = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Squad A', max_members: 4, member_ids: [leader.id] })
    expect(created.status).toBe(201)
    const rosterId = created.body.roster.id
    const reusable = await request(app)
      .get('/api/organizer/clan-rosters/mine')
      .set(as(leader))
    expect(reusable.status).toBe(200)
    expect(reusable.body.rosters[0]).toMatchObject({ id: rosterId, clan_name: 'Hidden Leaf', name: 'Squad A' })

    const invited = await request(app)
      .post(`/api/organizer/clan-rosters/${rosterId}/invites`)
      .set(as(leader))
      .send({ target: invitee.email, member_role: 'starter' })
    expect(invited.status).toBe(201)
    expect(invited.body.invite.token_hash).toBeUndefined()
    expect(deliveries).toHaveLength(1)
    const token = new URL(deliveries[0].inviteUrl).searchParams.get('token')!

    const wrongAccount = await request(app)
      .post('/api/organizer/roster-invites/accept')
      .set(as(stranger))
      .send({ token })
    expect(wrongAccount.status).toBe(403)

    const accepted = await request(app)
      .post('/api/organizer/roster-invites/accept')
      .set(as(invitee))
      .send({ token })
    expect(accepted.status).toBe(200)
    const rosterMembers = await pool.query(
      'select user_id from clan_roster_members where roster_id=$1 order by user_id',
      [rosterId],
    )
    expect(rosterMembers.rows.map((row) => row.user_id)).toContain(invitee.id)
    expect(await pool.query(
      'select id from clan_members where server_id=$1 and user_id=$2',
      [serverId, invitee.id],
    )).toMatchObject({ rows: [{ id: expect.any(String) }] })
  })

  it('persists an expired invitation instead of rolling the status change back', async () => {
    let clock = new Date('2026-08-01T00:00:00.000Z')
    app = createApp(pool, {
      now: () => clock,
      sendRosterInviteEmail: async (message) => { deliveries.push(message) },
    })
    const leader = await signUp(app, 'expiry-captain@example.com', 'expirycaptain')
    const invitee = await signUp(app, 'expiry-fighter@example.com', 'expiryfighter')
    const serverId = await clan(leader, 'Expiry Clan')
    const created = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Expiry Squad', max_members: 4, member_ids: [leader.id] })
    const invited = await request(app)
      .post(`/api/organizer/clan-rosters/${created.body.roster.id}/invites`)
      .set(as(leader))
      .send({ target: invitee.email })
    expect(invited.status).toBe(201)
    const token = new URL(deliveries[0].inviteUrl).searchParams.get('token')!
    clock = new Date('2026-08-09T00:00:00.000Z')

    const expired = await request(app)
      .post('/api/organizer/roster-invites/accept')
      .set(as(invitee))
      .send({ token })
    expect(expired.status).toBe(409)
    expect(expired.body.error).toBe('invitation_expired')
    expect((await pool.query('select status from clan_roster_invites where id=$1', [invited.body.invite.id])).rows[0].status)
      .toBe('expired')
  })

  it('lets a member remove themself from a reusable clan roster', async () => {
    const leader = await signUp(app, 'self-roster-leader@example.com', 'selfrosterlead')
    const member = await signUp(app, 'self-roster-member@example.com', 'selfrostermember')
    const serverId = await clan(leader)
    await addClanMember(serverId, member)
    const created = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Main Team', max_members: 4, member_ids: [leader.id, member.id] })
    expect(created.status).toBe(201)

    const mine = await request(app)
      .get('/api/organizer/clan-roster-memberships/mine')
      .set(as(member))
    expect(mine.status).toBe(200)
    expect(mine.body.rosters).toEqual([
      expect.objectContaining({ id: created.body.roster.id, name: 'Main Team', clan_name: 'Hidden Leaf' }),
    ])

    const removed = await request(app)
      .delete(`/api/organizer/clan-rosters/${created.body.roster.id}/members/${member.id}`)
      .set(as(member))
    expect(removed.status).toBe(200)

    const members = await pool.query(
      'select user_id from clan_roster_members where roster_id=$1',
      [created.body.roster.id],
    )
    expect(members.rows).toEqual([{ user_id: leader.id }])
  })

  it('lets a clan manager delete a reusable roster but refuses outsiders', async () => {
    const leader = await signUp(app, 'delete-roster-leader@example.com', 'deleterosterlead')
    const outsider = await signUp(app, 'delete-roster-outsider@example.com', 'deleterosterout')
    const serverId = await clan(leader)
    const created = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Temporary Team', max_members: 1 })
    expect(created.status).toBe(201)

    const refused = await request(app)
      .delete(`/api/organizer/clan-rosters/${created.body.roster.id}`)
      .set(as(outsider))
    expect(refused.status).toBe(403)

    const removed = await request(app)
      .delete(`/api/organizer/clan-rosters/${created.body.roster.id}`)
      .set(as(leader))
    expect(removed.status).toBe(200)
    expect(removed.body.deleted_roster_id).toBe(created.body.roster.id)
    expect((await pool.query('select id from clan_rosters where id=$1', [created.body.roster.id])).rows).toEqual([])
  })

  it('lets an organizer invite clans, select saved rosters, and enforce invite-only entry', async () => {
    const host = await signUp(app, 'clan-invite-host@example.com', 'claninvitehost')
    const leader = await signUp(app, 'clan-invite-leader@example.com', 'claninvitelead')
    const outsider = await signUp(app, 'clan-invite-outsider@example.com', 'claninviteout')
    const serverId = await clan(leader, 'Invited Leaf')
    const savedRoster = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'First Four', max_members: 4, member_ids: [leader.id] })
    expect(savedRoster.status).toBe(201)

    const tournament = await pool.query(
      `insert into tournaments (name,created_by,status,start_at,end_at)
       values ('Invitation Cup',$1,'open',now(),now()+interval '2 days') returning id`,
      [host.id],
    )
    const tournamentId = tournament.rows[0].id

    const refusedModeChange = await request(app)
      .patch(`/api/organizer/tournaments/${tournamentId}/clan-entry-mode`)
      .set(as(outsider))
      .send({ mode: 'invited_only' })
    expect(refusedModeChange.status).toBe(403)

    const modeChanged = await request(app)
      .patch(`/api/organizer/tournaments/${tournamentId}/clan-entry-mode`)
      .set(as(host))
      .send({ mode: 'invited_only' })
    expect(modeChanged.status).toBe(200)
    expect(modeChanged.body.clan_entry_mode).toBe('invited_only')

    const blockedBeforeInvite = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: savedRoster.body.roster.id })
    expect(blockedBeforeInvite.status).toBe(403)
    expect(blockedBeforeInvite.body.error).toBe('tournament_clan_invitation_required')

    const hostBoard = await request(app)
      .get(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(host))
    expect(hostBoard.status).toBe(200)
    expect(hostBoard.body.clan_options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: serverId,
        name: 'Invited Leaf',
        rosters: [expect.objectContaining({ id: savedRoster.body.roster.id, name: 'First Four', member_count: 1 })],
      }),
    ]))

    const invited = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/clan-invitations`)
      .set(as(host))
      .send({ clan_id: serverId, source_clan_roster_id: savedRoster.body.roster.id })
    expect(invited.status).toBe(201)
    expect(invited.body.invitation).toMatchObject({
      clan_id: serverId,
      clan_name: 'Invited Leaf',
      source_clan_roster_id: savedRoster.body.roster.id,
      source_clan_roster_name: 'First Four',
      status: 'invited',
    })

    const clanBoard = await request(app)
      .get(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(leader))
    expect(clanBoard.status).toBe(200)
    expect(clanBoard.body.clan_entry_mode).toBe('invited_only')
    expect(clanBoard.body.clan_options).toEqual([])
    expect(clanBoard.body.clan_invitations).toEqual([
      expect.objectContaining({ clan_id: serverId, status: 'invited' }),
    ])

    const entered = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: savedRoster.body.roster.id })
    expect(entered.status).toBe(201)
    expect(entered.body.roster.members.map((member: any) => member.user_id)).toContain(leader.id)
    expect((await pool.query(
      'select status,source_clan_roster_id from tournament_clan_invitations where tournament_id=$1 and clan_id=$2',
      [tournamentId, serverId],
    )).rows[0]).toMatchObject({ status: 'accepted', source_clan_roster_id: savedRoster.body.roster.id })
  })

  it('lets a player leave a locked tournament roster without manager rights or a perk', async () => {
    const host = await signUp(app, 'self-leave-host@example.com', 'selfleavehost')
    const leader = await signUp(app, 'self-leave-leader@example.com', 'selfleavelead')
    const member = await signUp(app, 'self-leave-member@example.com', 'selfleavemember')
    const serverId = await clan(leader)
    await addClanMember(serverId, member)
    const source = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Leave Test', max_members: 4, member_ids: [leader.id, member.id] })
    const tournament = await pool.query(
      `insert into tournaments (name,created_by,status,start_at,end_at)
       values ('Leave Cup',$1,'open',now(),now()+interval '2 days') returning id`,
      [host.id],
    )
    const entered = await request(app)
      .post(`/api/organizer/tournaments/${tournament.rows[0].id}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: source.body.roster.id })
    const rosterId = entered.body.roster.id
    expect((await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/submit`)
      .set(as(leader))
      .send()).status).toBe(200)

    const left = await request(app)
      .delete(`/api/organizer/tournament-rosters/${rosterId}/members/${member.id}`)
      .set(as(member))
      .send({ mutation_id: 'member-self-removal' })
    expect(left.status).toBe(200)
    expect(left.body.roster.members.map((row: any) => row.user_id)).not.toContain(member.id)
    expect((await pool.query(
      'select status from tournament_entrants where tournament_id=$1 and user_id=$2',
      [tournament.rows[0].id, member.id],
    )).rows[0].status).toBe('withdrawn')
  })

  it('lets a clan manager withdraw an unlocked tournament roster without deleting its audit history', async () => {
    const host = await signUp(app, 'draft-withdraw-host@example.com', 'draftwithdrawhost')
    const leader = await signUp(app, 'draft-withdraw-leader@example.com', 'draftwithdrawlead')
    const captain = await signUp(app, 'draft-withdraw-captain@example.com', 'draftwithdrawcaptain')
    const outsider = await signUp(app, 'draft-withdraw-outsider@example.com', 'draftwithdrawout')
    const serverId = await clan(leader, 'Draft Withdrawal Clan')
    await addClanMember(serverId, captain)
    const source = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Draft Four', max_members: 4, member_ids: [leader.id, captain.id] })
    const tournament = await pool.query(
      `insert into tournaments (name,created_by,status,start_at,end_at)
       values ('Draft Withdrawal Cup',$1,'open',now(),now()+interval '2 days') returning id`,
      [host.id],
    )
    const entered = await request(app)
      .post(`/api/organizer/tournaments/${tournament.rows[0].id}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: source.body.roster.id })
    const rosterId = entered.body.roster.id
    await pool.query('update tournament_rosters set captain_id=$2 where id=$1', [rosterId, captain.id])

    const captainBoard = await request(app)
      .get(`/api/organizer/tournaments/${tournament.rows[0].id}/rosters`)
      .set(as(captain))
    expect(captainBoard.status).toBe(200)
    expect(captainBoard.body.rosters[0]).toMatchObject({ can_manage: true, can_withdraw: false })
    const captainDenied = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/withdraw`)
      .set(as(captain))
      .send({ mutation_id: 'captain-draft-withdrawal' })
    expect(captainDenied.status).toBe(403)
    expect(captainDenied.body.error).toBe('roster_manager_required')

    const denied = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/withdraw`)
      .set(as(outsider))
      .send({ mutation_id: 'outsider-draft-withdrawal' })
    expect(denied.status).toBe(403)
    expect(denied.body.error).toBe('roster_manager_required')

    const withdrawn = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/withdraw`)
      .set(as(leader))
      .send({ mutation_id: 'manager-draft-withdrawal' })
    expect(withdrawn.status, JSON.stringify(withdrawn.body)).toBe(200)
    expect(withdrawn.body.roster.status).toBe('withdrawn')
    expect(withdrawn.body.roster.members.map((member: any) => member.user_id)).toEqual(
      expect.arrayContaining([leader.id, captain.id]),
    )
    expect((await pool.query(
      `select action,actor_id,reason,entitlement_source from tournament_roster_revisions
        where tournament_roster_id=$1 order by version desc limit 1`,
      [rosterId],
    )).rows[0]).toMatchObject({
      action: 'withdrawn',
      actor_id: leader.id,
      reason: null,
      entitlement_source: null,
    })
    expect((await pool.query(
      'select count(*)::int as n from tournament_roster_members where tournament_roster_id=$1',
      [rosterId],
    )).rows[0].n).toBe(2)

    const board = await request(app)
      .get(`/api/organizer/tournaments/${tournament.rows[0].id}/rosters`)
      .set(as(host))
    expect(board.status).toBe(200)
    expect(board.body.rosters).toEqual([])
  })

  it('requires an audited organizer override to withdraw a locked roster and preserves entrants', async () => {
    const host = await signUp(app, 'locked-withdraw-host@example.com', 'lockedwithdrawhost')
    const leader = await signUp(app, 'locked-withdraw-leader@example.com', 'lockedwithdrawlead')
    const member = await signUp(app, 'locked-withdraw-member@example.com', 'lockedwithdrawmember')
    const serverId = await clan(leader, 'Locked Withdrawal Clan')
    await addClanMember(serverId, member)
    const source = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Locked Four', max_members: 4, member_ids: [leader.id, member.id] })
    const tournament = await pool.query(
      `insert into tournaments (name,created_by,status,start_at,end_at)
       values ('Locked Withdrawal Cup',$1,'open',now(),now()+interval '2 days') returning id`,
      [host.id],
    )
    const tournamentId = tournament.rows[0].id
    const entered = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: source.body.roster.id })
    const rosterId = entered.body.roster.id
    expect((await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/submit`)
      .set(as(leader))
      .send()).status).toBe(200)
    await pool.query("update tournaments set status='closed' where id=$1", [tournamentId])

    const managerDenied = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/withdraw`)
      .set(as(leader))
      .send({ mutation_id: 'manager-locked-withdrawal' })
    expect(managerDenied.status).toBe(409)
    expect(managerDenied.body.error).toBe('locked_roster_withdrawal_requires_host')

    const missingReason = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/withdraw`)
      .set(as(host))
      .send({ mutation_id: 'host-withdrawal-without-reason' })
    expect(missingReason.status).toBe(400)
    expect(missingReason.body.error).toBe('host_override_reason_required')

    const removed = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/withdraw`)
      .set(as(host))
      .send({ mutation_id: 'host-locked-withdrawal', reason: 'Duplicate lineup entered by mistake.' })
    expect(removed.status, JSON.stringify(removed.body)).toBe(200)
    expect(removed.body.roster.status).toBe('withdrawn')
    expect(removed.body.roster.members).toHaveLength(2)
    expect((await pool.query(
      'select status from tournament_entrants where tournament_id=$1 order by user_id',
      [tournamentId],
    )).rows.map((row) => row.status)).toEqual(['withdrawn', 'withdrawn'])
    expect((await pool.query(
      `select action,actor_id,reason,entitlement_source,entitlement_ref
         from tournament_roster_revisions where mutation_id='host-locked-withdrawal'`,
    )).rows[0]).toMatchObject({
      action: 'withdrawn',
      actor_id: host.id,
      reason: 'Duplicate lineup entered by mistake.',
      entitlement_source: 'host_override',
      entitlement_ref: host.id,
    })

    const replay = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/withdraw`)
      .set(as(host))
      .send({ mutation_id: 'host-locked-withdrawal', reason: 'Duplicate lineup entered by mistake.' })
    expect(replay.status).toBe(200)
    expect(replay.body.replayed).toBe(true)
  })

  it('locks submitted rosters and consumes artifact or organizer-grant perks for changes', async () => {
    const host = await signUp(app, 'host@example.com', 'host')
    const leader = await signUp(app, 'rosterlead@example.com', 'rosterlead')
    const first = await signUp(app, 'first@example.com', 'first')
    const second = await signUp(app, 'second@example.com', 'second')
    const third = await signUp(app, 'third@example.com', 'third')
    const serverId = await clan(leader)
    await addClanMember(serverId, first)
    await addClanMember(serverId, second)
    await addClanMember(serverId, third)
    const clanRoster = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Ranked Four', max_members: 4, member_ids: [leader.id, first.id] })
    const sourceRosterId = clanRoster.body.roster.id

    const tournamentRow = await pool.query(
      `insert into tournaments (name,created_by,status,start_at,end_at)
       values ('Cup',$1,'open',now(),now()+interval '2 days') returning id`,
      [host.id],
    )
    const tournamentId = tournamentRow.rows[0].id
    const tournamentRoster = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: sourceRosterId })
    expect(tournamentRoster.status).toBe(201)
    const rosterId = tournamentRoster.body.roster.id
    expect((await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/submit`)
      .set(as(leader))
      .send()).status).toBe(200)

    await request(app)
      .post(`/api/organizer/clan-rosters/${sourceRosterId}/members`)
      .set(as(leader))
      .send({ user_id: second.id, member_role: 'starter' })
    const locked = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/sync`)
      .set(as(leader))
      .send({ mutation_id: 'locked-without-perk' })
    expect(locked.status).toBe(409)
    expect(locked.body.error).toBe('roster_locked_perk_required')

    await pool.query(
      `insert into assets (id,name,team_name,image_url,created_by,origin)
       values ('roster-pass','Roster Pass','Cup','',$1,'prize')`,
      [host.id],
    )
    await pool.query(
      `insert into asset_ownership (user_id,asset_id,source) values ($1,'roster-pass','prize')`,
      [leader.id],
    )
    await pool.query(
      `insert into assets (id,name,team_name,image_url,created_by,origin) values
       ('team-banner','Team Banner','Cup','',$1,'prize'),
       ('second-banner','Second Banner','Cup','',$1,'prize')`,
      [host.id],
    )
    await pool.query(
      `insert into asset_ownership (user_id,asset_id,source) values
       ($1,'team-banner','prize'),($1,'second-banner','prize')`,
      [leader.id],
    )
    const pack = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/packs`)
      .set(as(host))
      .send({
        name: 'Lineup Flex',
        qualifying_asset_id: 'roster-pass',
        benefits: { roster_changes: 1, artifact_slots: 1 },
      })
    expect(pack.status).toBe(201)

    const artifactPlacement = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/artifacts`)
      .set(as(leader))
      .send({ asset_id: 'team-banner', mutation_id: 'artifact-placement' })
    expect(artifactPlacement.status).toBe(200)
    expect(artifactPlacement.body.roster.artifacts[0].name).toBe('Team Banner')
    expect((await pool.query(
      `select source_kind,benefit from tournament_perk_usage where idempotency_key='artifact-placement'`,
    )).rows[0]).toMatchObject({ source_kind: 'artifact', benefit: 'artifact_slot' })
    expect((await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/artifacts`)
      .set(as(leader))
      .send({ asset_id: 'second-banner', mutation_id: 'artifact-placement-used-up' })).status).toBe(409)

    const artifactChange = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/sync`)
      .set(as(leader))
      .send({ mutation_id: 'artifact-change' })
    expect(artifactChange.status).toBe(200)
    expect(artifactChange.body.roster.members.map((member: any) => member.user_id)).toContain(second.id)
    const firstUse = await pool.query(
      `select source_kind from tournament_perk_usage where idempotency_key='artifact-change'`,
    )
    expect(firstUse.rows[0].source_kind).toBe('artifact')

    await request(app)
      .post(`/api/organizer/clan-rosters/${sourceRosterId}/members`)
      .set(as(leader))
      .send({ user_id: third.id, member_role: 'substitute' })
    expect((await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/sync`)
      .set(as(leader))
      .send({ mutation_id: 'artifact-used-up' })).status).toBe(409)

    const grant = await request(app)
      .post(`/api/organizer/tournament-packs/${pack.body.pack.id}/grants`)
      .set(as(host))
      .send({ tournament_roster_id: rosterId, note: 'Emergency substitute' })
    expect(grant.status).toBe(201)
    const grantedChange = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterId}/sync`)
      .set(as(leader))
      .send({ mutation_id: 'organizer-grant-change' })
    expect(grantedChange.status).toBe(200)
    expect(grantedChange.body.roster.members.map((member: any) => member.user_id)).toContain(third.id)
    expect((await pool.query(
      `select source_kind from tournament_perk_usage where idempotency_key='organizer-grant-change'`,
    )).rows[0].source_kind).toBe('grant')
  })

  it('keeps unlimited roster changes inside the tournament that issued the pack', async () => {
    const host = await signUp(app, 'unlimited-host@example.com', 'unlimitedhost')
    const leader = await signUp(app, 'unlimited-leader@example.com', 'unlimitedlead')
    const first = await signUp(app, 'unlimited-first@example.com', 'unlimitedfirst')
    const second = await signUp(app, 'unlimited-second@example.com', 'unlimitedsecond')
    const third = await signUp(app, 'unlimited-third@example.com', 'unlimitedthird')
    const serverId = await clan(leader, 'Unlimited Test Clan')
    await addClanMember(serverId, first)
    await addClanMember(serverId, second)
    await addClanMember(serverId, third)

    const source = await request(app)
      .post(`/api/organizer/clans/${serverId}/rosters`)
      .set(as(leader))
      .send({ name: 'Unlimited Squad', max_members: 4, member_ids: [leader.id, first.id] })
    expect(source.status).toBe(201)
    const sourceRosterId = source.body.roster.id

    const tournaments = await pool.query(
      `insert into tournaments (name,created_by,status,start_at,end_at) values
       ('Unlimited Cup',$1,'open',now(),now()+interval '2 days'),
       ('Separate Cup',$1,'open',now(),now()+interval '3 days') returning id,name`,
      [host.id],
    )
    const tournamentA = tournaments.rows.find((row) => row.name === 'Unlimited Cup').id
    const tournamentB = tournaments.rows.find((row) => row.name === 'Separate Cup').id

    const enteredA = await request(app)
      .post(`/api/organizer/tournaments/${tournamentA}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: sourceRosterId })
    const enteredB = await request(app)
      .post(`/api/organizer/tournaments/${tournamentB}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: sourceRosterId })
    expect(enteredA.status).toBe(201)
    expect(enteredB.status).toBe(201)
    const rosterA = enteredA.body.roster.id
    const rosterB = enteredB.body.roster.id
    expect((await request(app).post(`/api/organizer/tournament-rosters/${rosterA}/submit`).set(as(leader))).status).toBe(200)
    expect((await request(app).post(`/api/organizer/tournament-rosters/${rosterB}/submit`).set(as(leader))).status).toBe(200)

    const pack = await request(app)
      .post(`/api/organizer/tournaments/${tournamentA}/packs`)
      .set(as(host))
      .send({
        name: 'Unlimited Lineup Flex',
        benefits: { roster_changes: 25, unlimited_roster_changes: true, artifact_slots: 0 },
      })
    expect(pack.status).toBe(201)
    expect(pack.body.pack.benefits).toMatchObject({
      roster_changes: 0,
      unlimited_roster_changes: true,
      artifact_slots: 0,
    })
    const grant = await request(app)
      .post(`/api/organizer/tournament-packs/${pack.body.pack.id}/grants`)
      .set(as(host))
      .send({ user_id: leader.id, note: 'Unlimited only in Unlimited Cup' })
    expect(grant.status).toBe(201)

    const boardA = await request(app)
      .get(`/api/organizer/tournaments/${tournamentA}/rosters`)
      .set(as(leader))
    expect(boardA.body.rosters[0]).toMatchObject({
      id: rosterA,
      roster_changes_unlimited: true,
      roster_changes_remaining: 0,
    })

    await request(app)
      .post(`/api/organizer/clan-rosters/${sourceRosterId}/members`)
      .set(as(leader))
      .send({ user_id: second.id, member_role: 'starter' })
    expect((await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterA}/sync`)
      .set(as(leader))
      .send({ mutation_id: 'unlimited-change-one' })).status).toBe(200)

    await request(app)
      .post(`/api/organizer/clan-rosters/${sourceRosterId}/members`)
      .set(as(leader))
      .send({ user_id: third.id, member_role: 'substitute' })
    expect((await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterA}/sync`)
      .set(as(leader))
      .send({ mutation_id: 'unlimited-change-two' })).status).toBe(200)

    const blockedInOtherTournament = await request(app)
      .post(`/api/organizer/tournament-rosters/${rosterB}/sync`)
      .set(as(leader))
      .send({ mutation_id: 'unlimited-must-not-cross-tournaments' })
    expect(blockedInOtherTournament.status).toBe(409)
    expect(blockedInOtherTournament.body.error).toBe('roster_locked_perk_required')
    expect((await pool.query(
      `select count(*)::int as n from tournament_perk_usage
        where pack_id=$1 and benefit='roster_change'`,
      [pack.body.pack.id],
    )).rows[0].n).toBe(2)
  })

  it('turns a leader-approved clan alliance into a private shared village', async () => {
    const leafLeader = await signUp(app, 'leaf-leader@example.com', 'leaf_leader')
    const sandLeader = await signUp(app, 'sand-leader@example.com', 'sand_leader')
    const leafMember = await signUp(app, 'leaf-member@example.com', 'leaf_member')
    const outsider = await signUp(app, 'outsider@example.com', 'outsider')
    const leafId = await clan(leafLeader, 'Hidden Leaf')
    const sandId = await clan(sandLeader, 'Hidden Sand')
    await addClanMember(leafId, leafMember)

    const managed = await request(app).get('/api/organizer/clans/mine').set(as(leafLeader))
    expect(managed.status).toBe(200)
    expect(managed.body.clans.map((row: any) => row.id)).toEqual([leafId])

    const memberProposal = await request(app)
      .post(`/api/organizer/clans/${leafId}/alliance-requests`)
      .set(as(leafMember))
      .send({ to_clan_id: sandId, village_name: 'Village Hidden in the Test' })
    expect(memberProposal.status).toBe(403)

    const proposed = await request(app)
      .post(`/api/organizer/clans/${leafId}/alliance-requests`)
      .set(as(leafLeader))
      .send({ to_clan_id: sandId, village_name: 'Village Hidden in the Test' })
    expect(proposed.status).toBe(201)

    const targetDashboard = await request(app)
      .get(`/api/organizer/clans/${sandId}/alliance-dashboard`)
      .set(as(sandLeader))
    expect(targetDashboard.status).toBe(200)
    expect(targetDashboard.body.incoming[0].id).toBe(proposed.body.request.id)

    const wrongReviewer = await request(app)
      .post(`/api/organizer/alliance-requests/${proposed.body.request.id}/review`)
      .set(as(leafLeader))
      .send({ decision: 'accept' })
    expect(wrongReviewer.status).toBe(403)

    const accepted = await request(app)
      .post(`/api/organizer/alliance-requests/${proposed.body.request.id}/review`)
      .set(as(sandLeader))
      .send({ decision: 'accept' })
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200)
    expect(accepted.body.village.name).toBe('Village Hidden in the Test')
    expect(accepted.body.village.clans.map((row: any) => row.id).sort()).toEqual([leafId, sandId].sort())

    const memberBoard = await request(app)
      .get(`/api/organizer/villages/${accepted.body.village.id}`)
      .set(as(leafMember))
    expect(memberBoard.status).toBe(200)
    expect(memberBoard.body.can_manage).toBe(false)

    const privateBoard = await request(app)
      .get(`/api/organizer/villages/${accepted.body.village.id}`)
      .set(as(outsider))
    expect(privateBoard.status).toBe(403)
  })

  it('allows one leader-only atomic village home claim and rejects collisions', async () => {
    const leader = await signUp(app, 'home-leader@example.com', 'home_leader')
    const member = await signUp(app, 'home-member@example.com', 'home_member')
    const rivalLeader = await signUp(app, 'rival-leader@example.com', 'rival_leader')
    const clanId = await clan(leader, 'Home Clan')
    const rivalClanId = await clan(rivalLeader, 'Rival Clan')
    await addClanMember(clanId, member)
    const firstVillage = await pool.query(
      `insert into villages (name,chief_profile_id,created_by)
       values ('Home Village',$1,$1) returning id`,
      [leader.id],
    )
    const rivalVillage = await pool.query(
      `insert into villages (name,chief_profile_id,created_by)
       values ('Rival Village',$1,$1) returning id`,
      [rivalLeader.id],
    )
    await pool.query(
      `insert into village_clans (village_id,server_id,joined_by) values ($1,$2,$3),($4,$5,$6)`,
      [firstVillage.rows[0].id, clanId, leader.id, rivalVillage.rows[0].id, rivalClanId, rivalLeader.id],
    )
    await pool.query('update servers set village_id=$2 where id=$1', [clanId, firstVillage.rows[0].id])
    await pool.query('update servers set village_id=$2 where id=$1', [rivalClanId, rivalVillage.rows[0].id])
    const territoryA = await pool.query(
      `insert into territories (name,col,row) values ('Training Field',30,30) returning id`,
    )
    const territoryB = await pool.query(
      `insert into territories (name,col,row) values ('Second Field',31,30) returning id`,
    )

    const memberClaim = await request(app)
      .post(`/api/organizer/villages/${firstVillage.rows[0].id}/home-territory`)
      .set(as(member))
      .send({ territory_id: territoryA.rows[0].id })
    expect(memberClaim.status).toBe(403)

    const claimed = await request(app)
      .post(`/api/organizer/villages/${firstVillage.rows[0].id}/home-territory`)
      .set(as(leader))
      .send({ territory_id: territoryA.rows[0].id })
    expect(claimed.status, JSON.stringify(claimed.body)).toBe(200)
    expect(claimed.body.village.home_territory_name).toBe('Training Field')

    const secondHome = await request(app)
      .post(`/api/organizer/villages/${firstVillage.rows[0].id}/home-territory`)
      .set(as(leader))
      .send({ territory_id: territoryB.rows[0].id })
    expect(secondHome.status).toBe(409)
    expect(secondHome.body.error).toBe('village_home_already_claimed')

    const collision = await request(app)
      .post(`/api/organizer/villages/${rivalVillage.rows[0].id}/home-territory`)
      .set(as(rivalLeader))
      .send({ territory_id: territoryA.rows[0].id })
    expect(collision.status).toBe(409)
    expect(collision.body.error).toBe('territory_already_claimed')
  })

  it('enforces clan-only tournaments across creation, entry, and roster snapshots', async () => {
    const leader = await signUp(app, 'clan-cup-leader@example.com', 'clan_cup_leader')
    const member = await signUp(app, 'clan-cup-member@example.com', 'clan_cup_member')
    const outsider = await signUp(app, 'clan-cup-outsider@example.com', 'clan_cup_outsider')
    const rivalLeader = await signUp(app, 'clan-cup-rival@example.com', 'clan_cup_rival')
    const clanId = await clan(leader, 'Clan Cup Hosts')
    const rivalClanId = await clan(rivalLeader, 'Clan Cup Rivals')
    await addClanMember(clanId, member)

    const deniedTournament = await request(app)
      .post('/api/db')
      .set(as(outsider))
      .send({
        table: 'tournaments', action: 'insert', single: true,
        values: {
          name: 'Stolen Clan Cup', server_id: clanId, entry_scope: 'clan',
          end_at: '2030-01-01T00:00:00.000Z',
        },
      })
    expect(deniedTournament.status).toBe(403)

    const createdTournament = await request(app)
      .post('/api/db')
      .set(as(leader))
      .send({
        table: 'tournaments', action: 'insert', single: true,
        values: {
          name: 'Members Only Cup', server_id: clanId, entry_scope: 'clan',
          end_at: '2030-01-01T00:00:00.000Z',
        },
      })
    expect(createdTournament.status, JSON.stringify(createdTournament.body)).toBe(200)
    const tournamentId = createdTournament.body.data.id
    expect(createdTournament.body.data.created_by).toBe(leader.id)

    const outsiderEntry = await request(app)
      .post('/api/db')
      .set(as(outsider))
      .send({
        table: 'tournament_entrants', action: 'insert', single: true,
        values: { tournament_id: tournamentId, user_id: outsider.id },
      })
    expect(outsiderEntry.status).toBe(403)

    const memberEntry = await request(app)
      .post('/api/db')
      .set(as(member))
      .send({
        table: 'tournament_entrants', action: 'insert', single: true,
        values: { tournament_id: tournamentId, user_id: member.id },
      })
    expect(memberEntry.status, JSON.stringify(memberEntry.body)).toBe(200)
    expect(memberEntry.body.data.team_server_id).toBe(clanId)

    const rivalRoster = await request(app)
      .post(`/api/organizer/clans/${rivalClanId}/rosters`)
      .set(as(rivalLeader))
      .send({ name: 'Rival Four', max_members: 4, member_ids: [rivalLeader.id] })
    expect(rivalRoster.status).toBe(201)
    const wrongRoster = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: rivalRoster.body.roster.id })
    expect(wrongRoster.status).toBe(403)
    expect(wrongRoster.body.error).toBe('clan_tournament_roster_must_match_host_clan')

    const ownRoster = await request(app)
      .post(`/api/organizer/clans/${clanId}/rosters`)
      .set(as(leader))
      .send({ name: 'Host Four', max_members: 4, member_ids: [leader.id, member.id] })
    expect(ownRoster.status).toBe(201)
    const acceptedRoster = await request(app)
      .post(`/api/organizer/tournaments/${tournamentId}/rosters`)
      .set(as(leader))
      .send({ source_clan_roster_id: ownRoster.body.roster.id })
    expect(acceptedRoster.status, JSON.stringify(acceptedRoster.body)).toBe(201)
    expect(acceptedRoster.body.roster.clan_id).toBe(clanId)

    const publicTournament = await request(app)
      .post('/api/db')
      .set(as(outsider))
      .send({
        table: 'tournaments', action: 'insert', single: true,
        values: { name: 'Open Cup', entry_scope: 'public', end_at: '2030-01-01T00:00:00.000Z' },
      })
    expect(publicTournament.status).toBe(200)
  })

  it('rejects a managed clan roster from outside a village-only tournament', async () => {
    const villageLeader = await signUp(app, 'village-cup@example.com', 'village_cup')
    const rivalLeader = await signUp(app, 'outside-village@example.com', 'outside_village')
    const villageClanId = await clan(villageLeader, 'Village Hosts')
    const rivalClanId = await clan(rivalLeader, 'Outside Clan')
    const village = await pool.query(
      `insert into villages (name,chief_profile_id,created_by)
       values ('Roster Village',$1,$1) returning id`,
      [villageLeader.id],
    )
    const villageId = village.rows[0].id
    await pool.query(
      `insert into village_clans (village_id,server_id,joined_by) values ($1,$2,$3)`,
      [villageId, villageClanId, villageLeader.id],
    )
    const tournament = await request(app)
      .post('/api/db')
      .set(as(villageLeader))
      .send({
        table: 'tournaments', action: 'insert', single: true,
        values: {
          name: 'Village Teams Only', entry_scope: 'village', village_id: villageId,
          end_at: '2030-01-01T00:00:00.000Z',
        },
      })
    expect(tournament.status, JSON.stringify(tournament.body)).toBe(200)
    const outsideRoster = await request(app)
      .post(`/api/organizer/clans/${rivalClanId}/rosters`)
      .set(as(rivalLeader))
      .send({ name: 'Outside Four', max_members: 4, member_ids: [rivalLeader.id] })
    expect(outsideRoster.status).toBe(201)

    const rejected = await request(app)
      .post(`/api/organizer/tournaments/${tournament.body.data.id}/rosters`)
      .set(as(rivalLeader))
      .send({ source_clan_roster_id: outsideRoster.body.roster.id })
    expect(rejected.status).toBe(403)
    expect(rejected.body.error).toBe('village_tournament_roster_must_belong_to_host_village')
  })
})
