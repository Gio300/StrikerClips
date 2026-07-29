import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2,
  Circle,
  ExternalLink,
  Eye,
  EyeOff,
  MonitorCheck,
  Radio,
  RefreshCw,
  Server,
  ShieldCheck,
  TvMinimalPlay,
  Video,
} from 'lucide-react'
import {
  getOBS,
  buildProgramOutputUrl,
  loadConfig,
  saveConfig,
  formatStreamDuration,
  type OBSConnectionConfig,
  type OBSScene,
  type OBSStatus,
  type OBSStreamingState,
  type OBSStreamDestination,
  type OBSProgramSourceStatus,
} from '@/lib/obs'
import { Soundboard } from '@/components/Soundboard'
import { useAuth } from '@/hooks/useAuth'
import { useAutoMerge } from '@/hooks/useAutoMerge'
import { supabase } from '@/lib/supabase'

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
  const [programUrl] = useState(() => buildProgramOutputUrl())
  const { user } = useAuth()
  const { youtubeConnected } = useAutoMerge()
  const [cfg, setCfg] = useState<OBSConnectionConfig>(loadConfig())
  const [status, setStatus] = useState<OBSStatus>(obs.getStatus())
  const [error, setError] = useState('')
  const [scenes, setScenes] = useState<OBSScene[]>([])
  const [stream, setStream] = useState<OBSStreamingState>(obs.getStreamState())
  const [busy, setBusy] = useState(false)
  const [showPwd, setShowPwd] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [destination, setDestination] = useState<OBSStreamDestination | null>(null)
  const [programSource, setProgramSource] = useState<OBSProgramSourceStatus | null>(null)
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [listedOnTko, setListedOnTko] = useState<boolean | null>(null)
  const [checkNonce, setCheckNonce] = useState(0)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const unS = obs.onStatus(setStatus)
    const unR = obs.onStream(setStream)
    return () => { unS(); unR() }
  }, [obs])

  useEffect(() => {
    if (status !== 'connected') {
      setScenes([])
      setProgramSource(null)
      return
    }
    let cancelled = false
    Promise.all([
      obs.listScenes(),
      obs.getProgramSourceStatus(programUrl),
    ])
      .then(([nextScenes, nextProgramSource]) => {
        if (cancelled) return
        setScenes(nextScenes)
        setProgramSource(nextProgramSource)
      })
      .catch((err) => { if (!cancelled) setError(String(err?.message ?? err)) })
    return () => { cancelled = true }
  }, [status, obs, programUrl, checkNonce])

  useEffect(() => {
    let cancelled = false
    setChecking(true)

    void (async () => {
      const [healthResult, destinationResult, listingResult] = await Promise.all([
        fetch('/api/health', { headers: { Accept: 'application/json' } })
          .then((response) => response.ok)
          .catch(() => false),
        status === 'connected'
          ? obs.getStreamDestination().catch(() => null)
          : Promise.resolve(null),
        user
          ? supabase
              .from('live_streams')
              .select('id, is_live')
              .eq('user_id', user.id)
              .eq('is_live', true)
              .then(
                ({ data }) => (data?.length ?? 0) > 0,
                () => false,
              )
          : Promise.resolve(false),
      ])

      if (cancelled) return
      setBackendOk(healthResult)
      setDestination(destinationResult)
      setListedOnTko(listingResult)
      setChecking(false)
    })()

    return () => {
      cancelled = true
    }
  }, [status, obs, user, stream.isStreaming, programSource?.ready, checkNonce])

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
    setProgramSource(null)
    try { await obs.setCurrentScene(name) } catch (err) { setError(humanizeError(err)) }
    try {
      const [freshScenes, freshProgramSource] = await Promise.all([
        obs.listScenes(),
        obs.getProgramSourceStatus(programUrl),
      ])
      setScenes(freshScenes)
      setProgramSource(freshProgramSource)
    } catch { /* ignore */ }
  }

  async function handlePrepareProgram() {
    setError('')
    setBusy(true)
    try {
      const verified = await obs.ensureProgramSource(programUrl)
      setProgramSource(verified)
      setScenes(await obs.listScenes())
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  async function handleStream(action: 'start' | 'stop') {
    setError('')
    setBusy(true)
    try {
      if (action === 'start') {
        const verified = await obs.getProgramSourceStatus(programUrl)
        setProgramSource(verified)
        if (!verified.ready) {
          throw new Error(`Prepare the TKO program output first. ${verified.detail}`)
        }
        await obs.startStreaming()
      } else {
        await obs.stopStreaming()
      }
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
      if (action === 'start') {
        const verified = await obs.getProgramSourceStatus(programUrl)
        setProgramSource(verified)
        if (!verified.ready) {
          throw new Error(`Prepare the TKO program output first. ${verified.detail}`)
        }
        await obs.startRecording()
      } else {
        await obs.stopRecording()
      }
    } catch (err) {
      setError(humanizeError(err))
    } finally {
      setBusy(false)
    }
  }

  const isConnected = status === 'connected'

  const readyCount = [
    backendOk === true,
    youtubeConnected,
    isConnected,
    destination?.configured === true,
    programSource?.ready === true,
  ].filter(Boolean).length

  return (
    <div className="mb-6 rounded-lg border border-dark-border bg-dark-card p-5">
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

      <HostReadiness
        backendOk={backendOk}
        youtubeConnected={youtubeConnected}
        obsConnected={isConnected}
        destination={destination}
        programSource={programSource}
        listedOnTko={listedOnTko}
        streaming={stream.isStreaming}
        readyCount={readyCount}
        checking={checking}
        onRefresh={() => setCheckNonce((current) => current + 1)}
      />

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
            <strong>4.</strong> Connect below, then press <strong>Prepare TKO program</strong>. TKO creates and verifies the browser source for you.
          </p>
          <p>
            <strong>5.</strong> Confirm the program preview in OBS, then start streaming or recording.
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
              className="field mt-1 font-mono"
              placeholder="localhost"
            />
          </label>
          <label className="block">
            <span className="text-xs text-gray-400">Port</span>
            <input
              type="number"
              value={cfg.port}
              onChange={(e) => setCfg({ ...cfg, port: Number(e.target.value) || 4455 })}
              className="field mt-1 font-mono"
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
                className="field flex-1 font-mono"
                placeholder="WebSocket password"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dark-border text-gray-400 hover:border-gray-500 hover:text-white"
                aria-label={showPwd ? 'Hide password' : 'Show password'}
              >
                {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
          <div className="sm:col-span-3 flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="btn-primary"
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
          <div className="border-y border-dark-border py-3">
            <div className="flex flex-wrap items-center gap-3">
              <MonitorCheck
                size={18}
                className={programSource?.ready ? 'text-leaf' : 'text-chakra'}
              />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-white">TKO program output</h3>
                <p className={`text-xs ${programSource?.ready ? 'text-leaf' : 'text-gray-500'}`}>
                  {programSource?.detail ?? 'Not verified in OBS.'}
                </p>
              </div>
              <a
                href={programUrl}
                target="_blank"
                rel="noopener"
                className="flex h-9 w-9 items-center justify-center rounded border border-dark-border text-gray-400 hover:border-accent/50 hover:text-accent"
                aria-label="Open TKO program output"
                title="Open TKO program output"
              >
                <ExternalLink size={15} />
              </a>
              <button
                type="button"
                onClick={handlePrepareProgram}
                disabled={busy}
                className="btn-primary min-h-9 px-3 py-1.5 text-xs"
              >
                <MonitorCheck size={15} />
                {programSource?.ready ? 'Verify TKO program' : 'Prepare TKO program'}
              </button>
            </div>
            <p className="mt-2 break-all font-mono text-[11px] text-gray-600">{programUrl}</p>
          </div>

          {/* Stream + record bar */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dark-border p-3 bg-dark/40">
            <button
              type="button"
              onClick={() => stream.isStreaming ? handleStream('stop') : handleStream('start')}
              disabled={busy || (!stream.isStreaming && !programSource?.ready)}
              title={!stream.isStreaming && !programSource?.ready ? 'Prepare the TKO program first' : undefined}
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
              disabled={busy || (!stream.isRecording && !programSource?.ready)}
              title={!stream.isRecording && !programSource?.ready ? 'Prepare the TKO program first' : undefined}
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
          {stream.recordingError && (
            <p className="text-xs text-kunai">{stream.recordingError}</p>
          )}
          {!stream.isRecording && stream.recordingPath && (
            <p className="break-all text-xs text-gray-500">
              Saved recording: <span className="font-mono text-gray-300">{stream.recordingPath}</span>
            </p>
          )}

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

function HostReadiness({
  backendOk,
  youtubeConnected,
  obsConnected,
  destination,
  programSource,
  listedOnTko,
  streaming,
  readyCount,
  checking,
  onRefresh,
}: {
  backendOk: boolean | null
  youtubeConnected: boolean
  obsConnected: boolean
  destination: OBSStreamDestination | null
  programSource: OBSProgramSourceStatus | null
  listedOnTko: boolean | null
  streaming: boolean
  readyCount: number
  checking: boolean
  onRefresh: () => void
}) {
  const ready = readyCount === 5
  const checks = [
    {
      label: 'TKO services',
      detail: backendOk == null ? 'Checking backend' : backendOk ? 'Online' : 'Backend unavailable',
      passed: backendOk === true,
      Icon: Server,
    },
    {
      label: 'YouTube account',
      detail: youtubeConnected ? 'Channel linked to TKO' : 'Connect a channel before the test',
      passed: youtubeConnected,
      Icon: TvMinimalPlay,
      to: youtubeConnected ? undefined : '/connect',
    },
    {
      label: 'OBS control',
      detail: obsConnected ? 'WebSocket connected' : 'Start OBS and connect below',
      passed: obsConnected,
      Icon: Video,
    },
    {
      label: 'Stream destination',
      detail: destination?.configured
        ? destination.service
        : obsConnected
          ? 'Add the YouTube destination in OBS'
          : 'Checked after OBS connects',
      passed: destination?.configured === true,
      Icon: Radio,
    },
    {
      label: 'Program source',
      detail: programSource?.detail ?? 'Prepare the TKO browser source in OBS',
      passed: programSource?.ready === true,
      Icon: MonitorCheck,
    },
  ]

  return (
    <section className="mb-5 border-y border-dark-border py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={17} className={ready ? 'text-leaf' : 'text-chakra'} />
            <h3 className="font-semibold text-white">Host readiness</h3>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {ready ? 'Ready for a test broadcast.' : `${readyCount} of 5 required checks passed.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={checking}
          className="btn-ghost min-h-9 px-3 py-1.5 text-xs"
        >
          <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
          Recheck
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {checks.map(({ label, detail, passed, Icon, to }) => {
          const content = (
            <>
              <div className="flex items-center gap-2">
                <Icon size={15} className={passed ? 'text-leaf' : 'text-gray-500'} />
                <span className="text-xs font-semibold text-gray-200">{label}</span>
                {passed
                  ? <CheckCircle2 size={14} className="ml-auto text-leaf" />
                  : <Circle size={14} className="ml-auto text-gray-600" />}
              </div>
              <p className="mt-1 text-[11px] text-gray-500">{detail}</p>
            </>
          )

          return to ? (
            <Link key={label} to={to} className="rounded-lg border border-dark-border bg-dark px-3 py-2 hover:border-accent/50">
              {content}
            </Link>
          ) : (
            <div key={label} className="rounded-lg border border-dark-border bg-dark px-3 py-2">
              {content}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
        <span className={streaming ? 'text-leaf' : ''}>
          Output: {streaming ? 'live from OBS' : 'not streaming'}
        </span>
        <span className={listedOnTko ? 'text-leaf' : ''}>
          TKO listing: {listedOnTko ? 'visible' : 'not published yet'}
        </span>
      </div>
    </section>
  )
}

function StatusBadge({ status }: { status: OBSStatus }) {
  const map = {
    disconnected: { label: 'Not connected', cls: 'bg-dark-elevated border border-dark-border text-gray-400' },
    connecting: { label: 'Connecting…', cls: 'bg-chakra/15 border border-chakra/40 text-chakra' },
    reconnecting: { label: 'Reconnecting…', cls: 'bg-chakra/15 border border-chakra/40 text-chakra' },
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
