/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Real-backend Supabase stand-in. Talks to the Express API under /api instead of
 * the Supabase JS SDK. Enable with VITE_REAL_BACKEND=1.
 *
 * The base comes from ./apiBase — relative `/api` for the same-origin web build,
 * or the absolute `VITE_API_BASE` origin for the Capacitor APK, which is served
 * from https://localhost and cannot use a relative path. See src/lib/apiBase.ts.
 *
 * It mirrors the EXACT surface + return contracts that mockSupabase.ts exposes
 * (the app depends on them): `.from(table)`, `.auth`, `.storage`, `.channel()`,
 * `.removeChannel()`, `.functions.invoke()`. Realtime is deferred (no-op stub).
 *
 * Server protocol (see task spec):
 *   POST /api/auth/signup {email,password,username?} -> {user,token}
 *   POST /api/auth/login  {email,password}           -> {user,token}
 *   GET  /api/auth/me     (Bearer token)             -> {user}
 *   POST /api/auth/password/forgot|reset             -> recovery flow
 *   POST /api/auth/transfer/start|exchange            -> one-time origin handoff
 *   POST /api/db          {table,action,columns,filters,order,limit,single,count,values} -> {data,count,error}
 *   POST /api/storage/:bucket {path,name,contentType} -> {path}
 *   POST /api/fn/:name    {...body}                   -> {data,error} (or raw)
 *
 * The JWT is stored in localStorage under 'kc_token' and kept in an in-memory
 * session that hydrates from /api/auth/me on load.
 */

import { API_BASE } from './apiBase'
import { currentAuthToken, readAuthToken, writeAuthToken } from './authTokenStorage'

type SupaError = { message: string } | null

function getToken(): string | null {
  return currentAuthToken()
}

/** Low-level fetch wrapper. Returns { data, error, status } and never throws. */
async function apiFetch(
  path: string,
  opts: { method?: string; body?: any; headers?: Record<string, string> } = {},
): Promise<{ data: any; error: SupaError; status: number }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  try {
    const res = await fetch(API_BASE + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    })
    let body: any = null
    const text = await res.text()
    if (text) { try { body = JSON.parse(text) } catch { body = text } }
    if (!res.ok) {
      const raw = (body && (body.error?.message ?? body.error ?? body.message)) || res.statusText || 'Request failed'
      return { data: body, error: { message: typeof raw === 'string' ? raw : 'Request failed' }, status: res.status }
    }
    return { data: body, error: null, status: res.status }
  } catch (e: any) {
    return { data: null, error: { message: e?.message || 'Network error' }, status: 0 }
  }
}

// ---------------------------------------------------------------------------
// Auth / session
// ---------------------------------------------------------------------------

let session: { user: any; access_token: string } | null = null
const listeners: ((event: string, session: any) => void)[] = []
const emit = (event: string) => listeners.forEach((cb) => cb(event, session))

/**
 * Does this /auth/me answer prove the TOKEN is bad?
 *
 * Only the server rejecting the credential does. `apiFetch` never throws — it
 * catches its own network error and resolves with `status: 0` — so without this
 * check every failure looked identical to "signed out", and hydration runs on
 * EVERY cold start. One tunnel, one dead zone, one Cloud Run cold-start 5xx and
 * we deleted the user's `kc_token` from localStorage. There is no password
 * reset in this product (server/app.ts exposes only signup/login/me), so that
 * user's only route back is remembering their password or making a NEW account
 * — which starts at power 0. That is the mechanism behind "I lost my power
 * level"; the account row was never touched.
 *
 * Fail CLOSED on identity: keep the token unless told, by the server, that it
 * is invalid. A stale token costs one more rejected request. A wrongly deleted
 * one costs the account.
 */
function tokenIsRejected(status: number): boolean {
  return status === 401 || status === 403
}

/** Promise that resolves once the initial /auth/me hydration has completed. */
let hydration: Promise<void> = (async () => {
  const token = await readAuthToken()
  if (!token) return
  const { data, error, status } = await apiFetch('/auth/me', { method: 'GET' })
  if (error || !data?.user) {
    session = null
    // Network error, 5xx, 429 -> we simply do not know yet. Keep the token so
    // the next successful call signs them back in.
    if (tokenIsRejected(status)) await writeAuthToken(null)
  } else {
    session = { user: data.user, access_token: token }
    emit('SIGNED_IN')
  }
})()

async function reauthenticate(): Promise<void> {
  const token = await readAuthToken()
  if (!token) { session = null; return }
  const { data, error, status } = await apiFetch('/auth/me', { method: 'GET' })
  if (error || !data?.user) {
    session = null
    if (tokenIsRejected(status)) await writeAuthToken(null)
  }
  else session = { user: data.user, access_token: token }
}

const auth = {
  async getSession() {
    await hydration
    return { data: { session }, error: null }
  },
  async getUser() {
    await hydration
    return { data: { user: session?.user ?? null }, error: null }
  },
  onAuthStateChange(cb: (e: string, s: any) => void) {
    listeners.push(cb)
    return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) } } } }
  },
  async signUp(credentials: any) {
    const { email, password } = credentials ?? {}
    const meta = credentials?.options?.data ?? {}
    const username = meta.username ?? credentials?.username
    // Forward the signup attestations (terms + 13+ age gate) so the SERVER
    // stores them on the account and can re-validate the date of birth itself.
    const { data, error } = await apiFetch('/auth/signup', {
      method: 'POST',
      body: {
        email,
        password,
        username,
        metadata: meta,
        date_of_birth: meta.date_of_birth ?? null,
        terms_accepted: meta.terms_accepted === true,
        terms_version: meta.terms_version ?? '',
        privacy_accepted: meta.privacy_accepted === true,
        privacy_version: meta.privacy_version ?? '',
        youtube_url: meta.youtube_url ?? '',
        notifications_requested: meta.notifications_requested === true,
        age_consent_13_plus: meta.age_consent_13_plus === true,
      },
    })
    if (error) return { data: { user: null, session: null }, error }
    await writeAuthToken(data.token)
    session = { user: data.user, access_token: data.token }
    emit('SIGNED_IN')
    return { data: { user: data.user, session }, error: null }
  },
  async signInWithPassword(credentials: any) {
    const { email, password } = credentials ?? {}
    const { data, error } = await apiFetch('/auth/login', { method: 'POST', body: { email, password } })
    if (error) return { data: { user: null, session: null }, error }
    await writeAuthToken(data.token)
    session = { user: data.user, access_token: data.token }
    emit('SIGNED_IN')
    return { data: { user: data.user, session }, error: null }
  },
  async requestPasswordReset(email: string, origin?: string) {
    const { data, error } = await apiFetch('/auth/password/forgot', {
      method: 'POST',
      body: { email, origin: origin || (typeof window !== 'undefined' ? window.location.origin : '') },
    })
    return { data, error }
  },
  async resetPassword(token: string, password: string) {
    const { data, error } = await apiFetch('/auth/password/reset', {
      method: 'POST', body: { token, password },
    })
    if (error) return { data: { user: null, session: null }, error }
    await writeAuthToken(data.token)
    session = { user: data.user, access_token: data.token }
    emit('SIGNED_IN')
    return { data: { user: data.user, session }, error: null }
  },
  async createTransfer(targetOrigin: string, returnPath = '/') {
    const { data, error } = await apiFetch('/auth/transfer/start', {
      method: 'POST', body: { target_origin: targetOrigin, return_path: returnPath },
    })
    return { data, error }
  },
  async exchangeTransferCode(code: string, targetOrigin: string) {
    const { data, error } = await apiFetch('/auth/transfer/exchange', {
      method: 'POST', body: { code, target_origin: targetOrigin },
    })
    if (error) return { data: { user: null, session: null }, error }
    await writeAuthToken(data.token)
    session = { user: data.user, access_token: data.token }
    emit('SIGNED_IN')
    return { data: { user: data.user, session, return_path: data.return_path }, error: null }
  },
  async signInWithOAuth() {
    // OAuth is not wired into the Express backend yet — surface a clear error.
    return { data: { provider: 'google', url: '' }, error: { message: 'OAuth sign-in is not available on this backend.' } }
  },
  async signOut() {
    await writeAuthToken(null)
    session = null
    emit('SIGNED_OUT')
    return { error: null }
  },
  async refreshSession() {
    await reauthenticate()
    if (session) emit('USER_UPDATED')
    return { data: { session }, error: null }
  },
  async updateUser(attrs: any) {
    // No dedicated server endpoint in the protocol; merge locally + notify.
    // Replace the user object (fresh reference) so React re-renders on the write.
    if (session) {
      session.user = { ...session.user, user_metadata: { ...session.user.user_metadata, ...(attrs?.data ?? {}) } }
      emit('USER_UPDATED')
    }
    return { data: { user: session?.user ?? null }, error: null }
  },
}

// ---------------------------------------------------------------------------
// Query builder (mirrors mockSupabase's Query)
// ---------------------------------------------------------------------------

type Filter = { col: string; op: string; val: any }

/** Strip PostgREST embedded-join syntax ("*, profiles(username)") -> base cols. */
function stripEmbeds(cols?: string): string {
  if (!cols || cols === '*') return cols ?? '*'
  // Remove `identifier(...)` groups (single level of parens covers `poll_options(*)`).
  const out = cols
    .replace(/[a-zA-Z_][a-zA-Z0-9_]*\s*\([^()]*\)/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
  return out || '*'
}

/**
 * What one query resolves to.
 *
 * `status` is the HTTP status the request came back with, and it is NOT
 * cosmetic: this shim never throws (apiFetch catches its own network error and
 * resolves with status 0), so the status is the ONLY thing that distinguishes a
 * failure a caller should retry — 0 offline, 429 rate limited, 5xx, a 400 from
 * a connection-pool timeout — from one it should give up on. Chat's incremental
 * poll classifies on exactly this (src/lib/chatMessages.ts classifyPollFailure);
 * without it, one Wi-Fi hiccup read as "this backend cannot do that" and froze
 * the room for the life of the mount. The hosted supabase-js client returns
 * `status` on every PostgrestResponse too, so this matches, rather than
 * invents, the contract.
 */
type QueryResult = { data: any; count: number | null; error: SupaError; status: number }

class Query implements PromiseLike<QueryResult> {
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private columns = '*'
  private filters: Filter[] = []
  private orderSpec: { column: string; ascending: boolean } | null = null
  private limitN: number | null = null
  private offsetN: number | null = null
  private values: any = null
  private isSingle = false
  private count: 'exact' | 'planned' | 'estimated' | null = null
  private head = false
  constructor(private table: string) {}

  select(cols?: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    this.columns = stripEmbeds(cols)
    if (opts?.count) this.count = opts.count
    if (opts?.head) this.head = true
    return this
  }

  eq(col: string, val: any) { this.filters.push({ col, op: 'eq', val }); return this }
  neq(col: string, val: any) { this.filters.push({ col, op: 'neq', val }); return this }
  gt(col: string, val: any) { this.filters.push({ col, op: 'gt', val }); return this }
  gte(col: string, val: any) { this.filters.push({ col, op: 'gte', val }); return this }
  lt(col: string, val: any) { this.filters.push({ col, op: 'lt', val }); return this }
  lte(col: string, val: any) { this.filters.push({ col, op: 'lte', val }); return this }
  like(col: string, val: any) { this.filters.push({ col, op: 'like', val }); return this }
  ilike(col: string, val: any) { this.filters.push({ col, op: 'ilike', val }); return this }
  is(col: string, val: any) { this.filters.push({ col, op: 'is', val }); return this }
  in(col: string, val: any[]) { this.filters.push({ col, op: 'in', val }); return this }
  contains(col: string, val: any) { this.filters.push({ col, op: 'contains', val }); return this }
  match(obj: Record<string, any>) { for (const k of Object.keys(obj ?? {})) this.filters.push({ col: k, op: 'eq', val: obj[k] }); return this }
  filter(col: string, op: string, val: any) { this.filters.push({ col, op, val }); return this }
  // Operators we can't cleanly map to a single {col,op,val} are no-ops.
  or() { return this }
  not() { return this }
  range(from: number, to: number) {
    const start = Number.isFinite(from) ? Math.max(0, Math.floor(from)) : 0
    const end = Number.isFinite(to) ? Math.max(start, Math.floor(to)) : start
    this.offsetN = start
    this.limitN = end - start + 1
    return this
  }
  overlaps() { return this }
  containedBy() { return this }
  textSearch() { return this }

  order(col: string, o?: { ascending?: boolean }) { this.orderSpec = { column: col, ascending: o?.ascending !== false }; return this }
  limit(n: number) { this.limitN = n; return this }
  insert(rows: any) { this.action = 'insert'; this.values = Array.isArray(rows) ? rows : [rows]; return this }
  update(vals: any) { this.action = 'update'; this.values = vals; return this }
  delete() { this.action = 'delete'; return this }
  upsert(rows: any) { this.action = 'upsert'; this.values = Array.isArray(rows) ? rows : [rows]; return this }

  private body() {
    return {
      table: this.table,
      action: this.action,
      columns: this.columns,
      filters: this.filters,
      order: this.orderSpec,
      limit: this.limitN,
      offset: this.offsetN,
      single: this.isSingle,
      count: this.count,
      head: this.head,
      values: this.values,
    }
  }

  private async run(): Promise<QueryResult> {
    const { data: body, error, status } = await apiFetch('/db', { method: 'POST', body: this.body() })
    // status 0 is apiFetch's "the fetch itself failed" — the network, never the
    // schema. Carrying it through is what lets a caller retry instead of
    // concluding the backend does not support the query.
    if (error) return { data: null, count: null, error, status }
    const data = body && Object.prototype.hasOwnProperty.call(body, 'data') ? body.data : body
    const count = body && body.count != null ? body.count : null
    const innerErr: SupaError = body && body.error ? (typeof body.error === 'string' ? { message: body.error } : body.error) : null
    return { data, count, error: innerErr, status }
  }

  private static pickOne(data: any): any {
    if (Array.isArray(data)) return data[0] ?? null
    return data ?? null
  }

  single() {
    this.isSingle = true
    return this.run().then((r) => ({ data: Query.pickOne(r.data), error: r.error, status: r.status }))
  }
  maybeSingle() {
    this.isSingle = true
    return this.run().then((r) => ({ data: Query.pickOne(r.data), error: r.error, status: r.status }))
  }
  then<R1 = any, R2 = never>(
    res?: ((v: QueryResult) => R1 | PromiseLike<R1>) | null,
    rej?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.run()
      .then((r) => ({ data: this.head ? null : r.data, count: r.count, error: r.error, status: r.status }))
      .then(res, rej)
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const storage = {
  from(bucket: string) {
    return {
      async upload(path: string, file: any, _opts?: any) {
        const name = (file && (file.name as string)) || path
        const contentType = (file && (file.type as string)) || undefined
        const { data, error } = await apiFetch(`/storage/${encodeURIComponent(bucket)}`, {
          method: 'POST',
          body: { path, name, contentType },
        })
        if (error) return { data: null, error }
        return { data: { path: (data && data.path) || path }, error: null }
      },
      getPublicUrl(path: string) {
        const publicUrl = `${API_BASE}/storage/${encodeURIComponent(bucket)}/${path.split('/').map(encodeURIComponent).join('/')}`
        return { data: { publicUrl } }
      },
      async remove(paths?: string[]) {
        const { error } = await apiFetch(`/storage/${encodeURIComponent(bucket)}/remove`, {
          method: 'POST',
          body: { paths: paths ?? [] },
        })
        return { data: [], error }
      },
    }
  },
}

// ---------------------------------------------------------------------------
// Realtime (deferred) + edge functions
// ---------------------------------------------------------------------------

const channelStub: any = { on() { return channelStub }, subscribe() { return channelStub }, unsubscribe() { return channelStub }, send() { return channelStub } }

const functions = {
  async invoke(name: string, opts?: { body?: any }) {
    const { data, error } = await apiFetch(`/fn/${encodeURIComponent(name)}`, { method: 'POST', body: opts?.body ?? {} })
    if (error) return { data: null, error }
    // Unwrap { data } envelope if the server used one, else pass the body through.
    const payload = data && Object.prototype.hasOwnProperty.call(data, 'data') ? data.data : data
    return { data: payload, error: null }
  },
}

export const realSupabase: any = {
  auth,
  from: (t: string) => new Query(t),
  storage,
  channel: () => channelStub,
  removeChannel() {},
  functions,
}
