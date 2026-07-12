// ============================================================================
//  server/mentions.mjs — @username detection → "you were mentioned" pings.
//
//  The single strongest retention mechanic: when a chat message names someone,
//  that someone gets a notification row (and a live ws push). Strictly derived
//  from message content the author wrote — no automation, no scraping.
// ============================================================================
import { query } from './db.mjs'

const MENTION_RE = /@([a-zA-Z0-9_]{2,32})/g

/** Which message tables carry mentionable content, and how to build a link. */
const MSG_TABLES = new Set(['room_messages', 'clan_messages', 'messages', 'stream_messages'])

function extractUsernames(content) {
  if (typeof content !== 'string') return []
  const out = new Set()
  let m
  while ((m = MENTION_RE.exec(content)) !== null) out.add(m[1].toLowerCase())
  return [...out]
}

async function linkFor(table, row) {
  if (table === 'clan_messages') return `/clans/${row.clan_id}`
  if (table === 'stream_messages') return `/live`
  if (table === 'room_messages') {
    const t = row.room_type
    const ref = row.room_ref
    if (t === 'reel' || t === 'clip') return `/reels/${ref}`
    if (t === 'match') return `/matches/${ref}`
    if (t === 'tournament') return `/tournaments/${ref}`
    if (t === 'clan_match') return `/clans`
    return `/reels/${ref}`
  }
  if (table === 'messages') {
    // board message: resolve the channel's server for the /boards/:server/:channel route
    try {
      const { rows } = await query('SELECT server_id FROM public.channels WHERE id = $1', [row.channel_id])
      const sid = rows[0]?.server_id
      if (sid) return `/boards/${sid}/${row.channel_id}`
    } catch { /* ignore */ }
    return `/boards`
  }
  return '/'
}

/**
 * Process mentions for a just-inserted message row.
 * @returns {Promise<Array>} the notification rows created (for ws broadcast)
 */
export async function processMentions(table, row) {
  if (!MSG_TABLES.has(table) || !row || !row.content) return []
  const names = extractUsernames(row.content)
  if (names.length === 0) return []

  // Resolve usernames -> profile ids (case-insensitive), excluding the author.
  let targets
  try {
    const { rows } = await query(
      `SELECT id, username FROM public.profiles WHERE lower(username) = ANY($1)`,
      [names],
    )
    targets = rows.filter((r) => r.id !== row.user_id)
  } catch {
    return []
  }
  if (targets.length === 0) return []

  // Author's display name for the notification title.
  let actorName = 'Someone'
  if (row.user_id) {
    try {
      const { rows } = await query('SELECT username FROM public.profiles WHERE id = $1', [row.user_id])
      if (rows[0]?.username) actorName = rows[0].username
    } catch { /* ignore */ }
  }

  const link = await linkFor(table, row)
  const body = String(row.content).slice(0, 140)
  const created = []
  for (const t of targets) {
    try {
      const { rows } = await query(
        `INSERT INTO public.notifications (user_id, kind, title, body, link, related_id, actor_id)
         VALUES ($1, 'mention', $2, $3, $4, $5, $6) RETURNING *`,
        [t.id, `${actorName} mentioned you`, body, link, row.id, row.user_id ?? null],
      )
      if (rows[0]) created.push(rows[0])
    } catch { /* ignore individual failures */ }
  }
  return created
}
