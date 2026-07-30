import { useState, type ReactNode } from 'react'

/**
 * CollapsibleSection — a tappable header row that expands/collapses its children.
 *
 * Progressive disclosure primitive: secondary content (share buttons, upload
 * queues, comments, rules, settings…) tucks under a clean ONE-WORD label so the
 * primary media (video/player) and chat get the screen. Phone-first, on-brand
 * (near-black card, subtle border, orange chakra chevron), dependency-free.
 *
 *   <CollapsibleSection id="reel-share" label="Share" count={6}>
 *     <ShareButtons … />
 *   </CollapsibleSection>
 *
 * Behaviour:
 *   - Generous tap target (full-width header, py-3.5) so it's easy on a phone.
 *   - Open/closed state persists per `id` in localStorage, so a viewer's
 *     choices survive refreshes and navigation.
 *   - `defaultOpen` seeds the FIRST-EVER state; once the viewer toggles, their
 *     choice wins.
 *   - Children stay MOUNTED while collapsed (height-animated to 0) so any live
 *     state — comment subscriptions, players, counts in the header — keeps
 *     ticking. The clean open/close uses a CSS grid-rows transition, no JS
 *     measuring, no dependencies.
 */

const STORAGE_PREFIX = 'tko:section:'

function readStored(id: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  try {
    const v = window.localStorage.getItem(STORAGE_PREFIX + id)
    if (v === '1') return true
    if (v === '0') return false
  } catch {
    /* storage blocked (private mode / SSR) — fall back */
  }
  return fallback
}

function writeStored(id: string, open: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, open ? '1' : '0')
  } catch {
    /* ignore */
  }
}

export type CollapsibleSectionProps = {
  /** Stable id — used as the localStorage key so open/closed persists. */
  id: string
  /** ONE-WORD, commonly-understood label (Share, Comments, Upload, …). */
  label: string
  /** Optional small count shown next to the label (e.g. comment count). */
  count?: number | string
  /** Seeds the first-ever open state; the viewer's toggle then persists. */
  defaultOpen?: boolean
  /** Optional right-aligned hint text, shown before the chevron. */
  hint?: ReactNode
  children: ReactNode
  className?: string
}

export function CollapsibleSection({
  id,
  label,
  count,
  defaultOpen = false,
  hint,
  children,
  className = '',
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState<boolean>(() => readStored(id, defaultOpen))
  const bodyId = `section-${id}`

  function toggle() {
    setOpen((prev) => {
      const next = !prev
      writeStored(id, next)
      return next
    })
  }

  const showCount = count !== undefined && count !== null && `${count}` !== '0' && count !== ''

  return (
    <div className={`rounded-xl border border-dark-border bg-dark-card overflow-hidden ${className}`}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center gap-2 px-4 py-3.5 text-left select-none hover:bg-dark-elevated/50 transition-colors"
      >
        <span className="font-semibold text-[15px] text-white">{label}</span>
        {showCount && (
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-dark-elevated text-xs text-gray-300 tabular-nums">
            {count}
          </span>
        )}
        {hint && <span className="ml-auto text-xs text-gray-500 truncate">{hint}</span>}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={`${hint ? '' : 'ml-auto'} shrink-0 text-chakra transition-transform duration-300 ${open ? 'rotate-0' : '-rotate-90'}`}
          style={{ color: '#f59e0b' }}
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div
        id={bodyId}
        className={`grid transition-[grid-template-rows] duration-300 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="px-4 pb-4 pt-1">{children}</div>
        </div>
      </div>
    </div>
  )
}

export default CollapsibleSection
