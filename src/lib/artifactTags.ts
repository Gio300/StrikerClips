/**
 * artifactTags — the client for ARTIFACT TAGS, the bought/earned cosmetic pill a
 * player shows off next to their name everywhere on TKO.
 *
 * Writes go through trusted server functions (POST /api/fn/*), reused via the
 * shared `callFn` helper exactly like the wallet / predictions clients. A tag is
 * created by a clan leader, bought by any member (debits their wallet), and then
 * equipped / unequipped. The equipped tag lands on `profiles.equipped_tag_*` and
 * is surfaced by <TagBadge/>.
 *
 * Reads (listing a clan's tags + which ones the viewer owns) are best-effort
 * direct table reads: the create/buy/equip endpoints are the source of truth, so
 * if a read table isn't present on a given backend the UI simply starts empty and
 * fills in optimistically as the user creates/buys. See the READ TODO below.
 */

import { callFn } from './backend'
import { supabase } from './supabase'
import type { ArtifactRarity } from '@/types/database'
import type { Wallet } from './wallet'

export type { ArtifactRarity }

/** Ordered low → high, so a "best tag wins" comparison is a simple index. */
export const RARITY_ORDER: ArtifactRarity[] = ['common', 'rare', 'epic', 'legendary']

/** Human label for a rarity, e.g. for a create-tag dropdown. */
export function rarityLabel(r: ArtifactRarity): string {
  return r.charAt(0).toUpperCase() + r.slice(1)
}

/** One artifact tag as stored / returned by the server. */
export interface ArtifactTag {
  id: string
  clan_id: string | null
  tag_text: string
  price: number
  rarity: ArtifactRarity
  /** Present on owned-tag reads; who owns this copy. */
  owner_id?: string | null
  created_at?: string
}

// ── Writes (trusted server functions) ──────────────────────────────────────

export interface CreateTagInput {
  clanId: string
  tagText: string
  price?: number
  rarity?: ArtifactRarity
}

/** Clan leader creates a new artifact tag for their clan. */
export function createArtifactTag(input: CreateTagInput) {
  return callFn<{ ok: boolean; tag?: ArtifactTag; reason?: string }>('artifact-tag-create', {
    clanId: input.clanId,
    tagText: input.tagText,
    price: input.price,
    rarity: input.rarity,
  })
}

/** Buy an available artifact tag; debits Tokens. */
export function buyArtifactTag(tagId: string) {
  return callFn<
    { ok: true; tag: ArtifactTag; wallet: Wallet } | { ok: false; reason: 'insufficient' | 'not-found' }
  >('artifact-tag-buy', { tagId })
}

/** Equip a tag the viewer owns — becomes their shown-off pill. */
export function equipArtifactTag(tagId: string) {
  return callFn<
    { ok: true; equipped: ArtifactTag } | { ok: false; reason: 'not-owned' }
  >('artifact-tag-equip', { tagId })
}

/** Take off the currently-equipped tag. */
export function unequipArtifactTag() {
  return callFn<{ ok: boolean }>('artifact-tag-unequip', {})
}

// ── Reads (best-effort; see file header) ────────────────────────────────────
//
// TODO(server): there is no documented list endpoint for artifact tags yet.
// These read the `artifact_tags` / `artifact_tag_owners` tables directly and
// fail soft to [] so the management UI still works via the write endpoints. If a
// dedicated read fn (e.g. `artifact-tags-list`) ships, swap these to use it.

// These tables aren't in the generated Supabase types yet, so query through a
// loosely-typed view of the client. The reads fail soft regardless.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const looseDb = supabase as any

/** Tags a clan offers. Fails soft to [] where the table isn't present. */
export async function listClanArtifactTags(clanId: string): Promise<ArtifactTag[]> {
  try {
    const { data, error } = await looseDb
      .from('artifact_tags')
      .select('*')
      .eq('clan_id', clanId)
      .order('created_at', { ascending: false })
    if (error) return []
    return (data ?? []) as ArtifactTag[]
  } catch {
    return []
  }
}

/** Tag ids the viewer owns. Fails soft to an empty set. */
export async function listOwnedArtifactTagIds(userId: string): Promise<Set<string>> {
  try {
    const { data, error } = await looseDb
      .from('artifact_tag_owners')
      .select('tag_id')
      .eq('user_id', userId)
    if (error) return new Set()
    return new Set(((data ?? []) as { tag_id: string }[]).map((r) => r.tag_id))
  } catch {
    return new Set()
  }
}
