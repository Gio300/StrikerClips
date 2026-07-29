import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { StreamChat } from '@/components/StreamChat'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { Avatar } from '@/components/ui'
import { extractYouTubeId, CLEAN_EMBED_PARAMS } from '@/lib/youtubeApi'
import { loadTheme } from '@/lib/broadcastTheme'

/**
 * LiveControlLayout — a Twitch-style, screen-maximizing shell for a single live
 * stream. Reference: a control-room banner (host facecam oval over a fire/ice
 * split, two team names + scores, a dono-goal bar), a big main stage, a gift-sub
 * leaderboard + colored chat docked on the right, and Gift-A-Sub / Get-Bits CTAs.
 *
 * WHAT'S REAL vs PLACEHOLDER (there is NO new backend here):
 *   • Main stage video ........... REAL — the stream's youtube_url.
 *   • Host facecam oval + name ... REAL — the host's `profiles` row (avatar/username).
 *   • Team names ................. REAL — the host's saved broadcast theme
 *                                  (src/lib/broadcastTheme.ts, keyed by host id),
 *                                  the same names they set on the Broadcast page.
 *   • Chat (role/badge colored) .. REAL — reuses <StreamChat> (badges via badges.ts).
 *   • Get Bits / Gift-A-Sub ...... REAL routing — links to the existing /shop.
 *   • Wallet balance chip ........ REAL — useWallet (tokens).
 *   • Team SCORES ................ PLACEHOLDER — host-editable client state,
 *                                  cached per-stream in localStorage. See TODO:
 *                                  needs a `live_streams.score_a/score_b` (or a
 *                                  `live_scoreboard` table) so viewers see it live.
 *   • Dono goal bar .............. PLACEHOLDER — host-editable client state. TODO:
 *                                  drive `current` from an aggregate of this
 *                                  stream's tips/donations once that's queryable.
 *   • Gift-sub leaderboard ....... PLACEHOLDER — empty-state today. TODO: read a
 *                                  per-stream gifted_subs aggregate when it exists.
 */

type Props = {
  streamId: string
  youtubeUrl: string
  title: string | null
  /** The host's user id — used to load their profile (facecam) + team theme. */
  hostId?: string
  /** Off for direct-URL playback where there's no stored row (no chat/host). */
  enableChat?: boolean
  /** Optional slot rendered top-right of the banner (e.g. a ShareButton). */
  headerRight?: ReactNode
}

// The host-editable, not-yet-backed scoreboard. TODO(backend): promote these to
// real columns/table so every viewer sees the same score + goal in realtime.
// Until then they live per-stream in localStorage and only the host's device
// reflects edits — a clean visual placeholder, never fake "live" numbers.
type Scoreboard = {
  scoreA: number
  scoreB: number
  donoCurrent: number
  donoTarget: number
}

const BOARD_KEY = (streamId: string) => `kc_live_board:${streamId}`

const DEFAULT_BOARD: Scoreboard = { scoreA: 0, scoreB: 0, donoCurrent: 0, donoTarget: 200 }

function loadBoard(streamId: string): Scoreboard {
  try {
    const raw = localStorage.getItem(BOARD_KEY(streamId))
    if (!raw) return { ...DEFAULT_BOARD }
    const p = JSON.parse(raw) as Partial<Scoreboard>
    return {
      scoreA: Number.isFinite(p.scoreA) ? Number(p.scoreA) : 0,
      scoreB: Number.isFinite(p.scoreB) ? Number(p.scoreB) : 0,
      donoCurrent: Number.isFinite(p.donoCurrent) ? Number(p.donoCurrent) : 0,
      donoTarget: Number.isFinite(p.donoTarget) && Number(p.donoTarget) > 0 ? Number(p.donoTarget) : 200,
    }
  } catch {
    return { ...DEFAULT_BOARD }
  }
}

function saveBoard(streamId: string, board: Scoreboard): void {
  try { localStorage.setItem(BOARD_KEY(streamId), JSON.stringify(board)) } catch { /* quota */ }
}

type HostProfile = { username: string | null; avatarUrl: string | null }

// ─── inline SVG icons (lucide isn't installed) ─────────────────────────────
function GiftIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
      <path d="M12 8S10.5 4 8 4a2 2 0 1 0 0 4h4zM12 8s1.5-4 4-4a2 2 0 1 1 0 4h-4z" />
    </svg>
  )
}
function GemIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M6 3h12l4 6-10 12L2 9z" />
      <path d="M2 9h20M12 21 8 9l4-6 4 6-4 12" />
    </svg>
  )
}
function CrownIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M2 18h20l-1.5-9-5 4-3.5-7-3.5 7-5-4z" />
    </svg>
  )
}

export function LiveControlLayout({ streamId, youtubeUrl, title, hostId, enableChat = true, headerRight }: Props) {
  const { user } = useAuth()
  const wallet = useWallet()
  const isHost = !!user && !!hostId && user.id === hostId

  const videoId = extractYouTubeId(youtubeUrl)

  // Team names come straight from the host's saved broadcast theme — the SAME
  // names they type on /broadcast. Real, reused data (no new backend).
  const theme = useMemo(() => loadTheme(hostId || 'default'), [hostId])
  const teamA = theme.teamA || 'Team A'
  const teamB = theme.teamB || 'Team B'
  const accent = theme.accent

  // Host facecam + name from the host's profile row (real data).
  const [host, setHost] = useState<HostProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!hostId) { setHost(null); return }
    supabase
      .from('profiles')
      .select('username, avatar_url')
      .eq('id', hostId)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setHost(data ? { username: data.username ?? null, avatarUrl: data.avatar_url ?? null } : null)
      })
    return () => { cancelled = true }
  }, [hostId])

  // PLACEHOLDER scoreboard — host-editable, per-stream localStorage. See notes above.
  const [board, setBoard] = useState<Scoreboard>(() => loadBoard(streamId))
  useEffect(() => { setBoard(loadBoard(streamId)) }, [streamId])
  const patchBoard = (patch: Partial<Scoreboard>) => {
    setBoard((prev) => {
      const next = { ...prev, ...patch }
      next.scoreA = Math.max(0, next.scoreA)
      next.scoreB = Math.max(0, next.scoreB)
      next.donoCurrent = Math.max(0, next.donoCurrent)
      next.donoTarget = Math.max(1, next.donoTarget)
      saveBoard(streamId, next)
      return next
    })
  }

  const donoPct = Math.min(100, Math.round((board.donoCurrent / board.donoTarget) * 100))
  const hostName = host?.username || theme.hostName || 'Host'

  return (
    <div className="w-full">
      {/* ── TOP BANNER: fire/ice split, host facecam oval, team-vs-team scores ── */}
      <div className="relative rounded-2xl overflow-hidden border border-dark-border">
        {/* fire (left) → ice (right) split. Inline gradient — not a Tailwind color. */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(90deg, #7a1500 0%, #c2410c 30%, #171326 50%, #0e7490 70%, #052e45 100%)' }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-black/35" aria-hidden />

        <div className="relative px-3 sm:px-6 py-4 sm:py-5">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-black/50 text-[11px] font-bold text-white uppercase tracking-wider">
              <span className="inline-block w-2 h-2 rounded-full bg-kunai animate-pulse" /> Live
            </span>
            {headerRight}
          </div>

          {/* Team A ── score ── (facecam) ── score ── Team B */}
          <div className="flex items-center justify-center gap-2 sm:gap-5">
            {/* Team A */}
            <div className="flex-1 min-w-0 text-right">
              <p className="font-black text-white text-sm sm:text-2xl uppercase tracking-wide truncate drop-shadow">{teamA}</p>
              <div className="mt-1 flex items-center justify-end gap-1.5">
                <ScoreValue value={board.scoreA} />
                {isHost && <Stepper onDec={() => patchBoard({ scoreA: board.scoreA - 1 })} onInc={() => patchBoard({ scoreA: board.scoreA + 1 })} />}
              </div>
            </div>

            {/* Host facecam oval (centered over the split) */}
            <div className="shrink-0 flex flex-col items-center gap-1">
              <div
                className="w-16 h-20 sm:w-24 sm:h-28 rounded-full overflow-hidden ring-2 ring-white/80 shadow-lg flex items-center justify-center bg-dark"
                style={{ boxShadow: `0 0 0 2px ${accent}` }}
              >
                {host?.avatarUrl ? (
                  <img src={host.avatarUrl} alt={hostName} className="w-full h-full object-cover" />
                ) : (
                  <Avatar src={host?.avatarUrl ?? null} name={hostName} seed={hostId || streamId} size={72} />
                )}
              </div>
              <span className="px-2 py-0.5 rounded-full bg-black/55 text-[10px] sm:text-xs font-semibold text-white max-w-[7rem] truncate">
                {hostName}
              </span>
            </div>

            {/* Team B */}
            <div className="flex-1 min-w-0 text-left">
              <p className="font-black text-white text-sm sm:text-2xl uppercase tracking-wide truncate drop-shadow">{teamB}</p>
              <div className="mt-1 flex items-center justify-start gap-1.5">
                {isHost && <Stepper onDec={() => patchBoard({ scoreB: board.scoreB - 1 })} onInc={() => patchBoard({ scoreB: board.scoreB + 1 })} />}
                <ScoreValue value={board.scoreB} />
              </div>
            </div>
          </div>

          {title && (
            <p className="mt-3 text-center text-xs sm:text-sm text-white/85 truncate">{title}</p>
          )}
        </div>
      </div>

      {/* ── DONO GOAL bar (placeholder — host sets target/current; TODO backend) ── */}
      <div className="mt-3 rounded-xl border border-dark-border bg-dark-card px-3 sm:px-4 py-2.5">
        <div className="flex items-center justify-between text-xs sm:text-sm mb-1.5">
          <span className="font-semibold text-white flex items-center gap-1.5">
            <GiftIcon className="w-4 h-4 text-accent" /> Dono Goal
          </span>
          <span className="tabular-nums text-gray-300">
            {board.donoCurrent}
            <span className="text-gray-500">/{board.donoTarget}</span>
          </span>
        </div>
        <div className="h-2.5 rounded-full bg-dark overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${donoPct}%`, background: accent }} />
        </div>
        {isHost && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <button type="button" onClick={() => patchBoard({ donoCurrent: board.donoCurrent + 5 })} className="px-2 py-1 rounded border border-dark-border text-gray-300 hover:text-accent hover:border-accent/50">+5 raised</button>
            <label className="flex items-center gap-1 text-gray-400">
              Goal
              <input
                type="number"
                min={1}
                value={board.donoTarget}
                onChange={(e) => patchBoard({ donoTarget: Number(e.target.value) })}
                className="w-20 px-2 py-1 rounded bg-dark border border-dark-border text-white"
              />
            </label>
            <span className="text-gray-600">Host-only preview · a shared live goal needs a backend field</span>
          </div>
        )}
      </div>

      {/* ── MAIN STAGE + RIGHT RAIL (leaderboard + chat) ─────────────────────── */}
      <div className="mt-3 grid lg:grid-cols-[minmax(0,1fr)_340px] gap-3 items-start">
        <div className="min-w-0">
          {/* Big single stage — fills the column width. */}
          <div className="relative rounded-xl border border-dark-border overflow-hidden bg-black">
            <div className="aspect-video">
              {videoId ? (
                <CroppedFrame>
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}?autoplay=1&${CLEAN_EMBED_PARAMS}`}
                    title={title ?? 'Live stream'}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full"
                  />
                </CroppedFrame>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-center p-6">
                  <div>
                    <p className="text-gray-300 mb-3">This stream isn't a YouTube link, so it can't play inside TKO.</p>
                    <a href={youtubeUrl} target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Open stream ↗</a>
                  </div>
                </div>
              )}
            </div>
            {videoId && <TkoWatermark />}
          </div>

          {/* Action CTAs — real routing into the existing shop. */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow"
            >
              <GiftIcon className="w-4 h-4" /> Gift A Sub
            </Link>
            <Link
              to="/shop"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10"
            >
              <GemIcon className="w-4 h-4" /> Get Bits
            </Link>
            {user && (
              <span className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-dark-card border border-dark-border text-sm text-gray-300">
                <GemIcon className="w-4 h-4 text-accent" />
                <span className="tabular-nums font-semibold text-white">{wallet.tokens}</span>
                <span className="text-gray-500">bits</span>
              </span>
            )}
          </div>
        </div>

        {/* Right rail: gift-sub leaderboard on top, live chat below. On mobile
            this stacks under the stage. */}
        <div className="space-y-3">
          <GiftSubLeaderboard accent={accent} />
          {enableChat ? (
            <StreamChat streamId={streamId} title={title} />
          ) : (
            <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-center text-xs text-gray-500">
              Open this stream from its TKO page to join the chat.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Big score number in the banner. */
function ScoreValue({ value }: { value: number }) {
  return (
    <span className="inline-block min-w-[1.5ch] text-center tabular-nums font-black text-white text-xl sm:text-4xl leading-none drop-shadow">
      {value}
    </span>
  )
}

/** Host-only score stepper (− / +). */
function Stepper({ onDec, onInc }: { onDec: () => void; onInc: () => void }) {
  return (
    <span className="inline-flex flex-col gap-0.5">
      <button type="button" onClick={onInc} className="w-5 h-5 flex items-center justify-center rounded bg-black/50 text-white text-xs leading-none hover:bg-black/70" aria-label="Increase score">+</button>
      <button type="button" onClick={onDec} className="w-5 h-5 flex items-center justify-center rounded bg-black/50 text-white text-xs leading-none hover:bg-black/70" aria-label="Decrease score">−</button>
    </span>
  )
}

/**
 * GiftSubLeaderboard — top-3 gift-sub givers.
 *
 * PLACEHOLDER: there is no per-stream gifted-subs aggregate the client can read
 * today, so this shows a clean empty state. TODO(backend): populate from a
 * `gifted_subs` (or artifacts) aggregate grouped by giver for this stream.
 */
function GiftSubLeaderboard({ accent }: { accent: string }) {
  const rows: { name: string; count: number }[] = [] // TODO: real top-3 gifters
  const podium = ['text-yellow-300', 'text-slate-200', 'text-amber-500']
  return (
    <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      <div className="px-3 py-2 border-b border-dark-border flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-400">
        <CrownIcon className="w-4 h-4 text-yellow-300" />
        <span>Top Gifters</span>
      </div>
      <div className="p-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-3">
            No gifted subs yet — be the first.{' '}
            <Link to="/shop" className="text-accent hover:underline">Gift a sub</Link>
          </p>
        ) : (
          rows.slice(0, 3).map((r, i) => (
            <div key={r.name} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <CrownIcon className={`w-4 h-4 ${podium[i] ?? 'text-gray-500'}`} />
                <span className="truncate text-sm text-white">{r.name}</span>
              </span>
              <span className="tabular-nums text-sm font-semibold" style={{ color: accent }}>{r.count}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default LiveControlLayout
