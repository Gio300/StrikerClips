import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useCameraStream } from '@/hooks/useCameraStream'
import { canHost } from '@/lib/tkoKing'
import { createHostCommentary, hostSourceLabel, type HostSource } from '@/lib/hostCommentary'
import { OBSPanel } from '@/components/OBSPanel'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import type { Match } from '@/types/database'
import { CODE_REDEMPTION_ENABLED } from '@/lib/storeBuild'

/**
 * Host.tsx — the HOST LANE (docs/TKO-BUILD-PLAN.md §4).
 *
 * A host (global tko_host capability, granted by a founder HOST code — see
 * src/lib/tkoKing.ts) comes here to narrate matches. Two modes:
 *
 *   • HOST A LIVE MATCH now — two capture sources:
 *       (i)  connect their local OBS (obs-websocket, reusing <OBSPanel/>), or
 *       (ii) go on camera straight from the phone/browser (getUserMedia).
 *   • ADD COMMENTARY TO A PAST MATCH — pick an existing match and record
 *     commentary (camera+mic, or mic-only) as that match's "with host" version.
 *
 * Saving either persists a `host_commentaries` row (the "with host" version
 * marker, §3), which the player / version picker reads back.
 */

type Mode = 'live' | 'past'

export function Host() {
  const { user, loading } = useAuth()
  const host = canHost(user)
  const [mode, setMode] = useState<Mode>('live')

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading…</div>
      </div>
    )
  }

  if (!user) {
    return (
      <Gate
        title="Sign in to host"
        body="The host lane is for signed-in hosts. Sign in to continue."
        cta={{ to: '/login', label: 'Sign in' }}
      />
    )
  }

  if (!host) {
    return (
      <Gate
        title="Host access required"
        body={CODE_REDEMPTION_ENABLED
          ? 'Watching is open to everyone — but hosting the mic is gated. Unlock the live-commentary lane by going Legend (our top membership), or by redeeming a founder HOST code.'
          : 'Watching is open to everyone, but hosting the mic is available only to accounts that already have host access.'}
        cta={CODE_REDEMPTION_ENABLED
          ? { to: '/upgrade', label: 'Go Legend or redeem a code' }
          : { to: '/', label: 'Back to home' }}
      />
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-kunai/15 border border-kunai/40 text-kunai text-[11px] font-semibold mb-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-kunai" />
          HOST LANE
        </div>
        <h1 className="text-2xl font-bold">Go on the mic</h1>
        <p className="text-gray-400 mt-1">
          Narrate a match live, or add commentary over a match that already happened.
          Either way it becomes the <span className="text-accent font-medium">with host</span> version viewers can pick.
        </p>
      </div>

      {/* Mode chooser */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <ModeCard
          active={mode === 'live'}
          onClick={() => setMode('live')}
          title="Host a live match"
          body="Go live now — through your OBS, or straight from your phone camera + mic."
        />
        <ModeCard
          active={mode === 'past'}
          onClick={() => setMode('past')}
          title="Commentate a past match"
          body="Pick a match that already happened and record your commentary over it."
        />
      </div>

      {mode === 'live' ? <LiveHostLane /> : <PastMatchLane />}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  LIVE — two capture sources: OBS, or the phone/browser camera.
// ───────────────────────────────────────────────────────────────────────────

function LiveHostLane() {
  return (
    <div className="space-y-4">
      {/* Source (i): OBS via obs-websocket — reuse the existing panel. */}
      <OBSPanel />

      {/* Source (ii): phone / browser camera + mic. */}
      <div className="rounded-xl border border-dark-border bg-dark-card p-5">
        <h2 className="font-semibold text-lg mb-1">Use your phone camera + mic</h2>
        <p className="text-sm text-gray-400 mb-4">
          No OBS? Go on camera straight from this device. Turn the camera off to go voice-only.
        </p>
        <CameraCommentary mode="live" allowMicOnly={false} />
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  PAST — pick a match, then record commentary as its "with host" version.
// ───────────────────────────────────────────────────────────────────────────

function PastMatchLane() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [pickedId, setPickedId] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('matches')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100)
      if (!cancelled) {
        setMatches(data ?? [])
        setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  const picked = useMemo(() => matches.find((m) => m.id === pickedId) ?? null, [matches, pickedId])

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-lg mb-1">Pick a match to commentate</h2>
        <p className="text-sm text-gray-400">
          Choose a match that already happened. Your recording is saved as its
          <span className="text-accent"> with host</span> version.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-500">Loading matches…</p>
      ) : matches.length === 0 ? (
        <p className="text-sm text-gray-500">
          No matches yet. <Link to="/matches/create" className="text-accent hover:underline">Create one</Link> first.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto pr-1">
          {matches.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setPickedId(m.id)}
              className={`px-3 py-2 rounded-lg text-left transition-colors border ${
                m.id === pickedId
                  ? 'bg-accent/15 border-accent text-accent'
                  : 'bg-dark border-dark-border text-gray-200 hover:border-accent/50'
              }`}
            >
              <div className="font-medium truncate">{m.name}</div>
              {m.description && <div className="text-xs text-gray-500 truncate">{m.description}</div>}
            </button>
          ))}
        </div>
      )}

      {picked && (
        <div className="pt-1 border-t border-dark-border">
          <p className="text-sm text-gray-300 mt-4 mb-3">
            Commentating <span className="font-semibold text-white">{picked.name}</span>
          </p>
          <CameraCommentary mode="past" matchId={picked.id} allowMicOnly />
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Shared camera/mic capture + record + save.
// ───────────────────────────────────────────────────────────────────────────

function CameraCommentary({
  mode,
  matchId,
  allowMicOnly,
}: {
  mode: Mode
  matchId?: string
  allowMicOnly: boolean
}) {
  const cam = useCameraStream()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [commentaryUrl, setCommentaryUrl] = useState('')

  // Reflect the live stream into the preview element.
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = cam.camOn ? cam.stream : null
  }, [cam.stream, cam.camOn])

  // The capture source we persist: mic-only when the camera is off (past lane).
  const source: HostSource = cam.camOn ? 'camera' : 'mic'

  async function save() {
    setError('')
    setSaving(true)
    try {
      const row = await createHostCommentary({
        mode,
        source,
        matchId: matchId ?? null,
        commentaryUrl: commentaryUrl.trim() || null,
        status: mode === 'live' ? 'live' : 'ready',
      })
      if (!row) {
        setError('Could not save — check you are signed in as a host.')
        return
      }
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Preview */}
      <div className="relative aspect-video rounded-lg overflow-hidden border border-dark-border bg-dark grid place-items-center">
        {cam.active && cam.camOn ? (
          <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
        ) : (
          <div className="text-center text-gray-500 text-sm px-4">
            {cam.active
              ? '🎙 Voice only — camera is off'
              : 'Your camera preview shows here once you start.'}
          </div>
        )}
        {cam.active && (
          <span className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-kunai/90 text-white text-[11px] font-semibold">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            {mode === 'live' ? 'LIVE' : 'REC'}
          </span>
        )}
      </div>

      {cam.error && <p className="text-kunai text-xs">{cam.error}</p>}

      {/* Capture controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!cam.active ? (
          <button
            type="button"
            onClick={cam.start}
            disabled={cam.starting}
            className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-40"
          >
            {cam.starting ? 'Starting…' : '🎥 Start camera + mic'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={cam.toggleCam}
              className="px-3 py-2 rounded-lg border border-dark-border text-gray-200 text-sm hover:border-accent/50"
            >
              {cam.camOn ? (allowMicOnly ? 'Camera off (voice only)' : 'Camera off') : 'Camera on'}
            </button>
            <button
              type="button"
              onClick={cam.toggleMic}
              className="px-3 py-2 rounded-lg border border-dark-border text-gray-200 text-sm hover:border-accent/50"
            >
              {cam.micOn ? 'Mute mic' : 'Unmute mic'}
            </button>
            <button
              type="button"
              onClick={cam.stop}
              className="px-3 py-2 rounded-lg border border-dark-border text-gray-400 text-sm hover:border-kunai/40 hover:text-kunai"
            >
              End
            </button>
            <span className="text-xs text-gray-500">Source: {hostSourceLabel(source)}</span>
          </>
        )}
      </div>

      {/* Optional: link to the produced commentary track (uploaded elsewhere). */}
      <CollapsibleSection id="host-commentary-url" label="Commentary link (optional)">
        <p className="text-xs text-gray-500 mb-2">
          Already have the recorded commentary hosted (e.g. a YouTube link)? Paste it so the
          with-host version plays it back. You can also save the association now and add the link later.
        </p>
        <input
          type="url"
          value={commentaryUrl}
          onChange={(e) => setCommentaryUrl(e.target.value)}
          placeholder="https://…"
          className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
        />
      </CollapsibleSection>

      {/* Save the "with host" association */}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving || saved}
          className="px-4 py-2 rounded-lg bg-gradient-kunai text-dark text-sm font-semibold disabled:opacity-40"
        >
          {saved ? '✓ Saved as “with host”' : saving ? 'Saving…' : 'Save as the “with host” version'}
        </button>
        {error && <span className="text-kunai text-xs">{error}</span>}
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Small building blocks.
// ───────────────────────────────────────────────────────────────────────────

function ModeCard({
  active,
  onClick,
  title,
  body,
}: {
  active: boolean
  onClick: () => void
  title: string
  body: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left p-4 rounded-xl border transition-colors ${
        active
          ? 'bg-accent/15 border-accent'
          : 'bg-dark-card border-dark-border hover:border-accent/50'
      }`}
    >
      <div className={`font-semibold mb-1 ${active ? 'text-accent' : 'text-white'}`}>{title}</div>
      <div className="text-sm text-gray-400">{body}</div>
    </button>
  )
}

function Gate({
  title,
  body,
  cta,
}: {
  title: string
  body: string
  cta: { to: string; label: string }
}) {
  return (
    <div className="p-8 flex flex-col items-center justify-center gap-4 py-20 text-center max-w-md mx-auto">
      <h1 className="text-xl font-bold">{title}</h1>
      <p className="text-gray-400">{body}</p>
      <Link to={cta.to} className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all">
        {cta.label}
      </Link>
    </div>
  )
}

export default Host
