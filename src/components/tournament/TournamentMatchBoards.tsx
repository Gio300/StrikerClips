import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { sideForPlayer } from '@/lib/battleMedia'
import { expectedRoundsFromBattles } from '@/lib/tournamentBracket'
import {
  ParticipantDashboard,
  type BattleIdentity,
} from '@/components/tournament/ParticipantDashboard'
import { HostMatchBoard } from '@/components/tournament/HostMatchBoard'
import type { LiveSession, LiveStream, TournamentBattle } from '@/types/database'

function compareBattles(a: TournamentBattle, b: TournamentBattle) {
  return (
    Number(a.round ?? 1) - Number(b.round ?? 1) ||
    Number(a.bracket_slot ?? 0) - Number(b.bracket_slot ?? 0) ||
    a.created_at.localeCompare(b.created_at)
  )
}

/**
 * The "Match Board" section of a tournament page. Loads the bracket's battles
 * once and mounts:
 *   - the PARTICIPANT dashboard (the caller's own matches + their-side media
 *     editor) when the signed-in user fights on this bracket, and
 *   - the HOST match board (every match, both sides editable) for the
 *     tournament host/admins.
 * Plain viewers get pointed at the bracket, where attached links surface as
 * watch badges on each matchup card.
 */
export function TournamentMatchBoards({
  tournamentId,
  userId,
  isHost,
  isEntrant = false,
}: {
  tournamentId: string
  userId: string | null
  isHost: boolean
  /** Accepted entrant — shows the (possibly still empty) participant board
   *  even before the host seeds the bracket. */
  isEntrant?: boolean
}) {
  const [battles, setBattles] = useState<TournamentBattle[]>([])
  const [profiles, setProfiles] = useState<Map<string, BattleIdentity>>(new Map())
  const [myLive, setMyLive] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('tournament_battles')
      .select('*')
      .eq('tournament_id', tournamentId)
    const rows = ((data ?? []) as TournamentBattle[]).sort(compareBattles)
    setBattles(rows)

    const ids = Array.from(
      new Set(
        rows
          .flatMap((battle) => [battle.player_a, battle.player_b])
          .filter((id): id is string => Boolean(id)),
      ),
    )
    if (ids.length) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', ids)
      setProfiles(
        new Map(
          ((profileRows ?? []) as BattleIdentity[]).map((profile) => [profile.id, profile]),
        ),
      )
    } else {
      setProfiles(new Map())
    }
    setLoading(false)
  }, [tournamentId])

  useEffect(() => {
    void load()
  }, [load])

  // The user's CURRENT live, offered as a one-tap fill in their editor. Checks
  // live_streams first (the richer model), then live_sessions' watch_url.
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    async function findMyLive() {
      const { data: streams } = await supabase
        .from('live_streams')
        .select('youtube_url, created_at')
        .eq('user_id', userId!)
        .eq('is_live', true)
        .order('created_at', { ascending: false })
        .limit(1)
      const streamUrl = (streams?.[0] as Pick<LiveStream, 'youtube_url'> | undefined)
        ?.youtube_url
      if (!cancelled && streamUrl) {
        setMyLive(streamUrl)
        return
      }
      const { data: sessions } = await supabase
        .from('live_sessions')
        .select('watch_url, started_at')
        .eq('host_id', userId!)
        .eq('status', 'live')
        .order('started_at', { ascending: false })
        .limit(1)
      const sessionUrl = (sessions?.[0] as Pick<LiveSession, 'watch_url'> | undefined)
        ?.watch_url
      if (!cancelled && sessionUrl && sessionUrl.startsWith('https://')) {
        setMyLive(sessionUrl)
      }
    }
    void findMyLive()
    return () => {
      cancelled = true
    }
  }, [userId])

  const identityFor = useCallback(
    (id: string | null): BattleIdentity | null => (id ? profiles.get(id) ?? null : null),
    [profiles],
  )

  const myBattles = useMemo(
    () => battles.filter((battle) => sideForPlayer(battle, userId) !== null),
    [battles, userId],
  )

  // Rounds this bracket plays to, derived from the opening round's width. Uses
  // the shared helper so the board and the bracket header can never disagree
  // about which round is the final.
  const totalRounds = useMemo(() => expectedRoundsFromBattles(battles) || 1, [battles])

  const onBattleSaved = useCallback((battle: TournamentBattle) => {
    setBattles((prev) =>
      prev.map((entry) => (entry.id === battle.id ? { ...entry, ...battle } : entry)),
    )
  }, [])

  if (loading) {
    return (
      <div className="flex min-h-28 items-center justify-center text-sm text-gray-400">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        Loading match board
      </div>
    )
  }

  const isFighter = Boolean(userId) && myBattles.length > 0

  return (
    <div className="space-y-6">
      {userId && (isFighter || isEntrant) && (
        <ParticipantDashboard
          battles={myBattles}
          totalRounds={totalRounds}
          userId={userId}
          identityFor={identityFor}
          suggestedLive={myLive}
          onBattleSaved={onBattleSaved}
        />
      )}
      {isHost && (
        <HostMatchBoard
          battles={battles}
          totalRounds={totalRounds}
          identityFor={identityFor}
          onBattleSaved={onBattleSaved}
        />
      )}
      {!isHost && !isFighter && !isEntrant && (
        <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-sm text-gray-400">
          Fighters attach their lives and clips here. Watch links show up as
          badges on the bracket — check the Bracket tab.
        </div>
      )}
    </div>
  )
}
