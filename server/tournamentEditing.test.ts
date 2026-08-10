/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'
type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const response = await request(app).post('/api/auth/signup').send({
    email,
    password: 'password123',
    username,
    date_of_birth: ADULT_DOB,
  })
  expect(response.status).toBe(200)
  return { token: response.body.token, id: response.body.user.id }
}

function db(app: any, who: Who, body: any) {
  return request(app)
    .post('/api/db')
    .set('Authorization', `Bearer ${who.token}`)
    .send(body)
}

describe('tournament editing', () => {
  const app = makeApp()

  it('lets the creator and tournament admins edit safe fields but refuses outsiders', async () => {
    const nonce = Math.random().toString(36).slice(2, 9)
    const creator = await signUp(app, `edit-owner-${nonce}@example.com`, `editowner${nonce}`)
    const admin = await signUp(app, `edit-admin-${nonce}@example.com`, `editadmin${nonce}`)
    const outsider = await signUp(app, `edit-outsider-${nonce}@example.com`, `editout${nonce}`)

    const created = await db(app, creator, {
      table: 'tournaments',
      action: 'insert',
      single: true,
      values: {
        name: 'Original Cup',
        description: 'Original league description',
        status: 'draft',
        start_at: '2030-01-10T18:00:00.000Z',
        end_at: '2030-01-10T22:00:00.000Z',
        league_slug: 'tko',
        entry_scope: 'public',
      },
    })
    expect(created.status).toBe(200)
    const tournamentId = created.body.data.id as string

    const ownerEdit = await db(app, creator, {
      table: 'tournaments',
      action: 'update',
      single: true,
      filters: [{ col: 'id', op: 'eq', val: tournamentId }],
      values: {
        name: 'Owner Updated Cup',
        description: 'Updated league description',
        status: 'open',
        start_at: '2030-01-11T18:00:00.000Z',
        end_at: '2030-01-11T23:00:00.000Z',
        league_slug: 'shinobistrikerleague',
      },
    })
    expect(ownerEdit.status).toBe(200)
    expect(ownerEdit.body.data).toMatchObject({
      name: 'Owner Updated Cup',
      description: 'Updated league description',
      status: 'open',
      league_slug: 'shinobistrikerleague',
    })

    const adminRow = await db(app, creator, {
      table: 'tournament_admins',
      action: 'insert',
      single: true,
      values: {
        tournament_id: tournamentId,
        user_id: admin.id,
      },
    })
    expect(adminRow.status).toBe(200)

    const adminEdit = await db(app, admin, {
      table: 'tournaments',
      action: 'update',
      single: true,
      filters: [{ col: 'id', op: 'eq', val: tournamentId }],
      values: { status: 'live' },
    })
    expect(adminEdit.status).toBe(200)
    expect(adminEdit.body.data.status).toBe('live')

    const refused = await db(app, outsider, {
      table: 'tournaments',
      action: 'update',
      single: true,
      filters: [{ col: 'id', op: 'eq', val: tournamentId }],
      values: { name: 'Hijacked Cup' },
    })
    expect(refused.status).toBe(403)

    const invalidSchedule = await db(app, creator, {
      table: 'tournaments',
      action: 'update',
      single: true,
      filters: [{ col: 'id', op: 'eq', val: tournamentId }],
      values: { end_at: '2030-01-11T17:00:00.000Z' },
    })
    expect(invalidSchedule.status).toBe(400)
    expect(invalidSchedule.body.error).toContain('end time must be after the start time')
  })
})
