import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { ensureKing } from '@/lib/kingTournament'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { Avatar } from '@/components/ui'
import {
  KING_SCHEDULE,
  KING_PRIZE_TABLE,
  buildKingBoard,
  kingPhaseState,
  battleStatusLabel,
  battleTimingLabel,
  isBattleDecided,
  type BoardFighter,
  type KingBoard,
} from '@/lib/tkoKing'
import type { Tournament, TournamentBattle, TournamentRegistration } from '@/types/database'

/**
 * /king/board — THE BIG BOARD.
 *
 * The whole field on one page: every registered Shinobi, every battle grouped
 * into its labelled round (Round of 16 → Quarterfinal → Semifinal → Final),
 * every result, who is still advancing and how far each fighter got.
 *
 * Phone-first: rounds stack vertically with sticky round headers, the standings
 * table drops its optional columns under `sm:`, and the long lists live inside
 * CollapsibleSections. Nothing here needs an organizer — the header phase and
 * countdown come straight from KING_SCHEDULE.
 */

type Reg = TournamentRegistration & { username?: string; avatar_url?: string | null }
type Bat = TournamentBattle

const dayFmt = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function TkoKingBoard() {
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [regs, setRegs] = useState<Reg[]>([])
  const [battles, setBattles] = useState<Bat[]>([])
  const [loading, setLoading] = useState(true)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      // The King always exists — find-or-create from the schedule constants.
      const king = await ensureKing()
      if (cancelled) return
      setTournament(king)
      if (king) {
        const [regRes, batRes] = await Promise.all([
          supabase.from('tournament_registrations').select('*').eq('tournament_id', king.id),
          supabase.from('tournament_battles').select('*').eq('tournament_id', king.id),
        ])
        const rs = (regRes.data ?? []) as Reg[]
        const bs = (batRes.data ?? []) as Bat[]
        const ids = new Set<string>()
        rs.forEach((r) => ids.add(r.user_id))
        bs.forEach((b) => { ids.add(b.player_a); if (b.player_b) ids.add(b.player_b) })
        const names = new Map<string, { username: string; avatar_url: string | null }>()
        if (ids.size > 0) {
          const { data: profs } = await supabase
            .from('profiles')
            .select('id, username, avatar_url')
            .in('id', Array.from(ids))
          for (const p of profs ?? []) names.set(p.id, { username: p.username, avatar_url: p.avatar_url })
        }
        if (!cancelled) {
          setRegs(rs.map((r) => ({
            ...r,
            username: names.get(r.user_id)?.username,
            avatar_url: names.get(r.user_id)?.avatar_url ?? null,
          })))
          setBattles(bs)
        }
      }
      if (!cancelled) setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [])

  const state = useMemo(() => kingPhaseState(now), [now])
  const board: KingBoard = useMemo(
    () => buildKingBoard(
      regs.map((r) => ({ user_id: r.user_id, username: r.username, avatar_url: r.avatar_url })),
      battles,
    ),
    [regs, battles],
  )
  const nameOf = (id: string | null | undefined) =>
    board.fighters.find((f) => f.userId === id)?.username ?? 'shinobi'

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* ── BIG BOARD header ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-kunai/50 bg-gradient-to-br from-kunai/20 via-dark-card to-dark-card p-4 sm:p-6">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-3xl sm:text-4xl">👑</span>
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-4xl font-black tracking-tight text-white uppercase leading-none">
              The Board
            </h1>
            <p className="text-xs sm:text-sm text-gray-300 mt-1">
              TKO King · {KING_SCHEDULE.season} · the whole field
            </p>
          </div>
          <Link
            to="/king"
            className="ml-auto shrink-0 px-3 py-1.5 rounded-lg border border-dark-border text-xs text-gray-300 hover:border-accent/60"
          >
            ← Back to the pit
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-kunai/50 bg-kunai/15 text-kunai uppercase tracking-widest font-bold">
            {state.label}
          </span>
          {state.nextLabel && (
            <span className="text-[11px] px-2.5 py-1 rounded-full border border-dark-border text-gray-300 tabular-nums">
              {state.nextLabel} in {state.countdown}
            </span>
          )}
          <span className="text-[11px] px-2.5 py-1 rounded-full border border-dark-border text-gray-400">
            Crowned {dayFmt(KING_SCHEDULE.crownedAt)}
          </span>
        </div>

        {/* Field read-out */}
        <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-3">
          <Stat label="Shinobi" value={board.fieldSize} />
          <Stat label="Battles" value={battles.length} />
          <Stat label="Standing" value={board.advancing.length} />
        </div>

        {board.champion && (
          <div className="mt-4 rounded-xl border border-chakra/60 bg-chakra/10 p-4 text-center">
            <p className="text-[11px] uppercase tracking-widest text-chakra">The TKO King</p>
            <p className="text-2xl sm:text-3xl font-black text-white mt-1">@{board.champion.username}</p>
            <p className="text-xs text-gray-400 mt-1">
              {board.champion.wins} wins · {board.champion.roundsCleared} rounds cleared
            </p>
          </div>
        )}
      </div>

      {loading ? (
        <p className="mt-6 text-gray-400 animate-pulse">Loading the board…</p>
      ) : !tournament ? (
        <p className="mt-6 text-sm text-gray-400">
          Couldn't reach the tournament record, but the season still runs on schedule —{' '}
          {state.label.toLowerCase()}, {state.nextLabel ? `${state.nextLabel} in ${state.countdown}` : 'complete'}.
        </p>
      ) : (
        <>
          {/* ── ROUNDS ─────────────────────────────────────────────────── */}
          <h2 className="mt-6 mb-3 text-lg font-bold text-white">Rounds</h2>
          {board.rounds.length === 0 ? (
            <div className="rounded-xl border border-dark-border bg-dark-card p-6 text-center text-sm text-gray-400">
              No battles on the board yet. Matchups appear here as soon as the field is paired —
              enrolment runs to {dayFmt(KING_SCHEDULE.battlesStart)}.
            </div>
          ) : (
            <div className="space-y-5">
              {board.rounds.map((r) => (
                <section key={r.round}>
                  <div className="sticky top-0 z-10 -mx-3 px-3 sm:mx-0 sm:px-0 py-2 bg-dark/95 backdrop-blur flex items-center gap-2">
                    <h3 className="text-sm font-black uppercase tracking-widest text-white">{r.label}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border border-dark-border text-gray-400">
                      {r.battles.length} {r.battles.length === 1 ? 'battle' : 'battles'}
                    </span>
                    {r.complete && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-leaf/40 bg-leaf/10 text-leaf uppercase">
                        Done
                      </span>
                    )}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {r.battles.map(({ battle: b }) => {
                      const decided = isBattleDecided(b.status)
                      return (
                        <div
                          key={b.id}
                          className={`rounded-xl border p-3 ${
                            b.status === 'live'
                              ? 'border-kunai/60 bg-kunai/10'
                              : decided
                                ? 'border-dark-border bg-dark-card/60'
                                : 'border-dark-border bg-dark-card'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-dark-border text-gray-400 uppercase tracking-wider">
                              {battleStatusLabel(b.status)}
                            </span>
                            <span className="ml-auto text-[11px] text-gray-400 tabular-nums">
                              {battleTimingLabel(b, now)}
                            </span>
                          </div>
                          <div className="mt-2 space-y-1">
                            <Fighter name={nameOf(b.player_a)} won={decided && b.winner === b.player_a} lost={decided && !!b.winner && b.winner !== b.player_a} />
                            <Fighter name={b.player_b ? nameOf(b.player_b) : 'TBD'} won={decided && !!b.player_b && b.winner === b.player_b} lost={decided && !!b.winner && b.winner !== b.player_b} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}

          {/* ── STANDINGS — how far everyone got ───────────────────────── */}
          <h2 className="mt-8 mb-3 text-lg font-bold text-white">The field</h2>
          <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
            {board.fighters.length === 0 ? (
              <p className="p-6 text-center text-sm text-gray-400">
                No Shinobi registered yet. Enrolment opens {dayFmt(KING_SCHEDULE.enrollOpens)}.
              </p>
            ) : (
              <ul className="divide-y divide-dark-border">
                {board.fighters.map((f, i) => (
                  <FighterRow key={f.userId} f={f} rank={i + 1} totalRounds={board.totalRounds} />
                ))}
              </ul>
            )}
          </div>

          {/* ── PRIZES ─────────────────────────────────────────────────── */}
          <div className="mt-6">
            <CollapsibleSection
              id="king-board-prizes"
              label="Artifacts"
              count={KING_PRIZE_TABLE.length}
              hint="What advancing earns you"
            >
              <p className="text-xs text-gray-400 mb-3">
                Advance a round, earn an artifact into your locker. Prestige only — no cash, ever.
              </p>
              <ul className="space-y-2">
                {KING_PRIZE_TABLE.map((p) => (
                  <li key={p.asset.id} className="flex items-center gap-3 rounded-lg border border-dark-border bg-dark p-2">
                    <img src={p.asset.imageUrl} alt="" loading="lazy" className="w-10 h-10 rounded object-cover shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{p.asset.name}</p>
                      <p className="text-[11px] text-gray-400">{p.when}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-dark-border bg-dark/60 p-2.5 text-center">
      <p className="text-xl sm:text-2xl font-black text-white tabular-nums leading-none">{value}</p>
      <p className="text-[10px] uppercase tracking-widest text-gray-500 mt-1">{label}</p>
    </div>
  )
}

function Fighter({ name, won, lost }: { name: string; won: boolean; lost: boolean }) {
  return (
    <p className={`text-sm font-bold truncate ${won ? 'text-leaf' : lost ? 'text-gray-500 line-through' : 'text-white'}`}>
      @{name}
      {won && <span className="ml-1 text-[10px] font-normal uppercase tracking-wider">won</span>}
    </p>
  )
}

function FighterRow({ f, rank, totalRounds }: { f: BoardFighter; rank: number; totalRounds: number }) {
  const badge =
    f.status === 'champion' ? { text: 'King', cls: 'border-chakra/50 bg-chakra/15 text-chakra' }
    : f.status === 'eliminated' ? { text: 'Out', cls: 'border-dark-border text-gray-500' }
    : { text: 'Standing', cls: 'border-leaf/40 bg-leaf/10 text-leaf' }
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="w-6 shrink-0 text-xs text-gray-600 tabular-nums text-right">{rank}</span>
      <Avatar src={f.avatarUrl} name={f.username} seed={f.userId} size={28} />
      <Link to={`/profile/${f.userId}`} className="font-semibold text-sm text-white hover:text-accent truncate">
        @{f.username}
      </Link>
      <span className={`ml-auto shrink-0 text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${badge.cls}`}>
        {badge.text}
      </span>
      <span className="shrink-0 text-xs text-gray-400 tabular-nums w-14 text-right">
        {f.wins}W–{f.losses}L
      </span>
      <span className="hidden sm:block shrink-0 text-[11px] text-gray-500 w-28 text-right truncate">
        {f.roundsCleared > 0
          ? `Cleared ${f.roundsCleared}/${totalRounds}`
          : f.status === 'eliminated' ? 'Round 1 exit' : 'Yet to fight'}
      </span>
    </li>
  )
}

export default TkoKingBoard
