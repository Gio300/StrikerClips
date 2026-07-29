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

// Demo Shinobi Conquest board — a populated map (some clans holding land) so the
// Conquest page shows real ownership + a leaderboard in demo mode.
;(function seedConquest() {
  if (db.territories?.length) return
  const clans = [
    { id: 'clan-leaf', name: 'Hidden Leaf', clan_tag: 'LEAF', kind: 'clan' },
    { id: 'clan-cloud', name: 'Hidden Cloud', clan_tag: 'CLD', kind: 'clan' },
    { id: 'clan-sand', name: 'Hidden Sand', clan_tag: 'SND', kind: 'clan' },
    { id: 'clan-mist', name: 'Hidden Mist', clan_tag: 'MST', kind: 'clan' },
  ]
  db.servers = [...(db.servers ?? []), ...clans]
  const PLACES = ['Leaf', 'Sand', 'Mist', 'Cloud', 'Stone', 'Rain', 'Grass', 'Sound',
    'Waterfall', 'Star', 'Moon', 'Snow', 'Valley', 'Ember', 'Tide', 'Dune',
    'Ridge', 'Hollow', 'Reach', 'Verge']
  const owners: (string | null)[] = [
    'clan-leaf', null, 'clan-cloud', null, 'clan-leaf',
    null, 'clan-sand', null, 'clan-cloud', 'clan-leaf',
    null, 'clan-mist', null, 'clan-sand', null,
    null, 'clan-cloud', null, 'clan-leaf', null,
  ]
  db.territories = []
  let k = 0
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 5; col++) {
      db.territories.push({ id: 't' + k, name: PLACES[k], col, row, owner_clan_id: owners[k] ?? null })
      k++
    }
  }
})()

// Turn a SQL LIKE/ILIKE pattern (`%term%`, `_`) into a RegExp. A pattern with
// no wildcards behaves as an exact (anchored) match, mirroring PostgREST.
function likeToRegExp(pattern: string, flags: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = escaped.replace(/%/g, '.*').replace(/_/g, '.')
  return new RegExp(`^${body}$`, flags)
}

function makeUser(email = 'newuser@test.dev', username?: string) {
  return {
    id: 'mock-user-1',
    email,
    // Honor the username the user typed at signup; only fall back to the email
    // prefix when none was provided.
    user_metadata: { username: username || email.split('@')[0], reelone_tier: '' },
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
// Demo/recording builds (VITE_DEMO_AUTOLOGIN=1) start SIGNED IN as a Legend, so
// every authed screen renders for the walkthrough capture with no login step.
if (!session && import.meta.env.VITE_DEMO_AUTOLOGIN) {
  const u = makeUser('demo@tko.cam', 'PatternAfterError')
  u.user_metadata.reelone_tier = 'creator'
  session = { user: u, access_token: 'mock' }
  try { seedProfile(u) } catch { /* noop */ }
}

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
  async signUp(creds: any) { const email = creds?.email; const username = creds?.options?.data?.username ?? creds?.username; const u = makeUser(email, username); session = { user: u, access_token: 'mock' }; seedProfile(u); persist(); emit('SIGNED_IN'); return { data: { user: u, session }, error: null } },
  async signInWithPassword({ email }: any) { const u = makeUser(email); session = { user: u, access_token: 'mock' }; seedProfile(u); persist(); emit('SIGNED_IN'); return { data: { user: u, session }, error: null } },
  async signInWithOAuth() { const u = makeUser(); session = { user: u, access_token: 'mock' }; seedProfile(u); persist(); emit('SIGNED_IN'); return { data: { provider: 'google', url: '' }, error: null } },
  async signOut() { session = null; persist(); emit('SIGNED_OUT'); return { error: null } },
  async refreshSession() { return { data: { session }, error: null } },
  async updateUser(attrs: any) { if (session) { session.user = { ...session.user, user_metadata: { ...session.user.user_metadata, ...(attrs?.data ?? {}) } }; persist(); emit('USER_UPDATED') } return { data: { user: session?.user ?? null }, error: null } },
}

class Query implements PromiseLike<{ data: any; count: number | null; error: null }> {
  private rows: Row[]
  private preds: ((r: Row) => boolean)[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  private payload: any = null
  private orderKey?: { k: string; asc: boolean }
  private limitN?: number
  private head = false
  private wantCount = false
  constructor(table: string) {
    // The artifact catalogue is never empty on a real backend (db/schema.sql
    // seeds the demo gear + the Oracle rewards), so plant it here too — the Shop
    // and the Oracle locker both resolve names out of it.
    this.rows = table === 'assets' ? seedAssets() : (db[table] ??= [])
  }
  select(_cols?: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    if (opts?.count) this.wantCount = true
    if (opts?.head) this.head = true
    return this
  }
  eq(k: string, v: any) { this.preds.push((r) => r[k] === v); return this }
  neq(k: string, v: any) { this.preds.push((r) => r[k] !== v); return this }
  in(k: string, vs: any[]) { this.preds.push((r) => vs.includes(r[k])); return this }
  is(k: string, v: any) { this.preds.push((r) => r[k] === v); return this }
  gte() { return this } lte() { return this } gt() { return this } lt() { return this }
  ilike(k: string, v: string) { const re = likeToRegExp(String(v), 'i'); this.preds.push((r) => re.test(String(r[k] ?? ''))); return this }
  like(k: string, v: string) { const re = likeToRegExp(String(v), ''); this.preds.push((r) => re.test(String(r[k] ?? ''))); return this }
  contains() { return this }
  or() { return this } not() { return this } match() { return this } filter() { return this }
  range() { return this } overlaps() { return this } containedBy() { return this }
  textSearch() { return this }
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
  then<R1 = { data: any; count: number | null; error: null }, R2 = never>(
    res?: ((v: { data: any; count: number | null; error: null }) => R1 | PromiseLike<R1>) | null,
    rej?: ((reason: any) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    const out = this.apply()
    return Promise.resolve({ data: this.head ? null : out, count: this.wantCount ? out.length : null, error: null }).then(res, rej)
  }
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
    async invoke(name: string, opts?: { body?: any }) {
      if (name === 'redeem-code') {
        // Founder HOST codes → global tko_host flag (no tier). Keep in sync with
        // server/app.ts + src/lib/tkoKing.ts TKO_HOST_CODES.
        const HOST_CODES = new Set(['TKO-HOST-K9F3QX', 'TKO-HOST-M4R7PZ', 'TKO-HOST-B2X8LT', 'TKO-HOST-3P9K2J', 'TKO-HOST-7X4M8Q'])
        const code = String(opts?.body?.code ?? '').trim().toUpperCase()
        if (HOST_CODES.has(code)) {
          if (session?.user) {
            session.user = { ...session.user, user_metadata: { ...session.user.user_metadata, tko_host: true } }
            persist(); emit('USER_UPDATED')
          }
          return { data: { ok: true, host: true }, error: null }
        }
        const expires = new Date(Date.now() + 2.6e9).toISOString()
        if (session?.user) {
          // Replace the user object (don't mutate in place) so a fresh reference
          // reaches React, and persist so the grant survives a reload.
          session.user = { ...session.user, user_metadata: { ...session.user.user_metadata, reelone_tier: 'pro', reelone_tier_expires: expires } }
          persist(); emit('USER_UPDATED')
        }
        return { data: { ok: true, tier: 'pro', expires_at: expires }, error: null }
      }
      const econ = economyFn(name, opts?.body ?? {})
      if (econ) return { data: econ, error: null }
      return { data: { ok: true }, error: null }
    },
  },
}

// ---------------------------------------------------------------------------
// ECONOMY FUNCTIONS — the mock's stand-in for the trusted /api/fn/* handlers in
// server/app.ts (wallets, artifacts, predictions, King prizes, clan dues).
//
// These exist so the mock backend (VITE_MOCK_BACKEND=1, i.e. the _mobilebuild
// dev flow) can still click through the shop, the Oracle and a King bracket end
// to end. They intentionally mirror the SHAPE of the server's replies —
// `{ ok, reason }` refusals included — rather than the security: this is an
// in-memory toy where the caller IS the server, so nothing here is a trust
// boundary. Keep the payload shapes in sync with server/app.ts.
// ---------------------------------------------------------------------------

const ORACLE_REWARD_IDS = [
  'oracle-reward-crystal-emote',
  'oracle-reward-violet-skin',
  'oracle-reward-starfall-emote',
  'oracle-reward-astral-skin',
]

const MOCK_SEED_ASSETS: Row[] = [
  { id: 'seed-akatsuki-jersey', name: 'Akatsuki Home Jersey', team_name: 'Akatsuki', image_url: 'https://placehold.co/400x400/1a1a2e/e94560?text=Akatsuki', price_tokens: 250, kind: 'jersey', created_by: null, origin: 'seed' },
  { id: 'seed-leaf-village-jersey', name: 'Hidden Leaf Away Jersey', team_name: 'Hidden Leaf', image_url: 'https://placehold.co/400x400/0f3460/16db93?text=Hidden+Leaf', price_tokens: 200, kind: 'jersey', created_by: null, origin: 'seed' },
  { id: 'seed-sand-jersey', name: 'Sand Siblings Pro Kit', team_name: 'Sand Siblings', image_url: 'https://placehold.co/400x400/2d1b0e/f9c74f?text=Sand', price_tokens: 300, kind: 'jersey', created_by: null, origin: 'seed' },
  { id: 'oracle-reward-crystal-emote', name: 'Crystal Ball Emote', team_name: 'Oracle', image_url: 'https://placehold.co/400x400/2a1a3e/c084fc?text=Oracle+Emote', price_tokens: 0, kind: 'emote', created_by: null, origin: 'reward' },
  { id: 'oracle-reward-violet-skin', name: 'Violet Oracle Badge Skin', team_name: 'Oracle', image_url: 'https://placehold.co/400x400/1e1b4b/a78bfa?text=Oracle+Skin', price_tokens: 0, kind: 'badge_skin', created_by: null, origin: 'reward' },
  { id: 'oracle-reward-starfall-emote', name: 'Starfall Emote', team_name: 'Oracle', image_url: 'https://placehold.co/400x400/3b2f0b/fde68a?text=Starfall', price_tokens: 0, kind: 'emote', created_by: null, origin: 'reward' },
  { id: 'oracle-reward-astral-skin', name: 'Astral Oracle Badge Skin', team_name: 'Oracle', image_url: 'https://placehold.co/400x400/0b1e3b/93c5fd?text=Astral', price_tokens: 0, kind: 'badge_skin', created_by: null, origin: 'reward' },
]

function seedAssets(): Row[] {
  const t = (db.assets ??= [])
  if (!t.length) t.push(...MOCK_SEED_ASSETS.map((a) => ({ ...a, created_at: new Date(0).toISOString() })))
  return t
}

/** Mirror of roundLabel / advancementPrize in src/lib/tkoKing.ts. */
function mockArtifact(round: number, totalRounds: number): Row {
  const r = Math.max(1, Math.floor(round))
  const total = Math.max(r, Math.floor(totalRounds) || r)
  const remaining = total - r
  const make = (slug: string, name: string, kind: string, colors: string, caption: string): Row => ({
    id: `king-prize-${slug}`, name, team_name: 'TKO King',
    image_url: `https://placehold.co/400x400/${colors}?text=${encodeURIComponent(caption)}`,
    price_tokens: 0, kind, created_by: null, origin: 'prize',
  })
  if (remaining === 0) return make('crown', 'TKO King Crown', 'badge_skin', '1a1400/f9c74f', 'KING')
  if (remaining === 1) return make('finalist', 'Finalist Banner', 'banner', '1a1a2e/e94560', 'FINALIST')
  if (remaining === 2) return make('semifinalist', 'Semifinalist Sigil', 'badge_skin', '0f3460/16db93', 'SEMI')
  const label = remaining === 3 ? 'Round of 16' : `Round of ${2 ** (remaining + 1)}`
  return make(`round-${r}`, `${label} Token`, 'emote', '241a2e/c084fc', label)
}

function mockWallet(userId: string): Row {
  db.wallets ??= []
  let w = db.wallets.find((r) => r.user_id === userId)
  if (!w) { w = { user_id: userId, tokens: 0, sweeps: 0 }; db.wallets.push(w) }
  return w
}

function mockLedger(userId: string, entry: Row): void {
  ;(db.wallet_ledger ??= []).push({
    id: uuid(), user_id: userId, tokens_delta: 0, sweeps_delta: 0,
    status: 'Paid', created_at: new Date().toISOString(), ...entry,
  })
}

function mockOwn(userId: string, assetId: string, source: string, refId?: string | null): boolean {
  db.asset_ownership ??= []
  if (db.asset_ownership.some((r) => r.user_id === userId && r.asset_id === assetId)) return false
  db.asset_ownership.push({
    id: uuid(), user_id: userId, asset_id: assetId, source, ref_id: refId ?? null,
    acquired_at: new Date().toISOString(),
  })
  return true
}

function economyFn(name: string, body: any): any | null {
  const me = session?.user?.id
  if (!me) return null
  const balances = () => { const w = mockWallet(me); return { tokens: w.tokens, sweeps: w.sweeps } }

  if (name === 'wallet') return { ok: true, wallet: balances() }

  if (name === 'sweeps-daily') {
    const today = new Date().toISOString().slice(0, 10)
    const claimed = (db.wallet_ledger ?? []).some(
      (r) => r.user_id === me && r.kind === 'grant' && r.reason === 'daily' && r.ref_id === today,
    )
    if (claimed) return { ok: false, reason: 'already-claimed', wallet: balances() }
    mockWallet(me).sweeps += 25
    mockLedger(me, { kind: 'grant', sweeps_delta: 25, reason: 'daily', ref_id: today, event: 'Daily free Sweeps' })
    return { ok: true, granted: 25, wallet: balances() }
  }

  if (name === 'asset-buy') {
    const asset = seedAssets().find((a) => a.id === body.assetId)
    if (!asset) return { ok: false, reason: 'not-found' }
    if ((db.asset_ownership ?? []).some((r) => r.user_id === me && r.asset_id === asset.id)) {
      return { ok: false, reason: 'already-owned' }
    }
    if (asset.origin === 'reward' || asset.origin === 'prize') return { ok: false, reason: 'not-for-sale' }
    const price = Math.max(0, Number(asset.price_tokens ?? 0))
    const w = mockWallet(me)
    if (w.tokens < price) return { ok: false, reason: 'insufficient', wallet: balances() }
    w.tokens -= price
    mockLedger(me, { kind: 'spend', tokens_delta: -price, event: asset.name, reason: 'artifact purchase', ref_id: asset.id })
    mockOwn(me, asset.id, 'purchase')
    return { ok: true, asset, wallet: balances() }
  }

  if (name === 'prediction-make') {
    db.predictions ??= []
    if (db.predictions.some((p) => p.user_id === me && p.tournament_id === body.tournamentId && p.status === 'open')) {
      return { ok: false, reason: 'exists' }
    }
    const row = {
      id: uuid(), user_id: me, tournament_id: body.tournamentId, winner_id: String(body.winnerId ?? ''),
      pick_label: String(body.label ?? ''), status: 'open', reward_asset_id: null, resolved_at: null,
      created_at: new Date().toISOString(),
    }
    db.predictions.push(row)
    return { ok: true, prediction: row }
  }

  if (name === 'prediction-cancel') {
    db.predictions ??= []
    const i = db.predictions.findIndex((p) => p.user_id === me && p.tournament_id === body.tournamentId && p.status === 'open')
    if (i < 0) return { ok: true, cancelled: false }
    db.predictions.splice(i, 1)
    return { ok: true, cancelled: true }
  }

  if (name === 'prediction-resolve') {
    db.predictions ??= []
    const p = db.predictions.find((r) => r.user_id === me && r.tournament_id === body.tournamentId && r.status === 'open')
    if (!p) return { ok: true, resolved: false }
    // The grade comes from the recorded result, exactly as on the server.
    const result = (db.tournament_results ?? []).filter((r) => r.tournament_id === body.tournamentId).slice(-1)[0]
    if (!result) return { ok: true, resolved: false, reason: 'undecided' }
    const label = (db.tournaments ?? []).find((t) => t.id === body.tournamentId)?.name ?? 'Tournament'
    p.resolved_at = new Date().toISOString()
    if (p.winner_id !== result.winner_profile_id) {
      p.status = 'wrong'
      mockLedger(me, { kind: 'prediction', event: label, result: 'Loss', ref_id: body.tournamentId })
      return { ok: true, resolved: true, status: 'wrong' }
    }
    const n = db.predictions.filter((r) => r.user_id === me && r.status === 'correct').length + 1
    const rewardId = ORACLE_REWARD_IDS[(n - 1) % ORACLE_REWARD_IDS.length]
    p.status = 'correct'
    p.reward_asset_id = rewardId
    mockOwn(me, rewardId, 'reward', body.tournamentId)
    const asset = seedAssets().find((a) => a.id === rewardId)
    mockLedger(me, { kind: 'prediction', event: label, result: 'Win', prize: asset?.name, ref_id: body.tournamentId })
    return { ok: true, resolved: true, status: 'correct', asset }
  }

  if (name === 'king-prize') {
    const battle = (db.tournament_battles ?? []).find((b) => b.id === body.battleId)
    if (!battle) return { ok: false, reason: 'undecided' }
    if (!(battle.status === 'complete' || battle.status === 'forfeit') || !battle.winner) {
      return { ok: false, reason: 'undecided' }
    }
    const winner = String(battle.winner)
    const loser = String(battle.player_a) === winner ? battle.player_b : battle.player_a
    if (loser && String(loser) !== winner) {
      db.shinobi_defeats ??= []
      const ex = db.shinobi_defeats.find((r) => r.user_id === winner && r.opponent_id === loser)
      if (ex) ex.beat_count = Number(ex.beat_count ?? 1) + 1
      else db.shinobi_defeats.push({ id: uuid(), user_id: winner, opponent_id: loser, beat_count: 1 })
    }
    const entrants = (db.tournament_registrations ?? []).filter((r) => r.tournament_id === battle.tournament_id).length
    const derived = entrants > 1 ? Math.ceil(Math.log2(entrants)) : 1
    const round = Math.max(1, Math.floor(Number(battle.round) || Number(body.round) || 1))
    const totalRounds = Math.max(derived, round, Math.floor(Number(body.totalRounds) || 0))
    const artifact = mockArtifact(round, totalRounds)
    if (!seedAssets().some((a) => a.id === artifact.id)) seedAssets().push({ ...artifact, created_at: new Date(0).toISOString() })
    const fresh = mockOwn(winner, artifact.id, 'prize', body.battleId)
    if (fresh) {
      const label = (db.tournaments ?? []).find((t) => t.id === battle.tournament_id)?.name ?? 'Tournament'
      mockLedger(winner, { kind: 'tournament', event: label, result: 'Win', prize: artifact.name, ref_id: body.battleId })
    }
    return { ok: true, artifact, alreadyOwned: !fresh, round, totalRounds }
  }

  if (name === 'clan-pay') {
    const clan = (db.servers ?? []).find((s) => s.id === body.serverId)
    if (!clan) return { ok: false, reason: 'not-found' }
    const gross = Math.max(0, Number((body.kind === 'dues' ? clan.dues_tokens : clan.join_fee_tokens) ?? 0))
    if (gross === 0) return { ok: true, charged: 0, split: { clan: 0, platform: 0 }, wallet: balances() }
    const w = mockWallet(me)
    if (w.tokens < gross) return { ok: false, reason: 'insufficient', wallet: balances() }
    const platform = Math.round(gross * 0.2)
    const split = { clan: gross - platform, platform }
    w.tokens -= gross
    clan.treasury_tokens = Number(clan.treasury_tokens ?? 0) + split.clan
    ;(db.clan_dues_payments ??= []).push({
      id: uuid(), server_id: body.serverId, user_id: me, kind: body.kind ?? 'join',
      gross_tokens: gross, clan_tokens: split.clan, platform_tokens: split.platform,
      created_at: new Date().toISOString(),
    })
    mockLedger(me, { kind: 'clan_dues', tokens_delta: -gross, event: clan.name, reason: `${body.kind ?? 'join'} fee`, ref_id: body.serverId })
    return { ok: true, charged: gross, split, wallet: balances() }
  }

  return null
}
