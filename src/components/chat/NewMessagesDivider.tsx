/**
 * NewMessagesDivider — the single "New messages" rule drawn above the first
 * message the viewer has not read, shared by every chat surface.
 *
 * The divider is a READ-POSITION marker, not a live counter: it is computed once
 * from the watermark captured when the room opened (src/lib/chatUnread.ts) and
 * deliberately does not move as you read, so it stays a usable landmark while
 * you scroll back up.
 */
export function NewMessagesDivider({ count }: { count?: number }) {
  return (
    <div className="flex items-center gap-2 py-0.5 select-none" role="separator" aria-label="New messages">
      <span className="h-px flex-1 bg-kunai/40" />
      <span className="shrink-0 rounded-full bg-kunai/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-kunai">
        {count && count > 0 ? `${count > 99 ? '99+' : count} new` : 'New'}
      </span>
      <span className="h-px flex-1 bg-kunai/40" />
    </div>
  )
}

export default NewMessagesDivider
