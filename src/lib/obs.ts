/**
 * Browser-side OBS Studio integration through obs-websocket v5.
 *
 * OBS owns stream keys, encoding, and recordings. TKO only prepares a browser
 * source for the clean program output and sends explicit control requests.
 */

import OBSWebSocket, { EventSubscription } from 'obs-websocket-js'

export type OBSConnectionConfig = {
  host: string
  port: number
  password: string
}

export type OBSStatus =
  | 'disconnected'
  | 'connecting'
  | 'reconnecting'
  | 'connected'
  | 'error'

export type OBSScene = {
  name: string
  index: number
  isCurrent: boolean
}

export type OBSStreamingState = {
  isStreaming: boolean
  isRecording: boolean
  isRecordingPaused: boolean
  isReconnecting: boolean
  /** Seconds since the stream started. */
  durationSec: number
  /** Last path OBS reported after a successful recording stop. */
  recordingPath: string | null
  /** Output or confirmation error for the most recent recording action. */
  recordingError: string | null
}

export type OBSStreamDestination = {
  configured: boolean
  service: string
}

export type OBSProgramSourceStatus = {
  ready: boolean
  sceneName: string
  sourceName: string
  expectedUrl: string
  actualUrl: string | null
  sourceExists: boolean
  sceneExists: boolean
  attached: boolean
  enabled: boolean
  isCurrent: boolean
  detail: string
}

export type OBSRecordingResult = {
  outputPath: string
}

export type ProgramOutputUrlOptions = {
  origin?: string
  pathname?: string
  baseUrl?: string
  appUrl?: string
  groupId?: string
  layout?: 1 | 4 | 8
}

type OBSClientOptions = {
  reconnectDelaysMs?: readonly number[]
  outputPollIntervalMs?: number
  confirmationTimeoutMs?: number
  confirmationPollIntervalMs?: number
}

type InputEntry = {
  inputName?: string
  inputKind?: string
}

type SceneEntry = {
  sceneName?: string
  sceneIndex?: number
}

type SceneItemEntry = {
  sceneItemEnabled?: boolean
  sceneItemId?: number
  sourceName?: string
}

const STORAGE_KEY = 'tko.obs.config'
const LEGACY_STORAGE_KEY = 'clutchlens.obs.config'

export const TKO_PROGRAM_SCENE = 'TKO Program'
export const TKO_PROGRAM_SOURCE = 'TKO Program Output'

const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000, 15_000] as const

const INITIAL_STREAM_STATE: OBSStreamingState = {
  isStreaming: false,
  isRecording: false,
  isRecordingPaused: false,
  isReconnecting: false,
  durationSec: 0,
  recordingPath: null,
  recordingError: null,
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed === '/') return '/'
  const pathname = (() => {
    try {
      return new URL(trimmed, 'https://tko.invalid').pathname
    } catch {
      return trimmed
    }
  })()
  return `/${pathname.replace(/^\/+|\/+$/g, '')}/`
}

function runtimeLocation(): { origin: string; pathname: string } | null {
  if (typeof window === 'undefined') return null
  return { origin: window.location.origin, pathname: window.location.pathname }
}

/**
 * Build the absolute browser-source URL for both root builds and hosted
 * `/app/` builds. The runtime pathname is a fallback for misconfigured builds
 * that are mounted under `/app` while Vite still reports `/`.
 */
export function buildProgramOutputUrl(options: ProgramOutputUrlOptions = {}): string {
  const runtime = runtimeLocation()
  const configuredAppUrl = options.appUrl ?? import.meta.env.VITE_APP_URL ?? ''
  const configured = configuredAppUrl
    ? new URL(configuredAppUrl, options.origin ?? runtime?.origin ?? 'https://tko.cam')
    : null

  const runtimeOrigin = options.origin ?? runtime?.origin ?? ''
  const originIsHttp = /^https?:\/\//i.test(runtimeOrigin)
  const origin = originIsHttp
    ? runtimeOrigin
    : configured?.origin ?? 'https://tko.cam'
  const pathname = options.pathname ?? runtime?.pathname ?? configured?.pathname ?? '/'

  let basePath = normalizeBasePath(options.baseUrl ?? import.meta.env.BASE_URL ?? '/')
  if (basePath === '/' && /^\/app(?:\/|$)/.test(pathname)) {
    basePath = '/app/'
  } else if (
    basePath === '/' &&
    !originIsHttp &&
    configured &&
    configured.pathname !== '/'
  ) {
    basePath = normalizeBasePath(configured.pathname)
  }

  const group = options.groupId ? `/${encodeURIComponent(options.groupId)}` : ''
  const url = new URL(`${basePath}program${group}`, `${origin.replace(/\/+$/, '')}/`)
  if (options.layout) url.searchParams.set('layout', String(options.layout))
  return url.toString()
}

export function loadConfig(): OBSConnectionConfig {
  const fallback = { host: 'localhost', port: 4455, password: '' }
  if (typeof localStorage === 'undefined') return fallback
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as Partial<OBSConnectionConfig>
    const config = {
      host: typeof parsed.host === 'string' && parsed.host.trim()
        ? parsed.host.trim()
        : fallback.host,
      port: Number.isInteger(parsed.port) && Number(parsed.port) > 0
        ? Number(parsed.port)
        : fallback.port,
      password: typeof parsed.password === 'string' ? parsed.password : '',
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    return config
  } catch {
    return fallback
  }
}

export function saveConfig(cfg: OBSConnectionConfig): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function clearConfig(): void {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

function websocketUrl(cfg: OBSConnectionConfig): string {
  const host = cfg.host.trim()
  if (!host) throw new Error('OBS host is required.')
  if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65_535) {
    throw new Error('OBS WebSocket port must be between 1 and 65535.')
  }

  let parsed: URL
  try {
    parsed = new URL(/^wss?:\/\//i.test(host) ? host : `ws://${host}`)
  } catch {
    throw new Error('OBS host is invalid.')
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('OBS host must not include a path, query, or fragment.')
  }
  parsed.port = String(cfg.port)
  return parsed.toString().replace(/\/$/, '')
}

function canonicalHttpUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('TKO program URL must be an absolute URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('TKO program URL must use HTTP or HTTPS.')
  }
  url.hash = ''
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
  url.searchParams.sort()
  return url.toString()
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Stateful OBS client. A connection is only marked ready after OBS answers
 * version, scene, stream, and recording probes.
 */
export class OBSClient {
  private listeners = new Set<(status: OBSStatus) => void>()
  private streamListeners = new Set<(state: OBSStreamingState) => void>()
  private status: OBSStatus = 'disconnected'
  private streamState: OBSStreamingState = { ...INITIAL_STREAM_STATE }
  private desiredConfig: OBSConnectionConfig | null = null
  private shouldReconnect = false
  private connectPromise: Promise<void> | null = null
  private reconnectHandle: ReturnType<typeof setTimeout> | null = null
  private outputPollHandle: ReturnType<typeof setInterval> | null = null
  private reconnectAttempt = 0
  private pollFailures = 0
  private readonly reconnectDelaysMs: readonly number[]
  private readonly outputPollIntervalMs: number
  private readonly confirmationTimeoutMs: number
  private readonly confirmationPollIntervalMs: number

  constructor(
    private readonly ws: OBSWebSocket = new OBSWebSocket(),
    options: OBSClientOptions = {},
  ) {
    this.reconnectDelaysMs =
      options.reconnectDelaysMs?.length
        ? options.reconnectDelaysMs
        : DEFAULT_RECONNECT_DELAYS_MS
    this.outputPollIntervalMs = options.outputPollIntervalMs ?? 2_000
    this.confirmationTimeoutMs = options.confirmationTimeoutMs ?? 5_000
    this.confirmationPollIntervalMs = options.confirmationPollIntervalMs ?? 200

    this.ws.on('ConnectionClosed', (error) => this.handleConnectionLoss(error))
    this.ws.on('ConnectionError', (error) => this.handleConnectionLoss(error))
    this.ws.on('StreamStateChanged', (event) => {
      this.streamState = {
        ...this.streamState,
        isStreaming: event.outputActive,
        isReconnecting: event.outputState === 'OBS_WEBSOCKET_OUTPUT_RECONNECTING',
      }
      this.emitStream()
    })
    this.ws.on('RecordStateChanged', (event) => {
      const outputPath =
        typeof event.outputPath === 'string' && event.outputPath.trim()
          ? event.outputPath.trim()
          : null
      const outputError = /_ERROR$/i.test(event.outputState)
        ? `OBS reported a recording output error (${event.outputState}).`
        : null
      this.streamState = {
        ...this.streamState,
        isRecording: event.outputActive,
        isRecordingPaused: /_PAUSED$/i.test(event.outputState),
        recordingPath: outputPath ?? this.streamState.recordingPath,
        recordingError: outputError,
      }
      this.emitStream()
    })
  }

  onStatus(fn: (status: OBSStatus) => void): () => void {
    this.listeners.add(fn)
    fn(this.status)
    return () => this.listeners.delete(fn)
  }

  onStream(fn: (state: OBSStreamingState) => void): () => void {
    this.streamListeners.add(fn)
    fn(this.streamState)
    return () => this.streamListeners.delete(fn)
  }

  getStatus(): OBSStatus {
    return this.status
  }

  getStreamState(): OBSStreamingState {
    return this.streamState
  }

  async connect(cfg: OBSConnectionConfig): Promise<void> {
    const normalized = {
      host: cfg.host.trim(),
      port: cfg.port,
      password: cfg.password,
    }
    websocketUrl(normalized)

    this.shouldReconnect = false
    this.clearReconnectTimer()
    if (this.status !== 'disconnected') {
      this.stopOutputPoller()
      try {
        await this.ws.disconnect()
      } catch {
        // The old socket may already be gone.
      }
    }

    this.desiredConfig = normalized
    this.shouldReconnect = true
    this.reconnectAttempt = 0
    try {
      await this.openConnection(normalized, false)
    } catch (error) {
      this.setStatus('error')
      this.scheduleReconnect()
      throw error
    }
  }

  async disconnect(): Promise<void> {
    this.shouldReconnect = false
    this.desiredConfig = null
    this.clearReconnectTimer()
    this.stopOutputPoller()
    try {
      await this.ws.disconnect()
    } catch {
      // Disconnect is idempotent from the UI's perspective.
    }
    this.streamState = {
      ...this.streamState,
      isStreaming: false,
      isRecording: false,
      isRecordingPaused: false,
      isReconnecting: false,
      durationSec: 0,
    }
    this.emitStream()
    this.setStatus('disconnected')
  }

  async listScenes(): Promise<OBSScene[]> {
    this.requireReady()
    const output = await this.ws.call('GetSceneList')
    const current = output.currentProgramSceneName
    return (output.scenes as unknown as SceneEntry[]).map((scene, index) => ({
      name: scene.sceneName ?? `scene-${index}`,
      index: typeof scene.sceneIndex === 'number' ? scene.sceneIndex : index,
      isCurrent: scene.sceneName === current,
    }))
  }

  async setCurrentScene(name: string): Promise<void> {
    this.requireReady()
    await this.ws.call('SetCurrentProgramScene', { sceneName: name })
  }

  async getStreamDestination(): Promise<OBSStreamDestination> {
    this.requireReady()
    const output = await this.ws.call('GetStreamServiceSettings')
    const settings = output.streamServiceSettings as {
      key?: unknown
      service?: unknown
    }
    const service =
      (typeof settings?.service === 'string' && settings.service.trim()) ||
      (typeof output.streamServiceType === 'string' && output.streamServiceType.trim()) ||
      'Custom destination'
    return {
      configured: typeof settings?.key === 'string' && settings.key.trim().length > 0,
      service,
    }
  }

  async getProgramSourceStatus(programUrl: string): Promise<OBSProgramSourceStatus> {
    this.requireReady()
    const expectedUrl = canonicalHttpUrl(programUrl)
    const [inputList, sceneList] = await Promise.all([
      this.ws.call('GetInputList', { inputKind: 'browser_source' }),
      this.ws.call('GetSceneList'),
    ])
    const inputs = inputList.inputs as unknown as InputEntry[]
    const scenes = sceneList.scenes as unknown as SceneEntry[]
    const sourceExists = inputs.some((input) => input.inputName === TKO_PROGRAM_SOURCE)
    const sceneExists = scenes.some((scene) => scene.sceneName === TKO_PROGRAM_SCENE)

    let actualUrl: string | null = null
    let attached = false
    let enabled = false
    if (sourceExists) {
      const settings = await this.ws.call('GetInputSettings', {
        inputName: TKO_PROGRAM_SOURCE,
      })
      const rawUrl = settings.inputSettings.url
      if (typeof rawUrl === 'string' && rawUrl.trim()) {
        try {
          actualUrl = canonicalHttpUrl(rawUrl)
        } catch {
          actualUrl = rawUrl
        }
      }
    }
    if (sceneExists) {
      const itemList = await this.ws.call('GetSceneItemList', {
        sceneName: TKO_PROGRAM_SCENE,
      })
      const item = (itemList.sceneItems as unknown as SceneItemEntry[])
        .find((entry) => entry.sourceName === TKO_PROGRAM_SOURCE)
      attached = Boolean(item)
      enabled = item?.sceneItemEnabled !== false && Boolean(item)
    }

    const isCurrent = sceneList.currentProgramSceneName === TKO_PROGRAM_SCENE
    const ready =
      sourceExists &&
      sceneExists &&
      attached &&
      enabled &&
      isCurrent &&
      actualUrl === expectedUrl

    return {
      ready,
      sceneName: TKO_PROGRAM_SCENE,
      sourceName: TKO_PROGRAM_SOURCE,
      expectedUrl,
      actualUrl,
      sourceExists,
      sceneExists,
      attached,
      enabled,
      isCurrent,
      detail: programSourceDetail({
        sourceExists,
        sceneExists,
        attached,
        enabled,
        isCurrent,
        urlMatches: actualUrl === expectedUrl,
      }),
    }
  }

  /**
   * Create or repair one dedicated scene and browser source, then verify every
   * relevant setting OBS reports back before returning success.
   */
  async ensureProgramSource(programUrl: string): Promise<OBSProgramSourceStatus> {
    this.requireReady()
    const expectedUrl = canonicalHttpUrl(programUrl)
    const [inputList, sceneList, videoSettings] = await Promise.all([
      this.ws.call('GetInputList'),
      this.ws.call('GetSceneList'),
      this.ws.call('GetVideoSettings'),
    ])
    const inputs = inputList.inputs as unknown as InputEntry[]
    const scenes = sceneList.scenes as unknown as SceneEntry[]
    const existingInput = inputs.find((input) => input.inputName === TKO_PROGRAM_SOURCE)
    const sceneExists = scenes.some((scene) => scene.sceneName === TKO_PROGRAM_SCENE)

    if (existingInput && existingInput.inputKind !== 'browser_source') {
      throw new Error(
        `"${TKO_PROGRAM_SOURCE}" already exists in OBS but is not a browser source. ` +
        'Rename or remove it, then try again.',
      )
    }
    if (!sceneExists) {
      await this.ws.call('CreateScene', { sceneName: TKO_PROGRAM_SCENE })
    }

    const inputSettings = {
      url: expectedUrl,
      width: videoSettings.baseWidth,
      height: videoSettings.baseHeight,
      reroute_audio: true,
      shutdown: false,
    }
    if (!existingInput) {
      await this.ws.call('CreateInput', {
        sceneName: TKO_PROGRAM_SCENE,
        inputName: TKO_PROGRAM_SOURCE,
        inputKind: 'browser_source',
        inputSettings,
        sceneItemEnabled: true,
      })
    } else {
      await this.ws.call('SetInputSettings', {
        inputName: TKO_PROGRAM_SOURCE,
        inputSettings,
        overlay: true,
      })
      const itemList = await this.ws.call('GetSceneItemList', {
        sceneName: TKO_PROGRAM_SCENE,
      })
      const item = (itemList.sceneItems as unknown as SceneItemEntry[])
        .find((entry) => entry.sourceName === TKO_PROGRAM_SOURCE)
      if (!item) {
        await this.ws.call('CreateSceneItem', {
          sceneName: TKO_PROGRAM_SCENE,
          sourceName: TKO_PROGRAM_SOURCE,
          sceneItemEnabled: true,
        })
      } else if (item.sceneItemEnabled === false && typeof item.sceneItemId === 'number') {
        await this.ws.call('SetSceneItemEnabled', {
          sceneName: TKO_PROGRAM_SCENE,
          sceneItemId: item.sceneItemId,
          sceneItemEnabled: true,
        })
      }
    }

    await this.ws.call('SetCurrentProgramScene', { sceneName: TKO_PROGRAM_SCENE })
    const verified = await this.getProgramSourceStatus(expectedUrl)
    if (!verified.ready) {
      throw new Error(`OBS did not verify the TKO program source: ${verified.detail}`)
    }
    return verified
  }

  async startStreaming(): Promise<void> {
    this.requireReady()
    const current = await this.ws.call('GetStreamStatus')
    if (current.outputActive) throw new Error('OBS is already streaming.')
    await this.ws.call('StartStream')
    await this.waitForOutputState('stream', true)
  }

  async stopStreaming(): Promise<void> {
    this.requireReady()
    const current = await this.ws.call('GetStreamStatus')
    if (!current.outputActive) throw new Error('OBS is not currently streaming.')
    await this.ws.call('StopStream')
    await this.waitForOutputState('stream', false)
  }

  async startRecording(): Promise<void> {
    this.requireReady()
    const current = await this.ws.call('GetRecordStatus')
    if (current.outputActive) throw new Error('OBS is already recording.')
    this.setRecordingError(null)
    try {
      await this.ws.call('StartRecord')
      await this.waitForOutputState('record', true)
    } catch (error) {
      const message = `OBS could not confirm recording started: ${messageOf(error)}`
      this.setRecordingError(message)
      throw new Error(message)
    }
  }

  async stopRecording(): Promise<OBSRecordingResult> {
    this.requireReady()
    const current = await this.ws.call('GetRecordStatus')
    if (!current.outputActive) throw new Error('OBS is not currently recording.')
    this.setRecordingError(null)
    try {
      const stopped = await this.ws.call('StopRecord')
      await this.waitForOutputState('record', false)
      const outputPath =
        (typeof stopped.outputPath === 'string' && stopped.outputPath.trim()) ||
        this.streamState.recordingPath
      if (!outputPath) {
        throw new Error('OBS stopped recording but did not report a saved file path.')
      }
      this.streamState = {
        ...this.streamState,
        isRecording: false,
        recordingPath: outputPath,
        recordingError: null,
      }
      this.emitStream()
      return { outputPath }
    } catch (error) {
      const message = `OBS could not confirm recording stopped: ${messageOf(error)}`
      this.setRecordingError(message)
      throw new Error(message)
    }
  }

  private async openConnection(
    cfg: OBSConnectionConfig,
    reconnecting: boolean,
  ): Promise<void> {
    if (this.connectPromise) return this.connectPromise
    const run = async () => {
      this.setStatus(reconnecting ? 'reconnecting' : 'connecting')
      const subscriptions = (
        EventSubscription.General |
        EventSubscription.Scenes |
        EventSubscription.Inputs |
        EventSubscription.Outputs |
        EventSubscription.SceneItems
      )
      let socketOpened = false
      try {
        await this.ws.connect(websocketUrl(cfg), cfg.password || undefined, {
          eventSubscriptions: subscriptions,
        })
        socketOpened = true
        await this.refreshOutputState(true)
        await Promise.all([
          this.ws.call('GetVersion'),
          this.ws.call('GetSceneList'),
        ])

        this.reconnectAttempt = 0
        this.pollFailures = 0
        this.clearReconnectTimer()
        this.setStatus('connected')
        saveConfig(cfg)
        this.startOutputPoller()
      } catch (error) {
        if (socketOpened) {
          try {
            await this.ws.disconnect()
          } catch {
            // A failed readiness probe often means the socket is already gone.
          }
        }
        throw error
      }
    }
    this.connectPromise = run().finally(() => {
      this.connectPromise = null
    })
    return this.connectPromise
  }

  private handleConnectionLoss(error: unknown): void {
    this.stopOutputPoller()
    const wasRecording = this.streamState.isRecording
    this.streamState = {
      ...this.streamState,
      isStreaming: false,
      isRecording: false,
      isRecordingPaused: false,
      isReconnecting: false,
      durationSec: 0,
      recordingError: wasRecording
        ? `OBS connection was lost while recording: ${messageOf(error)}`
        : this.streamState.recordingError,
    }
    this.emitStream()
    if (!this.shouldReconnect || !this.desiredConfig) {
      this.setStatus('disconnected')
      return
    }
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || !this.desiredConfig) return
    this.setStatus('reconnecting')
    if (this.reconnectHandle) return
    const index = Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)
    const delay = this.reconnectDelaysMs[index]
    this.reconnectAttempt += 1
    this.reconnectHandle = globalThis.setTimeout(() => {
      this.reconnectHandle = null
      const cfg = this.desiredConfig
      if (!cfg || !this.shouldReconnect) return
      void this.openConnection(cfg, true).catch(() => this.scheduleReconnect())
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectHandle) return
    globalThis.clearTimeout(this.reconnectHandle)
    this.reconnectHandle = null
  }

  private async refreshOutputState(initial = false): Promise<void> {
    const [stream, recording] = await Promise.all([
      this.ws.call('GetStreamStatus'),
      this.ws.call('GetRecordStatus'),
    ])
    this.streamState = {
      ...this.streamState,
      isStreaming: stream.outputActive,
      isReconnecting: stream.outputReconnecting,
      isRecording: recording.outputActive,
      isRecordingPaused: recording.outputPaused,
      durationSec: Math.round((stream.outputDuration ?? 0) / 1_000),
      recordingError: initial ? null : this.streamState.recordingError,
    }
    this.emitStream()
  }

  private startOutputPoller(): void {
    this.stopOutputPoller()
    this.outputPollHandle = globalThis.setInterval(() => {
      if (this.status !== 'connected') return
      void this.refreshOutputState()
        .then(() => {
          this.pollFailures = 0
        })
        .catch((error) => {
          this.pollFailures += 1
          if (this.pollFailures < 3) return
          this.handleConnectionLoss(error)
          void this.ws.disconnect().catch(() => undefined)
        })
    }, this.outputPollIntervalMs)
  }

  private stopOutputPoller(): void {
    if (!this.outputPollHandle) return
    globalThis.clearInterval(this.outputPollHandle)
    this.outputPollHandle = null
  }

  private async waitForOutputState(
    output: 'stream' | 'record',
    active: boolean,
  ): Promise<void> {
    const deadline = Date.now() + this.confirmationTimeoutMs
    let lastError: unknown = null
    while (Date.now() <= deadline) {
      try {
        if (output === 'stream') {
          const state = await this.ws.call('GetStreamStatus')
          if (state.outputActive === active) {
            await this.refreshOutputState()
            return
          }
        } else {
          const state = await this.ws.call('GetRecordStatus')
          if (state.outputActive === active) {
            await this.refreshOutputState()
            return
          }
        }
      } catch (error) {
        lastError = error
      }
      await new Promise((resolve) => {
        globalThis.setTimeout(resolve, this.confirmationPollIntervalMs)
      })
    }
    const suffix = lastError ? ` Last OBS error: ${messageOf(lastError)}` : ''
    throw new Error(
      `Timed out waiting for ${output} output to become ${active ? 'active' : 'inactive'}.${suffix}`,
    )
  }

  private requireReady(): void {
    if (this.status !== 'connected') {
      throw new Error('OBS is not ready. Wait for the WebSocket connection to recover.')
    }
  }

  private setRecordingError(recordingError: string | null): void {
    this.streamState = { ...this.streamState, recordingError }
    this.emitStream()
  }

  private setStatus(status: OBSStatus): void {
    if (this.status === status) return
    this.status = status
    for (const listener of this.listeners) listener(status)
  }

  private emitStream(): void {
    for (const listener of this.streamListeners) listener(this.streamState)
  }
}

function programSourceDetail(checks: {
  sourceExists: boolean
  sceneExists: boolean
  attached: boolean
  enabled: boolean
  isCurrent: boolean
  urlMatches: boolean
}): string {
  if (!checks.sourceExists) return 'TKO browser source has not been created.'
  if (!checks.sceneExists) return 'TKO program scene has not been created.'
  if (!checks.attached) return 'TKO browser source is not attached to the program scene.'
  if (!checks.enabled) return 'TKO browser source is disabled.'
  if (!checks.urlMatches) return 'TKO browser source URL does not match this program output.'
  if (!checks.isCurrent) return 'TKO program scene is not currently on program.'
  return 'Verified browser source is on program.'
}

let singleton: OBSClient | null = null

export function getOBS(): OBSClient {
  if (!singleton) singleton = new OBSClient()
  return singleton
}

/** Format seconds as HH:MM:SS, or MM:SS below one hour. */
export function formatStreamDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safeSeconds / 3_600)
  const minutes = Math.floor((safeSeconds % 3_600) / 60)
  const remainder = safeSeconds % 60
  const pad = (value: number) => value.toString().padStart(2, '0')
  return hours > 0
    ? `${pad(hours)}:${pad(minutes)}:${pad(remainder)}`
    : `${pad(minutes)}:${pad(remainder)}`
}
