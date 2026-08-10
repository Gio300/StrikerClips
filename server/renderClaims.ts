/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CROSS-MACHINE RENDER CLAIMS — the server half of common/tko_claim.py.
 *
 * WHY. Job selection in the Python factory reads posted.json and failed.json,
 * two LOCAL files. That is correct and cheap for exactly one render box. Add a
 * second GPU and it becomes a money leak: both machines see the same
 * never-rendered videos, both burn ~10 minutes of GPU on the same clip, and
 * both POST it. The operator pays twice, the viewer sees a duplicate, and
 * YouTube sees a channel uploading near-identical videos back to back — which
 * is exactly the behaviour their repetitive-content policy is written for.
 *
 * So "who is rendering this video" has to live somewhere both machines can see,
 * and this is that. The shape is lifted from distributedLease.ts rather than
 * invented: a row with a TTL and an owner-qualified release, so a worker that
 * dies mid-render frees its claim while a stale worker can never release a
 * newer worker's.
 *
 * THE ONE ASYMMETRY, and it is deliberate — read before changing it.
 *
 *   release(done=false)  OWNER-QUALIFIED. A failed attempt only frees a claim
 *                        we still hold. A stale worker must not stomp the claim
 *                        of the machine that took over from it.
 *   release(done=true)   UNCONDITIONAL. The video was produced AND POSTED.
 *                        Recording that can only ever PREVENT work; failing to
 *                        record it risks a second machine re-rendering and
 *                        re-posting something already public, which cannot be
 *                        un-posted. So completion is written even if our claim
 *                        expired and someone else now owns the row.
 *
 * Expiry timestamps are computed in JS and passed as parameters rather than
 * built with make_interval() in SQL: the in-memory Postgres the tests run
 * against cannot parse make_interval, and an atomic claim that cannot be tested
 * is not one worth shipping. Comparisons still use the database's own now(), so
 * two machines are always judged against one clock.
 */

export type ClaimQueryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

/** Idempotent DDL, run from bootstrapTables() on boot like every other table. */
export const RENDER_CLAIM_DDL = [
  `create table if not exists public.render_claims (
     job_key text primary key,
     owner_id text not null,
     claimed_until timestamptz not null,
     done boolean not null default false,
     done_at timestamptz,
     updated_at timestamptz not null default now())`,
  `create index if not exists render_claims_expiry_idx on public.render_claims(claimed_until)`,
]

/** Matches tko_claim.py's own clamp, so neither side can widen it alone. */
export const MIN_TTL = 60
export const MAX_TTL = 7200

export function clampTtl(raw: unknown): number {
  // A MISSING OR JUNK TTL FALLS BACK TO THE MAXIMUM, NOT THE MINIMUM. The two
  // failure directions are not symmetric: too long and a dead worker blocks one
  // job until the TTL runs out, which self-heals; too short and a live worker's
  // claim expires mid-render, the other box picks the same video up, and the
  // result is the duplicate GPU spend and duplicate public post this whole
  // module exists to prevent. Note Number(null) === 0, so `null` has to be
  // rejected explicitly or it clamps to the 60-second floor.
  if (raw === null || raw === undefined || raw === '') return MAX_TTL
  const n = Number(raw)
  if (!Number.isFinite(n)) return MAX_TTL
  return Math.max(MIN_TTL, Math.min(MAX_TTL, Math.round(n)))
}

/** A job key / owner id the client actually sent. Empty is a bad request, not
 *  a claim on the empty string — which would be a global mutex over every job. */
export function cleanKey(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, 400)
}

export type ClaimResult = { ok: true; claimed: boolean; reason: string }

/**
 * Take (or extend) exclusive ownership of one render job.
 *
 * `renew` never steals: it extends a claim we still hold and nothing else. A
 * renew that could take over an expired row would let a machine that had
 * already lost the job quietly take it back mid-render on the other box.
 */
export async function claimRender(
  db: ClaimQueryable,
  jobKeyRaw: unknown,
  ownerIdRaw: unknown,
  ttlRaw: unknown,
  renew = false,
): Promise<ClaimResult> {
  const jobKey = cleanKey(jobKeyRaw)
  const ownerId = cleanKey(ownerIdRaw)
  if (!jobKey || !ownerId) return { ok: true, claimed: false, reason: 'jobKey and ownerId are required' }
  const until = new Date(Date.now() + clampTtl(ttlRaw) * 1000)

  if (renew) {
    const r = await db.query(
      `update render_claims set claimed_until=$3, updated_at=now()
       where job_key=$1 and owner_id=$2 and done=false
       returning owner_id`,
      [jobKey, ownerId, until],
    )
    return r.rows.length
      ? { ok: true, claimed: true, reason: 'renewed' }
      : { ok: true, claimed: false, reason: 'not the owner, or already finished' }
  }

  // THREE STATEMENTS, AND THE LAST ONE IS THE ANSWER.
  //
  // The obvious form is one conditional upsert
  // (`on conflict do update ... where ... returning`). It is correct Postgres,
  // and it is NOT what ships here, because the in-memory Postgres the tests run
  // against returns a row from that statement while changing nothing — it
  // reports a claim it did not grant. A concurrency guard whose happy path
  // cannot be tested is a guard nobody should trust, so the claim is expressed
  // in statements both engines model the same way.
  //
  // 1. TAKE OVER OR RE-ASSERT. A plain conditional UPDATE. In Postgres this
  //    takes a row lock and, under READ COMMITTED, re-checks its WHERE against
  //    the row the other machine just committed — so of two boxes racing for an
  //    expired claim, the loser sees a fresh claimed_until and matches nothing.
  const upd = await db.query(
    `update render_claims set owner_id=$2, claimed_until=$3, updated_at=now()
      where job_key=$1
        and done = false
        and (claimed_until <= now() or owner_id = $2)
     returning owner_id`,
    [jobKey, ownerId, until],
  )
  if (upd.rows.length) return { ok: true, claimed: true, reason: 'claimed' }

  // 2. FIRST SIGHTING. No row to update; create one. The primary key is what
  //    settles a tie here — exactly one INSERT can win.
  await db.query(
    `insert into render_claims (job_key, owner_id, claimed_until, updated_at)
     values ($1,$2,$3,now())
     on conflict (job_key) do nothing`,
    [jobKey, ownerId, until],
  )

  // 3. ASK THE TABLE, don't trust a rowcount. Whoever the row says owns it,
  //    owns it — which is true no matter which of the statements above actually
  //    took effect, and is the reading both engines agree on.
  const held = await db.query(
    `select owner_id, done from render_claims where job_key=$1`,
    [jobKey],
  )
  const row = held.rows[0]
  if (!row) return { ok: true, claimed: false, reason: 'claim row vanished' }
  if (row.done) return { ok: true, claimed: false, reason: 'already rendered and posted' }
  if (String(row.owner_id) === ownerId) return { ok: true, claimed: true, reason: 'claimed' }
  return { ok: true, claimed: false, reason: `held by ${row.owner_id}` }
}

export type ReleaseResult = { ok: true; released: boolean; reason: string }

/**
 * Give a claim up.
 *
 * done=true  -> produced and posted; recorded permanently so no machine
 *               re-renders it, including one whose local posted.json has never
 *               heard of this video.
 * done=false -> this attempt failed; freed at once rather than waiting out the
 *               TTL, so the other machine can try it on its next pass.
 */
export async function releaseRender(
  db: ClaimQueryable,
  jobKeyRaw: unknown,
  ownerIdRaw: unknown,
  done: boolean,
): Promise<ReleaseResult> {
  const jobKey = cleanKey(jobKeyRaw)
  const ownerId = cleanKey(ownerIdRaw)
  if (!jobKey || !ownerId) return { ok: true, released: false, reason: 'jobKey and ownerId are required' }

  if (done) {
    // Deliberately NOT owner-qualified — see the header. Marking a posted video
    // complete can only prevent work; losing that fact can duplicate a public
    // upload.
    await db.query(
      `insert into render_claims (job_key, owner_id, claimed_until, done, done_at, updated_at)
       values ($1,$2,now(),true,now(),now())
       on conflict (job_key) do update set
         done=true, done_at=now(), updated_at=now()`,
      [jobKey, ownerId],
    )
    return { ok: true, released: true, reason: 'recorded as done' }
  }

  const r = await db.query(
    `delete from render_claims where job_key=$1 and owner_id=$2 and done=false`,
    [jobKey, ownerId],
  )
  const n = r.rowCount ?? r.rows?.length ?? 0
  return n
    ? { ok: true, released: true, reason: 'freed for another attempt' }
    : { ok: true, released: false, reason: 'not the owner, or already finished' }
}
