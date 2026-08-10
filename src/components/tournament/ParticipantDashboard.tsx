import { Swords } from 'lucide-react'
import { Avatar } from '@/components/ui'
import { roundLabel } from '@/lib/tournamentBracket'
import { sideForPlayer } from '@/lib/battleMedia'
import { BattleMediaLinks } from '@/components/tournament/BattleMediaLinks'
import { MatchMediaEditor } from '@/components/tournament/MatchMediaEditor'
import type { TournamentBattle } from '@/types/database'

export type BattleIdentity = {
  id: string
  username: string
  avatar_url: string | null
}

/**
 * THE ENTRANT'S in-tournament dashboard: every matchup they fight in, with an
 * editor for THEIR OWN side's watch links — their live stream URL (one tap
 * from their active live session) and their YouTube clips. The opponent's
 * attached links render read-only. Server-side, the trusted fn only lets an
 * entrant write their own slot, so nothing here can touch the other fighter.
 */
export function ParticipantDashboard({
  battles,
  totalRounds,
  userId,
  identityFor,
  suggestedLive,
  onBattleSaved,
}: {
  /** ONLY this user's battles, sorted by round. */
  battles: TournamentBattle[]
  totalRounds: number
  userId: string
  identityFor: (id: string | null) => BattleIdentity | null
  /** Watch URL of the user's currently-live session, if any. */
  suggestedLive: string | null
  onBattleSaved: (battle: TournamentBattle) => void
}) {
  if (battles.length === 0) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-4 text-sm text-gray-400">
        You have no matches on this bracket yet. Once the host seeds you in,
        your matchups appear here so you can attach your live and your clips.
      </div>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
          <Swords className="h-5 w-5" />
        </span>
        <div>
          <h3 className="font-semibold text-white">My matches</h3>
          <p className="mt-1 text-sm text-gray-400">
            Attach your live stream and your best clips to each matchup —
            viewers get watch links right on the bracket.
          </p>
        </div>
      </div>

      {battles.map((battle) => {
        const mySide = sideForPlayer(battle, userId)
        if (!mySide) return null
        const opponentId = mySide === 'a' ? battle.player_b : battle.player_a
        const opponent = identityFor(opponentId)
        const won = Boolean(battle.winner && String(battle.winner) === String(userId))
        const decided = Boolean(battle.winner)
        return (
          <div
            key={battle.id}
            className="space-y-3 rounded-xl border border-dark-border bg-dark-card p-4"
          >
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {roundLabel(Number(battle.round ?? 1), totalRounds)}
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  decided
                    ? won
                      ? 'bg-leaf/10 text-leaf'
                      : 'bg-dark text-gray-500'
                    : battle.status === 'live'
                      ? 'bg-kunai/10 text-kunai'
                      : 'bg-dark text-gray-400'
                }`}
              >
                {decided ? (won ? 'Won' : 'Eliminated') : battle.status}
              </span>
              <div className="ml-auto flex items-center gap-2 text-sm text-gray-300">
                <span className="text-gray-500">vs</span>
                {opponent ? (
                  <>
                    <Avatar
                      src={opponent.avatar_url}
                      name={opponent.username}
                      seed={opponent.id}
                      size={26}
                    />
                    <span className="max-w-[10rem] truncate font-medium">
                      {opponent.username}
                    </span>
                  </>
                ) : (
                  <span className="text-gray-500">Awaiting opponent</span>
                )}
              </div>
            </div>

            <MatchMediaEditor
              key={`${battle.id}-${mySide}`}
              battle={battle}
              side={mySide}
              title="Your watch links"
              suggestedLive={suggestedLive}
              onSaved={onBattleSaved}
            />

            {/* The opponent's attached links, read-only. */}
            <BattleMediaLinks
              media={battle.media}
              playerA={identityFor(battle.player_a)}
              playerB={identityFor(battle.player_b)}
              only={mySide === 'a' ? 'b' : 'a'}
            />
          </div>
        )
      })}
    </section>
  )
}
