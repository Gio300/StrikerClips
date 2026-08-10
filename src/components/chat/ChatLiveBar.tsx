import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components/ui'
import {
  lastSeenLabel,
  memberName,
  presenceStatus,
  sortMembers,
  onlineCountLabel,
  type PresenceMember,
  type PresenceStatus,
} from '@/lib/chatPresence'
import type { ChatPollStatus } from '@/lib/chatMessages'

/**
 * ChatLiveBar — the shared "who is here" strip for every chat surface.
 *
 * One component so live, stage, tournament, channel and DM chat all present
 * presence identically; four hand-rolled strips would drift within a sprint.
 *
 * Renders NOTHING when presence is unavailable (signed out, backend down, fn
 * missing) — chat must look deliberate without it, not broken.
 */

const DOT: Record<PresenceStatus, string> = {
  online: 'bg-emerald-400',
  away: 'bg-yellow-400',
  offline: 'bg-gray-600',
}

export function ChatLiveBar({
  members,
  supported,
  selfId,
  className = '',
}: {
  members: readonly PresenceMember[]
  supported: boolean
  selfId?: string | null
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const wrapRef = useRef<HTMLDivElement>(null)

  // Re-rank while the roster panel is open so statuses age in front of the user.
  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [open])

  // Close the roster on an outside click, the way the app's other popovers do.
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const ranked = useMemo(() => sortMembers(members, now), [members, now])
  const label = onlineCountLabel(members, now)

  if (!supported || ranked.length === 0 || !label) return null

  const faces = ranked.slice(0, 4)

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => { setNow(Date.now()); setOpen((v) => !v) }}
        className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-white"
        aria-expanded={open}
        aria-label={`${label} — show who is here`}
        title="Who's here"
      >
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT.online}`} aria-hidden />
        <span className="tabular-nums">{label}</span>
        <span className="flex -space-x-1.5" aria-hidden>
          {faces.map((m) => (
            <Avatar
              key={m.userId}
              src={m.avatarUrl}
              name={memberName(m)}
              seed={m.userId}
              size={16}
              className="rounded-full ring-1 ring-dark-card"
            />
          ))}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-lg border border-dark-border bg-dark-card shadow-2xl">
          <p className="border-b border-dark-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-500">
            In this room
          </p>
          <ul className="max-h-64 overflow-y-auto py-1">
            {ranked.map((m) => {
              const status = presenceStatus(m, now)
              return (
                <li key={m.userId}>
                  <Link
                    to={`/profile/${m.userId}`}
                    className="flex items-center gap-2 px-3 py-1.5 hover:bg-dark-border/40"
                  >
                    <span className="relative shrink-0">
                      <Avatar src={m.avatarUrl} name={memberName(m)} seed={m.userId} size={22} />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-2 ring-dark-card ${DOT[status]}`}
                        aria-hidden
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs text-gray-200">
                        {memberName(m)}
                        {m.userId === selfId && <span className="text-gray-500"> (you)</span>}
                      </span>
                      <span className="block truncate text-[10px] text-gray-500">
                        {lastSeenLabel(m, now)}
                      </span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * TypingLine — "Gio is typing…". A fixed-height row so the message list does
 * not jump every time somebody starts and stops typing.
 */
export function TypingLine({ line, className = '' }: { line: string | null; className?: string }) {
  return (
    <div
      className={`h-4 px-3 text-[11px] italic text-gray-500 ${className}`}
      aria-live="polite"
      aria-atomic="true"
    >
      {line && (
        <span className="inline-flex items-center gap-1">
          <span className="flex gap-0.5" aria-hidden>
            <Dot delay="0ms" />
            <Dot delay="150ms" />
            <Dot delay="300ms" />
          </span>
          <span className="truncate">{line}</span>
        </span>
      )}
    </div>
  )
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1 w-1 animate-pulse rounded-full bg-gray-500 motion-reduce:animate-none"
      style={{ animationDelay: delay }}
    />
  )
}

/** What each non-live delivery state says. Nothing is an error, on purpose. */
const CONNECTION_LABEL: Partial<Record<ChatPollStatus, string>> = {
  reconnecting: 'Reconnecting…',
  offline: "You're offline — messages will catch up",
}

/**
 * ChatConnectionNote — the quiet line a chat surface shows when delivery is
 * struggling. One component so all four surfaces say the same thing.
 *
 * IT RENDERS NOTHING WHEN THINGS ARE FINE, and nothing when the backend simply
 * cannot serve the incremental read ('unsupported'): that room has always been
 * backfill-only and telling the viewer so helps nobody. It appears only for the
 * two states that are genuinely temporary, and only after the transport has
 * failed twice in a row — a single dropped packet heals on the next tick and is
 * not worth a word.
 *
 * THE TONE IS DELIBERATE. This is amber-on-transparent, lower case, no icon, no
 * border, no "Error". The operator's rule is that a rate limit or a blip must
 * never look like a broken chat: the room is still there, the messages are
 * still coming, we are just a few seconds behind. `aria-live="polite"` so a
 * screen reader hears it once it settles rather than interrupting a message.
 */
export function ChatConnectionNote({
  status,
  className = '',
}: {
  status: ChatPollStatus
  className?: string
}) {
  const label = CONNECTION_LABEL[status]
  if (!label) return null
  return (
    <p
      className={`px-3 py-1 text-[11px] text-amber-300/70 ${className}`}
      role="status"
      aria-live="polite"
    >
      <span className="inline-flex items-center gap-1.5">
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-amber-400/70 motion-reduce:animate-none"
          aria-hidden
        />
        {label}
      </span>
    </p>
  )
}
