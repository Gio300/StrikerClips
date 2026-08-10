import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from './app'
import { makeDb } from './testHarness'

const ADULT_DOB = '1990-01-01'

async function signUp(app: any, email: string, username: string) {
  const response = await request(app).post('/api/auth/signup').send({
    email,
    username,
    password: 'password123',
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return { id: response.body.user.id as string, token: response.body.token as string }
}

function db(app: any, token: string, body: unknown) {
  return request(app).post('/api/db').set('Authorization', `Bearer ${token}`).send(body)
}

describe('village-scoped tournament membership policy', () => {
  it('uses village_clans.server_id for manager and entrant membership checks', async () => {
    const pool = makeDb()
    const app = createApp(pool as any)
    const leader = await signUp(app, 'village-leader@tko.test', 'villageleader')
    const member = await signUp(app, 'village-member@tko.test', 'villagemember')
    const outsider = await signUp(app, 'village-outsider@tko.test', 'villageoutsider')

    const clan = await db(app, leader.token, {
      table: 'servers', action: 'insert', single: true,
      values: { name: 'Leaf QA Clan', kind: 'clan', owner_id: leader.id },
    })
    expect(clan.status).toBe(200)
    const serverId = clan.body.data.id as string
    const seat = await db(app, leader.token, {
      table: 'clan_members', action: 'insert', single: true,
      values: { server_id: serverId, user_id: member.id, role: 'member' },
    })
    expect(seat.status).toBe(200)

    const village = (await pool.query(
      `insert into villages (name,chief_profile_id,created_by)
       values ('Leaf QA Village',$1,$1) returning id`,
      [leader.id],
    )).rows[0]
    await pool.query(
      'insert into village_clans (village_id,server_id,joined_by) values ($1,$2,$3)',
      [village.id, serverId, leader.id],
    )

    const tournament = await db(app, leader.token, {
      table: 'tournaments', action: 'insert', single: true,
      values: {
        name: 'Leaf Village QA Cup',
        entry_scope: 'village',
        village_id: village.id,
        created_by: leader.id,
        start_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        end_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      },
    })
    expect(tournament.status, JSON.stringify(tournament.body)).toBe(200)

    const entered = await db(app, member.token, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: {
        tournament_id: tournament.body.data.id,
        user_id: member.id,
        team_server_id: serverId,
      },
    })
    expect(entered.status).toBe(200)
    expect(entered.body.data.status).toBe('pending')
    expect(entered.body.data.team_server_id).toBe(serverId)

    const refused = await db(app, outsider.token, {
      table: 'tournament_entrants', action: 'insert', single: true,
      values: { tournament_id: tournament.body.data.id, user_id: outsider.id },
    })
    expect(refused.status).toBe(403)
  })
})
