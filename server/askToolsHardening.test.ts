/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// ASK TKO TOOLS - HARDENING REGRESSIONS
//
// Two defects found in adversarial review of the tool layer. Both were reachable
// from a MODEL-CHOSEN string, which means neither needed a hostile user - a
// half-heard name or a hallucinated tool name was enough.
//
//   1. PROTOTYPE LOOKUP -> DATABASE CREDENTIALS. `EXECUTORS[name]` on an object
//      literal resolves up Object.prototype, so name='constructor' returned the
//      Object function. It passed the truthiness check and ran as
//      `Object(deps, args)`, which returns deps itself - live pg.Pool included.
//      The caller JSON.stringifies a tool result into the functionResponse sent
//      to Vertex, and pg.Pool.options carries user/password/host/
//      connectionString.
//
//   2. LIKE WILDCARDS -> ANOTHER PLAYER'S RECORD. cleanArg stripped control
//      characters but left `%` and `_`. player_record({username:'%'}) became
//      `like lower('%%')`, matched the alphabetically first player, and returned
//      their real win/loss ledger with found:true. The assistant then reads out
//      someone else's stats as fact - worse than a miss, because nothing looks
//      broken.
//
// The pre-existing tests missed both: the bad-tool-name case used an ARBITRARY
// name (never a prototype one), and the injection case used `'; drop table --`
// (which correctly matches nothing) rather than a wildcard.
// =============================================================================
import { beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './testHarness'
import { runAskTool, likeArg, cleanArg, type AskToolDeps } from './askTools'

describe('askTools hardening', () => {
  const pool = makeDb()
  const me = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'

  const deps = (userId: string): AskToolDeps => ({
    pool: pool as any,
    userId,
    liveNumbers: async () => 'live numbers',
    mySnapshot: async () => 'private snapshot',
  })

  beforeAll(async () => {
    // Deliberately NO underscores in these fixtures. likeArg() escapes `_` to
    // `\_`, which real Postgres resolves back to a literal underscore -- but
    // pg-mem (the in-memory harness) does not implement LIKE escapes, so an
    // underscore name is unverifiable HERE while being correct in production.
    // Testing the escape behaviour itself is what the likeArg unit case above
    // is for; these fixtures test that the lookup still works end to end.
    for (const [id, name] of [[me, 'aaafirst'], [other, 'zzzlast']] as const) {
      await pool.query('insert into users (id, email) values ($1,$2)', [id, `${name}@tko.cam`])
      await pool.query('insert into profiles (id, username, power_level) values ($1,$2,$3)', [id, name, 50])
    }
  })

  // ── 1. prototype lookup ───────────────────────────────────────────────────
  // Every one of these is a real own-property of Object.prototype, so each was
  // a separate way through the old bare-index lookup.
  const PROTO_NAMES = [
    'constructor', 'toString', 'valueOf', 'hasOwnProperty',
    '__proto__', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
  ]

  it('never resolves a tool through Object.prototype', async () => {
    for (const name of PROTO_NAMES) {
      const r: any = await runAskTool(deps(me), name, {})
      expect(r, `${name} must not execute`).toBeTruthy()
      expect(r.found, `${name} must be a miss`).toBe(false)
      expect(typeof r.note).toBe('string')
    }
  })

  it('never returns the deps object or anything holding a pool', async () => {
    for (const name of PROTO_NAMES) {
      const r: any = await runAskTool(deps(me), name, {})
      // The exact leak: Object(deps, args) === deps.
      expect(r.pool, `${name} leaked pool`).toBeUndefined()
      expect(r.userId, `${name} leaked userId`).toBeUndefined()
      // Belt and braces - nothing credential-shaped anywhere in the payload
      // that gets stringified onto the wire to Vertex.
      const wire = JSON.stringify(r)
      for (const secret of ['password', 'connectionString', 'connection_string']) {
        expect(wire.toLowerCase()).not.toContain(secret.toLowerCase())
      }
    }
  })

  // ── 2. LIKE wildcards ─────────────────────────────────────────────────────
  it('escapes LIKE metacharacters', () => {
    expect(likeArg('%')).toBe('\\%')
    expect(likeArg('_')).toBe('\\_')
    expect(likeArg('a%b_c')).toBe('a\\%b\\_c')
    expect(likeArg('back\\slash')).toBe('back\\\\slash')
    expect(likeArg('ordinary name')).toBe('ordinary name')
    // cleanArg stays display-safe: it must NOT gain escapes, or error text
    // shown to the player fills up with backslashes.
    expect(cleanArg('100%')).toBe('100%')
  })

  it('a bare wildcard does not return the first player as a confident match', async () => {
    for (const probe of ['%', '_', '%%', 'a%', '%_%']) {
      const r: any = await runAskTool(deps(me), 'player_record', { username: probe })
      // 'aaafirst' sorts first, so an unescaped pattern returned exactly it.
      if (r.found) {
        expect(
          String(r.username ?? '').toLowerCase(),
          `probe ${probe} returned a player it should not have`,
        ).not.toBe('aaafirst')
      }
    }
  })

  it('still finds a real player by exact and prefix name', async () => {
    // The escaping must not break the forgiving lookup it protects - a fix that
    // makes every name a miss would trade one wrong answer for no answers.
    const exact: any = await runAskTool(deps(me), 'player_record', { username: 'zzzlast' })
    expect(exact.found).toBe(true)
    expect(String(exact.username).toLowerCase()).toBe('zzzlast')

    const prefix: any = await runAskTool(deps(me), 'player_record', { username: 'zzz' })
    expect(prefix.found).toBe(true)
    expect(String(prefix.username).toLowerCase()).toBe('zzzlast')

    const at: any = await runAskTool(deps(me), 'player_record', { username: '@zzzlast' })
    expect(at.found).toBe(true)
  })
})
