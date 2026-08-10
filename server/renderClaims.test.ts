/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RENDER CLAIMS — the second GPU is only worth having if these hold.
 *
 * Job selection in the Python factory reads posted.json and failed.json, two
 * LOCAL files. Two render boxes therefore see the same never-rendered videos,
 * both spend ~10 minutes of GPU on the same clip, and both post it: paid for
 * twice, and the channel uploads a near-duplicate — the exact pattern YouTube's
 * repetitive-content policy targets. These tests hold the properties that make
 * a shared claim safe enough to switch on.
 *
 *   1. TWO MACHINES RACING CANNOT BOTH WIN. The claim is a single atomic
 *      statement, not read-then-write.
 *   2. A DEAD WORKER FREES ITS JOB. The TTL is the recovery path when a box
 *      loses power mid-render.
 *   3. A STALE WORKER CANNOT RELEASE A NEWER ONE'S CLAIM. Release is
 *      owner-qualified... except for done=true, which is deliberately
 *      unconditional, because a POSTED video must never be re-rendered and
 *      losing that fact is the one unrecoverable failure here.
 *   4. A FINISHED JOB IS FINISHED FOREVER, including for a machine whose local
 *      posted.json has never heard of it — the whole reason this is server-side.
 */
import { beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './testHarness'
import {
  RENDER_CLAIM_DDL, claimRender, releaseRender, clampTtl, cleanKey,
  MIN_TTL, MAX_TTL,
} from './renderClaims'

describe('render claims', () => {
  const pool = makeDb() as any
  const BOX_A = 'sensai:1234'
  const BOX_B = 'gpu2:5678'

  beforeAll(async () => {
    for (const ddl of RENDER_CLAIM_DDL) await pool.query(ddl)
  })

  const key = (() => { let n = 0; return () => `hammy|https://youtu.be/v${n++}` })()

  // ── 1. mutual exclusion ──────────────────────────────────────────────────
  it('gives one job to exactly one machine', async () => {
    const k = key()
    const a = await claimRender(pool, k, BOX_A, 3600)
    const b = await claimRender(pool, k, BOX_B, 3600)
    expect(a.claimed).toBe(true)
    expect(b.claimed).toBe(false)
    expect(b.reason).toContain(BOX_A)
  })

  it('never lets both machines win a simultaneous race', async () => {
    // Ten fresh jobs, both boxes going for each at once. Exactly one winner
    // each time or the second GPU costs money instead of making it.
    for (let i = 0; i < 10; i++) {
      const k = key()
      const [a, b] = await Promise.all([
        claimRender(pool, k, BOX_A, 3600),
        claimRender(pool, k, BOX_B, 3600),
      ])
      expect([a.claimed, b.claimed].filter(Boolean).length, `race ${i}`).toBe(1)
    }
  })

  it('lets the owner re-assert its own claim without waiting out the TTL', async () => {
    const k = key()
    await claimRender(pool, k, BOX_A, 3600)
    expect((await claimRender(pool, k, BOX_A, 3600)).claimed).toBe(true)
  })

  // ── 2. a dead worker frees its job ───────────────────────────────────────
  it('hands an expired claim to the other machine', async () => {
    const k = key()
    // A box that took the job and lost power: TTL floor is 60s, so age it out
    // by hand rather than sleeping.
    await claimRender(pool, k, BOX_A, 60)
    await pool.query(
      `update render_claims set claimed_until = now() - interval '1 second' where job_key=$1`,
      [k],
    ).catch(async () => {
      await pool.query(`update render_claims set claimed_until=$2 where job_key=$1`,
        [k, new Date(Date.now() - 1000)])
    })
    expect((await claimRender(pool, k, BOX_B, 3600)).claimed).toBe(true)
  })

  it('renew extends a live claim', async () => {
    const k = key()
    await claimRender(pool, k, BOX_A, 60)
    expect((await claimRender(pool, k, BOX_A, 3600, true)).claimed).toBe(true)
    // and box B still cannot have it
    expect((await claimRender(pool, k, BOX_B, 3600)).claimed).toBe(false)
  })

  it('renew never STEALS — only the owner may extend', async () => {
    const k = key()
    await claimRender(pool, k, BOX_A, 3600)
    const stolen = await claimRender(pool, k, BOX_B, 3600, true)
    expect(stolen.claimed).toBe(false)
    // A renew that could take over an expired row would let a machine that had
    // already lost the job quietly take it back mid-render on the other box.
    await pool.query(`update render_claims set claimed_until=$2 where job_key=$1`,
      [k, new Date(Date.now() - 1000)])
    expect((await claimRender(pool, k, BOX_B, 3600, true)).claimed).toBe(false)
  })

  // ── 3. release ───────────────────────────────────────────────────────────
  it('frees a failed attempt immediately for the other machine', async () => {
    const k = key()
    await claimRender(pool, k, BOX_A, 3600)
    expect((await releaseRender(pool, k, BOX_A, false)).released).toBe(true)
    expect((await claimRender(pool, k, BOX_B, 3600)).claimed).toBe(true)
  })

  it('a stale worker cannot release a newer worker’s claim', async () => {
    const k = key()
    await claimRender(pool, k, BOX_A, 3600)
    const notMine = await releaseRender(pool, k, BOX_B, false)
    expect(notMine.released).toBe(false)
    // A still holds it.
    expect((await claimRender(pool, k, BOX_B, 3600)).claimed).toBe(false)
  })

  // ── 4. done is forever ───────────────────────────────────────────────────
  it('a posted video is never claimable again, by anyone', async () => {
    const k = key()
    await claimRender(pool, k, BOX_A, 3600)
    await releaseRender(pool, k, BOX_A, true)
    expect((await claimRender(pool, k, BOX_A, 3600)).claimed).toBe(false)
    const b = await claimRender(pool, k, BOX_B, 3600)
    expect(b.claimed).toBe(false)
    expect(b.reason).toContain('posted')
  })

  it('records completion even when our claim already expired', async () => {
    // The asymmetry, stated as a test: box A renders slowly, its claim lapses,
    // box B takes over — then A finishes and POSTS. Marking done can only
    // prevent work; failing to mark it risks a duplicate public upload.
    const k = key()
    await claimRender(pool, k, BOX_A, 3600)
    await pool.query(`update render_claims set claimed_until=$2 where job_key=$1`,
      [k, new Date(Date.now() - 1000)])
    await claimRender(pool, k, BOX_B, 3600)
    expect((await releaseRender(pool, k, BOX_A, true)).released).toBe(true)
    expect((await claimRender(pool, k, BOX_B, 3600)).claimed).toBe(false)
  })

  it('done survives a machine that never saw the job before', async () => {
    const k = key()
    await releaseRender(pool, k, BOX_A, true)   // no prior claim at all
    expect((await claimRender(pool, k, BOX_B, 3600)).claimed).toBe(false)
  })

  it('a finished job cannot be freed back into the queue', async () => {
    const k = key()
    await claimRender(pool, k, BOX_A, 3600)
    await releaseRender(pool, k, BOX_A, true)
    expect((await releaseRender(pool, k, BOX_A, false)).released).toBe(false)
    expect((await claimRender(pool, k, BOX_A, 3600)).claimed).toBe(false)
  })

  // ── input hygiene ────────────────────────────────────────────────────────
  it('refuses an empty job key instead of taking a global mutex', async () => {
    // A claim on "" would be one lock over EVERY job on both machines.
    for (const bad of ['', '   ', null, undefined]) {
      expect((await claimRender(pool, bad, BOX_A, 3600)).claimed).toBe(false)
      expect((await claimRender(pool, key(), bad, 3600)).claimed).toBe(false)
      expect((await releaseRender(pool, bad, BOX_A, true)).released).toBe(false)
    }
  })

  it('clamps the TTL to the same window as the python client', () => {
    expect(clampTtl(30)).toBe(MIN_TTL)
    expect(clampTtl(999999)).toBe(MAX_TTL)
    expect(clampTtl(3600)).toBe(3600)
    // Garbage must not become a zero-second claim, which would free every job
    // instantly and reintroduce the duplicate render.
    for (const junk of [NaN, 'abc', null, undefined, {}]) {
      expect(clampTtl(junk as any)).toBe(MAX_TTL)
    }
  })

  it('trims and bounds keys', () => {
    expect(cleanKey('  a|b  ')).toBe('a|b')
    expect(cleanKey('x'.repeat(900)).length).toBe(400)
    expect(cleanKey(null)).toBe('')
  })
})
