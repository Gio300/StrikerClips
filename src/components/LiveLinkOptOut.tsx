import { useState } from 'react'
import { Link } from 'react-router-dom'
import { leaveStageGroup } from '@/lib/liveLinkService'
import { LINK_OPT_OUT_COPY, type LinkOptOutChoice } from '@/lib/liveLink'

/**
 * "Don't connect me" — the way OUT of a link, offered right where the link is
 * announced instead of buried in settings.
 *
 * Three choices, escalating:
 *   • just this one   — leave the stage, keep auto-linking on
 *   • ask first       — leave, and be consulted before it happens again
 *   • never again     — leave, and never be auto-linked again
 *
 * Leaving is graceful for everyone else: if two or more angles remain the stage
 * carries on without you; if it drops below two there is no stage left, so the
 * group is closed and viewers are pointed at the stream that's still running
 * rather than a one-feed "multi-angle" page.
 */
export function LiveLinkOptOut({
  groupId,
  userId,
  onLeft,
  className = '',
}: {
  groupId: string
  userId: string
  onLeft?: (r: { collapsed: boolean; remainingStreamIds: string[] }) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<LinkOptOutChoice | null>(null)
  const [done, setDone] = useState<{ collapsed: boolean; remaining: string[] } | null>(null)

  async function choose(choice: LinkOptOutChoice) {
    if (busy) return
    setBusy(choice)
    try {
      const res = await leaveStageGroup({ groupId, userId, choice })
      setDone({ collapsed: res.collapsed, remaining: res.remainingStreamIds })
      onLeft?.({ collapsed: res.collapsed, remainingStreamIds: res.remainingStreamIds })
    } finally {
      setBusy(null)
    }
  }

  if (done) {
    return (
      <div className={`rounded-lg border border-dark-border bg-dark-card p-3 ${className}`}>
        <p className="text-sm text-white">Your stream is out of this stage.</p>
        <p className="text-xs text-gray-400 mt-1">
          {done.collapsed
            ? "There aren't enough angles left for a shared stage, so it's been closed. Anyone watching goes back to the single stream."
            : 'The other angles are still running for anyone watching.'}
        </p>
        <p className="text-xs text-gray-500 mt-2">
          You can change this any time in{' '}
          <Link to="/profile" className="text-accent hover:underline">
            your settings
          </Link>
          .
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-sm text-gray-400 hover:text-red-400 underline underline-offset-2 ${className}`}
      >
        Don't connect me
      </button>
    )
  }

  return (
    <div className={`rounded-lg border border-dark-border bg-dark-card p-3 space-y-1 ${className}`}>
      <p className="text-xs uppercase tracking-wider text-gray-500 px-1 pb-1">
        Take my stream out of this
      </p>
      {(Object.keys(LINK_OPT_OUT_COPY) as LinkOptOutChoice[]).map((choice) => {
        const c = LINK_OPT_OUT_COPY[choice]
        return (
          <button
            key={choice}
            type="button"
            onClick={() => choose(choice)}
            disabled={busy !== null}
            className="w-full text-left rounded-md px-2 py-2 hover:bg-dark-border/30 disabled:opacity-50"
          >
            <span className="block text-sm text-white">
              {busy === choice ? 'Working…' : c.label}
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">{c.help}</span>
          </button>
        )
      })}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-gray-500 hover:text-gray-300 px-2 pt-1"
      >
        Never mind
      </button>
    </div>
  )
}
