import { useEffect, useState } from 'react'
import {
  getOBS,
  loadConfig,
  saveConfig,
  formatStreamDuration,
  type OBSConnectionConfig,
  type OBSScene,
  type OBSStatus,
  type OBSStreamingState,
} from '@/lib/obs'
import { Soundboard } from '@/components/Soundboard'

/**
 * OBSPanel — connect to a locally-running OBS Studio (free), drive scenes
 * and streaming from the ClutchLens UI. Each user streams to their own
 * YouTube/Twitch keys configured inside OBS — we never see them, and we
 * pay $0 for streaming infra.
 *
 * Workflow:
 *   1. Install OBS Studio (free).
 *   2. Tools → WebSocket Server Settings → Enable → set a password.
 *   3. Settings → Stream → enter your YouTube / Twitch stream key.
 *   4. Connect from this panel; pick a scene; press "Go live".
 */
export function OBSPanel() {
  const obs = getOBS()
  const [cfg, setCfg] = useState<OBSConnectionConfig>(loadConfig())
  const [status, setStatus] = useState<OBSStatus>(obs.getStatus())
  const [error, setError] = useState('')
  const [scenes, setScenes] = useState<OBSScene[]>([])
  const [stream, setStream] = useState<OBSStreamingState>(obs.getStreamState())
  const [busy, setBusy] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    const unS = obs.onStatus(setStatus)
    const unR = obs.onStream(setStream)
    return () => { unS(); unR() }
  }, [obs])

  useEffect(() => {
    if (status !== 'connected') return
    let cancelled = false
    obs.listScenes()
      .then((s) => { if (!cancelled) setScenes(s) })
      .catch((err) => { if (!cancelled) setError(String(err?.message ?? err)) })
    return () => { cancelled = true }
  }, [status, obs])

  async function handleConnect() {
    setError('')
    setBusy(true)
    try {
      saveConfig(cfg)
      await obs.connect(cfg)
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleDisconnect() {
    setBusy(true)
    try { await obs.disconnect() } finally { setBusy(false) }
  }

  async function handleSwitch(name: string) {
    setError('')
    try { await obs.setCurrentScene(name) } catch (err) { setError(humanizeError(err)) }
    try {
      const fresh = await obs.listScenes()
      setScenes(fresh)
    } catch { /* ignore */ }
  }

  async function handleStream(action: 'start' | 'stop') {
    setError('')
    setBusy(true)
    try {
      if (action === 'start') await obs.startStreaming()
      else await obs.stopStreaming()
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleRecord(action: 'start' | 'stop') {
    setError('')
    setBusy(true)
    try {
      if (action === 'start') await obs.startRecording()
      else await obs.stopRecording()
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  const isConnected = status === 'connected'

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 mb-6">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="font-semibold text-lg">Live broadcast — OBS Studio</h2>
        <StatusBadge status={status} />
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Stream to YouTube / Twitch through your local OBS — your keys, your machine, $0 from us.
        We control scenes and start/stop; OBS handles the encoding and ingest.
        {' '}
        <button
          type="button"
          onClick={() => setShowHelp((v) => !v)}
          className="text-accent hover:underline"
        >
          {showHelp ? 'Hide setup' : 'Setup help'}
        </button>
      </p>

      {showHelp && (
        <div className="mb-4 rounded-lg border border-accent/30 bg-accent/5 p-4 text-sm text-gray-300 space-y-2">
          <p>
            <strong>1.</strong> Download OBS Studio (v28+):{' '}
            <a href="https://obsproject.com/" target="_blank" rel="noopener" className="text-accent hover:underline">
              obsproject.com
            </a>
          </p>
          <p>
            <strong>2.</strong> In OBS: <code className="text-accent">Tools → WebSocket Server Settings</code> → enable, set a password, leave the port at <code className="text-accent">4455</code>.
          </p>
          <p>
            <strong>3.</strong> In OBS: <code className="text-accent">Settings → Stream</code> → pick YouTube or Twitch, paste your stream key (one-time).
          </p>
          <p>
            <strong>4.</strong> Build your scenes (Game capture, Camera, Squad scene, etc.). The names you set show up in this panel.
          </p>
          <p>
            <strong>5.</strong> Press Connect below. Switch scenes from the buttons. Hit "Go live" when you're ready.
          </p>
        </div>
      )}

      {/* Connect form */}
      {!isConnected && (
        <form
          onSubmit={(e) => { e.preventDefault(); handleConnect() }}
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4"
        >
          <label className="block">
            <span className="text-xs text-gray-400">Host</span>
            <input
              type="text"
              value={cfg.host}
              onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm font-mono"
              placeholder="localhost"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Port</span>
            <input
              type="number"
              value={cfg.port}
              onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) || 4455 })}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm font-mono"
              placeholder="4455"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Password</span>
            <div className="mt-1 flex gap-1">
              <input
                type={showPwd ? 'text' : 'password'}
                value={cfg.password}
                onChange={(e) => setCfg({ ...cfg, password: e.target.value })}
                className="flex-1 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm font-mono"
                placeholder="WebSocket password"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="px-2 rounded border border-dark-border text-gray-300 text-xs hover:border-accent/50"
              >
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          <div className="sm:col-span-3 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 rounded bg-accent text-dark text-sm font-semibold disabled:opacity-40"
            >
              {busy && status === 'connecting' ? 'Connecting…' : 'Connect to OBS'}
            </button>
            {error && <span className="text-kunai text-xs self-center">{error}</span>}
          </div>
        </form>
      )}

      {/* Connected controls */}
      {isConnected && (
        <div className="space-y-4">
          {/* Stream + record bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dark-border p-3 bg-dark/40">
            <button
              type="button"
              onClick={() => stream.isStreaming ? handleStream('stop') : handleStream('start')}
              disabled={busy}
              className={`px-4 py-2 rounded text-sm font-semibold transition-colors disabled:opacity-40 ${
                stream.isStreaming
                  ? 'bg-kunai text-white hover:bg-kunai-dark'
                  : 'bg-accent text-dark hover:bg-accent-muted'
              }`}
            >
              {stream.isStreaming ? '■ Stop stream' : '● Go live'}
            </button>
            <button
              type="button"
              onClick={() => stream.isRecording ? handleRecord('stop') : handleRecord('start')}
              disabled={busy}
              className="px-3 py-2 rounded border border-dark-border text-gray-200 text-sm hover:border-accent/50 hover:text-accent disabled:opacity-40"
            >
              {stream.isRecording ? 'Stop recording' : 'Record'}
            </button>
            {stream.isStreaming && (
              <div className="ml-auto flex items-center gap-2 text-sm">
                <span className="inline-flex items-center gap-1 text-kunai font-medium">
                  <span className="inline-block w-2 h-2 rounded-full bg-kunai animate-pulse" />
                  LIVE
                </span>
                <span className="text-gray-300 font-mono">{formatStreamDuration(stream.durationSec)}</span>
                {stream.isReconnecting && (
                  <span className="text-chakra text-xs">reconnecting…</span>
                )}
              </div>
            )}
          </div>

          {/* Scenes grid */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="font-medium text-sm">Scenes</h3>
              <span className="text-xs text-gray-500">{scenes.length} configured in OBS</span>
            </div>
            {scenes.length === 0 ? (
              <p className="text-xs text-gray-500">
                No scenes yet — create them in OBS, they'll show up here.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {scenes.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    onClick={() => handleSwitch(s.name)}
                    className={`px-3 py-2 rounded text-sm text-left transition-colors ${
                      s.isCurrent
                        ? 'bg-accent/15 border border-accent text-accent shadow-glow'
                        : 'bg-dark border border-dark-border text-gray-200 hover:border-accent/50 hover:text-accent'
                    }`}
                  >
                    <div className="text-xs text-gray-500 mb-0.5">
                      {s.isCurrent ? 'On air' : `Scene ${s.index + 1}`}
                    </div>
                    <div className="font-medium truncate">{s.name}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleDisconnect}
              className="px-3 py-1.5 rounded border border-dark-border text-gray-400 text-xs hover:border-kunai/40 hover:text-kunai"
            >
              Disconnect
            </button>
          </div>

          {error && <p className="text-kunai text-xs">{error}</p>}
        </div>
      )}

      <div className="mt-6">
        <Soundboard />
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: OBSStatus }) {
  const map = {
    disconnected: { label: 'Not connected', cls: 'bg-dark-elevated border border-dark-border text-gray-400' },
    connecting: { label: 'Connecting…', cls: 'bg-chakra/15 border border-chakra/40 text-chakra' },
    connected: { label: 'Connected', cls: 'bg-leaf/15 border border-leaf/40 text-leaf' },
    error: { label: 'Error', cls: 'bg-kunai/15 border border-kunai/40 text-kunai' },
  } as const
  const m = map[status]
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${m.cls}`}>{m.label}</span>
}

function humanizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('AuthenticationFailure') || msg.includes('Authentication')) {
    return 'OBS rejected the password. Check Tools → WebSocket Server Settings.'
  }
  if (msg.match(/Connection refused|Failed to construct|ECONNREFUSED|websocket/i)) {
    return 'Couldn\'t reach OBS. Make sure OBS is running and the WebSocket server is enabled.'
  }
  return msg
}
