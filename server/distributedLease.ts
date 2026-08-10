/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto'

export type LeaseQueryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

const workerId = `${process.env.K_REVISION || process.env.HOSTNAME || 'local'}:${process.pid}:${randomUUID()}`

/**
 * Run a background job on at most one Cloud Run instance at a time.
 *
 * The lease expires if an instance dies mid-job, while the owner-qualified
 * delete prevents an expired worker from releasing a newer worker's lease.
 */
export async function withDistributedLease<T>(
  db: LeaseQueryable,
  name: string,
  ttlSeconds: number,
  work: () => Promise<T>,
): Promise<{ acquired: boolean; value?: T }> {
  const ttl = Math.max(30, Math.min(3600, Math.round(ttlSeconds)))
  const claimed = await db.query(
    `insert into worker_leases (lease_name, owner_id, lease_until, updated_at)
     values ($1,$2,now() + make_interval(secs => $3::double precision),now())
     on conflict (lease_name) do update set
       owner_id=excluded.owner_id,
       lease_until=excluded.lease_until,
       updated_at=now()
     where worker_leases.lease_until <= now()
     returning owner_id`,
    [name, workerId, ttl],
  )
  if (!claimed.rows.length) return { acquired: false }

  try {
    return { acquired: true, value: await work() }
  } finally {
    try {
      await db.query(
        `delete from worker_leases where lease_name=$1 and owner_id=$2`,
        [name, workerId],
      )
    } catch (error) {
      // The TTL is the recovery path if cleanup fails.
      console.warn(`[lease] release failed for ${name}:`, (error as Error).message)
    }
  }
}
