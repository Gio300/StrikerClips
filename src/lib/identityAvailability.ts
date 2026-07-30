/**
 * identityAvailability — "is this name free?" against the live backend.
 *
 * The thin, side-effecting companion to the pure rules in `identity.ts`. It
 * answers availability for the three platform-unique identities (username,
 * clan name, clan tag) and, when a name is taken, hands back free alternatives
 * so the UI never dead-ends the user.
 *
 * Works on BOTH backends. The query is deliberately simple — a case-insensitive
 * PREFIX read (`.ilike(col, 'base%')`) — because:
 *   • `ilike` is implemented by the mock client (mockSupabase `likeToRegExp`),
 *     the real Express shim, and hosted PostgREST alike;
 *   • a prefix read can never MISS an exact collision (an exact match always
 *     starts with the base), so it's a safe superset;
 *   • the same one read seeds BOTH the taken check and the suggestions, so we
 *     don't fire a query per candidate variant.
 *
 * The superset is then narrowed in JS with the exact normalized comparison from
 * `identity.ts`, which also makes LIKE metacharacters (`%`, `_`) in the input
 * harmless — they only ever widen the fetched set, never the verdict.
 *
 * This is a UX guardrail, not the enforcement point: the DB's case-insensitive
 * UNIQUE indexes (db/schema.sql "IDENTITY UNIQUENESS") are the real gate and
 * will still reject a race between two people typing the same name at once.
 */

import { supabase } from './supabase'
import {
  CLAN_NAME_MAX,
  CLAN_TAG_MAX,
  USERNAME_MAX,
  isTaken,
  normalizeHandle,
  normalizeTag,
  suggestAlternatives,
  validateClanName,
  validateTag,
  validateUsername,
  type IdentityCheck,
} from './identity'

/** The three identities that must be unique across the platform. */
export type IdentityKind = 'username' | 'clanName' | 'clanTag'

interface KindSpec {
  table: string
  column: string
  /** Human label used in inline copy ("that username's taken"). */
  label: string
  normalize: (s: string) => string
  validate: (raw: string) => IdentityCheck
  maxLength: number
  /** Canonical value to persist (tags are stored uppercase). */
  canonical: (raw: string) => string
}

const SPECS: Record<IdentityKind, KindSpec> = {
  username: {
    table: 'profiles',
    column: 'username',
    label: 'username',
    normalize: normalizeHandle,
    validate: validateUsername,
    maxLength: USERNAME_MAX,
    canonical: (raw) => raw.trim(),
  },
  clanName: {
    table: 'servers',
    column: 'name',
    label: 'clan name',
    normalize: normalizeHandle,
    validate: validateClanName,
    maxLength: CLAN_NAME_MAX,
    canonical: (raw) => raw.trim().replace(/\s+/g, ' '),
  },
  clanTag: {
    table: 'servers',
    column: 'clan_tag',
    label: 'clan tag',
    normalize: normalizeTag,
    validate: validateTag,
    maxLength: CLAN_TAG_MAX,
    canonical: (raw) => normalizeTag(raw),
  },
}

/** The label + canonical-value helpers, exposed for call sites. */
export function identityLabel(kind: IdentityKind): string {
  return SPECS[kind].label
}
export function canonicalValue(kind: IdentityKind, raw: string): string {
  return SPECS[kind].canonical(raw)
}
export function validateIdentity(kind: IdentityKind, raw: string): IdentityCheck {
  return SPECS[kind].validate(raw)
}

/**
 * A minimal structural view of the query builder. Both shims and the hosted
 * client satisfy it; typing it this narrowly (rather than `any`) keeps the
 * dynamic table/column names out of the generated `Database` generics without
 * giving up type-checking at the call site.
 */
type LooseResult = { data: unknown; error: unknown }
type LooseQuery = {
  select: (cols: string) => LooseQuery
  ilike: (col: string, val: string) => LooseQuery
  limit: (n: number) => PromiseLike<LooseResult>
}
function looseFrom(table: string): LooseQuery {
  return (supabase as unknown as { from: (t: string) => LooseQuery }).from(table)
}

/** How many prefix matches to pull — plenty to seed 3 suggestions. */
const SCAN_LIMIT = 200

export interface AvailabilityResult {
  /** `false` when the name is claimed by someone else (or the query failed open). */
  available: boolean
  /** Free variants to offer when `available` is false. */
  suggestions: string[]
  /** True when the backend read errored — treat as "couldn't check", not "taken". */
  errored: boolean
}

/**
 * Check whether `candidate` is free for `kind`.
 *
 * `excludeId` is the row that already owns the name (a clan editing its own
 * name, or a user re-saving their own username) — without it, every edit would
 * report itself as taken.
 */
export async function checkAvailability(
  kind: IdentityKind,
  candidate: string,
  opts: { excludeId?: string; suggestionCount?: number } = {},
): Promise<AvailabilityResult> {
  const spec = SPECS[kind]
  const value = spec.canonical(candidate)
  if (!value) return { available: false, suggestions: [], errored: false }

  let rows: Record<string, unknown>[] = []
  try {
    const res = await looseFrom(spec.table)
      .select(`id, ${spec.column}`)
      .ilike(spec.column, `${value}%`)
      .limit(SCAN_LIMIT)
    if (res.error) return { available: true, suggestions: [], errored: true }
    rows = (res.data as Record<string, unknown>[] | null) ?? []
  } catch {
    // Fail OPEN: a flaky read must not block someone from claiming a free name.
    // The DB unique index is the real gate and will reject a true collision.
    return { available: true, suggestions: [], errored: true }
  }

  const takenNormalized = rows
    .filter((r) => !opts.excludeId || String(r.id ?? '') !== opts.excludeId)
    .map((r) => spec.normalize(String(r[spec.column] ?? '')))
    .filter((v) => v !== '')

  const taken = isTaken(value, takenNormalized, spec.normalize)
  if (!taken) return { available: true, suggestions: [], errored: false }

  return {
    available: false,
    suggestions: suggestAlternatives(value, takenNormalized, {
      count: opts.suggestionCount ?? 3,
      maxLength: spec.maxLength,
      normalize: spec.normalize,
    }),
    errored: false,
  }
}
