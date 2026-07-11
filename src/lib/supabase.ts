/**
 * KillCam data client — a Supabase-shaped compatibility shim over our own
 * same-origin API (Express server → Cloud SQL `reelone-db`). This REPLACES
 * `@supabase/supabase-js` so the app has ZERO Supabase dependency while keeping
 * the existing `supabase.from(...)`, `supabase.auth.*`, `supabase.storage.*`,
 * and `supabase.channel(...)` call sites working.
 *
 * - Data: `.from(table).select()/insert()/update()/delete()` → POST /api/query
 * - Auth: JWT in localStorage → /api/auth/*
 * - Storage / realtime: graceful degradation (no Supabase). Realtime chat falls
 *   back to backfill-only until websockets are added; storage returns a clear
 *   "not configured" error rather than throwing.
 */

// ---- Minimal auth types (replacing the ones from @supabase/supabase-js) ----
export type User = {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
  [k: string]: unknown
}
export type Session = { user: User; access_token: string }
type AuthChangeCb = (event: string, session: Session | null) => void

const TOKEN_KEY = 'killcam.token'
const getToken = () => (typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) || '' : '')
const setToken = (t: string) => {
  if (typeof localStorage === 'undefined') return
  if (t) localStorage.setItem(TOKEN_KEY, t)
  else localStorage.removeItem(TOKEN_KEY)
}
function authHeaders(): Record<string, string> {
  const t = getToken()
  return t ? { Authorization: `Bearer ${t}` } : {}
}

async function apiFetch(path: string, opts: RequestInit = {}): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(opts.headers || {}) },
    })
    const json = await res.json().catch(() => null)
    return { ok: res.ok, status: res.status, json }
  } catch {
    return { ok: false, status: 0, json: null }
  }
}

// ---- select() embed stripping: our gateway returns flat rows, so drop
//      PostgREST-style embeds like `*, profiles(username)`. ----
function stripEmbeds(cols: string): string {
  const out = cols.replace(/,?\s*[a-zA-Z_][\w]*\s*\([^)]*\)/g, '').replace(/^\s*,|,\s*$/g, '').trim()
  return out || '*'
}

type Filter = { col: string; op: string; val: unknown }
type Result<T = any> = { data: T; error: { message: string } | null }

class QueryBuilder implements PromiseLike<Result> {
  private _action: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private _columns = '*'
  private _filters: Filter[] = []
  private _order?: { col: string; ascending: boolean }
  private _limit?: number
  private _single = false
  private _values?: unknown
  constructor(private table: string) {}

  select(cols = '*') {
    if (this._action === 'select') this._columns = cols
    return this
  }
  insert(values: unknown) { this._action = 'insert'; this._values = values; return this }
  upsert(values: unknown) { this._action = 'insert'; this._values = values; return this }
  update(values: unknown) { this._action = 'update'; this._values = values; return this }
  delete() { this._action = 'delete'; return this }

  eq(col: string, val: unknown) { this._filters.push({ col, op: 'eq', val }); return this }
  neq(col: string, val: unknown) { this._filters.push({ col, op: 'neq', val }); return this }
  gt(col: string, val: unknown) { this._filters.push({ col, op: 'gt', val }); return this }
  gte(col: string, val: unknown) { this._filters.push({ col, op: 'gte', val }); return this }
  lt(col: string, val: unknown) { this._filters.push({ col, op: 'lt', val }); return this }
  lte(col: string, val: unknown) { this._filters.push({ col, op: 'lte', val }); return this }
  like(col: string, val: unknown) { this._filters.push({ col, op: 'like', val }); return this }
  ilike(col: string, val: unknown) { this._filters.push({ col, op: 'ilike', val }); return this }
  is(col: string, val: unknown) { this._filters.push({ col, op: 'is', val }); return this }
  in(col: string, val: unknown[]) { this._filters.push({ col, op: 'in', val }); return this }
  match(obj: Record<string, unknown>) { for (const k in obj) this._filters.push({ col: k, op: 'eq', val: obj[k] }); return this }

  order(col: string, opts?: { ascending?: boolean }) {
    this._order = { col, ascending: opts?.ascending !== false }
    return this
  }
  limit(n: number) { this._limit = n; return this }
  range(from: number, to: number) { this._limit = to - from + 1; return this }
  single() { this._single = true; return this }
  maybeSingle() { this._single = true; return this }

  private async _run(): Promise<Result> {
    const body = {
      table: this.table,
      action: this._action,
      columns: stripEmbeds(this._columns),
      filters: this._filters,
      order: this._order,
      limit: this._limit,
      single: this._single,
      values: this._values,
    }
    const { ok, json } = await apiFetch('/api/query', { method: 'POST', body: JSON.stringify(body) })
    if (!ok || !json) return { data: this._single ? null : [], error: { message: (json && json.error) || 'request failed' } }
    return { data: json.data ?? (this._single ? null : []), error: json.error ? { message: json.error } : null }
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this._run().then(onfulfilled, onrejected)
  }
}

// ---- realtime stub: chainable no-op so chat components don't crash ----
function makeChannel() {
  const ch = {
    on() { return ch },
    subscribe(cb?: (status: string) => void) { if (cb) cb('SUBSCRIBED'); return ch },
    unsubscribe() { return Promise.resolve('ok') },
  }
  return ch
}

const listeners: AuthChangeCb[] = []
function emit(event: string, session: Session | null) {
  for (const cb of listeners) { try { cb(event, session) } catch { /* ignore */ } }
}

const auth = {
  async getSession(): Promise<{ data: { session: Session | null }; error: null }> {
    const t = getToken()
    if (!t) return { data: { session: null }, error: null }
    const { ok, json } = await apiFetch('/api/auth/me')
    if (!ok || !json?.user) { setToken(''); return { data: { session: null }, error: null } }
    return { data: { session: { user: json.user, access_token: t } }, error: null }
  },
  async getUser(): Promise<{ data: { user: User | null }; error: null }> {
    const { data: { session } } = await this.getSession()
    return { data: { user: session?.user ?? null }, error: null }
  },
  onAuthStateChange(cb: AuthChangeCb) {
    listeners.push(cb)
    this.getSession().then(({ data: { session } }) => cb('INITIAL_SESSION', session))
    return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) } } } }
  },
  async signInWithPassword({ email, password }: { email: string; password: string }) {
    const { ok, json } = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    if (!ok || !json?.token) return { data: { session: null, user: null }, error: { message: (json && json.error) || 'Invalid login' } }
    setToken(json.token)
    const session: Session = { user: json.user, access_token: json.token }
    emit('SIGNED_IN', session)
    return { data: { session, user: json.user }, error: null }
  },
  async signUp({ email, password, options }: { email: string; password: string; options?: { data?: Record<string, unknown> } }) {
    const meta = options?.data || {}
    const username = (meta.username as string) || email.split('@')[0]
    const { ok, json } = await apiFetch('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, username, metadata: meta }),
    })
    if (!ok || !json?.token) return { data: { session: null, user: null }, error: { message: (json && json.error) || 'Sign up failed' } }
    setToken(json.token)
    const session: Session = { user: json.user, access_token: json.token }
    emit('SIGNED_IN', session)
    return { data: { session, user: json.user }, error: null }
  },
  async signInWithOAuth() {
    return { data: null, error: { message: 'Social login is not enabled on this deployment yet.' } }
  },
  async signOut() {
    setToken('')
    await apiFetch('/api/auth/logout', { method: 'POST' })
    emit('SIGNED_OUT', null)
    return { error: null }
  },
  async updateUser() {
    return { data: { user: null }, error: { message: 'Not supported yet.' } }
  },
}

const storage = {
  from(_bucket: string) {
    return {
      async upload() { return { data: null, error: { message: 'Uploads are not configured on this deployment yet.' } } },
      async remove() { return { data: null, error: null } },
      getPublicUrl(path: string) { return { data: { publicUrl: path } } },
      async createSignedUrl() { return { data: null, error: { message: 'Not configured.' } } },
    }
  },
}

export const supabase = {
  from: (table: string) => new QueryBuilder(table),
  auth,
  storage,
  channel: (_name: string) => makeChannel(),
  removeChannel: (_ch: unknown) => Promise.resolve('ok'),
  rpc: async () => ({ data: null, error: { message: 'rpc not supported' } }),
  functions: {
    // Edge functions (Stripe donations/connect) are not wired on this backend
    // yet — degrade gracefully instead of throwing in click handlers.
    async invoke(_name: string, _opts?: unknown) {
      return { data: null, error: { message: 'Payments are not enabled on this deployment yet.' } }
    },
  },
}

/** Retained for back-compat with call sites that imported this flag. Always
 * true now — config lives server-side, not in the browser. */
export const isSupabaseConfigured = true
