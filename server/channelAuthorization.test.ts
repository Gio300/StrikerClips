import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

async function signup(app: ReturnType<typeof createApp>, suffix: string) {
  const response = await request(app).post('/api/auth/signup').send({
    email: `${suffix}@channels.test`,
    password: 'password123',
    username: suffix,
  })
  expect(response.status).toBe(200)
  return { id: String(response.body.user.id), token: String(response.body.token) }
}

describe('legacy clan channel authorization', () => {
  it('lets the clan owner add a channel and refuses an outsider', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    const owner = await signup(app, 'channel_owner')
    const outsider = await signup(app, 'channel_outsider')
    const clan = (await pool.query(
      "insert into servers (name,owner_id,kind) values ('Channel Clan',$1,'clan') returning id",
      [owner.id],
    )).rows[0]

    const add = (token: string, name: string) => request(app)
      .post('/api/db')
      .set('authorization', `Bearer ${token}`)
      .send({
        table: 'channels',
        action: 'insert',
        single: true,
        values: [{ server_id: clan.id, name }],
      })

    const allowed = await add(owner.token, 'strategy')
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200)
    expect(allowed.body.data).toMatchObject({ server_id: clan.id, name: 'strategy' })

    const refused = await add(outsider.token, 'private-room')
    expect(refused.status).toBe(403)
    expect(refused.body.error).toContain('requires a host/owner role')
  })
})
