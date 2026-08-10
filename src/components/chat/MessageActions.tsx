import { useState } from 'react'
import { CornerUpLeft, SmilePlus, X } from 'lucide-react'
import { QUICK_REACTIONS, reactionLabel, type ReactionTally } from '@/lib/chatReactions'
import { EmojiPickerButton } from './EmojiPickerButton'
import type { ReplyTarget } from '@/lib/chatReplies'

/**
 * MessageActions — the per-message affordances shared by every chat surface:
 * the reaction chips, the tap-to-react control, and the reply button. Plus
 * ReplyQuote (the quoted parent shown above a reply) and ReplyingToBar (the
 * strip above the composer while you compose one).
 *
 * All presentation, no data access: the surfaces own their message state and
 * pass callbacks in, so this file stays identical for stream / tournament /
 * stage / channel / DM. Every label is real text, never markup.
 */

/** The reaction chips under a message, plus the "add a reaction" control. */
export function ReactionRow({
  tallies,
  onToggle,
  canReact,
  className = '',
}: {
  tallies: readonly ReactionTally[]
  onToggle: (emoji: string) => void
  /** False when signed out — chips still show counts but don't respond. */
  canReact: boolean
  className?: string
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  if (tallies.length === 0 && !canReact) return null

  return (
    <div className={`mt-1 flex flex-wrap items-center gap-1 ${className}`}>
      {tallies.map((tally) => (
        <button
          key={tally.emoji}
          type="button"
          disabled={!canReact}
          onClick={() => onToggle(tally.emoji)}
          title={reactionLabel(tally)}
          aria-label={reactionLabel(tally)}
          aria-pressed={tally.mine}
          className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] leading-none ${
            tally.mine
              ? 'border-accent/60 bg-accent/15 text-accent'
              : 'border-dark-border bg-dark/60 text-gray-300'
          } ${canReact ? 'hover:border-gray-500' : 'cursor-default'}`}
        >
          <span aria-hidden>{tally.emoji}</span>
          <span className="tabular-nums">{tally.count}</span>
        </button>
      ))}

      {canReact && (
        <div className="relative inline-flex">
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-label="Add a reaction"
            aria-expanded={pickerOpen}
            title="Add a reaction"
            className="inline-flex items-center rounded-full border border-dark-border bg-dark/60 px-1.5 py-0.5 text-gray-500 hover:text-accent"
          >
            <SmilePlus className="h-3 w-3" aria-hidden />
          </button>
          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-20 mb-1 flex items-center gap-0.5 rounded-full border border-dark-border bg-dark-card px-1.5 py-1 shadow-2xl">
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggle(emoji)
                    setPickerOpen(false)
                  }}
                  aria-label={`React with ${emoji}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-sm hover:bg-dark-border/60"
                >
                  {emoji}
                </button>
              ))}
              <span className="mx-0.5 h-4 w-px bg-dark-border" aria-hidden />
              <EmojiPickerButton
                align="left"
                title="More emoji"
                className="[&>button]:h-6 [&>button]:w-6 [&>button]:border-0"
                onPick={(char) => {
                  onToggle(char)
                  setPickerOpen(false)
                }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** The small "Reply" button revealed on a message row. */
export function ReplyButton({
  onClick,
  className = '',
}: {
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Reply to this message"
      title="Reply"
      className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] text-gray-500 hover:text-accent ${className}`}
    >
      <CornerUpLeft className="h-3 w-3" aria-hidden />
      Reply
    </button>
  )
}

/**
 * The quoted parent shown above a reply. Clicking it jumps to the parent, which
 * each surface implements by scrolling to `data-message-id`.
 */
export function ReplyQuote({
  target,
  onJump,
  className = '',
}: {
  target: ReplyTarget
  onJump?: (messageId: string) => void
  className?: string
}) {
  const body = (
    <>
      <CornerUpLeft className="h-3 w-3 shrink-0 text-gray-600" aria-hidden />
      <span className="shrink-0 font-medium text-accent/80">{target.author}</span>
      <span className="truncate text-gray-500">{target.preview || 'message'}</span>
    </>
  )
  const shared = `flex min-w-0 items-center gap-1 border-l-2 border-dark-border pl-1.5 text-[11px] leading-tight ${className}`

  if (!onJump) return <div className={shared}>{body}</div>
  return (
    <button
      type="button"
      onClick={() => onJump(target.id)}
      title={`Jump to ${target.author}'s message`}
      className={`${shared} w-full text-left hover:border-accent/60`}
    >
      {body}
    </button>
  )
}

/** The strip above the composer while a reply is being written. */
export function ReplyingToBar({
  target,
  onCancel,
  className = '',
}: {
  target: ReplyTarget
  onCancel: () => void
  className?: string
}) {
  return (
    <div
      className={`flex items-center gap-2 border-b border-dark-border bg-dark/40 px-3 py-1.5 text-[11px] ${className}`}
    >
      <CornerUpLeft className="h-3 w-3 shrink-0 text-accent" aria-hidden />
      <span className="shrink-0 text-gray-400">
        Replying to <span className="text-accent">{target.author}</span>
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-500">{target.preview}</span>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel reply"
        title="Cancel reply"
        className="shrink-0 text-gray-500 hover:text-white"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  )
}
