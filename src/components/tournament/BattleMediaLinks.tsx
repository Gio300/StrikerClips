import { Play, Radio } from 'lucide-react'
import { readSideMedia, type BattleSide } from '@/lib/battleMedia'

type Identity = { id: string; username: string } | null

/**
 * Viewer-facing watch links for one matchup: a red LIVE badge per side that
 * currently carries a live URL, and a clip badge per attached YouTube clip.
 * Renders nothing when neither side has media, so the bracket card stays
 * exactly as before until a fighter (or the host) attaches something.
 */
export function BattleMediaLinks({
  media,
  playerA,
  playerB,
  only,
}: {
  media: unknown
  playerA: Identity
  playerB: Identity
  /** Restrict the badges to one side (e.g. "show me my opponent's links"). */
  only?: BattleSide
}) {
  const sides: { side: BattleSide; player: Identity }[] = [
    { side: 'a', player: playerA },
    { side: 'b', player: playerB },
  ].filter((entry) => !only || entry.side === only) as {
    side: BattleSide
    player: Identity
  }[]

  const badges = sides.flatMap(({ side, player }) => {
    const { live_url, clip_urls } = readSideMedia(media, side)
    const name = player?.username ?? 'Player'
    const items: JSX.Element[] = []
    if (live_url) {
      items.push(
        <a
          key={`${side}-live`}
          href={live_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-7 items-center gap-1 rounded-full border border-kunai/40 bg-kunai/10 px-2 py-0.5 text-[11px] font-semibold text-kunai hover:border-kunai"
          title={`Watch ${name} live`}
        >
          <Radio className="h-3 w-3 shrink-0 animate-pulse-soft" />
          <span className="max-w-[8rem] truncate">LIVE · {name}</span>
        </a>,
      )
    }
    clip_urls.forEach((url, index) => {
      items.push(
        <a
          key={`${side}-clip-${index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-7 items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent hover:border-accent"
          title={`${name} — clip ${index + 1}`}
        >
          <Play className="h-3 w-3 shrink-0" />
          <span className="max-w-[8rem] truncate">
            {name} · Clip {index + 1}
          </span>
        </a>,
      )
    })
    return items
  })

  if (badges.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 border-t border-dark-border bg-dark/40 px-3 py-2">
      {badges}
    </div>
  )
}
