/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { newDb, DataType } from 'pg-mem'
import { randomUUID } from 'node:crypto'
import { createApp } from './app'

// Build an in-memory Postgres with the tables the API touches, then the app.
function makeApp() {
  const db = newDb()
  db.public.registerFunction({ name: 'gen_random_uuid', returns: DataType.uuid, implementation: () => randomUUID() })
  db.public.none(`
    create table users (
      id uuid primary key default gen_random_uuid(),
      email text unique not null, password_hash text,
      user_metadata jsonb default '{}', created_at timestamptz default now()
    );
    create table profiles (
      id uuid primary key, username text unique not null,
      avatar_url text, bio text, power_level integer default 0, country text
    );
    create table clips (
      id uuid primary key default gen_random_uuid(), user_id uuid,
      source_type text, url_or_path text, title text, category text,
      subject_profile_id uuid, youtube_video_id text, start_sec integer,
      created_at timestamptz default now()
    );
  `)
  const pg = (db.adapters as any).createPg()
  return createApp(new pg.Pool())
}

describe('KillCam API — new-user journey (in-memory Postgres)', () => {
  const app = makeApp()
  let token = ''
  let playerId = ''

  it('health check', async () => {
    const r = await request(app).get('/health')
    expect(r.status).toBe(200); expect(r.body.ok).toBe(true)
  })

  it('rejects weak signup', async () => {
    const r = await request(app).post('/auth/signup').send({ email: 'x@y.com', password: '123' })
    expect(r.status).toBe(400)
  })

  it('signs up a new user', async () => {
    const r = await request(app).post('/auth/signup').send({ email: 'rekt@kc.gg', password: 'password123', username: 'rekt' })
    expect(r.status).toBe(200)
    expect(r.body.token).toBeTruthy()
    expect(r.body.user.email).toBe('rekt@kc.gg')
    token = r.body.token; playerId = r.body.user.id
  })

  it('blocks duplicate email', async () => {
    const r = await request(app).post('/auth/signup').send({ email: 'rekt@kc.gg', password: 'password123' })
    expect(r.status).toBe(409)
  })

  it('logs in with correct password', async () => {
    const r = await request(app).post('/auth/login').send({ email: 'rekt@kc.gg', password: 'password123' })
    expect(r.status).toBe(200); expect(r.body.token).toBeTruthy(); token = r.body.token
  })

  it('rejects wrong password', async () => {
    const r = await request(app).post('/auth/login').send({ email: 'rekt@kc.gg', password: 'nope' })
    expect(r.status).toBe(401)
  })

  it('returns me when authed, 401 when not', async () => {
    const ok = await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`)
    expect(ok.status).toBe(200); expect(ok.body.user.email).toBe('rekt@kc.gg'); expect(ok.body.user.username).toBeTruthy()
    const no = await request(app).get('/auth/me')
    expect(no.status).toBe(401)
  })

  it('creates a tagged clip (auth required) and lists it', async () => {
    const unauth = await request(app).post('/clips').send({ url_or_path: 'https://youtu.be/x' })
    expect(unauth.status).toBe(401)
    const c = await request(app).post('/clips').set('Authorization', `Bearer ${token}`)
      .send({ url_or_path: 'https://youtu.be/abc', title: 'clean ko', category: 'kill', subject_profile_id: playerId, youtube_video_id: 'abc', start_sec: 42 })
    expect(c.status).toBe(200); expect(c.body.clip.category).toBe('kill')
    const list = await request(app).get('/clips')
    expect(list.body.clips.length).toBe(1)
  })

  it('searches clips by player + category ("his last kills")', async () => {
    const r = await request(app).get('/clips/search').query({ player: playerId, category: 'kill', limit: 10 })
    expect(r.status).toBe(200)
    expect(r.body.clips.length).toBe(1)
    expect(r.body.clips[0].youtube_video_id).toBe('abc')
  })
})
