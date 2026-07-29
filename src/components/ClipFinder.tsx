import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import {
  isYouTubeConnectConfigured,
  isYouTubeApiConfigured,
  connectYouTube,
  fetchMyUploads,
  fetchUploadsByHandle,
  videosFromLinks,
  enrichVideos,
  saveLibrary,
  loadLibrary,
  clearLibrary,
  thumbUrl,
} from '@/lib/youtubeConnect'
import { recordYouTubeLink } from '@/lib/youtubeLink'
import { parseDescribe, matchLibrary, describeSummary, type LibraryVideo } from '@/lib/describeClip'
import { demoLibrary } from '@/lib/demoClips'
import { useClipTray } from '@/hooks/useClipTray'
import { extractYouTubeId } from '@/lib/youtubeApi'
import { prettyClip } from '@/lib/clipLabel'
import { ConnectedBadge } from '@/components/ConnectedBadge'
import { demoSquad, clipsFor, groupByCategory, ytUrl, CATEGORY_LABEL } from '@/lib/squad'

/**
 * ClipFinder — "connect your YouTube, then just describe the clip."
 *
 * The flagship create path. The player links their channel once (real OAuth
 * when tko.cam has a Client ID, manual add otherwise), then types plain
 * language — "my ultimate against Rekt last night" — and we surface matching
 * videos as tappable thumbnails. Picking one hands its URL to the reel builder.
 */
export function ClipFinder({
  onAdd,
  onRemove,
  username,
}: {
  onAdd: (url: string) => void
  onRemove?: (url: string) => void
  username?: string
}) {
  const { user } = useAuth()
  const uid = user?.id ?? 'anon'
  const { items: tray, remove: removeTray } = useClipTray()

  const [library, setLibrary] = useState<LibraryVideo[]>([])
  const [busy, setBusy] = useState<'connect' | 'add' | null>(null)
  const [err, setErr] = useState('')
  const [manual, setManual] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [squadOpen, setSquadOpen] = useState<string | null>(null)

  const squad = useMemo(() => demoSquad(), [])

  useEffect(() => {
    setLibrary(loadLibrary(uid))
  }, [uid])

  const connected = library.length > 0
  const canOAuth = isYouTubeConnectConfigured()

  async function handleConnect() {
    setErr('')
    setBusy('connect')
    try {
      const token = await connectYouTube()
      const vids = await fetchMyUploads(token)
      setLibrary(vids)
      saveLibrary(uid, vids)
      if (vids.length === 0) setErr('Connected, but your channel has no public uploads yet.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not connect YouTube')
    } finally {
      setBusy(null)
    }
  }

  async function handleManualAdd() {
    setErr('')
    const links = manual.split(/[\s,]+/).filter(Boolean)
    if (!links.length) return
    setBusy('add')
    try {
      // A bare @handle (or channel URL) pulls the WHOLE channel's uploads — the
      // no-OAuth path that works in the installed app.
      const handleTok = links.find((l) => /^@/.test(l) || /youtube\.com\/@/.test(l))
      if (handleTok && isYouTubeApiConfigured()) {
        const vids = await fetchUploadsByHandle(handleTok)
        if (vids.length) {
          const merged = [...vids.filter((f) => !library.some((l) => l.id === f.id)), ...library]
          setLibrary(merged)
          saveLibrary(uid, merged)
          // ONE source of truth: also record the backend link so every screen
          // (TKO King, auto-merge, Go Live) agrees you're connected.
          void recordYouTubeLink(uid, handleTok)
          setManual('')
          return
        }
        setErr('No public uploads found on that handle.')
        return
      }
      const fresh = videosFromLinks(links)
      if (!fresh.length) {
        setErr('No valid YouTube links or IDs found. Paste clip links or your @handle.')
        return
      }
      const merged = [...fresh.filter((f) => !library.some((l) => l.id === f.id)), ...library]
      const enriched = await enrichVideos(merged)
      setLibrary(enriched)
      saveLibrary(uid, enriched)
      setManual('')
    } finally {
      setBusy(null)
    }
  }

  function disconnect() {
    clearLibrary(uid)
    setLibrary([])
    setPicked(new Set())
  }

  function loadDemo() {
    const vids = demoLibrary()
    setLibrary(vids)
    saveLibrary(uid, vids)
  }

  const parsed = useMemo(() => (query.trim() ? parseDescribe(query) : null), [query])
  const results = useMemo(() => {
    if (!parsed) return library.slice(0, 24)
    return matchLibrary(library, parsed, username)
  }, [parsed, library, username])

  function toggle(v: LibraryVideo) {
    const url = `https://www.youtube.com/watch?v=${v.id}`
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(v.id)) {
        // Already added — remove it from the reel and clear the badge.
        next.delete(v.id)
        onRemove?.(url)
      } else {
        next.add(v.id)
        onAdd(url)
      }
      return next
    })
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-white">Find a clip by describing it</span>
            {connected && <ConnectedBadge label="Your YouTube — connected" />}
          </div>
          <div className="text-xs text-gray-500">
            Link your YouTube once, then say who you fought and when — no URLs.
          </div>
        </div>
        {connected ? (
          <button type="button" onClick={disconnect} className="text-xs text-gray-500 hover:text-gray-300 underline">
            Disconnect
          </button>
        ) : null}
      </div>

      {tray.length > 0 && (
        <div className="rounded-lg border border-accent/25 bg-accent/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-white">From your clip tray</div>
            <div className="text-xs text-gray-500">Gathered in the Browser · tap to add</div>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {tray.map((it) => {
              const yid = extractYouTubeId(it.url)
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => { onAdd(it.url); removeTray(it.id) }}
                  className="group shrink-0 w-32 text-left rounded-lg overflow-hidden border border-dark-border hover:border-accent/60 transition-colors"
                  title={prettyClip(it.url)}
                >
                  <div className="relative aspect-video bg-dark">
                    {yid ? (
                      <img src={thumbUrl(yid)} alt="" loading="lazy" className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-500 px-1 text-center">
                        {it.fromHost || 'link'}
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-black/60 text-[10px] text-white px-1 py-0.5 opacity-0 group-hover:opacity-100">
                      + Add
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Squad shelf — use clips from people you follow / your clan (all live on TKO's channel) */}
      <div className="rounded-lg border border-dark-border bg-dark-card p-3">
        <div className="text-sm font-medium text-white">Squad clips</div>
        <div className="text-xs text-gray-500 mb-2">Tap a squadmate — people you follow or share a clan with — to use their clips in your reel.</div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {squad.members.map((m) => {
            const on = squadOpen === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSquadOpen(on ? null : m.id)}
                className={`shrink-0 flex flex-col items-center gap-1 ${on ? '' : 'opacity-90'}`}
              >
                <span className={`w-12 h-12 rounded-full bg-gradient-to-br ${m.tint ?? 'from-accent to-accent'} flex items-center justify-center text-dark font-bold ${on ? 'ring-2 ring-accent' : ''}`}>
                  {m.name.slice(0, 1)}
                </span>
                <span className="text-[11px] text-gray-300">{m.name}</span>
              </button>
            )
          })}
        </div>

        {squadOpen && (
          <div className="mt-3 space-y-3">
            {groupByCategory(clipsFor(squad.clips, squadOpen, uid)).map((grp) => (
              <div key={grp.category}>
                <div className="text-xs text-gray-400 mb-1">{CATEGORY_LABEL[grp.category]}</div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {grp.clips.map((c) => (
                    <button
                      key={c.id + c.category}
                      type="button"
                      onClick={() => onAdd(ytUrl(c))}
                      className="group shrink-0 w-28 text-left rounded-lg overflow-hidden border border-dark-border hover:border-accent/60"
                      title={c.title}
                    >
                      <div className="relative aspect-video bg-dark">
                        <img src={thumbUrl(c.id)} alt="" loading="lazy" className="w-full h-full object-cover"
                          onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }} />
                        <div className="absolute inset-x-0 bottom-0 bg-black/60 text-[10px] text-white px-1 py-0.5 opacity-0 group-hover:opacity-100">+ Add</div>
                      </div>
                      <div className="p-1.5 text-[11px] text-gray-300 line-clamp-2 min-h-[2rem]">{c.title}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {!connected && (
        <div className="space-y-3">
          {canOAuth && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={busy === 'connect'}
              className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
            >
              {busy === 'connect' ? 'Opening YouTube…' : 'Connect YouTube — pull my clips automatically'}
            </button>
          )}
          {/* Primary path: paste your own YouTube links. */}
          <div className="flex flex-wrap gap-2">
            <input
              value={manual}
              onChange={(e) => setManual(e.target.value)}
              placeholder="Paste one or more YouTube links…"
              className="flex-1 min-w-[200px] px-4 py-3 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            />
            <button
              type="button"
              onClick={handleManualAdd}
              disabled={busy === 'add'}
              className="px-5 py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
            >
              {busy === 'add' ? 'Adding…' : 'Add'}
            </button>
          </div>
          {!canOAuth && (
            <div className="text-xs text-gray-500">
              Paste your clip links above — they show up with thumbnails right away. One-tap connect to <em>your</em>{' '}
              YouTube turns on the moment tko.cam has its Google client ID.
            </div>
          )}
          {/* Secondary: preview with demo clips. */}
          {!canOAuth && (
            <button
              type="button"
              onClick={loadDemo}
              className="text-xs text-gray-400 hover:text-accent underline"
            >
              or see it in action — load demo clips
            </button>
          )}
        </div>
      )}

      {connected && (
        <>
          <div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder='e.g. "my ultimate against Rekt last night"'
              className="w-full px-4 py-2.5 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            />
            <div className="text-xs text-gray-500 mt-1">
              {parsed ? describeSummary(parsed) : `${library.length} videos connected. Try “flag run vs auryn on friday”.`}
            </div>
          </div>

          {results.length === 0 ? (
            <div className="text-sm text-gray-500 py-6 text-center">
              No matches. Try fewer words, or a different name/day.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {results.map((v) => {
                const on = picked.has(v.id)
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => toggle(v)}
                    className={`group text-left rounded-lg overflow-hidden border transition-colors ${
                      on ? 'border-accent ring-2 ring-accent/40' : 'border-dark-border hover:border-accent/50'
                    }`}
                  >
                    <div className="relative aspect-video bg-dark">
                      <img
                        src={thumbUrl(v.id)}
                        alt={v.title || v.id}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.2' }}
                      />
                      {on && (
                        <div className="absolute top-1 right-1 bg-accent text-dark text-[10px] font-bold px-1.5 py-0.5 rounded">
                          ADDED
                        </div>
                      )}
                    </div>
                    <div className="p-2">
                      <div className="text-xs text-gray-300 line-clamp-2 min-h-[2rem]">
                        {v.title || 'Untitled clip'}
                      </div>
                      {v.publishedAt ? (
                        <div className="text-[10px] text-gray-600 mt-0.5">
                          {new Date(v.publishedAt).toLocaleDateString()}
                        </div>
                      ) : null}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {err && <p className="text-red-400 text-sm">{err}</p>}
    </div>
  )
}
