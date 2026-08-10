import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'

describe('generic data query pagination', () => {
  it('honors a bounded offset after applying a stable order', async () => {
    const pool = makeDb()
    const app = createApp(pool)
    for (const username of ['page-a', 'page-b', 'page-c', 'page-d']) {
      await pool.query('insert into profiles (id, username) values ($1, $2)', [randomUUID(), username])
    }

    const response = await request(app).post('/api/db').send({
      table: 'profiles',
      action: 'select',
      columns: 'username',
      order: { column: 'username', ascending: true },
      limit: 2,
      offset: 1,
    })

    expect(response.status).toBe(200)
    expect(response.body.data.map((row: { username: string }) => row.username)).toEqual(['page-b', 'page-c'])
  })
})
