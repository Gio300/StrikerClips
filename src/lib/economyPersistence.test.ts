/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The client half of the localStorage -> Postgres migration.
 *
 * server/app.test.ts proves the API cannot be tricked into minting value. These
 * tests prove the other half: that the FRONTEND actually reads from the server,
 * and therefore that a prize, a locker and a prediction survive the thing that
 * used to destroy them — clearing the cache and reopening the app.
 *
 * `./backend` is mocked with a tiny in-memory stand-in for the API, so nothing
 * here depends on a real Supabase/Express instance. Clearing the module caches
 * and re-hydrating is the simulated reload: if the data only ever lived in
 * memory (the old behaviour), it is gone at that point.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ---- the fake backend ------------------------------------------------------
// Deliberately dumb: it stores rows and answers the handful of calls the
// economy modules make. The point is the ROUND TRIP, not SQL fidelity.

type Row = Record<string, any>
const tables: Record<string, Row[]> = {}

function reset() {
  tables.assets = [
    { id: 'seed-akatsuki-jersey', name: 'Akatsuki Home Jersey', team_name: 'Akatsuki', image_url: 'i', price_tokens: 250, kind: 'jersey', created_by: null, origin: 'seed', created_at: '2026-01-01T00:00:00.000Z' },
    { id: 'king-prize-crown', name: 'TKO King Crown', team_name: 'TKO King', image_url: 'i', price_tokens: 0, kind: 'badge_skin', created_by: null, origin: 'prize', created_at: '2026-01-02T00:00:00.000Z' },
    { id: 'oracle-reward-crystal-emote', name: 'Crystal Ball Emote', team_name: 'Oracle', image_url: 'i', price_tokens: 0, kind: 'emote', created_by: null, origin: 'reward', created_at: '2026-01-03T00:00:00.000Z' },
  ]
  tables.asset_ownership = []
  tables.predictions = []
  tables.wallets = []
}

/** Minimal chainable query stub: .select(...).eq(k,v) and .insert(row).select() */
function query(table: string) {
  const preds: ((r: Row) => boolean)[] = []
  let inserted: Row[] | null = null
  const api: any = {
    select: () => api,
    eq: (k: string, v: any) => { preds.push((r) => String(r[k]) === String(v)); return api },
    order: () => api,
    insert: (row: Row) => {
      const created = { created_at: new Date().toISOString(), ...row }
      ;(tables[table] ??= []).push(created)
      inserted = [created]
      return api
    },
    then: (res: any, rej: any) => {
      const data = inserted ?? (tables[table] ?? []).filter((r) => preds.every((p) => p(r)))
      return Promise.resolve({ data, error: null }).then(res, rej)
    },
  }
  return api
}

/** The server functions the modules call. Mirrors server/app.ts's contracts. */
async function invoke(name: string, body: any, actingAs: string): Promise<any> {
  if (name === 'wallet') {
    let w = tables.wallets.find((r) => r.user_id === actingAs)
    if (!w) { w = { user_id: actingAs, tokens: 0, sweeps: 0 }; tables.wallets.push(w) }
    return { ok: true, wallet: { tokens: w.tokens, sweeps: w.sweeps } }
  }
  if (name === 'king-prize') {
    // The real handler verifies the host + reads the winner off the battle. Here
    // we only model the OUTCOME: an idempotent ownership row for the winner,
    // who in this fixture is whoever is acting.
    const winner = actingAs
    const already = tables.asset_ownership.some((r) => r.user_id === winner && r.asset_id === 'king-prize-crown')
    if (!already) {
      tables.asset_ownership.push({ user_id: winner, asset_id: 'king-prize-crown', source: 'prize', ref_id: body.battleId })
    }
    const a = tables.assets.find((r) => r.id === 'king-prize-crown')!
    return { ok: true, artifact: a, alreadyOwned: already, round: 1, totalRounds: 1 }
  }
  if (name === 'prediction-make') {
    const row = {
      id: `p_${tables.predictions.length + 1}`, user_id: actingAs, tournament_id: body.tournamentId,
      winner_id: body.winnerId, pick_label: body.label, status: 'open',
      reward_asset_id: null, resolved_at: null, created_at: new Date().toISOString(),
    }
    tables.predictions.push(row)
    return { ok: true, prediction: row }
  }
  if (name === 'prediction-resolve') {
    const p = tables.predictions.find(
      (r) => r.user_id === actingAs && r.tournament_id === body.tournamentId && r.status === 'open',
    )
    if (!p) return { ok: true, resolved: false }
    // THE GRADE IS THE SERVER'S: it comes from the fixture result, not the call.
    const recorded = (tables as any).__result
    if (!recorded) return { ok: true, resolved: false, reason: 'undecided' }
    const correct = p.winner_id === recorded
    p.status = correct ? 'correct' : 'wrong'
    p.resolved_at = new Date().toISOString()
    if (!correct) return { ok: true, resolved: true, status: 'wrong' }
    p.reward_asset_id = 'oracle-reward-crystal-emote'
    tables.asset_ownership.push({
      user_id: actingAs, asset_id: 'oracle-reward-crystal-emote', source: 'reward', ref_id: body.tournamentId,
    })
    return { ok: true, resolved: true, status: 'correct', asset: tables.assets.find((r) => r.id === 'oracle-reward-crystal-emote') }
  }
  return null
}

/** Who the fake API thinks is calling — the client never sends this for real. */
let actor = 'user-a'

vi.mock('./backend', () => ({
  backend: async () => ({ from: (t: string) => query(t) }),
  callFn: async (name: string, body: any = {}) => invoke(name, body, actor),
}))

import {
  loadAssets, loadOwned, loadAssetState, getOwned, ownsAsset, clearAssetCache, addAsset, listAssets,
} from './assets'
import {
  submitPrediction, gradePrediction, loadPredictions, getStats, readPredictions, clearPredictionCache,
} from './predictions'
import { awardBattlePrize } from './tkoKing'
import { readWallet, loadWallet, applyWalletSnapshot, clearWalletCache } from './wallet'

const ALICE = 'user-a'
const BOB = 'user-b'

/** The simulated reload: every in-memory cache is dropped, as on a fresh load. */
function reload() {
  clearAssetCache()
  clearPredictionCache()
  clearWalletCache()
}

beforeEach(() => {
  reset()
  actor = ALICE
  reload()
})

describe('economy — the shared catalogue really is shared', () => {
  it('hydrates the catalogue from the server, not from a per-browser blob', async () => {
    const list = await loadAssets()
    expect(list.map((a) => a.id)).toContain('seed-akatsuki-jersey')
    // The row shape is mapped into the UI type.
    const crown = list.find((a) => a.id === 'king-prize-crown')!
    expect(crown.name).toBe('TKO King Crown')
    expect(crown.teamName).toBe('TKO King')
  })

  it('gear one user lists is visible to the next user who loads the shop', async () => {
    await loadAssets()
    await addAsset({
      id: 'a_alice_kit', name: 'Alice Kit', teamName: 'Alice FC', imageUrl: 'i',
      priceTokens: 50, kind: 'jersey', createdBy: ALICE,
    })
    // Bob opens the shop in a different browser: same catalogue.
    reload()
    const asBob = await loadAssets()
    expect(asBob.some((a) => a.id === 'a_alice_kit')).toBe(true)
    expect(listAssets().some((a) => a.id === 'a_alice_kit')).toBe(true)
  })
})

describe('economy — a King prize survives a reload', () => {
  it('persists the crown across a simulated cache clear', async () => {
    await loadAssetState(ALICE)
    expect(ownsAsset(ALICE, 'king-prize-crown')).toBe(false)

    // The host awards it. (Authorization is the server's job — see
    // server/app.test.ts "a FIGHTER cannot award themselves the crown".)
    const grant = await awardBattlePrize('battle-1', { round: 1, totalRounds: 1 })
    expect(grant?.asset.id).toBe('king-prize-crown')
    expect(grant?.alreadyOwned).toBe(false)

    // THE TEST THAT MATTERS: clear every cache — the old localStorage version
    // lost the crown here — and re-hydrate from the server.
    reload()
    expect(ownsAsset(ALICE, 'king-prize-crown')).toBe(false) // nothing in memory
    await loadAssetState(ALICE)
    expect(ownsAsset(ALICE, 'king-prize-crown')).toBe(true)
    expect(getOwned(ALICE).map((a) => a.id)).toContain('king-prize-crown')
  })

  it('is idempotent — re-awarding does not duplicate it', async () => {
    await awardBattlePrize('battle-1', { round: 1, totalRounds: 1 })
    const again = await awardBattlePrize('battle-1', { round: 1, totalRounds: 1 })
    expect(again?.alreadyOwned).toBe(true)

    reload()
    await loadAssetState(ALICE)
    expect(getOwned(ALICE).filter((a) => a.id === 'king-prize-crown')).toHaveLength(1)
  })

  it('ownership is per-user — the crown does not leak into another locker', async () => {
    await awardBattlePrize('battle-1', { round: 1, totalRounds: 1 })

    reload()
    await loadAssets()
    await loadOwned(BOB)
    expect(ownsAsset(BOB, 'king-prize-crown')).toBe(false)
    expect(getOwned(BOB)).toHaveLength(0)

    await loadOwned(ALICE)
    expect(ownsAsset(ALICE, 'king-prize-crown')).toBe(true)
  })
})

describe('economy — predictions resolve and persist', () => {
  it('grades against the recorded result and keeps the outcome across a reload', async () => {
    await loadAssetState(ALICE)
    const made = await submitPrediction({
      userId: ALICE, tournamentId: 't1', pick: { winnerId: 'champ', label: 'Champ' },
    })
    expect(made.ok).toBe(true)
    expect(getStats(ALICE).openCount).toBe(1)

    // No result recorded yet -> nothing is graded.
    expect(await gradePrediction(ALICE, 't1')).toEqual({ resolved: false })

    // The tournament is decided. Note the client never says who won.
    ;(tables as any).__result = 'champ'
    const res = await gradePrediction(ALICE, 't1')
    expect(res.resolved).toBe(true)
    if (res.resolved) {
      expect(res.status).toBe('correct')
      expect(res.reward?.id).toBe('oracle-reward-crystal-emote')
    }

    // Reload: the grade, the streak and the earned cosmetic all come back.
    reload()
    expect(readPredictions(ALICE)).toHaveLength(0)
    await loadPredictions(ALICE)
    await loadAssetState(ALICE)

    const stats = getStats(ALICE)
    expect(stats.correctCount).toBe(1)
    expect(stats.openCount).toBe(0)
    expect(stats.streak).toBe(1)
    expect(ownsAsset(ALICE, 'oracle-reward-crystal-emote')).toBe(true)
  })

  it('a wrong call is recorded as wrong and earns nothing', async () => {
    await submitPrediction({ userId: ALICE, tournamentId: 't2', pick: { winnerId: 'nobody', label: 'Nobody' } })
    ;(tables as any).__result = 'champ'
    const res = await gradePrediction(ALICE, 't2')
    expect(res.resolved && res.status).toBe('wrong')

    reload()
    await loadPredictions(ALICE)
    await loadAssetState(ALICE)
    expect(getStats(ALICE).wrongCount).toBe(1)
    expect(getStats(ALICE).streak).toBe(0)
    expect(getOwned(ALICE)).toHaveLength(0)
  })

  it('predictions are per-user', async () => {
    await submitPrediction({ userId: ALICE, tournamentId: 't3', pick: { winnerId: 'x', label: 'X' } })
    reload()
    await loadPredictions(BOB)
    expect(readPredictions(BOB)).toHaveLength(0)
    await loadPredictions(ALICE)
    expect(readPredictions(ALICE)).toHaveLength(1)
  })
})

describe('economy — the wallet is read-only on the client', () => {
  it('exposes no way to credit a balance', async () => {
    const wallet = await import('./wallet')
    // Every credit helper now REQUIRES an explicit local store, so there is no
    // no-arg "give me tokens" call reachable from app code. The server-backed
    // surface is: read it, and claim the guarded daily grant.
    expect(typeof wallet.loadWallet).toBe('function')
    expect(typeof wallet.claimDailySweeps).toBe('function')
    expect(wallet.addToWallet.length).toBe(3) // (userId, delta, storage)
    expect(wallet.addTokens.length).toBe(3)
    expect(wallet.addSweeps.length).toBe(3)
  })

  it('reads balances from the server and reflects server-returned snapshots', async () => {
    tables.wallets.push({ user_id: ALICE, tokens: 320, sweeps: 40 })
    const w = await loadWallet(ALICE)
    expect(w).toEqual({ tokens: 320, sweeps: 40, paid_sweeps_cents: 0, oracle_tickets: 0 })
    expect(readWallet(ALICE)).toEqual({ tokens: 320, sweeps: 40, paid_sweeps_cents: 0, oracle_tickets: 0 })

    // A handler's response (e.g. after a purchase) replaces the cached balance.
    applyWalletSnapshot(ALICE, { tokens: 70, sweeps: 40 })
    expect(readWallet(ALICE).tokens).toBe(70)

    // A different user's balance is not this user's.
    expect(readWallet(BOB)).toEqual({ tokens: 0, sweeps: 0, paid_sweeps_cents: 0, oracle_tickets: 0 })
  })

  it('a local-store wallet never leaks into the server-backed cache', () => {
    const mem = new Map<string, string>()
    const store = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, v) },
    }
    // LOCAL MODE: this is a test/offline store, not the user's real balance.
    const local = readWallet(ALICE, store)
    expect(local).toEqual({ tokens: 0, sweeps: 0, paid_sweeps_cents: 0, oracle_tickets: 0 })
    expect(readWallet(ALICE)).toEqual({ tokens: 0, sweeps: 0, paid_sweeps_cents: 0, oracle_tickets: 0 })
  })
})
