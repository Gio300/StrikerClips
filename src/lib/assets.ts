/**
 * Digital Asset Marketplace — the store of team-designed cosmetics, and the
 * locker every earned artifact lands in (Oracle rewards, TKO King prizes).
 *
 * REAL PERSISTENCE. This used to be two localStorage keys — `kc_assets` for the
 * "global" catalog (which was actually per-browser, so a cosmetic one user
 * listed was invisible to everyone else) and `kc_assets_owned:<id>` for
 * ownership (so a King's crown lived only in their own cache). Both are now
 * Postgres tables:
 *
 *   • `assets`          — the SHARED catalogue. Publicly readable; only the
 *                         creator may edit their own listing. Platform artifacts
 *                         (seed gear, Oracle rewards, King prizes) have a null
 *                         `created_by`, so no client owns or can edit them.
 *   • `asset_ownership` — who owns what, and HOW (`source`: purchase / reward /
 *                         prize / grant, plus the battle or tournament it came
 *                         from). Insert is 'deny' for every client: you cannot
 *                         grant yourself an artifact. Buying goes through
 *                         /api/fn/asset-buy, which debits Tokens in the same
 *                         request; earning and winning go through
 *                         /api/fn/prediction-resolve and /api/fn/king-prize.
 *
 * The reads stay SYNCHRONOUS (a module-level cache the `load*` functions
 * hydrate) so the shop grid and locker render without a loading dance, and the
 * existing `kc:assets` window event still fires on every change.
 *
 * The pivot this serves: a giving / prestige / cosmetics economy. Teams design
 * and sell their own gear; supporters buy it with Tokens to rep the team. This
 * is repping and giving — not gambling. Tokens are bought, never cashable, and
 * no cash ever pays out to a designer.
 *
 * LOCAL MODE: passing an explicit `storage` keeps the old localStorage
 * behaviour, for unit tests and offline use. Production callers pass nothing.
 */

import { backend, callFn } from './backend'
import { applyWalletSnapshot } from './wallet'

export type AssetKind = 'jersey' | 'banner' | 'emote' | 'badge_skin'
export type SellerType = 'official' | 'creator' | 'clan'

export type DigitalAsset = {
  id: string
  name: string
  teamName: string
  /** paste-a-URL image — no file infra needed */
  imageUrl: string
  priceTokens: number
  /** Fixed direct-cash tier, in integer USD cents. */
  priceCents?: number
  cashEnabled?: boolean
  paidSweepsEnabled?: boolean
  kind: AssetKind
  sellerType: SellerType
  clanId: string | null
  /** user id of the designer who listed it ('seed' / 'oracle' / 'tko-king' for platform artifacts) */
  createdBy: string
  createdAt: number
}

const CATALOG_KEY = 'kc_assets'
const OWNED_PREFIX = 'kc_assets_owned:'
const EVENT = 'kc:assets'

// Storage is injectable so tests can pass a fake (LOCAL MODE — see the header).
export interface AssetStorage {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

function ownedKey(userId: string): string {
  return `${OWNED_PREFIX}${userId || 'anon'}`
}

function broadcast(): void {
  if (typeof window === 'undefined') return
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* non-DOM */ }
}

// Demo jerseys so the shop is never empty. These are also seeded into the
// `assets` table by db/schema.sql — the copy here is the LOCAL-MODE fallback.
const SEED_ASSETS: DigitalAsset[] = [
  {
    id: 'seed-akatsuki-jersey',
    name: 'Akatsuki Home Jersey',
    teamName: 'Akatsuki',
    imageUrl: 'https://placehold.co/400x400/1a1a2e/e94560?text=Akatsuki',
    priceTokens: 250,
    kind: 'jersey',
    sellerType: 'official',
    clanId: null,
    createdBy: 'seed',
    createdAt: 0,
  },
  {
    id: 'seed-leaf-village-jersey',
    name: 'Hidden Leaf Away Jersey',
    teamName: 'Hidden Leaf',
    imageUrl: 'https://placehold.co/400x400/0f3460/16db93?text=Hidden+Leaf',
    priceTokens: 200,
    kind: 'jersey',
    sellerType: 'official',
    clanId: null,
    createdBy: 'seed',
    createdAt: 0,
  },
  {
    id: 'seed-sand-jersey',
    name: 'Sand Siblings Pro Kit',
    teamName: 'Sand Siblings',
    imageUrl: 'https://placehold.co/400x400/2d1b0e/f9c74f?text=Sand',
    priceTokens: 300,
    kind: 'jersey',
    sellerType: 'official',
    clanId: null,
    createdBy: 'seed',
    createdAt: 0,
  },
]

// ─────────────────────────────────────────────────────────────────────────
//  Row <-> DigitalAsset mapping. The table is snake_case; the UI type is not,
//  and predates the table, so the mapping lives here rather than rippling out.
// ─────────────────────────────────────────────────────────────────────────

type AssetRow = {
  id: string
  name: string
  team_name: string | null
  image_url: string | null
  price_tokens: number | null
  price_cents?: number | null
  cash_enabled?: boolean | null
  paid_sweeps_enabled?: boolean | null
  kind: string | null
  created_by: string | null
  origin?: string | null
  seller_type?: string | null
  clan_id?: string | null
  created_at?: string | null
}

export function rowToAsset(r: AssetRow): DigitalAsset {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    teamName: String(r.team_name ?? ''),
    imageUrl: String(r.image_url ?? ''),
    priceTokens: Math.max(0, Number(r.price_tokens ?? 0)),
    priceCents: Math.max(0, Math.round(Number(r.price_cents ?? 0))),
    cashEnabled: r.cash_enabled === true,
    paidSweepsEnabled: r.paid_sweeps_enabled === true,
    kind: (['jersey', 'banner', 'emote', 'badge_skin'].includes(String(r.kind))
      ? String(r.kind)
      : 'jersey') as AssetKind,
    sellerType: (['official', 'creator', 'clan'].includes(String(r.seller_type))
      ? String(r.seller_type)
      : (r.created_by ? 'creator' : 'official')) as SellerType,
    clanId: r.clan_id ? String(r.clan_id) : null,
    createdBy: r.created_by ? String(r.created_by) : (r.origin ? String(r.origin) : 'seed'),
    createdAt: r.created_at ? new Date(r.created_at).getTime() || 0 : 0,
  }
}

function assetToRow(a: DigitalAsset): Record<string, unknown> {
  return {
    id: a.id,
    name: a.name,
    team_name: a.teamName,
    image_url: a.imageUrl,
    price_tokens: a.priceTokens,
    price_cents: Math.max(0, Math.round(Number(a.priceCents ?? 0))),
    cash_enabled: a.cashEnabled === true,
    paid_sweeps_enabled: a.paidSweepsEnabled === true,
    kind: a.kind,
    seller_type: a.sellerType,
    clan_id: a.clanId,
    // created_by is FORCED to the caller server-side (insert:'owner'); `origin`
    // is in PRIVILEGE_COLS so a listing can never claim to be a prize.
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  The server-backed caches.
// ─────────────────────────────────────────────────────────────────────────

let catalogCache: DigitalAsset[] | null = null
const ownedCache = new Map<string, Set<string>>()

/** Drop every cached catalogue/ownership entry (sign-out). */
export function clearAssetCache(): void {
  catalogCache = null
  ownedCache.clear()
  broadcast()
}

function cachedCatalog(): DigitalAsset[] {
  return catalogCache ?? SEED_ASSETS
}

/** Pull the shared catalogue from the server into the cache. */
export async function loadAssets(): Promise<DigitalAsset[]> {
  try {
    const sb = await backend()
    if (!sb) return cachedCatalog()
    const { data, error } = await sb.from('assets').select('*')
    if (error) return cachedCatalog()
    const rows = Array.isArray(data) ? (data as AssetRow[]) : []
    // An empty table on a brand-new database still shows the demo gear.
    catalogCache = rows.length ? rows.map(rowToAsset) : [...SEED_ASSETS]
    broadcast()
    return listAssets()
  } catch {
    return cachedCatalog()
  }
}

/** Pull the signed-in user's ownership set from the server into the cache. */
export async function loadOwned(userId: string): Promise<DigitalAsset[]> {
  if (!userId) return []
  try {
    const sb = await backend()
    if (!sb) return getOwned(userId)
    const { data, error } = await sb
      .from('asset_ownership')
      .select('asset_id')
      .eq('user_id', userId)
    if (error) return getOwned(userId)
    const ids = (Array.isArray(data) ? data : []).map((r: { asset_id: string }) => String(r.asset_id))
    ownedCache.set(userId, new Set(ids))
    broadcast()
    return getOwned(userId)
  } catch {
    return getOwned(userId)
  }
}

/** Load the catalogue and the caller's locker together — what a surface mounts with. */
export async function loadAssetState(userId: string): Promise<void> {
  await loadAssets()
  if (userId) await loadOwned(userId)
}

// ─────────────────────────────────────────────────────────────────────────
//  LOCAL MODE helpers (unchanged behaviour, used when `storage` is passed).
// ─────────────────────────────────────────────────────────────────────────

function readCatalogRaw(storage: AssetStorage | null): DigitalAsset[] | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(CATALOG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DigitalAsset[]) : []
  } catch {
    return []
  }
}

function writeCatalog(items: DigitalAsset[], storage: AssetStorage | null): void {
  if (!storage) return
  try {
    storage.setItem(CATALOG_KEY, JSON.stringify(items))
  } catch { /* quota / private mode */ }
  broadcast()
}

function readOwnedIds(userId: string, storage: AssetStorage | null): string[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(ownedKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

function writeOwnedIds(userId: string, ids: string[], storage: AssetStorage | null): void {
  if (!storage) return
  try {
    storage.setItem(ownedKey(userId), JSON.stringify(ids))
  } catch { /* quota / private mode */ }
  broadcast()
}

// ─────────────────────────────────────────────────────────────────────────
//  Reads (sync — cache in server mode, the store in local mode).
// ─────────────────────────────────────────────────────────────────────────

/** Every asset in the catalogue, newest first. */
export function listAssets(storage?: AssetStorage | null): DigitalAsset[] {
  if (storage !== undefined) {
    const existing = readCatalogRaw(storage)
    if (existing === null) {
      // First run — plant the demo jerseys so the shop isn't empty.
      writeCatalog(SEED_ASSETS, storage)
      return [...SEED_ASSETS].sort((a, b) => b.createdAt - a.createdAt)
    }
    return [...existing].sort((a, b) => b.createdAt - a.createdAt)
  }
  return [...cachedCatalog()].sort((a, b) => b.createdAt - a.createdAt)
}

/** The full asset objects a user owns (their "locker"). */
export function getOwned(userId: string, storage?: AssetStorage | null): DigitalAsset[] {
  const ids = storage !== undefined
    ? new Set(readOwnedIds(userId, storage))
    : (ownedCache.get(userId) ?? new Set<string>())
  return listAssets(storage).filter((a) => ids.has(a.id))
}

/** True if the user already owns this asset (buy once — it's a cosmetic). */
export function ownsAsset(userId: string, assetId: string, storage?: AssetStorage | null): boolean {
  if (storage !== undefined) return readOwnedIds(userId, storage).includes(assetId)
  return (ownedCache.get(userId) ?? new Set<string>()).has(assetId)
}

/**
 * How many assets a given user has LISTED (their `createdBy` count). Feeds the
 * tier-gated upload cap (see canUploadArt in src/lib/tiers.ts).
 */
export function countAssetsByUser(userId: string, storage?: AssetStorage | null): number {
  if (!userId) return 0
  return listAssets(storage).filter((a) => a.createdBy === userId).length
}

// ─────────────────────────────────────────────────────────────────────────
//  Writes.
// ─────────────────────────────────────────────────────────────────────────

/**
 * List a new asset for sale — the team's "design & sell" form. Inserts into the
 * shared `assets` table, so it is visible to EVERY user (the localStorage
 * version was visible only to its author). `created_by` is forced to the caller
 * server-side, so a listing can never be attributed to someone else.
 */
export async function addAsset(
  input: Omit<DigitalAsset, 'id' | 'createdAt' | 'sellerType' | 'clanId'> & {
    id?: string
    createdAt?: number
    sellerType?: SellerType
    clanId?: string | null
  },
  storage?: AssetStorage | null,
  now: number = Date.now(),
): Promise<DigitalAsset[]> {
  const asset: DigitalAsset = {
    id: input.id ?? `a_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name.trim(),
    teamName: input.teamName.trim(),
    imageUrl: input.imageUrl.trim(),
    priceTokens: Math.max(0, Math.floor(input.priceTokens)),
    kind: input.kind,
    sellerType: input.sellerType ?? (input.createdBy === 'seed' ? 'official' : 'creator'),
    clanId: input.clanId ?? null,
    createdBy: input.createdBy,
    createdAt: input.createdAt ?? now,
  }

  if (storage !== undefined) {
    const current = listAssets(storage)
    const next = [asset, ...current]
    writeCatalog(next, storage)
    return next
  }

  try {
    const sb = await backend()
    const { data, error } = sb
      ? await sb.from('assets').insert(assetToRow(asset)).select('*')
      : { data: null, error: new Error('offline') }
    if (!error) {
      const row = Array.isArray(data) ? data[0] : data
      const created = row ? rowToAsset(row as AssetRow) : asset
      catalogCache = [created, ...cachedCatalog().filter((a) => a.id !== created.id)]
      broadcast()
    }
  } catch { /* offline — the optimistic entry below still renders */ }
  if (!catalogCache?.some((a) => a.id === asset.id)) {
    catalogCache = [asset, ...cachedCatalog()]
    broadcast()
  }
  return listAssets()
}

export type BuyFailure =
  | 'no-user' | 'not-found' | 'already-owned' | 'insufficient' | 'not-for-sale' | 'unavailable'

export type BuyResult =
  | { ok: true; asset: DigitalAsset }
  | { ok: false; reason: BuyFailure }

const BUY_FAILURES: BuyFailure[] = [
  'no-user', 'not-found', 'already-owned', 'insufficient', 'not-for-sale', 'unavailable',
]

const asBuyFailure = (r: unknown): BuyFailure =>
  BUY_FAILURES.includes(r as BuyFailure) ? (r as BuyFailure) : 'unavailable'

/**
 * Buy an asset: spend Tokens, record ownership.
 *
 * This is ONE server call (/api/fn/asset-buy) rather than a client-side
 * "read balance, subtract, write ownership" — the price is read from the
 * catalogue row and the debit and the ownership insert happen together, so a
 * client can neither pick its own price nor take the artifact without paying.
 * Fails gracefully with a reason and mutates nothing.
 */
export async function buyAsset(userId: string, assetId: string): Promise<BuyResult> {
  if (!userId) return { ok: false, reason: 'no-user' }
  try {
    const data = await callFn<{
      ok: boolean; reason?: string; asset?: AssetRow; wallet?: { tokens: number; sweeps: number }
    }>('asset-buy', { assetId })
    if (!data) return { ok: false, reason: 'unavailable' }
    if (!data.ok) {
      if (data.wallet) applyWalletSnapshot(userId, data.wallet)
      return { ok: false, reason: asBuyFailure(data.reason) }
    }
    if (data.wallet) applyWalletSnapshot(userId, data.wallet)
    const asset = data.asset ? rowToAsset(data.asset as AssetRow) : cachedCatalog().find((a) => a.id === assetId)
    noteOwned(userId, assetId)
    if (asset && !cachedCatalog().some((a) => a.id === asset.id)) {
      catalogCache = [asset, ...cachedCatalog()]
    }
    broadcast()
    return asset ? { ok: true, asset } : { ok: false, reason: 'not-found' }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}

/** Record an id in the local ownership cache (after the server confirmed it). */
export function noteOwned(userId: string, assetId: string): void {
  const set = ownedCache.get(userId) ?? new Set<string>()
  set.add(assetId)
  ownedCache.set(userId, set)
}

/**
 * Merge a server-confirmed artifact into the catalogue cache + the user's
 * locker. Called by the prediction and King-prize paths after the SERVER has
 * granted the artifact — this only mirrors what already happened in Postgres,
 * it does not (and cannot) grant anything.
 */
export function noteGranted(userId: string, asset: DigitalAsset): void {
  if (!cachedCatalog().some((a) => a.id === asset.id)) {
    catalogCache = [asset, ...cachedCatalog()]
  }
  noteOwned(userId, asset.id)
  broadcast()
}

export type GrantResult = { ok: boolean; alreadyOwned: boolean }

/**
 * LOCAL MODE ONLY grant — the `storage` parameter is REQUIRED on purpose.
 *
 * There is deliberately no server-mode `grantAsset(userId, asset)`: an
 * unconditional "give this user this artifact" call is exactly the thing a
 * client must never be able to make. Real grants are earned
 * (/api/fn/prediction-resolve) or won (/api/fn/king-prize), and the server
 * decides. This local variant exists for unit tests and offline demos.
 */
export function grantAsset(
  userId: string,
  asset: DigitalAsset,
  storage: AssetStorage | null,
): GrantResult {
  if (!userId) return { ok: false, alreadyOwned: false }
  const catalog = listAssets(storage)
  if (!catalog.some((a) => a.id === asset.id)) {
    writeCatalog([asset, ...catalog], storage)
  }
  if (ownsAsset(userId, asset.id, storage)) return { ok: true, alreadyOwned: true }
  writeOwnedIds(userId, [...readOwnedIds(userId, storage), asset.id], storage)
  return { ok: true, alreadyOwned: false }
}

/** Subscribe a component to catalog / ownership changes. Returns an unsubscribe fn. */
export function subscribeAssets(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => cb()
  window.addEventListener(EVENT, handler)
  // storage event fires cross-tab; local dispatch covers same-tab.
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

/** Human-friendly label for an asset kind. */
export function kindLabel(kind: AssetKind): string {
  switch (kind) {
    case 'jersey': return 'Jersey'
    case 'banner': return 'Banner'
    case 'emote': return 'Emote'
    case 'badge_skin': return 'Badge Skin'
    default: return kind
  }
}

export const ASSET_KINDS: AssetKind[] = ['jersey', 'banner', 'emote', 'badge_skin']
