/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// webPush — the server side of the phone buzz.
//
// One module owns everything between "something happened" and "a notification
// appeared on a phone": the VAPID configuration, the subscription rows, the
// send itself, and the reaping of subscriptions the push service has declared
// dead.
//
// INERT WITHOUT KEYS. With VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY unset — which
// is the state of production until the operator sets them — `pushConfigured()`
// is false and every entry point here returns immediately WITHOUT touching the
// database and WITHOUT importing web-push. The client asks /api/fn/push-config
// first and hides the control, so nothing subscribes either. The feature does
// not half-exist: it is either fully on or completely absent.
//
// NEVER THROWS. Every export is wrapped. A chat message must not fail to send
// because a push service had a bad minute, so callers get a result object and
// nothing else. This is the "degrade, never crash" rule applied to a network
// dependency we do not control.
//
// DEAD SUBSCRIPTIONS ARE DELETED. A push service answers 404 or 410 for an
// endpoint that no longer exists (app uninstalled, browser data cleared, site
// permissions revoked). Those rows are removed the moment we learn about them.
// Without that, the table only ever grows, and every subsequent send to that
// user pays for a request that can never succeed — the send path gets slower
// forever, for the users who message the most.
//
// WEB-PUSH IS IMPORTED LAZILY. `await import('web-push')` happens on the first
// real send, not at module load, so an unconfigured deployment never pays for
// it and a missing/broken package degrades to "no push" instead of a boot
// failure.
// =============================================================================
import type { Pool } from 'pg'

/** The shape one notification takes on the wire. Mirrors public/sw.js. */
export interface PushPayload {
  /** Notification title. Required — an untitled notification is not shippable. */
  title: string
  /** Body line. Truncated by the worker; truncated here too, for the wire. */
  body?: string | null
  /**
   * An APP ROUTE ('/messages', '/tournaments/<id>'), never an absolute URL.
   * public/sw.js re-bases it onto its own scope, so the same payload is correct
   * for the '/' and '/app/' registrations alike.
   */
  url?: string | null
  /**
   * The COLLAPSE KEY. Notifications sharing a tag replace one another instead of
   * stacking, so twenty messages in one conversation stay one line in the shade.
   * Key it to the conversation/room, never to the message.
   */
  tag?: string | null
}

/** VAPID identity for this deployment. */
export interface VapidConfig {
  publicKey: string
  privateKey: string
  /** 'mailto:…' or an https URL — who to contact about this application server. */
  subject: string
}

/** One stored subscription, as the sender needs it. */
export interface StoredSubscription {
  endpoint: string
  p256dh: string
  auth: string
}

/** What a single delivery attempt came back with. */
export type PushDeliveryResult =
  | { ok: true; statusCode?: number }
  | { ok: false; statusCode: number | null; message?: string }

/** The transport. Swappable so tests never touch the network. */
export type PushSender = (
  subscription: StoredSubscription,
  payloadJson: string,
  vapid: VapidConfig,
) => Promise<PushDeliveryResult>

/** Summary of one fan-out. Purely informational; nothing here ever throws. */
export interface PushSendSummary {
  /** False when no VAPID keys are set — nothing was read, nothing was sent. */
  configured: boolean
  /** Subscriptions we tried. */
  attempted: number
  /** Subscriptions the push service accepted. */
  delivered: number
  /** Subscriptions deleted because the push service said they are dead. */
  removed: number
}

const EMPTY_SUMMARY: PushSendSummary = {
  configured: false,
  attempted: 0,
  delivered: 0,
  removed: 0,
}

/** Truncation limits, matched to the worker's so nothing surprises anyone. */
export const PUSH_MAX_TITLE = 120
export const PUSH_MAX_BODY = 300
export const PUSH_MAX_TAG = 120
export const PUSH_MAX_URL = 512

/**
 * How many subscriptions one user's fan-out will attempt.
 *
 * A member with a phone, a tablet and two browsers is normal; a member with
 * forty rows is a bug or an attack, and either way the chat send that triggered
 * this must not wait on forty HTTPS requests.
 */
export const MAX_SUBSCRIPTIONS_PER_USER = 20

/** Endpoint length cap — a push endpoint is a URL, not a payload channel. */
export const MAX_ENDPOINT_LENGTH = 1000
const MAX_KEY_LENGTH = 300
const MAX_USER_AGENT_LENGTH = 400

// ---------------------------------------------------------------------------
//  Configuration
// ---------------------------------------------------------------------------

/**
 * The default `sub` claim when VAPID_SUBJECT is unset.
 *
 * RFC 8292 requires a contactable mailto: or https: value; some push services
 * refuse a JWT without one. This is a valid https subject for this deployment,
 * so a two-variable configuration still works — but the operator should set
 * VAPID_SUBJECT to a real contact address.
 */
export const DEFAULT_VAPID_SUBJECT = 'https://tko.cam'

function envString(env: Record<string, string | undefined>, key: string): string {
  const raw = env[key]
  if (typeof raw !== 'string') return ''
  const value = raw.trim()
  // A bundler/`.bat` can leave the literal word behind when a var is cleared.
  if (!value || value === 'undefined' || value === 'null') return ''
  return value
}

/**
 * The VAPID configuration, or null when this deployment has none.
 *
 * Read on every call rather than cached at import: the worker and the API boot
 * from the same module and an operator setting the keys should not need a
 * rebuild to be believed — only a restart, which is how every other change to
 * this system takes effect.
 */
export function readVapidConfig(
  env: Record<string, string | undefined> = process.env,
): VapidConfig | null {
  const publicKey = envString(env, 'VAPID_PUBLIC_KEY')
  const privateKey = envString(env, 'VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return null
  const subject = envString(env, 'VAPID_SUBJECT') || DEFAULT_VAPID_SUBJECT
  return { publicKey, privateKey, subject }
}

/** True when push can actually be delivered from this process. */
export function pushConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return readVapidConfig(env) !== null
}

/** The key the browser needs to create a subscription, or null when inert. */
export function pushPublicKey(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return readVapidConfig(env)?.publicKey ?? null
}

// ---------------------------------------------------------------------------
//  Recipients
// ---------------------------------------------------------------------------

/** Everything needed to decide who, if anyone, should get buzzed. */
export interface RecipientInput {
  /** Everyone who could plausibly be notified (room members, mentioned users). */
  candidates: readonly (string | null | undefined)[]
  /** Who caused the event. NEVER notified about their own message. */
  senderId: string | null | undefined
  /**
   * Who is currently present in THIS EXACT room, from the presence registry.
   * Notifying these people is the "why did my phone buzz for a message I am
   * looking at" bug, and it is the fastest way to get a member to turn
   * notifications off for good.
   */
  activeUserIds?: readonly (string | null | undefined)[]
}

function normalizeId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

/**
 * The people who should actually receive a push, de-duplicated, in candidate
 * order.
 *
 * Pure on purpose: the two exclusions below are the whole product decision of
 * this slice, and they are testable without a database, a browser or a push
 * service.
 */
export function pushRecipients(input: RecipientInput): string[] {
  const sender = normalizeId(input.senderId)
  const active = new Set((input.activeUserIds ?? []).map(normalizeId).filter(Boolean))
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of input.candidates ?? []) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id) continue
    const key = normalizeId(id)
    if (key === sender) continue
    if (active.has(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(id)
  }
  return out
}

// ---------------------------------------------------------------------------
//  Subscription storage
// ---------------------------------------------------------------------------

/** A subscription as the browser hands it to us. */
export interface IncomingSubscription {
  endpoint: string
  p256dh: string
  auth: string
  userAgent?: string | null
}

function cleanField(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  return trimmed.length > max ? '' : trimmed
}

/**
 * Coerce whatever the client posted into a storable subscription, or null.
 *
 * Accepts both the flat shape and the browser's own
 * `{ endpoint, keys: { p256dh, auth } }` (what `PushSubscription.toJSON()`
 * produces), because the client sends the latter verbatim.
 */
export function parseIncomingSubscription(raw: any): IncomingSubscription | null {
  if (!raw || typeof raw !== 'object') return null
  const keys = raw.keys && typeof raw.keys === 'object' ? raw.keys : {}
  const endpoint = cleanField(raw.endpoint, MAX_ENDPOINT_LENGTH)
  const p256dh = cleanField(raw.p256dh ?? keys.p256dh, MAX_KEY_LENGTH)
  const auth = cleanField(raw.auth ?? keys.auth, MAX_KEY_LENGTH)
  if (!endpoint || !p256dh || !auth) return null
  // Only an https endpoint is a real push endpoint. This also keeps the send
  // path from being pointed at an arbitrary internal URL.
  if (!/^https:\/\//i.test(endpoint)) return null
  const userAgentRaw = typeof raw.userAgent === 'string' ? raw.userAgent.trim() : ''
  const userAgent = userAgentRaw ? userAgentRaw.slice(0, MAX_USER_AGENT_LENGTH) : null
  return { endpoint, p256dh, auth, userAgent }
}

/**
 * Store (or re-bind) one subscription.
 *
 * DELETE-THEN-INSERT rather than an upsert: the endpoint is the identity, and a
 * browser that re-subscribes may hand the SAME endpoint to a DIFFERENT signed-in
 * member (a shared phone) or hand a NEW endpoint to the same member (the push
 * service rotated it). Both are one row afterwards, never two.
 *
 * Returns false when the write could not be made — the caller reports that
 * honestly rather than telling the member notifications are on when they are not.
 */
export async function saveSubscription(
  pool: Pool,
  userId: string,
  subscription: IncomingSubscription,
): Promise<boolean> {
  // NAMING AN ENDPOINT IS NOT PROOF YOU OWN IT.
  // The delete below is keyed on endpoint alone, so posting somebody else's
  // endpoint silently re-bound their device to the caller: the victim's next DM
  // produced ZERO pushes and they had no way to notice. An endpoint is not a
  // secret -- it travels in logs, proxies and error reports.
  //
  // The KEYS are the proof. PushManager hands the same browser the same
  // p256dh/auth for the life of a subscription, so a genuine re-bind (the same
  // phone signing into a second account) presents matching keys, while someone
  // who merely learned the endpoint string cannot. A cross-user claim with the
  // wrong keys is refused; an unclaimed endpoint, or the caller's own, proceeds
  // exactly as before.
  const owner = await pool.query(
    'select user_id, p256dh, auth from push_subscriptions where endpoint = $1 limit 1',
    [subscription.endpoint],
  ).catch(() => ({ rows: [] as any[] }))
  const held = (owner.rows ?? [])[0]
  if (held && String(held.user_id) !== String(userId)) {
    const proven = String(held.p256dh ?? '') === String(subscription.p256dh ?? '')
      && String(held.auth ?? '') === String(subscription.auth ?? '')
    if (!proven) return false
  }
  const attempt = async (): Promise<void> => {
    await pool.query('delete from push_subscriptions where endpoint = $1', [subscription.endpoint])
    await pool.query(
      `insert into push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, last_seen_at)
       values ($1, $2, $3, $4, $5, now())`,
      [
        userId,
        subscription.endpoint,
        subscription.p256dh,
        subscription.auth,
        subscription.userAgent ?? null,
      ],
    )
  }
  try {
    await attempt()
    return true
  } catch {
    // A concurrent subscribe of the same endpoint can lose the race on the
    // unique key. One retry settles it; a second failure is a real problem.
    try {
      await attempt()
      return true
    } catch (error: any) {
      console.error(`[push] could not store subscription — ${error?.message || error}`)
      return false
    }
  }
}

/**
 * Forget one subscription.
 *
 * Scoped to the caller so one member cannot silence another's phone by posting
 * their endpoint. Returns how many rows went away (0 is a perfectly normal
 * "already gone", not an error).
 */
export async function deleteSubscription(
  pool: Pool,
  userId: string,
  endpoint: string,
): Promise<number> {
  const clean = cleanField(endpoint, MAX_ENDPOINT_LENGTH)
  if (!clean) return 0
  try {
    const result = await pool.query(
      'delete from push_subscriptions where user_id = $1 and endpoint = $2',
      [userId, clean],
    )
    return Number((result as any)?.rowCount ?? 0)
  } catch (error: any) {
    console.error(`[push] could not delete subscription — ${error?.message || error}`)
    return 0
  }
}

/** Every live subscription for one member, newest first, capped. */
export async function listSubscriptions(
  pool: Pool,
  userId: string,
): Promise<StoredSubscription[]> {
  try {
    const result = await pool.query(
      `select endpoint, p256dh, auth from push_subscriptions
        where user_id = $1
        order by last_seen_at desc
        limit ${MAX_SUBSCRIPTIONS_PER_USER}`,
      [userId],
    )
    return (result.rows ?? [])
      .map((row: any) => ({
        endpoint: String(row.endpoint ?? ''),
        p256dh: String(row.p256dh ?? ''),
        auth: String(row.auth ?? ''),
      }))
      .filter((row) => row.endpoint && row.p256dh && row.auth)
  } catch {
    // No table on this deployment (the DDL was refused, or this is a slim test
    // database): nobody is subscribed, which is a perfectly valid answer.
    return []
  }
}

/** True when the member has at least one live subscription. */
export async function hasSubscription(pool: Pool, userId: string): Promise<boolean> {
  return (await listSubscriptions(pool, userId)).length > 0
}

// ---------------------------------------------------------------------------
//  Delivery
// ---------------------------------------------------------------------------

/**
 * Status codes that mean "this endpoint is gone, stop trying".
 *
 * 404 — the push service never heard of it. 410 Gone — it existed and has been
 * revoked (permission withdrawn, app uninstalled, browser storage cleared).
 * Anything else (429, 5xx, a timeout) is transient and the row is KEPT.
 */
export const DEAD_SUBSCRIPTION_STATUSES: readonly number[] = [404, 410]

export function isDeadSubscription(statusCode: number | null | undefined): boolean {
  return typeof statusCode === 'number' && DEAD_SUBSCRIPTION_STATUSES.includes(statusCode)
}

/** Trim a payload to what the worker will actually render. */
export function serializePayload(payload: PushPayload): string {
  const clip = (value: unknown, max: number): string =>
    typeof value === 'string' ? value.trim().slice(0, max) : ''
  const body: Record<string, string> = { title: clip(payload.title, PUSH_MAX_TITLE) || 'TKO.cam' }
  const text = clip(payload.body, PUSH_MAX_BODY)
  if (text) body.body = text
  const url = clip(payload.url, PUSH_MAX_URL)
  if (url) body.url = url
  const tag = clip(payload.tag, PUSH_MAX_TAG)
  if (tag) body.tag = tag
  return JSON.stringify(body)
}

let senderOverride: PushSender | null = null
let webPushModule: any = null

/**
 * Replace the transport. Tests call this with a recording fake; pass null to
 * restore the real one. Nothing else should ever call it.
 */
export function setPushSender(sender: PushSender | null): void {
  senderOverride = sender
}

/**
 * The real transport, over `web-push`.
 *
 * Imported on first use so an unconfigured deployment never loads it, and a
 * missing or broken package degrades to "delivery failed" instead of taking the
 * process down at boot.
 */
const defaultSender: PushSender = async (subscription, payloadJson, vapid) => {
  try {
    if (!webPushModule) {
      const imported: any = await import('web-push')
      webPushModule = imported?.default ?? imported
    }
    webPushModule.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey)
    await webPushModule.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      },
      payloadJson,
      { TTL: 60 * 60 * 24 },
    )
    return { ok: true }
  } catch (error: any) {
    const statusCode = Number.isFinite(Number(error?.statusCode))
      ? Number(error.statusCode)
      : null
    return { ok: false, statusCode, message: String(error?.message ?? error) }
  }
}

/** Options every send accepts. Only tests pass them. */
export interface SendOptions {
  env?: Record<string, string | undefined>
  sender?: PushSender
}

function resolveSender(options?: SendOptions): PushSender {
  return options?.sender ?? senderOverride ?? defaultSender
}

/**
 * Send one payload to every device one member has registered.
 *
 * Returns a summary and NEVER throws — the caller is always a user-facing write
 * (a chat send) whose success must not depend on a push service.
 */
export async function sendPushToUser(
  pool: Pool,
  userId: string,
  payload: PushPayload,
  options?: SendOptions,
): Promise<PushSendSummary> {
  const vapid = readVapidConfig(options?.env ?? process.env)
  // INERT: no keys means no database read either. This is the production path
  // until the operator sets the two env vars.
  if (!vapid) return { ...EMPTY_SUMMARY }
  const id = typeof userId === 'string' ? userId.trim() : ''
  if (!id) return { ...EMPTY_SUMMARY, configured: true }

  const subscriptions = await listSubscriptions(pool, id)
  if (subscriptions.length === 0) return { ...EMPTY_SUMMARY, configured: true }

  const payloadJson = serializePayload(payload)
  const send = resolveSender(options)

  // In parallel: one member's four devices should cost one round trip of
  // latency to the chat send that triggered this, not four.
  const results = await Promise.all(
    subscriptions.map(async (subscription) => {
      try {
        return { subscription, result: await send(subscription, payloadJson, vapid) }
      } catch (error: any) {
        // A sender that throws instead of resolving is still just a failure.
        return {
          subscription,
          result: { ok: false as const, statusCode: null, message: String(error?.message ?? error) },
        }
      }
    }),
  )

  let delivered = 0
  let removed = 0
  const dead: string[] = []
  const alive: string[] = []
  for (const { subscription, result } of results) {
    if (result.ok) {
      delivered += 1
      alive.push(subscription.endpoint)
      continue
    }
    if (isDeadSubscription(result.statusCode)) dead.push(subscription.endpoint)
  }

  // REAP. Left alone, the table fills with corpses and every future send to
  // this member pays for a request that can never succeed.
  for (const endpoint of dead) {
    try {
      const result = await pool.query('delete from push_subscriptions where endpoint = $1', [
        endpoint,
      ])
      removed += Number((result as any)?.rowCount ?? 0)
    } catch (error: any) {
      console.error(`[push] could not reap dead subscription — ${error?.message || error}`)
    }
  }

  // Best-effort freshness stamp; it only orders the list and caps it.
  for (const endpoint of alive) {
    try {
      await pool.query('update push_subscriptions set last_seen_at = now() where endpoint = $1', [
        endpoint,
      ])
    } catch {
      /* ordering is cosmetic — never worth a log line, let alone a throw */
    }
  }

  return { configured: true, attempted: subscriptions.length, delivered, removed }
}

/**
 * Fan one payload out to several members.
 *
 * Sequential per member on purpose: a mention that names eight people is eight
 * small fan-outs, and doing them at once would let one chat message open eighty
 * sockets. Never throws.
 */
export async function sendPushToUsers(
  pool: Pool,
  userIds: readonly string[],
  payload: PushPayload,
  options?: SendOptions,
): Promise<PushSendSummary> {
  const total: PushSendSummary = { ...EMPTY_SUMMARY }
  if (!pushConfigured(options?.env ?? process.env)) return total
  total.configured = true
  for (const userId of userIds) {
    try {
      const one = await sendPushToUser(pool, userId, payload, options)
      total.attempted += one.attempted
      total.delivered += one.delivered
      total.removed += one.removed
    } catch (error: any) {
      // sendPushToUser already swallows everything; this is belt and braces so
      // one bad recipient can never cost the rest their notification.
      console.error(`[push] fan-out failed for one recipient — ${error?.message || error}`)
    }
  }
  return total
}
