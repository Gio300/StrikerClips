/* eslint-disable @typescript-eslint/no-explicit-any */
// TOURNAMENT BATTLE MEDIA — the watch links (a fighter's live stream + their
// YouTube clips) attached to one SIDE of a bracket matchup, stored in
// tournament_battles.media as { a: { live_url, clip_urls }, b: { ... } }.
//
// The question every test here asks is the authorization one: an entrant may
// write ONLY their own side, the tournament host may write either side, and
// nobody else writes anything. Plus the validation net: clips must parse to a
// YouTube video id (canonicalized server-side), lives must be https — junk
// never lands where a viewer's click can reach it. The raw `media` column is
// an elevated col on the generic /api/db API, so the trusted
// /api/fn/tournament-battle-media handler is the only door an entrant has.
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { makeApp } from './testHarness'

const ADULT_DOB = '1995-06-15'

type Who = { token: string; id: string }

async function signUp(app: any, email: string, username: string): Promise<Who> {
  const r = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id }
}

/** POST /api/db as a given user (or anonymously when `who` is null). */
function db(app: any, who: Who | null, body: any) {
  const r = request(app).post('/api/db').send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

/** POST /api/fn/:name as a given user. */
function fn(app: any, who: Who | null, name: string, body: any = {}) {
  const r = request(app).post(`/api/fn/${name}`).send(body)
  return who ? r.set('Authorization', `Bearer ${who.token}`) : r
}

async function makeSeededTournament(
  app: any,
  host: Who,
  name: string,
  players: Who[],
): Promise<{ tournamentId: string; battles: any[] }> {
  const t = await db(app, host, {
    table: 'tournaments',
    action: 'insert',
    single: true,
    values: { name, created_by: host.id, end_at: '2030-01-01T00:00:00.000Z' },
  })
  expect(t.status).toBe(200)
  const tournamentId = t.body.data.id
  for (const player of players) {
    const entrant = await db(app, host, {
      table: 'tournament_entrants',
      action: 'insert',
      single: true,
      values: { tournament_id: tournamentId, user_id: player.id, status: 'accepted' },
    })
    expect(entrant.status).toBe(200)
  }
  const seeded = await fn(app, host, 'tournament-bracket-seed', {
    tournamentId,
    seedMode: 'registration',
  })
  expect(seeded.status).toBe(200)
  expect(seeded.body.ok).toBe(true)
  return { tournamentId, battles: seeded.body.battles }
}

describe('tournament battle media — lives + clips land on the right side only', () => {
  const app = makeApp()
  let host: Who
  let alice: Who
  let bob: Who
  let mallory: Who
  let battleId = ''
  /** Which of alice/bob actually seeded as player_a / player_b (seed order can
   *  tie on created_at and fall back to uuid order, so never assume). */
  let sideA: Who
  let sideB: Who

  it('sets up a seeded 1v1 bracket', async () => {
    host = await signUp(app, 'media-host@kc.gg', 'mediahost')
    alice = await signUp(app, 'media-alice@kc.gg', 'mediaalice')
    bob = await signUp(app, 'media-bob@kc.gg', 'mediabob')
    mallory = await signUp(app, 'media-mallory@kc.gg', 'mediamallory')

    // These fixtures intentionally let the tournament host attach the fighters'
    // media. New accounts otherwise use the followers-of-followers default.
    for (const fighter of [alice, bob]) {
      const privacy = await request(app)
        .post('/api/privacy/reels')
        .set('Authorization', `Bearer ${fighter.token}`)
        .send({ value: 'tournaments' })
      expect(privacy.status).toBe(200)
    }

    const { battles } = await makeSeededTournament(app, host, 'Media Cup', [alice, bob])
    expect(battles).toHaveLength(1)
    const battle = battles[0]
    battleId = battle.id
    sideA = battle.player_a === alice.id ? alice : bob
    sideB = battle.player_b === alice.id ? alice : bob
    expect(sideA.id).not.toBe(sideB.id)
  })

  it('an anonymous caller cannot attach media', async () => {
    const r = await fn(app, null, 'tournament-battle-media', {
      battleId,
      liveUrl: 'https://www.youtube.com/live/dQw4w9WgXcQ',
    })
    expect(r.status).toBe(401)
  })

  it('a fighter attaches a live + clips to THEIR OWN side (side inferred)', async () => {
    const r = await fn(app, sideA, 'tournament-battle-media', {
      battleId,
      liveUrl: 'https://www.youtube.com/live/aaaaaaaaaa1',
      clipUrls: [
        'https://youtu.be/aliceclip01',
        // A bare 11-char id is accepted too, and duplicates collapse.
        'aliceclip02',
        'https://www.youtube.com/watch?v=aliceclip01',
      ],
    })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    expect(r.body.side).toBe('a')
    const media = r.body.battle.media
    expect(media.a.live_url).toBe('https://www.youtube.com/live/aaaaaaaaaa1')
    // Clips are canonicalized to watch URLs and de-duplicated.
    expect(media.a.clip_urls).toEqual([
      'https://www.youtube.com/watch?v=aliceclip01',
      'https://www.youtube.com/watch?v=aliceclip02',
    ])
    expect(media.b).toBeUndefined()
  })

  it('a fighter cannot write the OTHER side', async () => {
    const r = await fn(app, sideA, 'tournament-battle-media', {
      battleId,
      side: 'b',
      liveUrl: 'https://evil.example/steal-the-spotlight',
    })
    expect(r.status).toBe(403)
    // And side b stayed untouched.
    const check = await db(app, null, {
      table: 'tournament_battles',
      action: 'select',
      filters: [{ col: 'id', op: 'eq', val: battleId }],
    })
    expect(check.body.data[0].media.b).toBeUndefined()
  })

  it('a user who is not in the battle gets 403 even for a side they name', async () => {
    for (const side of ['a', 'b']) {
      const r = await fn(app, mallory, 'tournament-battle-media', {
        battleId,
        side,
        clipUrls: ['https://youtu.be/malloryvid1'],
      })
      expect(r.status).toBe(403)
    }
  })

  it('junk clip URLs are rejected wholesale', async () => {
    for (const bad of [
      ['https://vimeo.com/123456789'],
      ['not a url at all'],
      ['https://www.youtube.com/watch?v=short'], // id must be 11 chars
      'https://youtu.be/aliceclip01', // must be a LIST
    ]) {
      const r = await fn(app, sideB, 'tournament-battle-media', {
        battleId,
        clipUrls: bad,
      })
      expect(r.status).toBe(400)
    }
  })

  it('more clips than the cap is refused', async () => {
    const r = await fn(app, sideB, 'tournament-battle-media', {
      battleId,
      clipUrls: ['clipnumb001', 'clipnumb002', 'clipnumb003', 'clipnumb004', 'clipnumb005'],
    })
    expect(r.status).toBe(400)
  })

  it('junk live URLs are rejected', async () => {
    for (const bad of [
      'http://insecure.example/live', // https only
      'javascript:alert(1)',
      'ftp://old.example/live',
      'just some words',
    ]) {
      const r = await fn(app, sideB, 'tournament-battle-media', {
        battleId,
        liveUrl: bad,
      })
      expect(r.status).toBe(400)
    }
  })

  it('a request with nothing to attach is a 400, not a silent no-op', async () => {
    const r = await fn(app, sideB, 'tournament-battle-media', { battleId })
    expect(r.status).toBe(400)
  })

  it('the HOST writes any side — and an override keeps the other keys', async () => {
    // Host fills side b on behalf of that fighter.
    const forB = await fn(app, host, 'tournament-battle-media', {
      battleId,
      side: 'b',
      liveUrl: 'https://twitch.tv/side-b-live',
      clipUrls: ['https://www.youtube.com/shorts/bobbyclip01'],
    })
    expect(forB.status).toBe(200)
    expect(forB.body.battle.media.b.live_url).toBe('https://twitch.tv/side-b-live')
    expect(forB.body.battle.media.b.clip_urls).toEqual([
      'https://www.youtube.com/watch?v=bobbyclip01',
    ])

    // Host overrides side a's live ONLY — the clips a fighter attached stay.
    const overrideA = await fn(app, host, 'tournament-battle-media', {
      battleId,
      side: 'a',
      liveUrl: 'https://www.youtube.com/live/hostoverrid1',
    })
    expect(overrideA.status).toBe(200)
    expect(overrideA.body.battle.media.a.live_url).toBe('https://www.youtube.com/live/hostoverrid1')
    expect(overrideA.body.battle.media.a.clip_urls).toEqual([
      'https://www.youtube.com/watch?v=aliceclip01',
      'https://www.youtube.com/watch?v=aliceclip02',
    ])
    // ...and side b was untouched by the side-a override.
    expect(overrideA.body.battle.media.b.live_url).toBe('https://twitch.tv/side-b-live')
  })

  it('a fighter clears their live without losing their clips', async () => {
    const r = await fn(app, sideA, 'tournament-battle-media', {
      battleId,
      liveUrl: null,
    })
    expect(r.status).toBe(200)
    expect(r.body.battle.media.a.live_url).toBeUndefined()
    expect(r.body.battle.media.a.clip_urls).toEqual([
      'https://www.youtube.com/watch?v=aliceclip01',
      'https://www.youtube.com/watch?v=aliceclip02',
    ])
  })

  it('the raw media column is CLOSED to fighters on the generic data API', async () => {
    const r = await db(app, sideA, {
      table: 'tournament_battles',
      action: 'update',
      single: true,
      filters: [{ col: 'id', op: 'eq', val: battleId }],
      values: { media: { b: { live_url: 'https://evil.example/forged' } } },
    })
    expect(r.status).toBe(403)
  })

  it('an unknown battle 404s and a malformed id never reaches SQL', async () => {
    const missing = await fn(app, host, 'tournament-battle-media', {
      battleId: '00000000-0000-4000-8000-000000000000',
      side: 'a',
      liveUrl: 'https://example.com/live',
    })
    expect(missing.status).toBe(404)
    const malformed = await fn(app, host, 'tournament-battle-media', {
      battleId: 'not-a-uuid',
      liveUrl: 'https://example.com/live',
    })
    expect(malformed.status).toBe(404)
  })

  it('a bye slot (no fighter yet) takes no media, even from the host', async () => {
    const trio = await Promise.all(
      Array.from({ length: 3 }, (_, index) =>
        signUp(app, `media-trio-${index}@kc.gg`, `mediatrio${index}`),
      ),
    )
    const { battles } = await makeSeededTournament(app, host, 'Bye Cup', trio)
    const bye = battles.find((battle: any) => !battle.player_b)
    expect(bye).toBeTruthy()
    const r = await fn(app, host, 'tournament-battle-media', {
      battleId: bye.id,
      side: 'b',
      liveUrl: 'https://example.com/live',
    })
    expect(r.status).toBe(400)
  })
})
