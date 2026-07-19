import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useClipTray } from '@/hooks/useClipTray'
import { extractYouTubeId } from '@/lib/youtubeApi'

/**
 * In-app browser — the surface where a player pulls up the PlayStation /
 * Xbox site (or any app) and pastes a KillCam clip link to post it anywhere.
 *
 * On the web build many sites block being framed (X-Frame-Options / CSP), so
 * we always offer "Open in new tab". Inside the mobile wrapper (Capacitor /
 * Tauri WebView) the same page loads full-screen with no framing limits — the
 * iframe is swapped for a native in-app browser view there.
 */

type Shortcut = { label: string; url: string; tint: string }

const SHORTCUTS: Shortcut[] = [
  { label: 'PlayStation', url: 'https://www.playstation.com/', tint: 'from-[#0070d1] to-[#003791]' },
  { label: 'Xbox', url: 'https://www.xbox.com/', tint: 'from-[#107c10] to-[#0b5c0b]' },
  { label: 'YouTube', url: 'https://www.youtube.com/', tint: 'from-[#ff0000] to-[#b00000]' },
  { label: 'Twitch', url: 'https://www.twitch.tv/', tint: 'from-[#9146ff] to-[#5c2db0]' },
  { label: 'TikTok', url: 'https://www.tiktok.com/', tint: 'from-[#25f4ee] to-[#fe2c55]' },
  { label: 'X', url: 'https://x.com/', tint: 'from-[#333] to-[#000]' },
  { label: 'Discord', url: 'https://discord.com/app', tint: 'from-[#5865f2] to-[#3a44c0]' },
  { label: 'Instagram', url: 'https://www.instagram.com/', tint: 'from-[#f9ce34] via-[#ee2a7b] to-[#6228d7]' },
]

function normalizeUrl(input: string): string {
  const v = input.trim()
  if (!v) return ''
  if (/^https?:\/\//i.test(v)) return v
  // Looks like a domain? prefix https. Otherwise treat as a web search.
  if (/^[\w-]+(\.[\w-]+)+/.test(v)) return `https://${v}`
  return `https://www.google.com/search?q=${encodeURIComponent(v)}`
}

export function Browser() {
  const navigate = useNavigate()
  const { add: stash, count: trayCount } = useClipTray()
  const [address, setAddress] = useState('')
  const [current, setCurrent] = useState<string>('')
  const [clip, setClip] = useState('')
  const [copied, setCopied] = useState(false)
  const [stashed, setStashed] = useState('')
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const flash = (msg: string) => { setStashed(msg); setTimeout(() => setStashed(''), 1800) }

  const go = (raw: string) => {
    const url = normalizeUrl(raw)
    if (!url) return
    setCurrent(url)
    setAddress(url)
  }

  const openExternal = () => {
    if (current) window.open(current, '_blank', 'noopener,noreferrer')
  }

  const copyClip = async () => {
    if (!clip.trim()) return
    try {
      await navigator.clipboard.writeText(clip.trim())
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked; user can long-press to copy */ }
  }

  const host = useMemo(() => {
    try { return current ? new URL(current).host : '' } catch { return '' }
  }, [current])

  // Stash whatever's open in the browser into the shared tray, ready to drop
  // into a reel. YouTube video pages are the sweet spot; anything else stashes
  // as a plain link the user can still share.
  const sendCurrentToKillCam = () => {
    if (!current) return
    const isVideo = !!extractYouTubeId(current)
    stash({ url: current, source: 'browser', fromHost: host })
    flash(isVideo ? 'Clip sent to KillCam ✓' : 'Link sent to KillCam ✓')
  }

  const sendClipToKillCam = () => {
    const url = clip.trim()
    if (!url) return
    stash({ url, source: 'browser' })
    flash('Sent to KillCam ✓')
  }

  return (
    <div className="flex flex-col h-[calc(100vh-0px)]">
      {/* Address + actions */}
      <div className="p-3 border-b border-dark-border bg-dark-card/60 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-[220px]">
          <span className="text-xs text-gray-500 hidden sm:block">🔒</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') go(address) }}
            placeholder="Search or paste a link (playstation.com, xbox.com…)"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-kunai"
          />
          <button onClick={() => go(address)} className="px-3 py-2 rounded-lg bg-kunai text-dark text-sm font-semibold shrink-0">Go</button>
        </div>
        {current && (
          <button onClick={sendCurrentToKillCam} className="px-3 py-2 rounded-lg bg-accent text-dark text-sm font-semibold shrink-0 hover:shadow-glow">
            + Send to KillCam
          </button>
        )}
        {current && (
          <button onClick={openExternal} className="px-3 py-2 rounded-lg border border-dark-border text-gray-300 text-sm hover:border-kunai/40 shrink-0">
            Open in new tab ↗
          </button>
        )}
        <button
          onClick={() => navigate('/create')}
          className="px-3 py-2 rounded-lg border border-accent/50 text-accent text-sm shrink-0 hover:bg-accent/10"
          title="Open the reel builder — your tray is waiting there"
        >
          Tray{trayCount > 0 ? ` (${trayCount})` : ''} → Build
        </button>
      </div>
      {stashed && (
        <div className="px-3 py-1.5 text-xs text-accent bg-accent/10 border-b border-accent/20">{stashed}</div>
      )}

      {!current ? (
        /* Start page: shortcuts + clip helper */
        <div className="flex-1 overflow-y-auto p-5">
          <h1 className="text-xl font-bold">Post your clips anywhere</h1>
          <p className="text-sm text-gray-500 mt-1">Pull up your console or any app, then drop your KillCam link into it.</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {SHORTCUTS.map((s) => (
              <button
                key={s.label}
                onClick={() => go(s.url)}
                className={`h-24 rounded-xl bg-gradient-to-br ${s.tint} text-white font-semibold flex items-end p-3 shadow-md hover:brightness-110 transition`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="mt-8 rounded-xl border border-dark-border bg-dark-card p-4 max-w-2xl">
            <div className="text-sm font-medium text-white">Gather a clip</div>
            <p className="text-xs text-gray-500 mt-1">Paste a YouTube / KillCam link — copy it to share, or send it to your tray to build a reel from it.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                value={clip}
                onChange={(e) => setClip(e.target.value)}
                placeholder="https://youtu.be/…  or  killcam.app/reels/…"
                className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-kunai"
              />
              <button onClick={sendClipToKillCam} className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold">
                + Send to KillCam
              </button>
              <button onClick={copyClip} className="px-4 py-2 rounded-lg border border-dark-border text-gray-200 text-sm hover:border-kunai/40">
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Framed site */
        <div className="flex-1 relative bg-black">
          <iframe
            ref={iframeRef}
            src={current}
            title={host}
            className="absolute inset-0 w-full h-full"
            sandbox="allow-forms allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            referrerPolicy="no-referrer"
          />
          {/* Fallback hint layered under the iframe — visible only if the site refuses to frame (blank iframe). */}
          <div className="pointer-events-none absolute inset-0 -z-0 flex items-center justify-center p-6">
            <div className="pointer-events-auto text-center max-w-sm">
              <p className="text-sm text-gray-400">
                If <span className="text-gray-200">{host}</span> doesn’t load here, it blocks embedding —
                open it in a new tab, then come back and copy your clip link.
              </p>
              <button onClick={openExternal} className="mt-3 px-4 py-2 rounded-lg bg-kunai text-dark text-sm font-semibold">
                Open {host} ↗
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
