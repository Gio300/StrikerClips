/**
 * artifacts.ts — the TKO ARTIFACT ECONOMY (pure, unit-tested core).
 *
 * Artifacts are collectible reward items. Players EARN them by using the app
 * (uploading clips, recruiting friends) and LEGEND-tier players can CRAFT them
 * (3 free/month) and imbue them with a capability — the headline one being
 * "gift a Pro month" that they can share as an image with an embedded code.
 *
 * This module holds only the rules + math, no React/DB, so it's easy to test
 * and reason about. UI (RewardsPage, UnlockReveal) and persistence (Supabase
 * `artifacts` / `referrals` / `gifted_subs`) build on top of it.
 */

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'

export const RARITY: Record<Rarity, { label: string; accent: string; emoji: string }> = {
  common:    { label: 'Common',    accent: '#9aa4b2', emoji: '🔹' },
  rare:      { label: 'Rare',      accent: '#00e5ff', emoji: '💠' },
  epic:      { label: 'Epic',      accent: '#a855f7', emoji: '🔮' },
  legendary: { label: 'Legendary', accent: '#ff8a1e', emoji: '🔥' },
  mythic:    { label: 'Mythic',    accent: '#ffd700', emoji: '🌟' },
}

/** What an artifact can DO once owned/redeemed. */
export type Capability =
  | 'none'                 // pure cosmetic / collectible
  | 'gift_starter'         // grants the REDEEMER a LOWER-tier (starter) pass — single-use,
                           // new recipient only. Deliberately NOT Pro, so players can't
                           // farm free Pro months by gifting each other in a loop.
  | 'profile_flair'        // shows a flair on the owner's profile
  | 'clan_tag'             // a clan/event tag cosmetic
  | 'event_badge'          // event art badge

/** The tier a "gift" artifact grants — the entry paid tier, never Pro/creator. */
export const GIFT_TIER = 'ad_free' as const

export const CAPABILITY_LABEL: Record<Capability, string> = {
  none: 'Collectible',
  gift_starter: 'Gifts a starter pass (ad-free month)',
  profile_flair: 'Profile flair',
  clan_tag: 'Clan / event tag',
  event_badge: 'Event badge',
}

export interface ArtifactDef {
  slug: string
  name: string
  rarity: Rarity
  capability: Capability
  reason: string           // how it was earned, shown to the player
}

export type EarnKind = 'uploads' | 'referrals' | 'paid_referrals'

/** Milestone tables — cross a threshold, earn the artifact. Tune freely. */
export const MILESTONES: Record<EarnKind, { at: number; def: ArtifactDef }[]> = {
  uploads: [
    { at: 1,   def: mk('first-blood', 'First Blood', 'common', 'none', 'Uploaded your first clip') },
    { at: 5,   def: mk('clip-collector', 'Clip Collector', 'common', 'profile_flair', 'Uploaded 5 clips') },
    { at: 15,  def: mk('highlight-hunter', 'Highlight Hunter', 'rare', 'profile_flair', 'Uploaded 15 clips') },
    { at: 40,  def: mk('reel-machine', 'Reel Machine', 'epic', 'profile_flair', 'Uploaded 40 clips') },
    { at: 100, def: mk('content-legend', 'Content Legend', 'legendary', 'gift_starter', 'Uploaded 100 clips') },
  ],
  referrals: [
    { at: 1,  def: mk('recruiter', 'Recruiter', 'common', 'none', 'A friend joined on your invite') },
    { at: 3,  def: mk('squad-builder', 'Squad Builder', 'rare', 'profile_flair', 'Recruited 3 friends') },
    { at: 7,  def: mk('clan-caller', 'Clan Caller', 'epic', 'gift_starter', 'Recruited 7 friends') },
    { at: 15, def: mk('village-elder', 'Village Elder', 'legendary', 'gift_starter', 'Recruited 15 friends') },
  ],
  paid_referrals: [
    { at: 1, def: mk('kingmaker', 'Kingmaker', 'epic', 'gift_starter', 'A friend you invited went Pro') },
    { at: 5, def: mk('shadow-broker', 'Shadow Broker', 'mythic', 'gift_starter', '5 invited friends went Pro') },
  ],
}

/** How many artifacts a Legend-tier player may craft for free each month. */
export const LEGEND_MONTHLY_CRAFTS = 3

function mk(slug: string, name: string, rarity: Rarity, capability: Capability, reason: string): ArtifactDef {
  return { slug, name, rarity, capability, reason }
}

/** All artifacts earned at a given count for one earn-kind (idempotent). */
export function earned(kind: EarnKind, count: number): ArtifactDef[] {
  return MILESTONES[kind].filter((m) => count >= m.at).map((m) => m.def)
}

/** The next milestone a player is working toward, with progress 0..1. */
export function nextMilestone(kind: EarnKind, count: number):
  { def: ArtifactDef; at: number; remaining: number; progress: number } | null {
  const next = MILESTONES[kind].find((m) => count < m.at)
  if (!next) return null
  const prev = [...MILESTONES[kind]].reverse().find((m) => m.at <= count)?.at ?? 0
  return {
    def: next.def,
    at: next.at,
    remaining: next.at - count,
    progress: (count - prev) / (next.at - prev),
  }
}

/** Every artifact newly unlocked when a counter goes from `before` to `after`. */
export function newlyEarned(kind: EarnKind, before: number, after: number): ArtifactDef[] {
  const had = new Set(earned(kind, before).map((d) => d.slug))
  return earned(kind, after).filter((d) => !had.has(d.slug))
}

/** Can this Legend still craft this month? */
export function canCraft(isLegend: boolean, craftedThisMonth: number): boolean {
  return isLegend && craftedThisMonth < LEGEND_MONTHLY_CRAFTS
}

/** Short shareable code for a giftable artifact, e.g. TKO-GIFT-9F3K2Q. */
export function makeGiftCode(seed?: string): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let s = ''
  const rnd = seed ? hash(seed) : Math.floor(Math.random() * 1e9)
  let n = rnd
  for (let i = 0; i < 6; i++) { s += alpha[n % alpha.length]; n = Math.floor(n / alpha.length) + ((i + 1) * 7) }
  return `TKO-GIFT-${s}`
}

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0 }
  return h
}
