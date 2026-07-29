import { useEffect, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { NinjaIcon } from './NinjaIcon'

/**
 * Drawer / SlideOver — a reusable bottom-sheet (or side) panel. Phone-first.
 *
 *   • Slides in from `side` ('bottom' | 'right' | 'left') over a dimmed,
 *     blurred backdrop.
 *   • Locks body scroll while open.
 *   • Closes on backdrop tap, on Escape, and automatically when the route
 *     changes (so navigating from inside the sheet tidies up after itself).
 *   • Renders nothing when closed (no stray DOM / focus traps).
 *
 *   <Drawer open={open} onClose={() => setOpen(false)} title="Options">…</Drawer>
 */

export type DrawerSide = 'bottom' | 'right' | 'left'

export type DrawerProps = {
  open: boolean
  onClose: () => void
  side?: DrawerSide
  title?: ReactNode
  children: ReactNode
  /** Extra classes on the panel (e.g. max-width). */
  className?: string
  /** Hide the little grab handle on the bottom sheet. */
  hideHandle?: boolean
}

export function Drawer({
  open,
  onClose,
  side = 'bottom',
  title,
  children,
  className = '',
  hideHandle = false,
}: DrawerProps) {
  const location = useLocation()

  // Close whenever the route changes.
  useEffect(() => {
    if (open) onClose()
    // Intentionally only reacts to path changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Lock body scroll + wire Escape while open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const panelPos =
    side === 'bottom'
      ? 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl border-t animate-slide-up pb-[calc(1rem+env(safe-area-inset-bottom))]'
      : side === 'right'
        ? 'inset-y-0 right-0 w-[88%] max-w-sm border-l animate-slide-in-right'
        : 'inset-y-0 left-0 w-[88%] max-w-sm border-r animate-slide-in-left'

  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
      <button
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
      />
      <div
        className={`absolute overflow-y-auto border-dark-border bg-dark-card px-4 pt-3 shadow-2xl ${panelPos} ${className}`}
      >
        {side === 'bottom' && !hideHandle && (
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-dark-border" aria-hidden />
        )}
        {title && (
          <div className="mb-3 flex items-center gap-2">
            <div className="text-sm font-semibold text-white">{title}</div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto -mr-1 rounded-lg p-1.5 text-gray-400 hover:text-white hover:bg-dark-elevated"
            >
              <NinjaIcon name="plus" size={18} className="rotate-45" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export default Drawer
