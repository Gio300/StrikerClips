/**
 * kingTournament — the backend-touching "the King always exists" layer.
 *
 * The pure season rules live in src/lib/tkoKing.ts (KING_SCHEDULE + the phase
 * resolver). This module is the thin find-or-create that makes the schedule
 * REAL: it looks for the featured king_pit tournament row and, if there isn't
 * one, seeds it straight from the schedule constants — exactly the way
 * `ensureTkoSpace` seeds the official chat space.
 *
 * Why: the TKO King must run itself. Nobody creates it, nobody starts it,
 * nobody advances it. Any surface that loads the King calls `ensureKing()` and
 * always gets a tournament back, so /king can never dead-end on "No TKO King
 * tournament is running right now."
 */

import { supabase } from '@/lib/supabase'
import { KING_PIT_FORMAT, kingTournamentSeed } from '@/lib/tkoKing'
import type { Tournament } from '@/types/database'

/** Find the featured King row, if one already exists. */
export async function findKing(): Promise<Tournament | null> {
  const { data } = await supabase
    .from('tournaments')
    .select('*')
    .eq('format', KING_PIT_FORMAT)
    .order('created_at', { ascending: false })
  const list = (data ?? []) as Tournament[]
  return list.find((t) => t.is_featured) ?? list[0] ?? null
}

/**
 * Find-or-create the schedule-driven TKO King. Safe to call repeatedly and from
 * several surfaces at once: it only inserts when nothing is there. Returns null
 * only if the insert itself failed (offline / RLS), in which case callers fall
 * back to the schedule-only view — the phase + countdown still render, because
 * those come from KING_SCHEDULE, not from the row.
 */
export async function ensureKing(createdBy: string | null = null): Promise<Tournament | null> {
  const existing = await findKing()
  if (existing) return existing
  const { data } = await supabase
    .from('tournaments')
    .insert(kingTournamentSeed(createdBy) as never)
    .select()
    .single()
  return ((data as Tournament) ?? null) || (await findKing())
}
