import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useLiveLinks } from '@/hooks/useLiveLinks'
import { handleOf, stageFromStreams, MAX_STAGE_ANGLES, type LiveStage } from '@/lib/liveLink'
import { createStageGroup, type LiveCard } from '@/lib/liveLinkService'

/**
 * LiveNowBoard — the "everyone who's live" surface.
 *
 * Two halves, both driven by the link engine (src/lib/liveLink.ts):
 *
 *   1. LINKED STAGES — pairs/groups the engine is confident belong together
 *      (a scheduled battle, a clan, a tournament). A scheduled battle gets the
 *      loud "Watch both angles" call to action.
 *   2. EVERY live stream, each card carrying a RELATIONSHIP INDICATOR
 *      ("⚔ Scheduled battle vs @rex", "Same clan", "Both in TKO King") so the
 *      connection is visible before you click anything.
 *
 * Any viewer can also hand-pick 2–4 feeds and link them into one stage. The
 * link is persisted to `live_groups`, so the combined view is a real, shareable
 * page rather than a local layout.
 */

function adhocPath(stage: LiveStage): string {
  return `/live-stage/new?s=${encodeURIComponent(stage.streams.map((s) => s.streamId).join(','))}`
}

function Thumb({ card, className = '' }: { card: LiveCard; className?: string }) {
  return (
    <div className={`aspect-video bg-dark relative overflow-hidden ${className}`}>
      {card.videoId ? (
        <img
          src={`https://i.ytimg.com/vi/${card.videoId}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">No preview</div>
      )}
      <span className="absolute top-2 left-2 pill-kunai">
        <span className="live-dot" />
        LIVE
      </span>
    </div>
  )
}

export function LiveNowBoard({ className = '' }: { className?: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { cards, stages, candidates, loading, badgeFor, bestFor, reload } = useLiveLinks()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const toggle = (streamId: string) =>
    setSelected((prev) =>
      prev.includes(streamId)
        ? prev.filter((id) => id !== streamId)
        : prev.length >= MAX_STAGE_ANGLES
          ? prev
          : [...prev, streamId],
    )

  /**
   * Open a stage. Signed in → persist it (so anyone can open the same combined
   * view and everyone involved gets notified). Signed out → open an ad-hoc
   * combined view from the url, which still works and still plays.
   */
  async function openStage(stage: LiveStage) {
    if (!user) {
      navigate(adhocPath(stage))
      return
    }
    setBusy(stage.key)
    try {
      const res = await createStageGroup(stage, user.id)
      navigate(res ? `/live-stage/${res.groupId}` : adhocPath(stage))
      if (res) reload()
    } finally {
      setBusy(null)
    }
  }

  async function linkSelected() {
    const picked = selected
      .map((id) => cards.find((c) => c.streamId === id))
      .filter((c): c is LiveCard => !!c)
    const stage = stageFromStreams(picked, candidates)
    if (!stage) return
    setSelected([])
    await openStage(stage)
  }

  if (loading) {
    return <div className="py-8 text-center text-accent animate-pulse">Finding who's live…</div>
  }

  if (cards.length === 0) {
    return (
      <div className={`rounded-xl border border-dark-border bg-dark-card p-8 text-center ${className}`}>
        <div className="text-2xl mb-1">🔴</div>
        <h2 className="font-semibold text-white">Nobody's live right now</h2>
        <p className="text-gray-400 text-sm mt-1">
          Go live and anyone you're matched with — your opponent, your clan, your tournament — gets linked to you
          automatically.
        </p>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* ── 1. Stages the engine linked for us ─────────────────────────── */}
      {stages.length > 0 && (
        <section className="mb-8">
          <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300 mb-3 px-1">
            Linked right now
          </h2>
          <div className="space-y-3">
            {stages.map((stage) => {
              const battle = stage.reason === 'scheduled_battle'
              return (
                <div
                  key={stage.key}
                  className={`rounded-xl border overflow-hidden ${
                    battle ? 'border-accent bg-accent/5 shadow-glow' : 'border-dark-border bg-dark-card'
                  }`}
                >
                  <div className="flex gap-1 p-1">
                    {stage.streams.slice(0, MAX_STAGE_ANGLES).map((s) => (
                      <Thumb key={s.streamId} card={s as LiveCard} className="flex-1 rounded-lg" />
                    ))}
                  </div>
                  <div className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-white truncate">
                        {battle && <span className="mr-1">⚔</span>}
                        {stage.title}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {battle
                          ? 'Both fighters are live — watch the battle from both angles.'
                          : `${stage.streams.length} people live together · linked because: ${stage.title.split(' — ')[0]}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openStage(stage)}
                      disabled={busy === stage.key}
                      className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50 ${
                        battle ? 'bg-accent text-dark hover:shadow-glow' : 'border border-accent text-accent hover:bg-accent/10'
                      }`}
                    >
                      {busy === stage.key ? 'Linking…' : battle ? 'Watch both angles' : 'Watch all angles'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── 2. Everyone who's live, with relationship indicators ────────── */}
      <section>
        <div className="flex items-center gap-2 mb-3 px-1">
          <span className="live-dot" />
          <h2 className="text-sm font-semibold tracking-wide uppercase text-gray-300">
            Live now · {cards.length}
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => {
            const badge = badgeFor(card.streamId)
            const best = bestFor(card.streamId)
            const isBattle = best?.reason === 'scheduled_battle'
            const picked = selected.includes(card.streamId)
            return (
              <div
                key={card.streamId}
                className={`rounded-xl border overflow-hidden bg-dark-card transition-colors ${
                  picked ? 'border-accent ring-1 ring-accent' : 'border-dark-border hover:border-accent/60'
                }`}
              >
                <Link
                  to={`/watch/${card.streamId}?u=${encodeURIComponent(card.url ?? '')}${
                    card.title ? `&t=${encodeURIComponent(card.title)}` : ''
                  }`}
                  className="block"
                >
                  <Thumb card={card} />
                </Link>
                <div className="p-3">
                  <div className="flex items-center gap-2 min-w-0">
                    {card.avatarUrl ? (
                      <img src={card.avatarUrl} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
                    ) : (
                      <span className="w-7 h-7 rounded-full bg-dark border border-dark-border shrink-0 flex items-center justify-center text-[11px] text-gray-400">
                        {(card.username ?? '?').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{card.title}</p>
                      <Link
                        to={`/profile/${card.userId}`}
                        className="text-xs text-gray-400 hover:text-accent truncate block"
                      >
                        {handleOf(card)}
                      </Link>
                    </div>
                  </div>

                  {/* THE RELATIONSHIP INDICATOR — why this stream connects to another. */}
                  {badge && (
                    <span
                      className={`mt-2 inline-block max-w-full truncate px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        isBattle
                          ? 'bg-accent text-dark'
                          : 'bg-dark border border-accent/40 text-accent'
                      }`}
                    >
                      {badge}
                    </span>
                  )}

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggle(card.streamId)}
                      className={`px-2.5 py-1 rounded-lg text-xs border ${
                        picked
                          ? 'border-accent text-accent'
                          : 'border-dark-border text-gray-400 hover:text-accent hover:border-accent/50'
                      }`}
                    >
                      {picked ? '✓ Added' : '＋ Add angle'}
                    </button>
                    {isBattle && best && (
                      <button
                        type="button"
                        onClick={() =>
                          openStage(
                            stageFromStreams([best.a, best.b], candidates) ?? {
                              key: best.key,
                              streams: [best.a, best.b],
                              reason: best.reason,
                              confidence: best.confidence,
                              title: best.label,
                            },
                          )
                        }
                        className="px-2.5 py-1 rounded-lg bg-accent text-dark text-xs font-semibold"
                      >
                        Watch both angles
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Sticky "link what I picked" bar — phone-first ───────────────── */}
      {selected.length > 0 && (
        <div className="sticky bottom-4 mt-6 z-20">
          <div className="mx-auto max-w-lg rounded-xl border border-accent bg-dark-card/95 backdrop-blur px-4 py-3 flex items-center justify-between gap-3 shadow-glow">
            <span className="text-sm text-gray-300">
              {selected.length} angle{selected.length === 1 ? '' : 's'} picked
              {selected.length === 1 && <span className="text-gray-500"> · pick one more</span>}
            </span>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setSelected([])}
                className="px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 text-sm"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={linkSelected}
                disabled={selected.length < 2 || !!busy}
                className="px-4 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-40"
              >
                Link into one view
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LiveNowBoard
