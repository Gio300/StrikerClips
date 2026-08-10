/* eslint-disable @typescript-eslint/no-explicit-any */
// =============================================================================
// THE CANONICAL ENTRANT ROSTER — one answer to "who is in this tournament?"
//
// The platform grew TWO disjoint rosters:
//
//   tournament_entrants      the MAIN entry flow (src/pages/TournamentDetail).
//                            Has the full lifecycle — pending → accepted /
//                            rejected / withdrawn — and the one approval fn
//                            (/api/fn/tournament-entrant-review).
//   tournament_registrations the KING entry flow (src/pages/TkoKing). A flat
//                            "I passed the entry gate" record carrying the
//                            King-specific acknowledgements (streamed,
//                            no_mod_ack, membership_granted). No lifecycle,
//                            no approval step — the gate IS the approval.
//
// Every reader used to paper over the split with its own ad-hoc dedupe, and
// they did not agree with each other. The bracket seeder was the worst: it took
// accepted entrants, and ONLY IF there were fewer than two did it fall back to
// registrations — so a tournament holding 3 accepted entrants and 4 King
// registrations seeded a 3-player bracket and silently dropped 4 people who had
// paid the entry gate. The end sweep, the Ask context and the round-depth math
// each drew a different line.
//
// THE MODEL NOW: `tournament_entrants` is canonical. `tournament_registrations`
// keeps its King-specific columns and stays the King flow's own record, but it
// is a READ-THROUGH: every registration is mirrored into an entrant row, so
// every reader resolves ONE set by reading the canonical table alone.
//
// The mirror runs in three places so it cannot drift:
//   1. ON WRITE  — the generic table API mirrors each inserted registration
//                  (server/app.ts, the tournament_registrations insert path).
//   2. ON BOOT   — backfillEntrantsFromRegistrations() heals installs whose
//                  registrations predate the mirror (server/index.ts).
//   3. ON READ   — canonicalEntrants() backfills the tournament it is about to
//                  read, so a settlement or a seeding can never act on a stale
//                  roster even if 1 and 2 both missed.
//
// MIRRORED STATUS IS 'accepted', deliberately. The King flow has no host
// approval surface, so a 'pending' mirror would be a row nobody can ever
// approve — the King bracket would stop seeding entirely. 'accepted' is also
// exactly what every reader already inferred from a registration row today
// (the seeder fallback, hasCurrentTournamentInvolvement, the end sweep's notify
// list), so the mirror preserves the existing meaning rather than inventing a
// new one. The main flow's approval gate is untouched: a client insert into
// tournament_entrants still lands 'pending' and still needs the host's fn.
// =============================================================================

export type EntrantQueryable = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

/** Entrant statuses that mean "still in this tournament". */
export const ACTIVE_ENTRANT_STATUSES = ['pending', 'accepted'] as const

/** Entrant statuses that may be seeded into a bracket or paid a prize. */
export const SEEDABLE_ENTRANT_STATUSES = ['accepted'] as const

export type CanonicalEntrant = {
  userId: string
  status: string
  /** Entry time — `created_at` for an entrant, `registered_at` for a mirror. */
  enteredAt: string | null
}

export type CanonicalEntrantOptions = {
  /** Which part of the lifecycle counts. Defaults to SEEDABLE ('accepted'). */
  statuses?: readonly string[]
  /** Run the read-through mirror first. Default true; see canonicalEntrants. */
  sync?: boolean
}

/**
 * Run a statement whose table may be ABSENT on this install, or which may lose
 * a benign race (the unique (tournament_id, user_id) index catching a
 * concurrent mirror). In real Postgres ONE failed statement poisons the whole
 * surrounding transaction (25P02), which would roll back the wallet credits an
 * end-sweep had already written — so the failure is fenced behind a SAVEPOINT
 * and treated as "nothing to do". Same pattern as `optionalRows` in
 * server/tournamentEndSweep.ts, for the same reason.
 */
async function fenced<T>(db: EntrantQueryable, run: () => Promise<T>, fallback: T): Promise<T> {
  let savepoint = false
  try {
    await db.query('savepoint tko_entrant_sync')
    savepoint = true
  } catch { /* engine without savepoints — the catch below still contains it */ }
  try {
    const value = await run()
    if (savepoint) { try { await db.query('release savepoint tko_entrant_sync') } catch { /* noop */ } }
    return value
  } catch {
    if (savepoint) { try { await db.query('rollback to savepoint tko_entrant_sync') } catch { /* noop */ } }
    return fallback
  }
}

/**
 * Mirror ONE King-flow registration into the canonical entrant table.
 *
 * Idempotent by (tournament_id, user_id): the `not exists` guard covers engines
 * without the unique index (the in-memory test schema), and the fence above
 * absorbs the unique violation when two writers race in real Postgres. An
 * existing entrant row — whatever its status, including a host's 'rejected' —
 * is left ALONE: the mirror never resurrects or re-approves an entry the host
 * already ruled on.
 *
 * Returns true when a row was created.
 */
export async function ensureEntrantForRegistration(
  db: EntrantQueryable,
  tournamentId: string,
  userId: string,
  enteredAt?: string | null,
): Promise<boolean> {
  if (!tournamentId || !userId) return false
  return fenced(db, async () => {
    const result = await db.query(
      `insert into tournament_entrants (tournament_id, user_id, status, agreed_to_rules_at, created_at)
       select $1, $2, 'accepted', coalesce($3::timestamptz, now()), coalesce($3::timestamptz, now())
        where not exists (
          select 1 from tournament_entrants where tournament_id=$1 and user_id=$2
        )`,
      [tournamentId, userId, enteredAt ?? null],
    )
    return Number(result.rowCount ?? 0) > 0
  }, false)
}

/** Backfill ONE tournament: two plain reads and a JS diff. */
async function backfillOne(db: EntrantQueryable, tournamentId: string): Promise<number> {
  const registrations = await fenced(db, async () => (await db.query(
    'select user_id, registered_at from tournament_registrations where tournament_id=$1',
    [tournamentId],
  )).rows, [] as any[])
  if (registrations.length === 0) return 0

  const existing = new Set(
    (await fenced(db, async () => (await db.query(
      'select user_id from tournament_entrants where tournament_id=$1',
      [tournamentId],
    )).rows, [] as any[])).map((row: any) => String(row.user_id)),
  )

  let created = 0
  for (const row of registrations) {
    const userId = String(row.user_id ?? '')
    if (!userId || existing.has(userId)) continue
    const made = await ensureEntrantForRegistration(
      db,
      tournamentId,
      userId,
      row.registered_at ? new Date(row.registered_at).toISOString() : null,
    )
    if (made) {
      existing.add(userId)
      created += 1
    }
  }
  return created
}

/**
 * Heal every registration that has no canonical entrant row. Scoped to one
 * tournament when `tournamentId` is given, otherwise the whole install (the
 * boot backfill). Returns how many entrant rows were created.
 *
 * Deliberately two plain reads and a JS diff per tournament rather than one
 * `not exists` join: pg-mem — the in-memory engine the whole server suite runs
 * on — cannot resolve an alias-qualified column inside a correlated subquery,
 * so the elegant single query silently returns nothing there and the backfill
 * would be untestable. The same reasoning already governs the roster reads in
 * server/tournamentEndSweep.ts and server/askContext.ts. Work stays bounded per
 * tournament, and `tournament_registrations` is the small King-flow table.
 */
export async function backfillEntrantsFromRegistrations(
  db: EntrantQueryable,
  tournamentId?: string | null,
): Promise<number> {
  if (tournamentId) return backfillOne(db, String(tournamentId))

  const tournamentIds = await fenced(db, async () => (await db.query(
    'select distinct tournament_id from tournament_registrations',
  )).rows, [] as any[])
  let created = 0
  for (const row of tournamentIds) {
    const id = String(row.tournament_id ?? '')
    if (id) created += await backfillOne(db, id)
  }
  return created
}

/**
 * THE canonical roster for one tournament, in entry order.
 *
 * Backfills first (see the header: read-through is the third guard), then reads
 * the canonical table alone — no union, no per-caller dedupe, no fallback that
 * silently discards one of the two rosters.
 *
 * `statuses` selects which part of the lifecycle counts. Seeding and prize
 * eligibility pass SEEDABLE_ENTRANT_STATUSES ('accepted' — an entry the host
 * has not approved is not in the bracket); notification passes
 * ACTIVE_ENTRANT_STATUSES so a pending entrant still hears that it ended.
 */
export async function canonicalEntrants(
  db: EntrantQueryable,
  tournamentId: string,
  options: CanonicalEntrantOptions = {},
): Promise<CanonicalEntrant[]> {
  if (!tournamentId) return []
  // `sync: false` for a caller that has ALREADY backfilled this tournament in
  // the same unit of work — the end sweep reads the roster three times and
  // should not pay for three mirrors.
  if (options.sync !== false) await backfillEntrantsFromRegistrations(db, tournamentId)
  const statuses = options.statuses ?? SEEDABLE_ENTRANT_STATUSES
  const list = statuses.length ? statuses : SEEDABLE_ENTRANT_STATUSES
  const params: any[] = [tournamentId]
  const placeholders = list.map((status) => { params.push(status); return `$${params.length}` }).join(', ')
  const rows = await fenced(db, async () => (await db.query(
    `select user_id, status, created_at
       from tournament_entrants
      where tournament_id=$1 and status in (${placeholders})
      order by created_at, user_id`,
    params,
  )).rows, [] as any[])

  const seen = new Set<string>()
  const entrants: CanonicalEntrant[] = []
  for (const row of rows) {
    const userId = String(row.user_id ?? '')
    if (!userId || seen.has(userId)) continue
    seen.add(userId)
    entrants.push({
      userId,
      status: String(row.status ?? 'pending'),
      enteredAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    })
  }
  return entrants
}

/** Convenience: just the ids of the canonical roster, in entry order. */
export async function canonicalEntrantIds(
  db: EntrantQueryable,
  tournamentId: string,
  options: CanonicalEntrantOptions = {},
): Promise<string[]> {
  return (await canonicalEntrants(db, tournamentId, options)).map((entrant) => entrant.userId)
}

/** Convenience: how many entrants the canonical roster holds (bracket depth). */
export async function canonicalEntrantCount(
  db: EntrantQueryable,
  tournamentId: string,
  options: CanonicalEntrantOptions = {},
): Promise<number> {
  return (await canonicalEntrants(db, tournamentId, options)).length
}
