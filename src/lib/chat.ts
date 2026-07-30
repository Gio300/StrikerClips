/**
 * Chat — the pure, unit-tested core of the Discord-style Space → Category →
 * Channel → Message model (docs/economy-clans-villages.md §4).
 *
 * A "chat" a user makes is NOT one room: it's a SPACE that holds many CHANNELS,
 * optionally grouped into CATEGORIES, with one default `#general`. This module
 * is the DOM-free / storage-free / backend-free logic that the ChatSpace UI
 * reads:
 *   - channel grouping + deterministic ordering (categories → channels),
 *   - the permission resolver — who can post / create channels / delete —
 *     given a space's KIND and (for clan spaces) the viewer's clan rank, reusing
 *     the `can(role, action)` matrix from clans.ts so the two never drift.
 *
 * Mirrors the pure shape of clans.ts / tiers.ts: no side effects, fully testable.
 */

import { can, type ClanRole } from './clans'

// ───────────────────────────────────────────────────────────────────────────
//  Space kinds (§4.2)
// ───────────────────────────────────────────────────────────────────────────

/**
 * A Space is one of three kinds:
 *   - `clan`  — private to a clan's members; permissions via clan ranks (clans.ts).
 *   - `open`  — public community anyone signed-in can join/post; owner + staff moderate.
 *   - `tko`   — official TKO channels; community channels open, announcements staff-only.
 */
export type SpaceKind = 'clan' | 'open' | 'tko'

export const SPACE_KINDS: SpaceKind[] = ['clan', 'open', 'tko']

/** Human label for a space kind (UI chips / headers). */
export function spaceKindLabel(kind: SpaceKind): string {
  switch (kind) {
    case 'clan':
      return 'Clan'
    case 'open':
      return 'Open'
    case 'tko':
      return 'TKO Official'
    default:
      return 'Space'
  }
}

// ───────────────────────────────────────────────────────────────────────────
//  Channel grouping + ordering
// ───────────────────────────────────────────────────────────────────────────

/** The subset of a channel row the grouping/ordering helpers read. */
export interface ChannelLike {
  id: string
  name: string
  /** Category label; null/empty = ungrouped (top-level). */
  category?: string | null
  /** Sort position within the space (lower = higher up). */
  position?: number | null
  /** Announcement / read-mostly channel (post-restricted). */
  is_announcement?: boolean | null
}

/** One category and its ordered channels. `category === null` = ungrouped. */
export interface ChannelGroup<T extends ChannelLike = ChannelLike> {
  category: string | null
  channels: T[]
}

/** Trim a category label; empty → null (ungrouped). */
export function normalizeCategory(c: string | null | undefined): string | null {
  const t = (c ?? '').trim()
  return t === '' ? null : t
}

function posOf(c: ChannelLike): number {
  const p = c.position
  return typeof p === 'number' && Number.isFinite(p) ? p : Number.MAX_SAFE_INTEGER
}

function byPositionThenName(a: ChannelLike, b: ChannelLike): number {
  const pa = posOf(a)
  const pb = posOf(b)
  if (pa !== pb) return pa - pb
  return a.name.localeCompare(b.name)
}

/** Channels sorted by `position` (nulls last), ties broken by name. Pure copy. */
export function sortChannels<T extends ChannelLike>(channels: readonly T[]): T[] {
  return [...channels].sort(byPositionThenName)
}

/**
 * Group channels into ordered categories, each with its channels ordered.
 * Ungrouped channels (no category) form the FIRST group (`category: null`),
 * mirroring Discord's top-level channels. Categories then follow, ordered by
 * their lowest channel position (ties by category name) so the layout is stable.
 */
export function groupChannels<T extends ChannelLike>(channels: readonly T[]): ChannelGroup<T>[] {
  const buckets = new Map<string, T[]>() // '' key = ungrouped
  for (const ch of channels) {
    const key = normalizeCategory(ch.category) ?? ''
    const list = buckets.get(key)
    if (list) list.push(ch)
    else buckets.set(key, [ch])
  }

  const entries = [...buckets.entries()].map(([key, chs]) => ({
    category: key === '' ? null : key,
    channels: sortChannels(chs),
    minPos: Math.min(...chs.map(posOf)),
  }))

  entries.sort((a, b) => {
    // Ungrouped always first.
    if ((a.category === null) !== (b.category === null)) return a.category === null ? -1 : 1
    if (a.minPos !== b.minPos) return a.minPos - b.minPos
    return (a.category ?? '').localeCompare(b.category ?? '')
  })

  return entries.map(({ category, channels }) => ({ category, channels }))
}

/** Ordered list of category names present (excludes the ungrouped bucket). */
export function categoryNames(channels: readonly ChannelLike[]): string[] {
  return groupChannels(channels)
    .map((g) => g.category)
    .filter((c): c is string => c !== null)
}

/**
 * Slugify a raw channel name to a Discord-ish handle (lowercase, dashes, no
 * leading `#`). Empty result → 'general' so a space always has a usable channel.
 */
export function normalizeChannelName(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32)
  return slug || 'general'
}

// ───────────────────────────────────────────────────────────────────────────
//  "Make a chat" — the default channel set per kind (§4.2)
// ───────────────────────────────────────────────────────────────────────────

/** A channel to create when a space is first made (no id yet — inserted by the caller). */
export interface ChannelDraft {
  name: string
  category: string | null
  position: number
  is_announcement: boolean
}

/**
 * The channels a brand-new space starts with. A clan/open space gets a single
 * `#general`; the TKO-official space seeds the announcement + community set from
 * §4.2 (announcements is staff-post-only, the rest are open community channels).
 */
export function defaultChannelsForKind(kind: SpaceKind): ChannelDraft[] {
  if (kind === 'tko') {
    return [
      { name: 'announcements', category: 'INFO', position: 0, is_announcement: true },
      { name: 'general', category: 'COMMUNITY', position: 1, is_announcement: false },
      { name: 'find-a-clan', category: 'COMMUNITY', position: 2, is_announcement: false },
      { name: 'tournaments', category: 'COMMUNITY', position: 3, is_announcement: false },
      { name: 'help', category: 'COMMUNITY', position: 4, is_announcement: false },
    ]
  }
  return [{ name: 'general', category: null, position: 0, is_announcement: false }]
}

// ───────────────────────────────────────────────────────────────────────────
//  Permission resolver (§4.3) — who can post / create channels / delete
// ───────────────────────────────────────────────────────────────────────────

/**
 * Everything the permission helpers need about the viewer + the target
 * channel. `clanRole` is the viewer's rank in a *clan* space (null = not a
 * member). `isOwner` marks the creator of an *open* space; `isStaff` marks a
 * TKO staff member (the founder/reviewer bypass) for *tko* spaces + open-space
 * moderation.
 */
export interface ChatPermCtx {
  kind: SpaceKind
  /** Target channel is an announcement / read-mostly channel. */
  isAnnouncement?: boolean
  /** Viewer is signed in (all posting requires this). */
  signedIn?: boolean
  /** Viewer is TKO staff (founder bypass) — tko spaces + open-space mod. */
  isStaff?: boolean
  /** Viewer owns this (open) space. */
  isOwner?: boolean
  /** Viewer's clan rank in a clan space (null = not a member). */
  clanRole?: ClanRole | null
}

/**
 * May the viewer POST in the target channel? Resolves the space-kind rule ∩ the
 * channel restriction (§4.3):
 *   - clan: must be a member; announcement channels need `post_announcement`
 *     (officer+), normal channels need `post` (member+).
 *   - open: anyone signed-in posts in normal channels; announcement channels are
 *     owner/staff-only.
 *   - tko: anyone signed-in posts in community channels; announcement channels
 *     are TKO-staff-only.
 */
export function canPost(ctx: ChatPermCtx): boolean {
  if (!ctx.signedIn) return false
  switch (ctx.kind) {
    case 'clan': {
      // The space owner (clan creator) and TKO staff can always post — otherwise
      // whoever made the chat couldn't talk in it.
      if (ctx.isOwner || ctx.isStaff) return true
      const role = ctx.clanRole
      if (!role) return false // non-members can't post in a private clan space
      return ctx.isAnnouncement ? can(role, 'post_announcement') : can(role, 'post')
    }
    case 'open':
      if (ctx.isAnnouncement) return !!ctx.isOwner || !!ctx.isStaff
      return true
    case 'tko':
      if (ctx.isAnnouncement) return !!ctx.isStaff
      return true
    default:
      return false
  }
}

/**
 * May the viewer CREATE / manage channels + categories in this space?
 *   - clan: officers+ (reuses `manage_channels` from the clan matrix).
 *   - open: the owner (or staff).
 *   - tko: TKO staff only.
 */
export function canManageChannels(ctx: ChatPermCtx): boolean {
  if (!ctx.signedIn) return false
  switch (ctx.kind) {
    case 'clan':
      return !!ctx.isOwner || !!ctx.isStaff || (!!ctx.clanRole && can(ctx.clanRole, 'manage_channels'))
    case 'open':
      return !!ctx.isOwner || !!ctx.isStaff
    case 'tko':
      return !!ctx.isStaff
    default:
      return false
  }
}

/** Alias: deleting a channel needs the same authority as creating one. */
export const canDeleteChannel = canManageChannels

/**
 * May the viewer DELETE the whole space? Stricter than channel management:
 * only the clan Leader / open-space owner / TKO staff.
 */
export function canDeleteSpace(ctx: ChatPermCtx): boolean {
  if (!ctx.signedIn) return false
  switch (ctx.kind) {
    case 'clan':
      return ctx.clanRole === 'leader'
    case 'open':
      return !!ctx.isOwner || !!ctx.isStaff
    case 'tko':
      return !!ctx.isStaff
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Poll messages
// ---------------------------------------------------------------------------

const CHAT_POLL_PREFIX = '[[tko-poll:v1:'
const CHAT_POLL_PATTERN = /^\[\[tko-poll:v1:([a-zA-Z0-9-]{3,80})\]\]$/

export interface ChatPollDraft {
  question: string
  options: string[]
}

export interface ChatPollValidation {
  draft: ChatPollDraft | null
  error: string | null
}

/**
 * Polls are persisted in the existing polls/poll_options tables. A chat
 * message carries only this opaque reference, which keeps normal message rows
 * backward compatible across DMs and channel chat.
 */
export function encodeChatPoll(pollId: string): string {
  const id = pollId.trim()
  if (!/^[a-zA-Z0-9-]{3,80}$/.test(id)) {
    throw new Error('Invalid poll id')
  }
  return `${CHAT_POLL_PREFIX}${id}]]`
}

/** Return a poll id only when the entire message is a poll reference. */
export function parseChatPoll(body: string): string | null {
  return body.trim().match(CHAT_POLL_PATTERN)?.[1] ?? null
}

/**
 * Normalize and validate a poll before any rows are written. Duplicate options
 * are rejected case-insensitively because they make vote results ambiguous.
 */
export function validateChatPoll(question: string, options: readonly string[]): ChatPollValidation {
  const normalizedQuestion = question.trim()
  const normalizedOptions = options.map((option) => option.trim()).filter(Boolean)

  if (!normalizedQuestion) return { draft: null, error: 'Add a poll question.' }
  if (normalizedQuestion.length > 200) {
    return { draft: null, error: 'Poll questions must be 200 characters or fewer.' }
  }
  if (normalizedOptions.length < 2) {
    return { draft: null, error: 'Add at least two poll options.' }
  }
  if (normalizedOptions.length > 6) {
    return { draft: null, error: 'Polls can have up to six options.' }
  }
  if (normalizedOptions.some((option) => option.length > 80)) {
    return { draft: null, error: 'Poll options must be 80 characters or fewer.' }
  }

  const unique = new Set(normalizedOptions.map((option) => option.toLocaleLowerCase()))
  if (unique.size !== normalizedOptions.length) {
    return { draft: null, error: 'Poll options must be different.' }
  }

  return {
    draft: { question: normalizedQuestion, options: normalizedOptions },
    error: null,
  }
}
