import { supabase } from '@/lib/supabase'
import { notify } from '@/lib/notifications'
import { isBlockedPair, normalizeBlocks as normalizeBlockRows, type BlockFact } from '@/lib/blocking'
import type { ReelParticipant } from '@/types/database'

/**
 * Reel participants — "you're in a new clip".
 *
 * The core product loop is that several players upload their own angle of the
 * SAME match (see matchGrouping.ts) and the app combines them into one
 * multi-angle reel. Before this module a reel belonged to exactly one person —
 * `reels.user_id`, the uploader — so everyone else who literally appears in the
 * video was never told and never saw it in their own clips list.
 *
 * `reel_participants` (reel_id, user_id) fixes that. It is the cast list of a
 * reel: readable by anyone (a reel is public content), but never insertable by
 * a client — TABLE_POLICY marks it insert/write 'deny' so nobody can write
 * themselves into somebody else's reel to farm a notification. Rows are created
 * by the same trusted path that creates the reel.
 *
 * The interesting logic — WHO gets told, and making sure one person is told
 * exactly once per reel — is pure and lives at the top of this file.
 */

/** A person we believe appears in a combined reel. */
export interface ParticipantCandidate {
  /** profiles.id of the person in the clip. */
  userId: string
  /** Their display handle, for the notification copy. */
  username?: string | null
  /** The clip of theirs that fed the combined reel, when known. */
  clipId?: string | null
}

export interface NotifyPlan {
  /** Deduped recipients, uploader excluded, in first-seen order. */
  recipients: ParticipantCandidate[]
  /** Everyone in the cast list including the uploader — what gets persisted. */
  cast: ParticipantCandidate[]
  /** True when this is genuinely a multi-angle reel (2+ distinct people). */
  isMultiAngle: boolean
  /**
   * People who WOULD have been in the cast but were removed by a block. They
   * get no `reel_participants` row and no notification — so the clip never
   * shows up in their list. THIS IS THE COST OF BLOCKING, made explicit: if you
   * block someone and then beat them, you don't get that clip. The block UI
   * says so before you confirm (see blocking.ts BLOCK_CLIP_WARNING).
   */
  excluded: ParticipantCandidate[]
}

const clean = (v: string | null | undefined): string => (v ?? '').trim()

/**
 * Decide who is in a combined reel and who should be told about it.
 *
 * Rules, all of them things that bit us in manual testing:
 *   • one row per person — the same user contributing three angles is ONE
 *     participant and gets ONE notification, not three;
 *   • the uploader is part of the cast (the reel is theirs too) but is never
 *     notified — they just made it;
 *   • blank / whitespace ids are dropped rather than producing an orphan row;
 *   • order is stable (first appearance) so tests and the roster agree;
 *   • a BLOCKED pair is never in the same cast. A block in either direction
 *     between the uploader and a participant drops that participant from the
 *     cast AND from the notification list, so neither of them receives the
 *     combined clip. The uploader is never the one dropped from their own reel.
 *     Among the remaining participants the same rule applies pairwise, first
 *     appearance winning, so the outcome is deterministic.
 */
export function planReelNotifications(
  uploaderId: string,
  candidates: ParticipantCandidate[],
  blocks: BlockFact[] = [],
): NotifyPlan {
  const owner = clean(uploaderId)
  const byUser = new Map<string, ParticipantCandidate>()

  for (const c of candidates) {
    const id = clean(c.userId)
    if (!id) continue
    const existing = byUser.get(id)
    if (existing) {
      // Keep the first row but fill in anything it was missing.
      if (!clean(existing.username) && clean(c.username)) existing.username = c.username
      if (!clean(existing.clipId ?? '') && clean(c.clipId ?? '')) existing.clipId = c.clipId
      continue
    }
    byUser.set(id, { userId: id, username: c.username ?? null, clipId: c.clipId ?? null })
  }

  if (owner && !byUser.has(owner)) {
    byUser.set(owner, { userId: owner, username: null, clipId: null })
  }

  const ordered = [...byUser.values()]

  // ── the block filter ─────────────────────────────────────────────────────
  const dropped = new Set<string>()
  if (blocks.length > 0) {
    // 1. Anyone blocked with the UPLOADER goes first — the reel is theirs, so
    //    they are never the one removed.
    if (owner) {
      for (const c of ordered) {
        if (c.userId !== owner && isBlockedPair(blocks, owner, c.userId)) dropped.add(c.userId)
      }
    }
    // 2. Then pairwise among who is left. First appearance wins, so the result
    //    doesn't depend on which lookup found somebody.
    const survivors = ordered.filter((c) => !dropped.has(c.userId))
    for (let i = 0; i < survivors.length; i++) {
      const a = survivors[i]
      if (dropped.has(a.userId)) continue
      for (let j = i + 1; j < survivors.length; j++) {
        const b = survivors[j]
        if (dropped.has(b.userId)) continue
        if (isBlockedPair(blocks, a.userId, b.userId)) dropped.add(b.userId)
      }
    }
  }

  const cast = ordered.filter((c) => !dropped.has(c.userId))
  const excluded = ordered.filter((c) => dropped.has(c.userId))
  const recipients = cast.filter((c) => c.userId !== owner)
  return { cast, recipients, excluded, isMultiAngle: cast.length >= 2 }
}

/** The notification copy for "you're in this one". Pure so it can be asserted. */
export function participantNotification(reelTitle: string, reelId: string): {
  kind: 'reel_participant'
  title: string
  body: string
  link: string
  relatedId: string
} {
  const title = clean(reelTitle) || 'your match'
  return {
    kind: 'reel_participant',
    title: "You're in a new clip 🎬",
    body: `A new multi-angle clip of your match is up — you're in it: "${title}".`,
    link: `/reels/${reelId}`,
    relatedId: reelId,
  }
}

// ── persistence + fan-out ───────────────────────────────────────────────────

/**
 * Read the blocks the CALLER is allowed to see. By TABLE_POLICY a client may
 * only read its own `blocks` rows (nobody may see who blocked them), so this is
 * exactly "people I blocked". The other direction — someone who blocked ME —
 * cannot be resolved here and is enforced server-side instead: the
 * `reel_participants` insert check rejects a cast row for a blocked pair.
 */
async function loadOwnBlocks(): Promise<BlockFact[]> {
  try {
    const { data } = await supabase.from('blocks').select('*')
    return normalizeBlockRows((data ?? []) as never[])
  } catch {
    return []
  }
}

/**
 * Record the cast of a combined reel and tell everyone who isn't the uploader.
 * Best-effort throughout: a reel that saved must never be undone because the
 * cast list or a notification failed.
 *
 * Blocked participants are dropped before anything is written — no cast row, no
 * notification, so the clip never reaches them.
 */
export async function recordReelParticipants(args: {
  reelId: string
  uploaderId: string
  reelTitle: string
  candidates: ParticipantCandidate[]
  /** Pass to skip the lookup (tests, or a caller that already has them). */
  blocks?: BlockFact[]
}): Promise<NotifyPlan> {
  const blocks = args.blocks ?? (await loadOwnBlocks())
  const plan = planReelNotifications(args.uploaderId, args.candidates, blocks)
  // A single-person reel is just "my clip" — no cast list, no fan-out.
  if (!plan.isMultiAngle) return plan

  const { error } = await supabase.from('reel_participants').insert(
    plan.cast.map((c) => ({
      reel_id: args.reelId,
      user_id: c.userId,
      clip_id: c.clipId ?? null,
    })),
  )
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('recordReelParticipants() failed:', error.message)
  }

  const copy = participantNotification(args.reelTitle, args.reelId)
  await Promise.all(
    plan.recipients.map((r) =>
      notify({
        userId: r.userId,
        kind: copy.kind,
        title: copy.title,
        body: copy.body,
        link: copy.link,
        relatedId: copy.relatedId,
      }),
    ),
  )
  return plan
}

/**
 * Work out who is in a combined reel from the shared clip catalogue.
 *
 * Every clip a TKO user makes is catalogued with its owner (see squad.ts), so a
 * reel built from several angles of one match already carries the evidence of
 * who is in it: the OWNERS of the source clips. We look them up two ways —
 * `clips.youtube_video_id` (the catalogue row) and `clip_records.youtube_id`
 * (the per-clip analysis row, which also carries the player) — because a clip
 * pulled from a squadmate's shelf may have either.
 *
 * Deliberately evidence-based rather than trusting anything the client typed:
 * the caller can't hand us a list of user ids to notify.
 */
export async function resolveParticipantsFromVideoIds(
  videoIds: string[],
): Promise<ParticipantCandidate[]> {
  const ids = [...new Set(videoIds.map((v) => clean(v)).filter(Boolean))]
  if (ids.length === 0) return []

  const [clipRes, recRes] = await Promise.all([
    supabase.from('clips').select('id, user_id, youtube_video_id').in('youtube_video_id', ids),
    supabase.from('clip_records').select('clip_id, player_id, youtube_id').in('youtube_id', ids),
  ])

  const out: ParticipantCandidate[] = []
  for (const row of (clipRes.data ?? []) as { id: string; user_id: string }[]) {
    if (row?.user_id) out.push({ userId: row.user_id, clipId: row.id ?? null })
  }
  for (const row of (recRes.data ?? []) as { clip_id: string | null; player_id: string }[]) {
    if (row?.player_id) out.push({ userId: row.player_id, clipId: row.clip_id ?? null })
  }
  // planReelNotifications() does the dedupe — one row per person regardless of
  // how many of these lookups found them.
  return out
}

/**
 * Reel ids a user appears in but did not upload — what MyClips unions onto the
 * user's own reels so a multi-angle clip lands in the list of everyone in it.
 */
export async function reelIdsFeaturing(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('reel_participants')
    .select('reel_id')
    .eq('user_id', userId)
  const rows = (data ?? []) as Pick<ReelParticipant, 'reel_id'>[]
  return [...new Set(rows.map((r) => r.reel_id).filter(Boolean))]
}

/** The cast of one reel, for the "who's in this" strip on a reel page. */
export async function participantsOfReel(reelId: string): Promise<ReelParticipant[]> {
  const { data } = await supabase
    .from('reel_participants')
    .select('*')
    .eq('reel_id', reelId)
  return (data ?? []) as ReelParticipant[]
}
