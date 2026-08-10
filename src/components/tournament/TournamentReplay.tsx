import { useEffect, useMemo, useRef, useState } from 'react'
import { ExternalLink, Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { TournamentBracket } from '@/components/TournamentBracket'
import {
  battlesAsOf,
  buildReplayTimeline,
  type ReplayBattle,
  type ReplayEvent,
} from '@/lib/tournamentReplay'
import type { Tournament } from '@/types/database'

/**
 * TOURNAMENT REPLAY — watch a finished (or still-running) tournament back like
 * a stream. The tape is the event timeline derived from the rows the product
 * already stores (src/lib/tournamentReplay.ts); the bracket re-renders as of
 * the cursor via TournamentBracket's controlled `battles` prop, and each
 * matchup's watch links (battle media) surface in the ticker at the moment
 * they were attached.
 *
 * Controls: play/pause, scrub (event index), speed (dwell per event), and
 * skip to start/end.
 */

const SPEEDS = [1, 2, 4, 8] as const
/** How long one event holds the screen at 1× (ms). */
const BASE_DWELL_MS = 1600

export function TournamentReplay({ tournament }: { tournament: Tournament }) {
  const [battles, setBattles] = useState<ReplayBattle[]>([])
  const [events, setEvents] = useState<ReplayEvent[]>([])
  const [loading, setLoading] = useState(true)
  // Cursor = how many events have been applied (0 = before anything happened).
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(2)
  const tickerRef = useRef<HTMLOListElement | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [battleRes, entrantRes, registrationRes, resultRes] = await Promise.all([
        supabase.from('tournament_battles').select('*').eq('tournament_id', tournament.id),
        supabase.from('tournament_entrants').select('*').eq('tournament_id', tournament.id),
        supabase.from('tournament_registrations').select('*').eq('tournament_id', tournament.id),
        supabase.from('tournament_results').select('*').eq('tournament_id', tournament.id),
      ])
      if (cancelled) return
      const battleRows = (battleRes.data ?? []) as ReplayBattle[]
      const entrantRows = (entrantRes.data ?? []) as { user_id: string; created_at: string; status?: string }[]
      const registrationRows = (registrationRes.data ?? []) as { user_id: string; registered_at: string }[]
      const resultRows = (resultRes.data ?? []) as { winner_profile_id: string; created_at: string }[]

      const userIds = Array.from(
        new Set(
          [
            ...battleRows.flatMap((battle) => [battle.player_a, battle.player_b, battle.winner]),
            ...entrantRows.map((row) => row.user_id),
            ...registrationRows.map((row) => row.user_id),
            ...resultRows.map((row) => row.winner_profile_id),
          ].filter((id): id is string => Boolean(id)),
        ),
      )
      const usernames = new Map<string, string>()
      if (userIds.length) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', userIds)
        for (const profile of profileRows ?? []) usernames.set(profile.id, profile.username)
      }
      if (cancelled) return
      setBattles(battleRows)
      setEvents(
        buildReplayTimeline({
          tournament,
          battles: battleRows,
          entrants: entrantRows,
          registrations: registrationRows,
          results: resultRows,
          usernames,
        }),
      )
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [tournament])

  // Advance the tape while playing.
  useEffect(() => {
    if (!playing) return
    if (cursor >= events.length) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(
      () => setCursor((current) => Math.min(current + 1, events.length)),
      BASE_DWELL_MS / speed,
    )
    return () => clearTimeout(timer)
  }, [playing, cursor, speed, events.length])

  // Keep the newest ticker line in view as the tape rolls.
  useEffect(() => {
    const el = tickerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [cursor])

  const applied = useMemo(() => events.slice(0, cursor), [events, cursor])
  const currentEvent = applied.at(-1) ?? null
  const cursorTime = currentEvent?.at ?? null
  const visibleBattles = useMemo(
    () => (cursorTime ? battlesAsOf(battles, cursorTime) : []),
    [battles, cursorTime],
  )

  if (loading) {
    return <div className="animate-pulse text-sm text-gray-400 py-6">Loading the replay tape…</div>
  }
  if (events.length === 0) {
    return (
      <div className="border-y border-dark-border py-6 text-center text-sm text-gray-400">
        Nothing has happened in this tournament yet — there is no tape to play.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Transport controls */}
      <div className="rounded-xl border border-dark-border bg-dark-card p-4 space-y-3">
        <div className="flex items-center gap-2 text-kunai">
          <Radio size={15} />
          <span className="text-xs font-semibold uppercase tracking-wider">Tournament replay</span>
          <span className="ml-auto text-xs text-gray-500">
            {cursor}/{events.length} events
            {currentEvent && ` · ${new Date(currentEvent.at).toLocaleString()}`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setPlaying(false); setCursor(0) }}
            aria-label="Back to the start"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-dark-border text-gray-300 hover:text-white"
          >
            <SkipBack size={17} />
          </button>
          <button
            type="button"
            onClick={() => {
              if (cursor >= events.length) setCursor(0)
              setPlaying((current) => !current)
            }}
            aria-label={playing ? 'Pause the replay' : 'Play the replay'}
            className="flex h-10 w-14 items-center justify-center rounded-lg bg-accent text-dark hover:shadow-glow"
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            type="button"
            onClick={() => { setPlaying(false); setCursor(events.length) }}
            aria-label="Jump to the end"
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-dark-border text-gray-300 hover:text-white"
          >
            <SkipForward size={17} />
          </button>
          <div className="ml-auto flex items-center gap-1" role="radiogroup" aria-label="Playback speed">
            {SPEEDS.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={speed === option}
                onClick={() => setSpeed(option)}
                className={`min-h-8 rounded-lg px-2.5 text-xs font-semibold ${
                  speed === option ? 'bg-white text-dark' : 'text-gray-400 hover:text-white'
                }`}
              >
                {option}×
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="sr-only">Scrub the replay</span>
          <input
            type="range"
            min={0}
            max={events.length}
            step={1}
            value={cursor}
            onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)) }}
            className="w-full accent-accent"
          />
        </label>
      </div>

      {/* The bracket as of the cursor — reuses the live bracket renderer. */}
      <TournamentBracket tournamentId={tournament.id} battles={visibleBattles} compact />

      {/* Event ticker: everything that has "happened" so far, newest last.
          Media events carry the matchup's watch links at their moment. */}
      <ol
        ref={tickerRef}
        className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-dark-border bg-dark-card p-4 text-sm"
        aria-label="Replay events"
      >
        {applied.length === 0 && (
          <li className="text-gray-500">Press play to start the tape.</li>
        )}
        {applied.map((event, index) => (
          <li
            key={`${event.at}-${event.kind}-${event.battleId ?? event.userId ?? index}`}
            className={index === applied.length - 1 ? 'text-white' : 'text-gray-400'}
          >
            <span className="mr-2 text-[11px] text-gray-600">
              {new Date(event.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
            {event.label}
            {event.media && event.media.length > 0 && (
              <span className="ml-2 inline-flex flex-wrap gap-2">
                {event.media.map((link) => (
                  <a
                    key={link.url}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent hover:underline"
                  >
                    <ExternalLink size={12} />
                    {link.kind === 'live' ? 'Watch live' : 'Watch clip'}
                  </a>
                ))}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
