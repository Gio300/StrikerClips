import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { EVENT_KINDS, MODES } from '@/lib/shinobiStriker'
import { fetchEvents, matchClaim, type MatchResult } from '@/lib/momentMatch'
import { chaptersFromEvents, toVideoId, buildEmbedUrl } from '@/lib/cueLink'
import type { ClipEvent } from '@/lib/shinobiStriker'

/**
 * "Proof, instantly" — say what happened, get a YouTube link cued to that exact
 * moment, copied to your clipboard. No re-render (just a timestamp), the full
 * video stays scrubbable, and the view counts on our channel. You paste it
 * wherever you want — we never post it or touch a password.
 */
export function ProofFinder() {
  const { user } = useAuth()
  const [videoInput, setVideoInput] = useState('')
  const [claim, setClaim] = useState('')
  const [events, setEvents] = useState<ClipEvent[]>([])
  const [result, setResult] = useState<MatchResult | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const videoId = toVideoId(videoInput)
  const [searchParams] = useSearchParams()

  // Deep link: /proof?v=<id>&claim=<text> auto-runs (shareable proof links).
  useEffect(() => {
    const v = searchParams.get('v')
    const c = searchParams.get('claim')
    if (!v) return
    setVideoInput(v)
    if (c) setClaim(c)
    ;(async () => {
      const evs = await fetchEvents(v)
      setEvents(evs)
      if (c) {
        const r = matchClaim(c, toVideoId(v), evs)
        setResult(r)
        if (r.moments[0]) setPreview(r.moments[0].embed)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadEvents(): Promise<ClipEvent[]> {
    if (!videoId) { setErr('Paste a YouTube link or video id first.'); return [] }
    setErr('')
    const evs = await fetchEvents(videoId)
    setEvents(evs)
    return evs
  }

  async function findProof() {
    setBusy(true)
    setErr('')
    try {
      const evs = events.length ? events : await loadEvents()
      if (!claim.trim()) { setErr('Type what happened — e.g. “I killed him 4 times”.'); return }
      const r = matchClaim(claim, videoId, evs)
      setResult(r)
      if (r.moments[0]) setPreview(r.moments[0].embed)
    } finally {
      setBusy(false)
    }
  }

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.focus(); ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
    }
    setCopied(id)
    window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1600)
  }

  const copyAll = () => {
    if (!result?.moments.length) return
    copy(result.moments.map((m) => `${m.time} — ${m.label}\n${m.url}`).join('\n\n'), 'all')
  }

  const chapters = events.length ? chaptersFromEvents(events) : ''

  return (
    <div className="p-6 md:p-10 max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="text-xs font-mono tracking-widest uppercase text-accent">Proof, instantly</div>
        <h1 className="text-2xl md:text-3xl font-bold mt-1">Say it. Get the receipt.</h1>
        <p className="text-gray-400 mt-2 max-w-2xl">
          Type what happened. We find that exact moment in the clip and hand you a YouTube link cued
          right to it — <span className="text-gray-200">copied to your clipboard</span> so you can
          paste it anywhere. No re-render: the full video is still there to scrub. We never post it
          for you or ask for a password.
        </p>
      </div>

      {/* Inputs */}
      <div className="card p-5 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Clip (YouTube link or video id)</label>
          <input
            value={videoInput}
            onChange={(e) => { setVideoInput(e.target.value); setEvents([]); setResult(null) }}
            placeholder="https://youtube.com/watch?v=…"
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">What happened?</label>
          <div className="flex flex-wrap gap-2">
            <input
              value={claim}
              onChange={(e) => setClaim(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') findProof() }}
              placeholder='e.g. "I killed him 4 times" or "flag on the second run"'
              className="flex-1 min-w-[240px] px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            />
            <button onClick={findProof} disabled={busy} className="btn-primary">
              {busy ? 'Finding…' : 'Find proof'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {['I killed him 4 times', 'flag on the second run', 'the clutch match win', 'my first kill'].map((ex) => (
              <button key={ex} onClick={() => setClaim(ex)} className="pill hover:border-accent/50 hover:text-white">{ex}</button>
            ))}
          </div>
        </div>
        {err && <p className="text-kunai text-sm">{err}</p>}
      </div>

      {/* Results */}
      {result && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">{result.note}</h2>
            {result.moments.length > 1 && (
              <button onClick={copyAll} className="btn-ghost text-sm">
                {copied === 'all' ? 'Copied all ✓' : 'Copy all links'}
              </button>
            )}
          </div>

          {result.moments.length === 0 ? (
            <div className="card p-6 text-gray-400 text-sm">
              Nothing indexed for that yet. Tag the moment below and it becomes findable instantly.
            </div>
          ) : (
            <div className="space-y-2">
              {result.moments.map((m, i) => (
                <div key={m.event.id || i} className="card p-4 flex items-center gap-4">
                  <span className="pill-accent font-mono tabular-nums shrink-0">{m.time}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{m.label}</div>
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent font-mono break-all hover:underline">{m.url}</a>
                  </div>
                  <button onClick={() => setPreview(m.embed)} className="btn-ghost text-xs shrink-0">Play here</button>
                  <button onClick={() => copy(m.url, m.event.id || String(i))} className="btn-primary text-xs shrink-0">
                    {copied === (m.event.id || String(i)) ? 'Copied ✓' : 'Copy link'}
                  </button>
                </div>
              ))}
            </div>
          )}

          {preview && (
            <div className="mt-4 rounded-xl overflow-hidden border border-dark-border aspect-video bg-black">
              <iframe
                src={preview}
                title="Cued moment"
                className="w-full h-full"
                allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
        </div>
      )}

      {/* Tag a moment (the reliable index source) */}
      <TagMoment videoId={videoId} user={user} onAdded={(e) => setEvents((prev) => [...prev, e].sort((a, b) => Number(a.t_seconds) - Number(b.t_seconds)))} />

      {/* Chapters preview */}
      {chapters && (
        <div className="mt-6 card p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">YouTube chapters</h3>
            <button onClick={() => copy(chapters, 'chapters')} className="btn-ghost text-xs">
              {copied === 'chapters' ? 'Copied ✓' : 'Copy for description'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-2">Paste into the video description — YouTube renders these as a segmented scrub bar, no re-render.</p>
          <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap bg-dark rounded-lg p-3 border border-dark-border">{chapters}</pre>
        </div>
      )}
    </div>
  )
}

function TagMoment({ videoId, user, onAdded }: { videoId: string; user: { id: string } | null; onAdded: (e: ClipEvent) => void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('kill')
  const [mode, setMode] = useState('')
  const [time, setTime] = useState('')
  const [target, setTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  function parseTime(s: string): number | null {
    const t = s.trim()
    if (/^\d+$/.test(t)) return parseInt(t, 10)
    const m = t.match(/^(\d+):(\d{1,2})$/)
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
    const h = t.match(/^(\d+):(\d{1,2}):(\d{1,2})$/)
    if (h) return parseInt(h[1], 10) * 3600 + parseInt(h[2], 10) * 60 + parseInt(h[3], 10)
    return null
  }

  async function add() {
    setMsg('')
    if (!videoId) { setMsg('Set the clip up top first.'); return }
    const t = parseTime(time)
    if (t == null) { setMsg('Time like 83 or 1:23.'); return }
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('clip_events')
        .insert({ video_id: videoId, event_kind: kind, mode: mode || null, target: target || null, t_seconds: t, source: 'tag', created_by: user?.id ?? null })
        .select('*')
        .single()
      if (error) { setMsg(error.message); return }
      if (data) { onAdded(data as ClipEvent); setTime(''); setTarget(''); setMsg('Tagged ✓') }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-6 card p-5">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between">
        <span className="font-semibold">Tag a moment <span className="text-gray-500 font-normal">— the reliable way to index (uploader tags)</span></span>
        <span className="text-accent">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-4 flex flex-wrap gap-2 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Event</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)} className="px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm">
              {EVENT_KINDS.map((e) => <option key={e.kind} value={e.kind}>{e.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm">
              <option value="">—</option>
              {MODES.map((m) => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Time (s or m:ss)</label>
            <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="1:23" className="w-24 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">On (optional)</label>
            <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="rival" className="w-28 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm" />
          </div>
          <button onClick={add} disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Add to index'}</button>
          {msg && <span className="text-xs text-gray-400 self-center">{msg}</span>}
        </div>
      )}
    </div>
  )
}
