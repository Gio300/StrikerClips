/**
 * OBS Studio integration via the built-in obs-websocket plugin.
 *
 * How this works (zero infra, $0/mo):
 *   1. The user runs OBS Studio locally (free; ships with WebSocket plugin
 *      since v28 — no extra install).
 *   2. They enable the WebSocket server in OBS (Tools → WebSocket Server
 *      Settings → Enable, set a password).
 *   3. Our app connects from the browser to ws://localhost:4455 with the
 *      password. Everything runs on their machine.
 *   4. They configure their YouTube/Twitch stream keys inside OBS
 *      (Settings → Stream). We never see the keys.
 *   5. Our UI sends scene-change / source-toggle / start-stream commands.
 *
 * Notes:
 *   - obs-websocket-js v5 ships ESM only and works in modern browsers.
 *   - We persist host/port/password in localStorage scoped to this origin.
 *   - On a hard refresh the connection drops; the UI re-prompts to reconnect.
 *   - This integration is web-app friendly. The Tauri desktop build can
 *     additionally LAUNCH OBS for the user via a sidecar — that's a
 *     desktop-only enhancement we add later.
 */

import OBSWebSocket, { type EventSubscription } from 'obs-websocket-js'

export type OBSConnectionConfig = {
  host: string
  port: number
  password: string
}

export type OBSStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export type OBSScene = {
  name: string
  index: number
  isCurrent: boolean
}

export type OBSStreamingState = {
  isStreaming: boolean
  isRecording: boolean
  isReconnecting: boolean
  /** Seconds since stream started. */
  durationSec: number
}

const STORAGE_KEY = 'clutchlens.obs.config'

export function loadConfig(): OBSConnectionConfig {
  if (typeof localStorage === 'undefined') return { host: 'localhost', port: 4455, password: '' }
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return { host: 'localhost', port: 4455, password: '' }
  try {
    const parsed = JSON.parse(raw) as Partial<OBSConnectionConfig>
    return {
      host: parsed.host || 'localhost',
      port: parsed.port || 4455,
      password: parsed.password || '',
    }
  } catch {
    return { host: 'localhost', port: 4455, password: '' }
  }
}

export function saveConfig(cfg: OBSConnectionConfig): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

export function clearConfig(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * Thin wrapper around obs-websocket-js with the few methods our UI needs.
 * Singleton because OBS only allows one WebSocket connection at a time.
 */
export class OBSClient {
  private ws = new OBSWebSocket()
  private listeners = new Set<(s: OBSStatus) => void>()
  private streamListeners = new Set<(s: OBSStreamingState) => void>()
  private status: OBSStatus = 'disconnected'
  private streamState: OBSStreamingState = {
    isStreaming: false,
    isRecording: false,
    isReconnecting: false,
    durationSec: 0,
  }
  private streamTickHandle: number | null = null

  constructor() {
    this.ws.on('ConnectionClosed', () => this.setStatus('disconnected'))
    this.ws.on('ConnectionError', () => this.setStatus('error'))
    this.ws.on('StreamStateChanged', (e) => {
      this.streamState = {
        ...this.streamState,
        isStreaming: e.outputActive,
        isReconnecting: e.outputState === 'OBS_WEBSOCKET_OUTPUT_RECONNECTING',
      }
      this.emitStream()
    })
    this.ws.on('RecordStateChanged', (e) => {
      this.streamState = { ...this.streamState, isRecording: e.outputActive }
      this.emitStream()
    })
  }

  onStatus(fn: (s: OBSStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => this.listeners.delete(fn)
  }

  onStream(fn: (s: OBSStreamingState) => void): () => void {
    this.streamListeners.add(fn)
    fn(this.streamState)
    return () => this.streamListeners.delete(fn)
  }

  getStatus(): OBSStatus { return this.status }
  getStreamState(): OBSStreamingState { return this.streamState }

  async connect(cfg: OBSConnectionConfig): Promise<void> {
    if (this.status === 'connecting' || this.status === 'connected') {
      await this.disconnect()
    }
    this.setStatus('connecting')
    const url = `ws://${cfg.host}:${cfg.port}`
    try {
      // eventSubscriptions: subscribe to everything we listen to so events
      // flow without us calling extra setup endpoints.
      const subs: EventSubscription = (1 | 2 | 4 | 8 | 16 | 32 | 64 | 128) as EventSubscription
      await this.ws.connect(url, cfg.password || undefined, { eventSubscriptions: subs })
      this.setStatus('connected')
      saveConfig(cfg)
      // Pull initial stream state.
      try {
        const s = await this.ws.call('GetStreamStatus')
        const r = await this.ws.call('GetRecordStatus')
        this.streamState = {
          isStreaming: s.outputActive,
          isReconnecting: s.outputReconnecting,
          isRecording: r.outputActive,
          durationSec: Math.round((s.outputDuration ?? 0) / 1000),
        }
        this.emitStream()
        this.startStreamTicker()
      } catch {
        /* OBS may not have these endpoints if super-old; ignore. */
      }
    } catch (err) {
      this.setStatus('error')
      throw err
    }
  }

  async disconnect(): Promise<void> {
    this.stopStreamTicker()
    try { await this.ws.disconnect() } catch { /* ignore */ }
    this.setStatus('disconnected')
  }

  // ── Scenes ──────────────────────────────────────────────────────────

  async listScenes(): Promise<OBSScene[]> {
    const out = await this.ws.call('GetSceneList')
    const current = out.currentProgramSceneName
    type SceneEntry = { sceneName?: string; sceneIndex?: number; sceneUuid?: string }
    return (out.scenes as unknown as SceneEntry[]).map((s, idx) => ({
      name: s.sceneName ?? `scene-${idx}`,
      index: typeof s.sceneIndex === 'number' ? s.sceneIndex : idx,
      isCurrent: s.sceneName === current,
    }))
  }

  async setCurrentScene(name: string): Promise<void> {
    await this.ws.call('SetCurrentProgramScene', { sceneName: name })
  }

  // ── Streaming ───────────────────────────────────────────────────────

  async startStreaming(): Promise<void> {
    await this.ws.call('StartStream')
  }

  async stopStreaming(): Promise<void> {
    await this.ws.call('StopStream')
  }

  async startRecording(): Promise<void> {
    await this.ws.call('StartRecord')
  }

  async stopRecording(): Promise<void> {
    await this.ws.call('StopRecord')
  }

  // ── Internal ────────────────────────────────────────────────────────

  private setStatus(s: OBSStatus) {
    this.status = s
    for (const fn of this.listeners) fn(s)
  }

  private emitStream() {
    for (const fn of this.streamListeners) fn(this.streamState)
  }

  private startStreamTicker() {
    this.stopStreamTicker()
    this.streamTickHandle = window.setInterval(async () => {
      if (this.status !== 'connected') return
      try {
        const s = await this.ws.call('GetStreamStatus')
        this.streamState = {
          ...this.streamState,
          isStreaming: s.outputActive,
          isReconnecting: s.outputReconnecting,
          durationSec: Math.round((s.outputDuration ?? 0) / 1000),
        }
        this.emitStream()
      } catch {
        /* ignore intermittent calls */
      }
    }, 2000)
  }

  private stopStreamTicker() {
    if (this.streamTickHandle != null) {
      window.clearInterval(this.streamTickHandle)
      this.streamTickHandle = null
    }
  }
}

let singleton: OBSClient | null = null
export function getOBS(): OBSClient {
  if (!singleton) singleton = new OBSClient()
  return singleton
}

/** Format seconds → "HH:MM:SS" or "MM:SS" if <1h. Used in the streaming HUD. */
export function formatStreamDuration(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`
}
