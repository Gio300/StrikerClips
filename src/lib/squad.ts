/**
 * Squad shelf — the "use my friends' clips" model.
 *
 * The whole point (and the elegant part): every clip a KillCam user makes is
 * published to KillCam's own YouTube channel and catalogued with its owner,
 * category and timestamp. So "use a friend's clip" is not a cross-account
 * YouTube login — it's just filtering our shared catalog to that friend. This
 * model is that catalog view: members you're squadded with, and their clips,
 * grouped so you can scroll a friend and drop their K.O.s straight into a reel.
 *
 * Visibility is a KillCam-side permission (the videos are unlisted on YouTube),
 * so a clip is shareable to your squad without being exposed to the internet.
 *
 * Pure/testable; the backend just supplies real members + clips instead of the
 * demo set.
 */

import type { ClipCategory } from './clipSearch'

export type Visibility = 'public' | 'friends' | 'private'

export type SquadMember = {
  id: string
  name: string
  /** tailwind gradient classes for the avatar chip, e.g. 'from-... to-...' */
  tint?: string
}

export type SquadClip = {
  id: string // youtube video id (on KillCam's channel)
  ownerId: string
  ownerName: string
  category: ClipCategory
  title: string
  publishedAt: number
  visibility: Visibility
}

/** Can the viewer use this clip? Owner always can; friends see friends+public. */
export function canUseClip(clip: SquadClip, viewerId: string, isFriend: boolean): boolean {
  if (clip.ownerId === viewerId) return true
  if (clip.visibility === 'private') return false
  if (clip.visibility === 'public') return true
  return isFriend // 'friends'
}

/** A member's usable clips, newest first. */
export function clipsFor(clips: SquadClip[], memberId: string, viewerId: string): SquadClip[] {
  return clips
    .filter((c) => c.ownerId === memberId && canUseClip(c, viewerId, true))
    .sort((a, b) => b.publishedAt - a.publishedAt)
}

export const CATEGORY_ORDER: ClipCategory[] = ['kill', 'ultimate', 'flag', 'clutch', 'win', 'death']

export const CATEGORY_LABEL: Record<ClipCategory, string> = {
  kill: 'K.O.s',
  ultimate: 'Ultimates',
  flag: 'Flag runs',
  clutch: 'Clutches',
  win: 'Wins',
  death: 'Deaths',
}

/** Group a member's clips by category, in a stable display order. */
export function groupByCategory(clips: SquadClip[]): { category: ClipCategory; clips: SquadClip[] }[] {
  const map = new Map<ClipCategory, SquadClip[]>()
  for (const c of clips) {
    const arr = map.get(c.category) ?? []
    arr.push(c)
    map.set(c.category, arr)
  }
  return CATEGORY_ORDER.filter((cat) => map.has(cat)).map((cat) => ({ category: cat, clips: map.get(cat)! }))
}

export function ytUrl(clip: SquadClip): string {
  return `https://www.youtube.com/watch?v=${clip.id}`
}

// ---- Demo squad (replaced by the real friend graph once the backend is in) --

const DAY = 86_400_000

export function demoSquad(now: number = Date.now()): { members: SquadMember[]; clips: SquadClip[] } {
  const members: SquadMember[] = [
    { id: 'u_rekt', name: 'Rekt', tint: 'from-[#ff7a18] to-[#b00000]' },
    { id: 'u_auryn', name: 'Auryn', tint: 'from-[#9146ff] to-[#5c2db0]' },
    { id: 'u_kaze', name: 'Kaze', tint: 'from-[#25f4ee] to-[#0070d1]' },
  ]
  const mk = (
    ownerId: string, ownerName: string, id: string, category: ClipCategory, title: string, ageDays: number,
  ): SquadClip => ({ id, ownerId, ownerName, category, title, publishedAt: now - ageDays * DAY, visibility: 'friends' })

  const clips: SquadClip[] = [
    mk('u_rekt', 'Rekt', 'dPCS6ACHeQ0', 'kill', 'Triple K.O. — ranked', 1),
    mk('u_rekt', 'Rekt', 'IZcwiJrMwas', 'flag', 'Flag run, clutch cap', 2),
    mk('u_rekt', 'Rekt', '6kM_PgLUjSM', 'clutch', '1v3 comeback', 4),
    mk('u_auryn', 'Auryn', 'xU45LZvPkYg', 'ultimate', 'Ougi finish in the Pit', 1),
    mk('u_auryn', 'Auryn', 'tgNuaTIM_n4', 'kill', 'Double K.O. defense', 3),
    mk('u_kaze', 'Kaze', 'dQw4w9WgXcQ', 'kill', 'Opening pick', 2),
    mk('u_kaze', 'Kaze', '6kM_PgLUjSM', 'win', 'Match point', 5),
  ]
  return { members, clips }
}
