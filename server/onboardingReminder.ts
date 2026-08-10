import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import {
  pushConfigured,
  sendPushToUsers,
  type PushPayload,
  type PushSendSummary,
} from './webPush'

/**
 * One stable campaign identity makes retries safe. The row-level NOT EXISTS
 * predicate below is deliberately scoped to this kind + related id so it does
 * not interfere with any other notification a member may already have.
 */
export const ONBOARDING_REMINDER_CAMPAIGN = {
  id: '00000000-0000-4000-8000-000020260810',
  kind: 'onboarding_ask_tko_chat_v1_2026_08_10',
  title: 'Finish your account setup',
  body: 'Tell the setup assistant your gamer tag, clan role, and YouTube gameplay link. Review each change before it updates your profile, clan, and roster.',
  link: '/setup',
  tag: 'onboarding:ask-tko:chat-v1:2026-08-10',
} as const

type PoolLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>
}

export interface OnboardingReminderResult {
  dry_run: boolean
  campaign_id: string
  kind: string
  accounts_total: number
  already_notified: number
  notifications_pending: number
  notifications_created: number
  push_users_eligible: number
  push: PushSendSummary
}

const ELIGIBILITY_QUERY_BATCH = 500
const INSERT_QUERY_BATCH = 100
const PUSH_CONCURRENCY = 4

const emptyPushSummary = (): PushSendSummary => ({
  configured: pushConfigured(),
  attempted: 0,
  delivered: 0,
  removed: 0,
})

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = []
  for (let offset = 0; offset < values.length; offset += size) {
    output.push(values.slice(offset, offset + size))
  }
  return output
}

async function campaignTargets(pool: PoolLike): Promise<{
  accountsTotal: number
  pendingIds: string[]
}> {
  // Two indexed/plain reads instead of a correlated subquery. Besides being
  // portable to the in-memory Postgres used by the test suite, this keeps the
  // dry-run path easy to audit: every profile minus this campaign's receipts.
  const [profiles, notified] = await Promise.all([
    pool.query('select id from profiles order by id'),
    pool.query(
      `select user_id
         from notifications
        where kind = $1 and related_id = $2`,
      [ONBOARDING_REMINDER_CAMPAIGN.kind, ONBOARDING_REMINDER_CAMPAIGN.id],
    ),
  ])
  const already = new Set(notified.rows.map((row) => String(row.user_id)))
  const allIds = profiles.rows.map((row) => String(row.id))
  return {
    accountsTotal: allIds.length,
    pendingIds: allIds.filter((id) => !already.has(id)),
  }
}

async function insertCampaignNotifications(
  pool: PoolLike,
  candidateIds: readonly string[],
): Promise<string[]> {
  const insertedIds: string[] = []
  for (const batch of chunks(candidateIds, INSERT_QUERY_BATCH)) {
    // Each SELECT has its own parameter-only NOT EXISTS guard. That preserves
    // idempotence when another invocation inserts between target discovery and
    // this write, without relying on a new global notifications constraint.
    const params: unknown[] = [
      ONBOARDING_REMINDER_CAMPAIGN.kind,
      ONBOARDING_REMINDER_CAMPAIGN.title,
      ONBOARDING_REMINDER_CAMPAIGN.body,
      ONBOARDING_REMINDER_CAMPAIGN.link,
      ONBOARDING_REMINDER_CAMPAIGN.id,
      ...batch.flatMap((userId) => [campaignNotificationId(userId), userId]),
    ]
    const selects = batch.map((_, index) => {
      const notificationParam = `$${6 + index * 2}`
      const userParam = `$${7 + index * 2}`
      return `select ${notificationParam}::uuid, ${userParam}::uuid, $1, $2, $3, $4, $5::uuid
               where not exists (
                 select 1 from notifications
                  where user_id = ${userParam}::uuid
                    and kind = $1
                    and related_id = $5::uuid
               )`
    })
    const inserted = await pool.query(
      `insert into notifications (id, user_id, kind, title, body, link, related_id)
       ${selects.join('\nunion all\n')}
       on conflict (id) do nothing
       returning user_id`,
      params,
    )
    insertedIds.push(...inserted.rows.map((row) => String(row.user_id)))
  }
  return insertedIds
}

/**
 * A stable per-user primary key closes the concurrent retry race without a
 * schema migration. NOT EXISTS keeps ordinary retries cheap; ON CONFLICT on
 * this deterministic id is the final fence when two service instances start
 * the same campaign at exactly the same time.
 */
function campaignNotificationId(userId: string): string {
  const bytes = createHash('sha256')
    .update(`${ONBOARDING_REMINDER_CAMPAIGN.id}:${userId}`, 'utf8')
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function subscribedUsers(pool: PoolLike, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const subscribed = new Set<string>()
  for (const batch of chunks(userIds, ELIGIBILITY_QUERY_BATCH)) {
    const result = await pool.query(
      `select distinct user_id
         from push_subscriptions
        where user_id::text in (${batch.map((_, index) => `$${index + 1}`).join(', ')})`,
      batch,
    )
    for (const row of result.rows) {
      const id = String(row?.user_id || '').trim()
      if (id) subscribed.add(id)
    }
  }
  return [...subscribed]
}

function addPushSummary(total: PushSendSummary, one: PushSendSummary): void {
  total.configured = total.configured || one.configured
  total.attempted += one.attempted
  total.delivered += one.delivered
  total.removed += one.removed
}

/**
 * Fan out with a small, fixed concurrency cap. sendPushToUsers remains
 * sequential inside each lane, so a large campaign cannot open an unbounded
 * number of push-service connections.
 */
async function sendBoundedPush(
  pool: PoolLike,
  userIds: readonly string[],
  payload: PushPayload,
): Promise<PushSendSummary> {
  const total = emptyPushSummary()
  if (!total.configured || userIds.length === 0) return total

  const laneCount = Math.min(PUSH_CONCURRENCY, userIds.length)
  const lanes: string[][] = Array.from({ length: laneCount }, () => [])
  userIds.forEach((userId, index) => lanes[index % laneCount].push(userId))
  const summaries = await Promise.all(
    lanes.map((lane) => sendPushToUsers(pool as Pool, lane, payload)),
  )
  for (const summary of summaries) addPushSummary(total, summary)
  return total
}

/**
 * Create the one-time onboarding reminder for every profile. Dry runs perform
 * the same target and subscription reads but never insert or call Web Push.
 */
export async function runOnboardingReminder(
  pool: PoolLike,
  dryRun: boolean,
): Promise<OnboardingReminderResult> {
  const { accountsTotal, pendingIds } = await campaignTargets(pool)
  const recipientIds = dryRun
    ? pendingIds
    : await insertCampaignNotifications(pool, pendingIds)

  // This indexed read touches only the members newly targeted by this run.
  // Users with no stored device subscription never enter the push fan-out.
  const pushUserIds = await subscribedUsers(pool, recipientIds)
  const push = dryRun
    ? emptyPushSummary()
    : await sendBoundedPush(pool, pushUserIds, {
        title: ONBOARDING_REMINDER_CAMPAIGN.title,
        body: ONBOARDING_REMINDER_CAMPAIGN.body,
        url: ONBOARDING_REMINDER_CAMPAIGN.link,
        tag: ONBOARDING_REMINDER_CAMPAIGN.tag,
      })

  return {
    dry_run: dryRun,
    campaign_id: ONBOARDING_REMINDER_CAMPAIGN.id,
    kind: ONBOARDING_REMINDER_CAMPAIGN.kind,
    accounts_total: accountsTotal,
    already_notified: Math.max(0, accountsTotal - recipientIds.length),
    notifications_pending: dryRun ? recipientIds.length : 0,
    notifications_created: dryRun ? 0 : recipientIds.length,
    push_users_eligible: pushUserIds.length,
    push,
  }
}
