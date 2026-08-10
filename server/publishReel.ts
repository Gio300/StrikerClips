/* eslint-disable @typescript-eslint/no-explicit-any */
// ===========================================================================
// PUBLISH REEL — the produced video's way INTO the reels feed.
//
// credit-produced (server/creditProduced.ts) writes clip_records, which is what
// puts a factory video on each player's PROFILE and in My Clips. It writes
// nothing to `reels`, so a produced video could never reach the reels FEED
// (src/pages/Reels.tsx reads `reels`) and `reels.promoted` — the front-page
// switch free-member weeklies must be able to turn OFF — had no writer at all:
// `reels` is insert:'owner' in TABLE_POLICY and `promoted` is a PRIVILEGE_COL,
// so no client and no service caller could set either.
//
// This module is that writer. Given a produced YouTube id and the player it
// belongs to, it creates (or heals) ONE reel row owned by that player pointing
// at the YouTube watch URL, stamped with the league it was made for and the
// front-page `promoted` flag, plus a `reel_participants` cast row for every
// participant we can honestly resolve.
//
// IDEMPOTENT per (owner, youtube id): the reel is looked up by its canonical
// watch URL, so re-delivering the same video never creates a second card. That
// is what makes the factory's pending-delivery retry ledger safe.
//
// Pure orchestration over the pool + an injected block predicate, so it unit
// tests against pg-mem with no circular import back into app.ts.
// ===========================================================================

type Pool = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

/** One member of the produced video's cast. */
export interface ReelParticipantInput {
  user_id: string
  /** Gamertag, only used to pick a title when none was sent. */
  handle?: string | null
}

export interface PublishReelInput {
  /** A YouTube id or any YouTube URL containing one. */
  youtubeId: string
  /** The player the reel belongs to — normally the uploader of the footage. */
  ownerUserId: string
  title?: string | null
  /** League the video was produced for (`leagues.slug`), e.g. 'tko'. */
  leagueSlug?: string | null
  /** Front-page visibility. FREE-tier weeklies must send false. */
  promoted?: boolean
  thumbnail?: string | null
  participants?: ReelParticipantInput[]
  /** ISO timestamp of the production, when the caller knows it. */
  createdAt?: string | null
}

export interface PublishReelResult {
  reel_id: string
  created: boolean
  promoted: boolean
  youtube_id: string
  watch_url: string
  title: string
  league_slug: string | null
  /** Cast rows that exist after this call, owner first. */
  participants: string[]
  /** Ids we refused: unknown account, or blocked either way with the owner. */
  skipped: string[]
}

const t = (v: unknown): string => String(v ?? '').trim()

/**
 * The 11-char video id out of a bare id or any YouTube URL form, or ''.
 * Kept local (not imported from src/lib/youtubeApi) so this server module has
 * no dependency on the browser bundle.
 */
export function reelYouTubeId(input: string | null | undefined): string {
  const s = t(input)
  if (!s) return ''
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s
  const m = s.match(
    /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|live\/|embed\/|shorts\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
  )
  if (m) return m[1]
  const v = s.match(/[?&]v=([a-zA-Z0-9_-]{11})/)
  return v ? v[1] : ''
}

/** The ONE spelling of a produced video's URL, so lookups are deterministic. */
export function reelWatchUrl(youtubeId: string): string {
  return `https://www.youtube.com/watch?v=${youtubeId}`
}

/** Public thumbnail for a YouTube id — no API key, same host the app uses. */
export function reelThumbUrl(youtubeId: string): string {
  return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
}

export const DEFAULT_REEL_TITLE = 'Match highlight'

/** A reel needs a title (NOT NULL); fall back to the cast, then a constant. */
export function reelTitleFor(
  title: string | null | undefined,
  participants: ReelParticipantInput[] = [],
): string {
  const given = t(title)
  if (given) return given.slice(0, 200)
  const tags = participants.map((p) => t(p.handle)).filter(Boolean)
  if (tags.length >= 2) return `${tags[0]} vs ${tags[1]}`
  if (tags.length === 1) return `${tags[0]} — match highlight`
  return DEFAULT_REEL_TITLE
}

type Blocked = (pool: Pool, a: string, b: string) => Promise<boolean>
const neverBlocked: Blocked = async () => false
type ReuseAllowed = (pool: Pool, ownerUserId: string, actorUserId: string) => Promise<boolean>
const alwaysAllowed: ReuseAllowed = async () => true

async function profileExists(pool: Pool, userId: string): Promise<boolean> {
  const r = await pool.query('select id from profiles where id=$1 limit 1', [userId])
  return r.rows.length > 0
}

/**
 * Create (or heal) the reel row for a produced video and attach its cast.
 *
 * Fails loudly on a bad owner — a reel with no real author would be invisible
 * everywhere and impossible to correct — and quietly drops a participant we
 * cannot stand behind:
 *   • an id with no profile row (would violate the FK anyway);
 *   • anyone blocked either way with the owner. That mirrors the client rule in
 *     TABLE_POLICY.reel_participants: blocking someone costs you the clip you
 *     were both in, and the block cannot be sidestepped by having the other
 *     side assemble the video.
 */
export async function publishReel(
  pool: Pool,
  input: PublishReelInput,
  blocked: Blocked = neverBlocked,
  reuseAllowed: ReuseAllowed = alwaysAllowed,
): Promise<PublishReelResult> {
  const youtubeId = reelYouTubeId(input.youtubeId)
  if (!youtubeId) throw new Error('youtube_id required')
  const owner = t(input.ownerUserId)
  if (!owner) throw new Error('user_id required')
  if (!(await profileExists(pool, owner))) throw new Error('unknown user_id')

  const watchUrl = reelWatchUrl(youtubeId)
  const participants = input.participants ?? []
  const title = reelTitleFor(input.title, participants)
  const promoted = input.promoted !== false
  const league = t(input.leagueSlug) || null
  const thumbnail = t(input.thumbnail) || reelThumbUrl(youtubeId)

  // IDEMPOTENCY: one reel per (owner, produced video). The canonical watch URL
  // is the key — the caller may send an id, a youtu.be link or a watch URL and
  // they all collapse to the same row.
  const existing = await pool.query(
    'select id from reels where user_id=$1 and combined_video_url=$2 limit 1',
    [owner, watchUrl],
  )
  let reelId = t(existing.rows[0]?.id)
  const created = !reelId
  if (created) {
    const createdAt = t(input.createdAt)
    const inserted = await pool.query(
      `insert into reels (user_id, title, clip_ids, combined_video_url, thumbnail, promoted, league_slug, created_at)
       values ($1,$2,'{}',$3,$4,$5,$6, coalesce($7::timestamptz, now()))
       returning id`,
      [owner, title, watchUrl, thumbnail, promoted, league, createdAt || null],
    )
    reelId = t(inserted.rows[0]?.id)
  } else {
    // Heal a row written by an earlier revision. `title` and `thumbnail` are
    // non-empty by construction above, so they are safe to set outright;
    // `league_slug` is only overwritten when this delivery actually knows one.
    await pool.query(
      `update reels
          set title = $2, thumbnail = $3, promoted = $4,
              league_slug = coalesce($5, league_slug)
        where id = $1`,
      [reelId, title, thumbnail, promoted, league],
    )
  }
  if (!reelId) throw new Error('reel insert failed')

  // THE CAST. The owner is always in it (the reel is theirs), then everyone the
  // caller resolved — deduped, one row per person, never twice.
  const wanted: string[] = []
  for (const p of [{ user_id: owner }, ...participants]) {
    const id = t(p.user_id)
    if (id && !wanted.includes(id)) wanted.push(id)
  }
  const attached: string[] = []
  const skipped: string[] = []
  for (const id of wanted) {
    if (id !== owner) {
      if (!(await profileExists(pool, id))) { skipped.push(id); continue }
      if (await blocked(pool, owner, id)) { skipped.push(id); continue }
      if (!(await reuseAllowed(pool, id, owner))) { skipped.push(id); continue }
    }
    const had = await pool.query(
      'select id from reel_participants where reel_id=$1 and user_id=$2 limit 1',
      [reelId, id],
    )
    if (!had.rows.length) {
      await pool.query(
        'insert into reel_participants (reel_id, user_id, created_at) values ($1,$2, now())',
        [reelId, id],
      )
    }
    attached.push(id)
  }

  return {
    reel_id: reelId,
    created,
    promoted,
    youtube_id: youtubeId,
    watch_url: watchUrl,
    title,
    league_slug: league,
    participants: attached,
    skipped,
  }
}
