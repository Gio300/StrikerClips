/**
 * KillCam realtime client — a single shared WebSocket to the server's /ws,
 * with topic subscriptions. Replaces Supabase Realtime. The `supabase` shim's
 * `.channel()` is built on top of this so existing chat components get live
 * updates with no changes.
 *
 * Topic scheme mirrors the server: `${table}:${keyColumn}:${keyValue}`.
 */
type Handler = (row: any) => void

const handlers = new Map<string, Set<Handler>>() // topic -> handlers
let ws: WebSocket | null = null
let connected = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let backoff = 1000

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${location.host}/ws`
}

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
  try {
    ws = new WebSocket(wsUrl())
  } catch {
    scheduleReconnect()
    return
  }
  ws.onopen = () => {
    connected = true
    backoff = 1000
    // (Re)subscribe to every active topic.
    for (const topic of handlers.keys()) send({ action: 'subscribe', topic })
  }
  ws.onmessage = (ev) => {
    let m: any
    try { m = JSON.parse(ev.data) } catch { return }
    if (m && m.type === 'insert' && m.topic) {
      const set = handlers.get(m.topic)
      if (set) for (const h of set) { try { h(m.new) } catch { /* ignore */ } }
    }
  }
  ws.onclose = () => { connected = false; ws = null; scheduleReconnect() }
  ws.onerror = () => { try { ws?.close() } catch { /* ignore */ } }
}

function scheduleReconnect() {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (handlers.size > 0) connect()
  }, backoff)
  backoff = Math.min(backoff * 2, 15000)
}

function send(obj: unknown) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify(obj)) } catch { /* ignore */ }
  }
}

/** Subscribe a handler to a topic. Returns an unsubscribe fn. */
export function subscribeTopic(topic: string, handler: Handler): () => void {
  if (typeof window === 'undefined') return () => {}
  let set = handlers.get(topic)
  if (!set) { set = new Set(); handlers.set(topic, set) }
  set.add(handler)
  connect()
  if (connected) send({ action: 'subscribe', topic })
  return () => {
    const s = handlers.get(topic)
    if (!s) return
    s.delete(handler)
    if (s.size === 0) {
      handlers.delete(topic)
      send({ action: 'unsubscribe', topic })
    }
  }
}
