import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { usePip } from './PipContext'

/**
 * PipWidget — the floating picture-in-picture card rendered at the app root.
 *
 * Shows the currently-minimized session (its `render()` output — e.g. a video
 * player) in a small card the user can drag around or leave corner-docked. It
 * has a MAXIMIZE control (navigate back to the session's restore route + clear)
 * and a CLOSE control (clear without navigating).
 *
 * Phone-first: it corner-docks bottom-right ABOVE the fixed BottomNav (which is
 * ~4rem tall + safe-area) so it never overlaps navigation. On drag it switches
 * to free positioning, clamped to the viewport.
 */

const CARD_WIDTH = 232 // px — compact, phone-friendly

export function PipWidget() {
  const { session, close } = usePip()
  const navigate = useNavigate()
  const location = useLocation()

  // Free-drag position (top-left px). `null` = use the default corner dock.
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // If the user navigates to the session's own route, drop the PiP — the full
  // surface is on screen again, so the little dock would just be a duplicate.
  useEffect(() => {
    if (session && location.pathname === session.restorePath) close()
  }, [location.pathname, session, close])

  if (!session) return null

  function onPointerDown(e: React.PointerEvent) {
    const card = cardRef.current
    if (!card) return
    const rect = card.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const card = cardRef.current
    const w = card?.offsetWidth ?? CARD_WIDTH
    const h = card?.offsetHeight ?? 160
    const maxX = window.innerWidth - w - 8
    const maxY = window.innerHeight - h - 8
    const x = Math.max(8, Math.min(maxX, e.clientX - d.dx))
    const y = Math.max(8, Math.min(maxY, e.clientY - d.dy))
    setPos({ x, y })
  }

  function onPointerUp(e: React.PointerEvent) {
    dragRef.current = null
    ;(e.target as Element).releasePointerCapture?.(e.pointerId)
  }

  function maximize() {
    const path = session!.restorePath
    close()
    navigate(path)
  }

  // Default corner dock (phone: clear of the bottom nav) vs. dragged position.
  const dockStyle: React.CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : { right: 12, bottom: 'calc(4.75rem + env(safe-area-inset-bottom))' }

  return (
    <div
      ref={cardRef}
      className="fixed z-[68] sm:bottom-4 rounded-xl border border-accent/40 bg-dark-card shadow-2xl overflow-hidden animate-slide-up"
      style={{ width: CARD_WIDTH, ...dockStyle }}
      role="dialog"
      aria-label={`Minimized: ${session.title}`}
    >
      {/* Title bar — the drag handle + controls. */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex items-center gap-1 px-2 py-1.5 bg-dark-elevated border-b border-dark-border cursor-grab active:cursor-grabbing touch-none select-none"
      >
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-white">{session.title}</span>
        <button
          type="button"
          onClick={maximize}
          aria-label="Maximize"
          title="Maximize"
          className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:text-accent hover:bg-dark-border/50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 14v6h6M20 10V4h-6M14 4h6v6M10 20H4v-6" />
          </svg>
        </button>
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          title="Close"
          className="shrink-0 h-6 w-6 flex items-center justify-center rounded text-gray-300 hover:text-white hover:bg-dark-border/50"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      {/* Media — the minimized content keeps playing here. Tapping it maximizes. */}
      <button
        type="button"
        onClick={maximize}
        aria-label={`Maximize ${session.title}`}
        className="block w-full aspect-video bg-black text-left"
      >
        <div className="w-full h-full pointer-events-none">{session.render()}</div>
      </button>
    </div>
  )
}

export default PipWidget
