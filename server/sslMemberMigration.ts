/**
 * 2026-08-02 OPERATOR MIGRATION — put the existing player base INTO the
 * SHINOBI STRIKER LEAGUE (leagues.slug 'shinobistrikerleague').
 *
 * Why: shinobistrikerleague.com went live pointing at the SAME backend as
 * tko.cam (same DB, same API — the Amplify site bakes VITE_API_BASE
 * https://tko.cam), so no data moves. What WAS missing is the association:
 * `league_members` had zero rows, so nothing routed the operator's existing
 * players to their league — member-league theming (App.tsx fetchMemberLeague →
 * setActiveLeagueSlug), the league kit in the reel builder (CreateHighlight),
 * the live-control skin (LiveControlLayout) and league management
 * (isLeagueManager) all keyed off rows that did not exist.
 *
 * Shape: idempotent boot statements, exactly like the SSL league seed in
 * server/index.ts (they run in that file's bootstrapTables() ddl loop on every
 * boot, each wrapped in try/catch). Guarded (membership check + on conflict
 * do nothing) so they insert exactly once, never clobber later edits, re-run on
 * every deploy — which also means a named player who registers LATER (e.g.
 * GlizzardOfOz had no profile yet on 2026-08-02) is picked up by the next boot.
 *
 * Exported as a builder (the PHYSICAL_MERCH_DDL sharing pattern) so the pg-mem
 * suite (server/sslMemberMigration.test.ts) exercises the very statements
 * production runs.
 */

/** The launch league's slug — must match the seed in server/index.ts. */
export const SSL_LEAGUE_SLUG = 'shinobistrikerleague'

/**
 * The operator's named players (operator message, 2026-08-02), lowercased for
 * the case-insensitive username join on profiles. Unknown names simply match
 * nothing — they are NOT created here; they join when they register.
 */
export const SSL_FOUNDING_USERNAMES = [
  'hammy',
  'kissatronix',
  'patternaftererror',
  'mrjerry',
  'glizzardofoz',
] as const

/**
 * The SSL league's id as a DERIVED TABLE whose one column is renamed away
 * from `id`. Never write `leagues join profiles/users` directly: both sides
 * carry an `id` column and pg-mem resolves that ambiguity to the LEFT table,
 * silently turning `p.id` into the league's id (a scalar subquery in the
 * projection is no escape either — pg-mem types it uuid[]). If the league
 * seed above this migration ever failed, the derived table is empty and the
 * join makes every statement a natural no-op.
 */
const SSL_LEAGUE = `(select id as league_row_id from public.leagues where slug = '${SSL_LEAGUE_SLUG}') lg`

/**
 * ONE single-row statement per named player (usernames are unique in
 * profiles), instead of one multi-row insert..select over the whole list:
 * pg-mem constant-folds a zero-arg gen_random_uuid() once per statement, so
 * any multi-row insert collides with itself on the pkey there. Real Postgres
 * is happy either way; five tiny guarded inserts at boot cost nothing.
 */
const memberInsert = (username: string) =>
  `insert into public.league_members (id, league_id, user_id, role)
   select gen_random_uuid(), lg.league_row_id, p.id, 'member'
     from public.profiles p
     join ${SSL_LEAGUE} on lower(p.username) = '${username}'
    where ${NOT_YET_A_MEMBER('p.id')}
   on conflict (league_id, user_id) do nothing`

/**
 * Conservative email shape check. The operator email arrives from the
 * SSL_OPERATOR_EMAIL env var (server/index.ts) — never from a request — but
 * the value is inlined into SQL, so only a plainly safe charset is accepted.
 * No quotes, no whitespace, no backslashes possible.
 */
const SAFE_EMAIL = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/

/**
 * "Not already an SSL member" guard, written UNCORRELATED (no reference to the
 * outer query's aliases): pg-mem — the engine the test suite runs the exact
 * production statements on — cannot resolve a joined alias inside a correlated
 * NOT EXISTS. There is exactly one league per slug and membership is unique
 * per (league_id, user_id), so scoping the subquery by slug is equivalent;
 * membership in OTHER leagues never blocks SSL enrollment.
 *
 * Note the deliberate re-enroll semantics shared by every seed of this shape:
 * if a row is DELETED later, the next boot restores it. Removing one of the
 * named players permanently means editing this list.
 *
 * Each insert ALSO carries `on conflict (league_id, user_id) do nothing`
 * (the table's unique constraint): pg-mem caches a compiled statement by its
 * text and re-executes it against a stale materialization of this subquery,
 * so on a re-run the guard alone does not stop the insert there. On real
 * Postgres the guard already suffices; the conflict clause is what makes the
 * re-run provably a no-op on BOTH engines (and under concurrent boots).
 */
const NOT_YET_A_MEMBER = (idColumn: string) =>
  `${idColumn} not in (
     select m.user_id from public.league_members m
      where m.league_id in (select id from public.leagues where slug = '${SSL_LEAGUE_SLUG}'))`

/**
 * Build the migration statements. `operatorEmail` (optional) identifies the
 * operator's own account by login email — usernames are public but the
 * operator's handle was ambiguous, while the account email is authoritative
 * and `users` is only reachable server-side, exactly where this runs.
 *
 * Statement ORDER matters: the operator's owner-role membership goes first so
 * that, if the operator's own account is ALSO one of the named usernames, the
 * member-role insert's membership guard sees the owner row and skips it — the
 * operator can never be demoted to 'member' by their own migration.
 */
export function sslMemberMigration2026_08_02(operatorEmail?: string | null): string[] {
  const email = String(operatorEmail ?? '').trim().toLowerCase()
  const operatorStatements = SAFE_EMAIL.test(email)
    ? [
        // 1) The operator joins their own league as 'owner' (league
        //    management — isLeagueManager — flows from this role). Same
        //    derived-table shape as memberInsert, over users instead.
        `insert into public.league_members (id, league_id, user_id, role)
         select gen_random_uuid(), lg.league_row_id, u.id, 'owner'
           from public.users u
           join ${SSL_LEAGUE} on lower(u.email) = '${email}'
          where ${NOT_YET_A_MEMBER('u.id')}
         on conflict (league_id, user_id) do nothing`,
        // 2) Claim the leagues row itself — the seed created it with owner_id
        //    null, which left the league unmanageable from the Studio. Only
        //    fills the blank; a later ownership transfer is never overwritten.
        `update public.leagues
            set owner_id = (select u.id from public.users u
                             where lower(u.email) = '${email}' limit 1),
                updated_at = now()
          where slug = '${SSL_LEAGUE_SLUG}'
            and owner_id is null
            and exists (select 1 from public.users u
                         where lower(u.email) = '${email}')`,
      ]
    : []
  return [
    ...operatorStatements,
    // 3) The named existing players become plain members, by username join on
    //    profiles (the operator asked for these players by name).
    ...SSL_FOUNDING_USERNAMES.map(memberInsert),
  ]
}
