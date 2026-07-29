/**
 * blocking — the pure "may these two people be put together?" rules.
 *
 * A block on TKO is deliberately NOT a single switch. The founder's position is
 * that blocking is a heavy, lossy action and most people who reach for it
 * actually want to unfollow, so the product has to (a) offer unfollow first,
 * (b) be honest about what a block costs, and (c) let the blocker choose how far
 * the block reaches:
 *
 *   hideInSharedLives = false   they may still turn up in the same live stage
 *                               (a tournament has to keep working), but the
 *                               engine will NEVER auto-link them.
 *   hideInSharedLives = true    they may not share a live stage at all.
 *
 * In BOTH cases a blocked pair is excluded from each other's multi-angle clips:
 * the cast list and the "you're in a new clip" notification. That is the cost
 * the block UI has to state out loud — if you block someone and then beat them,
 * you do not get that clip.
 *
 * A block is one-directional as DATA (blocker → blocked; nobody may read who
 * blocked them — see TABLE_POLICY.blocks in server/app.ts) but SYMMETRIC as a
 * RULE: once a block exists in either direction, neither person is auto-linked
 * to the other and neither ends up in the other's combined clip. Enforcing it
 * symmetrically is what stops a block being trivially defeated by having the
 * other person start the stage / upload the reel.
 *
 * This module is pure and dependency-free so all of that is unit-testable. The
 * I/O half (reading `blocks`, writing a block, unfollowing) is in
 * `src/lib/blockingService.ts`.
 */

// ───────────────────────────────────────────────────────────────────────────
//  Types
// ───────────────────────────────────────────────────────────────────────────

/** One `blocks` row, normalized. */
export interface BlockFact {
  blockerId: string
  blockedId: string
  /**
   * true  → they must not appear in the same live stage at all.
   * false → they may co-appear (manually / via a third party) but are never
   *         auto-linked.
   */
  hideInSharedLives: boolean
  /** epoch ms, when known. Purely informational. */
  createdAt?: number | null
}

/** What a block does to one specific pairing. */
export interface PairBlockState {
  /** A block exists in at least one direction. */
  blocked: boolean
  /** At least one of those blocks asks to be hidden in shared lives. */
  hidden: boolean
}

export const NO_BLOCK: PairBlockState = { blocked: false, hidden: false }

const clean = (v: string | null | undefined): string => (v ?? '').trim()

// ───────────────────────────────────────────────────────────────────────────
//  Normalizing
// ───────────────────────────────────────────────────────────────────────────

/**
 * Turn a raw `blocks` row into a BlockFact. Returns null for a row that names
 * nobody, or a self-block (which the DB also rejects) — neither should ever be
 * allowed to silently poison the engine.
 */
export function normalizeBlock(row: {
  blocker_id?: string | null
  blocked_id?: string | null
  hide_in_shared_lives?: boolean | null
  created_at?: string | null
}): BlockFact | null {
  const blockerId = clean(row?.blocker_id)
  const blockedId = clean(row?.blocked_id)
  if (!blockerId || !blockedId || blockerId === blockedId) return null
  const t = row?.created_at ? new Date(row.created_at).getTime() : NaN
  return {
    blockerId,
    blockedId,
    hideInSharedLives: row?.hide_in_shared_lives === true,
    createdAt: Number.isFinite(t) ? t : null,
  }
}

export function normalizeBlocks(rows: Parameters<typeof normalizeBlock>[0][]): BlockFact[] {
  const out: BlockFact[] = []
  for (const r of rows ?? []) {
    const b = normalizeBlock(r)
    if (b) out.push(b)
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────────
//  Pair predicates — the whole rule set
// ───────────────────────────────────────────────────────────────────────────

/** Every block that touches this pair, in EITHER direction. */
export function blocksBetween(blocks: BlockFact[], a: string, b: string): BlockFact[] {
  const x = clean(a)
  const y = clean(b)
  if (!x || !y || x === y) return []
  return (blocks ?? []).filter(
    (bl) =>
      (bl.blockerId === x && bl.blockedId === y) || (bl.blockerId === y && bl.blockedId === x),
  )
}

/** The full verdict for a pair — one pass, both flags. */
export function pairBlockState(blocks: BlockFact[], a: string, b: string): PairBlockState {
  const found = blocksBetween(blocks, a, b)
  if (found.length === 0) return NO_BLOCK
  return { blocked: true, hidden: found.some((bl) => bl.hideInSharedLives) }
}

/** Is there a block either way? A blocked pair is NEVER auto-linked. */
export function isBlockedPair(blocks: BlockFact[], a: string, b: string): boolean {
  return blocksBetween(blocks, a, b).length > 0
}

/** Must these two never share a live stage at all? */
export function isHiddenPair(blocks: BlockFact[], a: string, b: string): boolean {
  return blocksBetween(blocks, a, b).some((bl) => bl.hideInSharedLives)
}

/**
 * May the engine auto-link these two? A block in either direction is an
 * absolute no, regardless of `hideInSharedLives` — that flag only widens the
 * block, it never softens it.
 */
export function canAutoLink(blocks: BlockFact[], a: string, b: string): boolean {
  return !isBlockedPair(blocks, a, b)
}

/** May these two appear in the same live stage (manually or via a third party)? */
export function canShareLiveStage(blocks: BlockFact[], a: string, b: string): boolean {
  return !isHiddenPair(blocks, a, b)
}

/**
 * May these two be in the same multi-angle CLIP? No — a block in either
 * direction, hidden or not, removes the blocked pairing from the cast. This is
 * the founder's stated consequence of blocking.
 */
export function canShareClip(blocks: BlockFact[], a: string, b: string): boolean {
  return !isBlockedPair(blocks, a, b)
}

/**
 * Trim a list of user ids so that no two of them are hidden from each other.
 * Earlier ids win, so the caller controls precedence (a stage keeps its seed).
 */
export function dropHiddenConflicts(blocks: BlockFact[], userIds: string[]): string[] {
  const kept: string[] = []
  for (const id of userIds) {
    const u = clean(id)
    if (!u || kept.includes(u)) continue
    if (kept.some((k) => isHiddenPair(blocks, k, u))) continue
    kept.push(u)
  }
  return kept
}

/** Everyone `me` has blocked (only meaningful over `me`'s own rows). */
export function blockedIdsOf(blocks: BlockFact[], me: string): string[] {
  const u = clean(me)
  return [...new Set((blocks ?? []).filter((b) => b.blockerId === u).map((b) => b.blockedId))]
}

/** The block `me` created against `them`, if any. */
export function myBlockOf(blocks: BlockFact[], me: string, them: string): BlockFact | null {
  const u = clean(me)
  const t = clean(them)
  return (blocks ?? []).find((b) => b.blockerId === u && b.blockedId === t) ?? null
}

// ───────────────────────────────────────────────────────────────────────────
//  Copy — the honest-about-the-cost strings, kept here so they are asserted
// ───────────────────────────────────────────────────────────────────────────

/** The softer option, offered FIRST in the block UI. */
export const UNFOLLOW_FIRST_TITLE = 'Unfollow instead?'
export const UNFOLLOW_FIRST_BODY =
  "You'll stop seeing their posts — this is usually what people want."

/** The plain warning shown before a block is confirmed. */
export const BLOCK_CLIP_WARNING =
  "Heads up: if you block someone, you won't get multi-angle clips of matches you played against them — including ones you won."

/** What each reach of the block actually does, in plain language. */
export const BLOCK_SCOPE_COPY: Record<'coappear' | 'hide', { label: string; help: string }> = {
  coappear: {
    label: 'They can still show up in lives with me',
    help: 'You just never get linked together automatically. Tournaments and group stages keep working.',
  },
  hide: {
    label: "Don't put us in the same live at all",
    help: "You'll never appear in the same multi-angle stage, even one someone else set up.",
  },
}
