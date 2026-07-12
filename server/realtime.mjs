// ============================================================================
//  server/realtime.mjs — WebSocket fan-out for live chat + notifications.
//
//  Turns the "backfill-only" chat into real live chat. Clients open one ws to
//  /ws and subscribe to TOPICS. When a row is inserted into a realtime table
//  (via /api/query), the server broadcasts it to the matching topic(s).
//
//  Topic scheme: `${table}:${keyColumn}:${keyValue}` — mirrors the single-column
//  filter the frontend already uses (e.g. room_messages filtered by room_ref).
// ============================================================================
import { WebSocketServer } from 'ws'

// For each realtime table, which column(s) a client can subscribe on.
export const RT_KEYS = {
  room_messages: ['room_ref'],
  clan_messages: ['clan_id'],
  messages: ['channel_id'],
  stream_messages: ['stream_id'],
  notifications: ['user_id'],
}

/** topic -> Set<ws> */
const topics = new Map()

function subscribe(ws, topic) {
  if (typeof topic !== 'string' || topic.length > 200) return
  if (!topics.has(topic)) topics.set(topic, new Set())
  topics.get(topic).add(ws)
  ws._topics.add(topic)
}
function unsubscribe(ws, topic) {
  const set = topics.get(topic)
  if (set) { set.delete(ws); if (set.size === 0) topics.delete(topic) }
  ws._topics.delete(topic)
}
function dropClient(ws) {
  for (const t of ws._topics) {
    const set = topics.get(t)
    if (set) { set.delete(ws); if (set.size === 0) topics.delete(t) }
  }
  ws._topics.clear()
}

const PG_CHANNEL = 'killcam_rt'

/** Fan a row out to LOCAL ws subscribers of its key topics. */
function broadcastLocal(table, row) {
  const keys = RT_KEYS[table]
  if (!keys || !row) return
  for (const col of keys) {
    const val = row[col]
    if (val == null) continue
    const topic = `${table}:${col}:${val}`
    const set = topics.get(topic)
    if (!set || set.size === 0) continue
    const msg = JSON.stringify({ type: 'insert', topic, table, new: row })
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) { try { ws.send(msg) } catch { /* ignore */ } }
    }
  }
}

/**
 * Publish an insert to ALL instances via Postgres NOTIFY, so realtime works no
 * matter which Cloud Run instance the poster vs. the subscriber landed on. The
 * origin instance receives its own NOTIFY back through its LISTEN connection, so
 * we do NOT also broadcast locally here (that would double-send).
 */
export async function publishInsert(pool, table, row) {
  try {
    const payload = JSON.stringify({ table, row })
    if (payload.length > 7500) {
      // NOTIFY payload cap is 8000 bytes; fall back to a local-only broadcast.
      broadcastLocal(table, row)
      return
    }
    await pool.query('SELECT pg_notify($1, $2)', [PG_CHANNEL, payload])
  } catch {
    broadcastLocal(table, row) // DB NOTIFY failed — at least reach same-instance clients
  }
}

/** Open a dedicated LISTEN connection; re-broadcast NOTIFYs to local clients. */
export async function startPgListener(pool) {
  try {
    const client = await pool.connect()
    client.on('notification', (msg) => {
      if (msg.channel !== PG_CHANNEL || !msg.payload) return
      try {
        const { table, row } = JSON.parse(msg.payload)
        broadcastLocal(table, row)
      } catch { /* ignore */ }
    })
    client.on('error', () => { setTimeout(() => startPgListener(pool), 3000) })
    await client.query(`LISTEN ${PG_CHANNEL}`)
    console.log('[realtime] LISTEN', PG_CHANNEL, 'active (cross-instance fan-out)')
  } catch (e) {
    console.warn('[realtime] LISTEN setup failed, retrying:', e.message)
    setTimeout(() => startPgListener(pool), 5000)
  }
}

/** Attach the ws server to an existing http.Server. */
export function attachRealtime(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' })
  wss.on('connection', (ws) => {
    ws._topics = new Set()
    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
    ws.on('message', (data) => {
      let m
      try { m = JSON.parse(data.toString()) } catch { return }
      if (!m || typeof m !== 'object') return
      if (m.action === 'subscribe' && m.topic) subscribe(ws, m.topic)
      else if (m.action === 'unsubscribe' && m.topic) unsubscribe(ws, m.topic)
      else if (m.action === 'ping') { try { ws.send('{"type":"pong"}') } catch { /* ignore */ } }
    })
    ws.on('close', () => dropClient(ws))
    ws.on('error', () => dropClient(ws))
  })

  // Heartbeat: drop dead sockets so topic sets don't leak.
  const interval = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate() } catch { /* ignore */ }; continue }
      ws.isAlive = false
      try { ws.ping() } catch { /* ignore */ }
    }
  }, 30000)
  wss.on('close', () => clearInterval(interval))
  console.log('[realtime] ws server attached at /ws')
  return wss
}
