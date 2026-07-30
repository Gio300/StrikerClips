import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, GitBranch, LoaderCircle, Shuffle, Trophy } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { callFn } from '@/lib/backend'
import { roundLabel } from '@/lib/tournamentBracket'
import { supabase } from '@/lib/supabase'
import type { TournamentBattle } from '@/types/database'

type EntrantIdentity = {
  user_id: string
  username?: string
  avatar_url?: string | null
  team_server_name?: string
}

type ProfileIdentity = {
  id: string
  username: string
  avatar_url: string | null
}

type BracketResponse = {
  ok?: boolean
  reason?: string
  error?: string
  battles?: TournamentBattle[]
}

interface TournamentBracketProps {
  tournamentId: string
  entrants?: EntrantIdentity[]
  canManage?: boolean
  compact?: boolean
}

function compareBattles(a: TournamentBattle, b: TournamentBattle) {
  return (
    Number(a.round ?? 1) - Number(b.round ?? 1) ||
    Number(a.bracket_slot ?? 0) - Number(b.bracket_slot ?? 0) ||
    a.created_at.localeCompare(b.created_at)
  )
}

export function TournamentBracket({
  tournamentId,
  entrants = [],
  canManage = false,
  compact = false,
}: TournamentBracketProps) {
  const [battles, setBattles] = useState<TournamentBattle[]>([])
  const [profiles, setProfiles] = useState<Map<string, ProfileIdentity>>(new Map())
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [seedMode, setSeedMode] = useState<'registration' | 'shuffle'>('registration')
  const [message, setMessage] = useState('')

  const entrantMap = useMemo(
    () => new Map(entrants.map((entrant) => [entrant.user_id, entrant])),
    [entrants],
  )

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('tournament_battles')
      .select('*')
      .eq('tournament_id', tournamentId)
    const nextBattles = ((data ?? []) as TournamentBattle[]).sort(compareBattles)
    setBattles(nextBattles)

    const profileIds = Array.from(
      new Set(
        nextBattles
          .flatMap((battle) => [battle.player_a, battle.player_b, battle.winner])
          .filter((id): id is string => Boolean(id)),
      ),
    )
    if (profileIds.length) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', profileIds)
      setProfiles(
        new Map(
          ((profileRows ?? []) as ProfileIdentity[]).map((profile) => [profile.id, profile]),
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

  const rounds = useMemo(() => {
    const grouped = new Map<number, TournamentBattle[]>()
    for (const battle of battles) {
      const round = Number(battle.round ?? 1)
      grouped.set(round, [...(grouped.get(round) ?? []), battle])
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => a - b)
      .map(([round, matches]) => ({
        round,
        matches: matches.sort(compareBattles),
      }))
  }, [battles])

  const identityFor = (id: string | null) => {
    if (!id) return null
    const profile = profiles.get(id)
    const entrant = entrantMap.get(id)
    return {
      id,
      username: entrant?.username || profile?.username || 'Player',
      avatar_url: entrant?.avatar_url ?? profile?.avatar_url ?? null,
      team: entrant?.team_server_name,
    }
  }

  const seed = async () => {
    setWorking('seed')
    setMessage('')
    const result = await callFn<BracketResponse>('tournament-bracket-seed', {
      tournamentId,
      seedMode,
    })
    if (!result) {
      setMessage('TKO could not reach the bracket service. Try again.')
    } else if (!result.ok) {
      setMessage(
        result.reason === 'not-enough-entrants'
          ? 'Accept at least two entrants before building the bracket.'
          : result.error || 'This bracket could not be built.',
      )
    } else {
      setMessage('Bracket built. Player art will advance with each result.')
      await load()
    }
    setWorking(null)
  }

  const recordWinner = async (battleId: string, winnerId: string) => {
    setWorking(battleId)
    setMessage('')
    const result = await callFn<BracketResponse>('tournament-bracket-winner', {
      battleId,
      winnerId,
    })
    if (!result?.ok) {
      setMessage(result?.error || 'TKO could not save that winner.')
    } else {
      await load()
    }
    setWorking(null)
  }

  if (loading) {
    return (
      <div className="flex min-h-28 items-center justify-center text-sm text-gray-400">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        Loading bracket
      </div>
    )
  }

  if (battles.length === 0) {
    if (!canManage) {
      return (
        <div className="border-y border-dark-border py-5 text-center text-sm text-gray-400">
          The tournament host has not built the bracket yet.
        </div>
      )
    }
    return (
      <div className="space-y-4 border-y border-dark-border py-5">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <GitBranch className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold text-white">Build the live bracket</h3>
            <p className="mt-1 text-sm text-gray-400">
              TKO seeds accepted entrants, then moves each winner and their profile art forward.
            </p>
          </div>
        </div>
        <label className="block">
          <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-gray-500">
            Seeding
          </span>
          <select
            value={seedMode}
            onChange={(event) => setSeedMode(event.target.value as typeof seedMode)}
            className="w-full rounded-md border border-dark-border bg-dark px-3 py-3 text-white"
          >
            <option value="registration">Registration order</option>
            <option value="shuffle">Shuffle entrants</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void seed()}
          disabled={working === 'seed'}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 py-2.5 font-semibold text-black disabled:opacity-50"
        >
          {working === 'seed' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : seedMode === 'shuffle' ? (
            <Shuffle className="h-4 w-4" />
          ) : (
            <GitBranch className="h-4 w-4" />
          )}
          Build bracket
        </button>
        {message && <p className="text-sm text-kunai">{message}</p>}
      </div>
    )
  }

  const championId =
    rounds.length > 0
      ? rounds.at(-1)?.matches.find((battle) => battle.winner)?.winner ?? null
      : null
  const champion = identityFor(championId)

  return (
    <div className={compact ? 'space-y-3' : 'space-y-5'}>
      {champion && (
        <div className="flex items-center gap-3 border-y border-kunai/30 bg-kunai/5 px-3 py-3">
          <Trophy className="h-5 w-5 shrink-0 text-kunai" />
          <Avatar
            src={champion.avatar_url}
            name={champion.username}
            seed={champion.id}
            size={compact ? 34 : 42}
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-kunai">
              Tournament winner
            </p>
            <p className="truncate font-semibold text-white">{champion.username}</p>
          </div>
        </div>
      )}

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-stretch gap-4">
          {rounds.map(({ round, matches }) => (
            <section key={round} className={compact ? 'w-56' : 'w-64'}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">
                {roundLabel(round, rounds.length)}
              </h3>
              <div className="flex h-[calc(100%-1.5rem)] flex-col justify-around gap-3">
                {matches.map((battle) => (
                  <Matchup
                    key={battle.id}
                    battle={battle}
                    playerA={identityFor(battle.player_a)}
                    playerB={identityFor(battle.player_b)}
                    canManage={canManage}
                    compact={compact}
                    working={working === battle.id}
                    onWinner={(winnerId) => void recordWinner(battle.id, winnerId)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      {message && <p className="text-sm text-kunai">{message}</p>}
    </div>
  )
}

function Matchup({
  battle,
  playerA,
  playerB,
  canManage,
  compact,
  working,
  onWinner,
}: {
  battle: TournamentBattle
  playerA: {
    id: string
    username: string
    avatar_url: string | null
    team?: string
  } | null
  playerB: {
    id: string
    username: string
    avatar_url: string | null
    team?: string
  } | null
  canManage: boolean
  compact: boolean
  working: boolean
  onWinner: (winnerId: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-md border border-dark-border bg-dark-card">
      {[playerA, playerB].map((player, index) => {
        const winner = Boolean(player && battle.winner === player.id)
        const canPick = Boolean(
          player &&
            canManage &&
            playerA &&
            playerB &&
            !battle.winner &&
            !working,
        )
        return (
          <button
            key={player?.id ?? `open-${index}`}
            type="button"
            disabled={!canPick}
            onClick={() => player && onWinner(player.id)}
            className={`flex w-full items-center gap-2 px-3 text-left transition-colors ${
              compact ? 'min-h-12 py-2' : 'min-h-14 py-2.5'
            } ${
              index === 1 ? 'border-t border-dark-border' : ''
            } ${
              winner
                ? 'bg-leaf/10 text-white'
                : canPick
                  ? 'hover:bg-accent/10'
                  : 'text-gray-300'
            }`}
          >
            {player ? (
              <>
                <Avatar
                  src={player.avatar_url}
                  name={player.username}
                  seed={player.id}
                  size={compact ? 30 : 34}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{player.username}</span>
                  {player.team && (
                    <span className="block truncate text-[11px] text-gray-500">{player.team}</span>
                  )}
                </span>
                {winner && <Check className="h-4 w-4 shrink-0 text-leaf" />}
                {working && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />}
              </>
            ) : (
              <span className="text-sm text-gray-600">Awaiting winner</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
