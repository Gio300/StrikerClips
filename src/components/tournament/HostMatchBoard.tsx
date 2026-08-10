import { ClipboardList } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { roundLabel } from '@/lib/tournamentBracket'
import type { BattleSide } from '@/lib/battleMedia'
import { MatchMediaEditor } from '@/components/tournament/MatchMediaEditor'
import type { TournamentBattle } from '@/types/database'
import type { BattleIdentity } from '@/components/tournament/ParticipantDashboard'

/**
 * THE HOST'S match board: every matchup on the bracket with the same watch-link
 * inputs the entrants have — but for BOTH sides, so the host can input or
 * override any fighter's live/clips (host-only server-side; the trusted fn
 * checks isTournamentHost for cross-side writes).
 */
export function HostMatchBoard({
  battles,
  totalRounds,
  identityFor,
  onBattleSaved,
}: {
  /** ALL battles on the bracket, sorted by round/slot. */
  battles: TournamentBattle[]
  totalRounds: number
  identityFor: (id: string | null) => BattleIdentity | null
  onBattleSaved: (battle: TournamentBattle) => void
}) {
  if (battles.length === 0) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-sm text-gray-400">
        No matches yet — build the bracket first, then attach lives and clips
        to each matchup here.
      </div>
    )
  }

  const rounds = new Map<number, TournamentBattle[]>()
  for (const battle of battles) {
    const round = Number(battle.round ?? 1)
    rounds.set(round, [...(rounds.get(round) ?? []), battle])
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-chakra/10 text-chakra">
          <ClipboardList className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-semibold text-white">Host match board</h3>
          <p className="mt-1 text-sm text-gray-400">
            Attach or override the live stream and clip links on any side of any
            matchup. Fighters can only edit their own side; you can edit both.
          </p>
        </div>
      </div>

      {Array.from(rounds.entries())
        .sort(([a], [b]) => a - b)
        .map(([round, matches]) => (
          <div key={round} className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {roundLabel(round, totalRounds)}
            </h4>
            {matches.map((battle) => (
              <div
                key={battle.id}
                className="space-y-3 rounded-xl border border-dark-border bg-dark-card p-4"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  {(['a', 'b'] as BattleSide[]).map((side) => {
                    const playerId = side === 'a' ? battle.player_a : battle.player_b
                    const player = identityFor(playerId)
                    const isWinner = Boolean(
                      playerId && battle.winner && String(battle.winner) === String(playerId),
                    )
                    return (
                      <div key={side} className="space-y-2">
                        <div className="flex min-h-8 items-center gap-2">
                          {player ? (
                            <>
                              <Avatar
                                src={player.avatar_url}
                                name={player.username}
                                seed={player.id}
                                size={26}
                              />
                              <span className="max-w-[11rem] truncate text-sm font-medium text-white">
                                {player.username}
                              </span>
                              {isWinner && (
                                <span className="rounded-full bg-leaf/10 px-2 py-0.5 text-[11px] font-semibold text-leaf">
                                  Winner
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-gray-600">Open slot</span>
                          )}
                        </div>
                        {player ? (
                          <MatchMediaEditor
                            key={`${battle.id}-${side}`}
                            battle={battle}
                            side={side}
                            title={`${player.username}'s watch links`}
                            onSaved={onBattleSaved}
                          />
                        ) : (
                          <p className="rounded-md border border-dashed border-dark-border p-3 text-xs text-gray-600">
                            Links open once a fighter lands in this slot.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ))}
    </section>
  )
}
