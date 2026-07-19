/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory Supabase stand-in for local end-to-end UI testing WITHOUT Docker or
 * cloud creds. Enable with VITE_MOCK_BACKEND=1. It fakes auth (sign up / in /
 * out), a chainable query builder over in-memory tables, storage, realtime, and
 * edge-function invokes — enough to click through the whole app as a new user.
 *
 * NOT for production. It only proves the frontend flows work; real RLS / edge
 * logic still needs a real Supabase to test.
 */

type Row = Record<string, any>
const db: Record<string, Row[]> = {}
const uuid = () => 'id-' + Math.random().toString(36).slice(2, 10)

function makeUser(email = 'newuser@test.dev') {
  return {
    id: 'mock-user-1',
    email,
    user_metadata: { username: email.split('@')[0], reelone_tier: '' },
    app_metadata: {},
    aud: 'authenticated',
    created_at: new Date().toISOString(),
  }
}

let session: { user: any; access_token: string } | null = null
const listeners: ((event: string, session: any) => void)[] = []
const emit = (event: string) => listeners.forEach((cb) => cb(event, session))
const persist = () => { try { session ? localStorage.setItem('mock_session', JSON.stringify(session)) : localStorage.removeItem('mock_session') } catch { /* noop */ } }
try { const s = localStorage.getItem('mock_session'); if (s) { session = JSON.parse(s); if (session?.user) seedProfile(session.user) } } catch { /* noop */ }

function seedProfile(u: any) {
  db.profiles ??= []
  if (!db.profiles.find((p) => p.id === u.id)) {
    db.profiles.push({ id: u.id, username: u.user_metadata.username, avatar_url: null, bio: null, created_at: new Date().toISOString() })
  }
}

const auth = {
  async getSession() { return { data: { session }, error: null } },
  async getUser() { return { data: { user: session?.user ?? null }, error: null } },
  onAuthStateChange(cb: (e: string, s: any) => void) {
    listeners.push(cb)
    return { data: { subscription: { unsubscribe() { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1) } } } }
  },
  async signUp({ email }: any) { const u = makeUser(email); session = { user: u, access_token: 'mock' }; seedProfile(u); persist(); emit('SIGNED_IN'); return { data: { user: u, session }, error: null } },
  async signInWithPassword({ email }: any) { const u = makeUser(email); session = { user: u, access_token: 'mock' }; seedProfile(u); persist(); emit('SIGNED_IN'); return { data: { user: u, session }, error: null } },
  async signInWithOAuth() { const u = makeUser(); session = { user: u, access_token: 'mock' }; seedProfile(u); persist(); emit('SIGNED_IN'); return { data: { provider: 'google', url: '' }, error: null } },
  async signOut() { session = null; persist(); emit('SIGNED_OUT'); return { error: null } },
  async refreshSession() { return { data: { session }, error: null } },
  async updateUser(attrs: any) { if (session) { session.user.user_metadata = { ...session.user.user_metadata, ...(attrs?.data ?? {}) }; persist() } return { data: { user: session?.user ?? null }, error: null } },
}

class Query implements PromiseLike<{ data: any; error: null }> {
  private rows: Row[]
  private preds: ((r: Row) => boolean)[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: any = null
  private orderKey?: { k: string; asc: boolean }
  private limitN?: number
  constructor(private table: string) { this.rows = db[table] ??= [] }
  select() { return this }
  eq(k: string, v: any) { this.preds.push((r) => r[k] === v); return this }
  neq(k: string, v: any) { this.preds.push((r) => r[k] !== v); return this }
  in(k: string, vs: any[]) { this.preds.push((r) => vs.includes(r[k])); return this }
  is(k: string, v: any) { this.preds.push((r) => r[k] === v); return this }
  gte() { return this } lte() { return this } ilike() { return this } contains() { return this }
  order(k: string, o?: { ascending?: boolean }) { this.orderKey = { k, asc: o?.ascending !== false }; return this }
  limit(n: number) { this.limitN = n; return this }
  insert(rows: any) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  update(vals: any) { this.op = 'update'; this.payload = vals; return this }
  delete() { this.op = 'delete'; return this }
  upsert(rows: any) { return this.insert(rows) }
  private apply(): Row[] {
    let out = this.rows.filter((r) => this.preds.every((p) => p(r)))
    if (this.op === 'insert') { const added = this.payload.map((r: Row) => ({ id: uuid(), created_at: new Date().toISOString(), ...r })); this.rows.push(...added); return added }
    if (this.op === 'update') { out.forEach((r) => Object.assign(r, this.payload)); return out }
    if (this.op === 'delete') { for (const r of out) { const i = this.rows.indexOf(r); if (i >= 0) this.rows.splice(i, 1) } return out }
    if (this.orderKey) out = [...out].sort((a, b) => (a[this.orderKey!.k] > b[this.orderKey!.k] ? 1 : -1) * (this.orderKey!.asc ? 1 : -1))
    if (this.limitN != null) out = out.slice(0, this.limitN)
    return out
  }
  single() { return Promise.resolve({ data: this.apply()[0] ?? null, error: null }) }
  maybeSingle() { return Promise.resolve({ data: this.apply()[0] ?? null, error: null }) }
  then<R>(res: (v: { data: any; error: null }) => R) { return Promise.resolve({ data: this.apply(), error: null }).then(res) }
}

const storage = {
  from() {
    return {
      async upload() { return { data: { path: 'mock/x.mp4' }, error: null } },
      getPublicUrl(path: string) { return { data: { publicUrl: 'https://example.com/' + path } } },
      async remove() { return { data: [], error: null } },
    }
  },
}

const channelStub: any = { on() { return channelStub }, subscribe() { return channelStub }, unsubscribe() { return channelStub }, send() { return channelStub } }

export const mockSupabase: any = {
  auth,
  from: (t: string) => new Query(t),
  storage,
  channel: () => channelStub,
  removeChannel() {},
  async functions_invoke() { return { data: { ok: true }, error: null } },
  functions: {
    async invoke(name: string) {
      if (name === 'redeem-code') {
        const expires = new Date(Date.now() + 2.6e9).toISOString()
        if (session?.user) {
          session.user.user_metadata = { ...session.user.user_metadata, reelone_tier: 'pro', reelone_tier_expires: expires }
          persist(); emit('USER_UPDATED')
        }
        return { data: { ok: true, tier: 'pro', expires_at: expires }, error: null }
      }
      return { data: { ok: true }, error: null }
    },
  },
}
