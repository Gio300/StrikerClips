import { StreamChat } from '@/components/StreamChat'

/**
 * MergedStreamChat — BOTH streamers' chats for a linked multi-angle stage.
 *
 * One angle → the normal single chat. Two or more real streams → each streamer's
 * (tested) StreamChat stacked under a compact header, so a viewer of the combined
 * battle sees the whole room, not just one side. The featured streamer's chat is
 * shown first so the column tracks the director's cut. Capped at two panes to
 * stay readable on a phone.
 */
export interface MergedChatCard {
  streamId: string
  handle: string
}

export function MergedStreamChat({
  cards,
  featuredStreamId,
}: {
  cards: MergedChatCard[]
  featuredStreamId?: string | null
}) {
  const list = cards.filter((c) => c.streamId)
  if (list.length === 0) return null
  if (list.length === 1) {
    return <StreamChat streamId={list[0].streamId} title={list[0].handle} />
  }

  const ordered = [...list].sort((a, b) => {
    if (a.streamId === featuredStreamId) return -1
    if (b.streamId === featuredStreamId) return 1
    return 0
  })
  const shown = ordered.slice(0, 2)

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] uppercase tracking-wider text-gray-500">Both chats</div>
      {shown.map((c) => (
        <div key={c.streamId} className="rounded-lg border border-dark-border overflow-hidden">
          <div className="px-2 py-1 bg-dark-card text-[11px] font-semibold text-gray-300 flex items-center gap-1.5">
            <span className={`live-dot ${c.streamId === featuredStreamId ? '' : 'opacity-40'}`} />
            {c.handle}
            {c.streamId === featuredStreamId && <span className="text-accent">· on air</span>}
          </div>
          <StreamChat streamId={c.streamId} title={c.handle} />
        </div>
      ))}
    </div>
  )
}

export default MergedStreamChat
