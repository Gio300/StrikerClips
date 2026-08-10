/**
 * server/leagueUrl.ts — the trusted half of a league's URL identity.
 *
 * The vocabulary (rungs, tiers, reserved names, the TXT challenge shape) lives
 * in src/lib/leagueUrls.ts and is shared verbatim with the browser. THIS file
 * holds the two things only the server may do:
 *
 *   • MINT the verification token (crypto random, never client-supplied), and
 *   • ASK DNS whether the league actually published it.
 *
 * The resolver is swappable so tests can prove the claim → verify → serve
 * flow without touching the network, in exactly the way the Stripe suites stub
 * `fetch`.
 *
 * FAIL-SOFT is the rule here too: an unreachable resolver, an NXDOMAIN, a
 * malformed answer — all mean "not proven yet", never a 500. A league owner
 * retries; nothing breaks.
 */
import { promises as dnsPromises } from 'node:dns'
import { randomBytes } from 'node:crypto'
import {
  DOMAIN_VERIFY_PREFIX,
  DOMAIN_VERIFY_TOKEN_RE,
  normalizeCustomDomain,
  txtRecordsProve,
} from '../src/lib/leagueUrls'

/** A TXT lookup: host → the record's string chunks (node's resolveTxt shape). */
export type TxtResolver = (host: string) => Promise<string[][]>

let txtResolver: TxtResolver = (host) => dnsPromises.resolveTxt(host)

/** Swap the resolver (tests). Returns a restore fn. */
export function setTxtResolver(fn: TxtResolver): () => void {
  const previous = txtResolver
  txtResolver = fn
  return () => { txtResolver = previous }
}

/** A fresh 32-hex-char ownership token. Only ever generated here. */
export function newDomainVerifyToken(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Read `_tko-verify.<domain>` and flatten node's chunked answer into plain
 * strings. Any failure (NXDOMAIN, timeout, no resolver) yields an empty list.
 */
export async function lookupVerifyTxt(domain: string): Promise<string[]> {
  const host = normalizeCustomDomain(domain)
  if (!host) return []
  try {
    const answer = await txtResolver(`${DOMAIN_VERIFY_PREFIX}.${host}`)
    if (!Array.isArray(answer)) return []
    // resolveTxt returns string[][] — one inner array per record, chunked at
    // 255 bytes. Join the chunks of each record, never across records.
    return answer.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks ?? '')))
  } catch {
    return []
  }
}

/**
 * Is the domain proven to belong to the league holding `token`? The single
 * question `/api/fn/league-url-verify` asks before flipping a row to verified.
 */
export async function isDomainVerified(domain: string, token: string): Promise<boolean> {
  const t = String(token ?? '').trim().toLowerCase()
  if (!DOMAIN_VERIFY_TOKEN_RE.test(t)) return false
  return txtRecordsProve(await lookupVerifyTxt(domain), t)
}

/**
 * The columns rung 3 adds to `leagues`. Kept here so server/index.ts (real
 * Postgres) and server/testHarness.ts (pg-mem) can never drift on the shape
 * of a claimed domain.
 *
 * `domain` (the pre-existing column) stays what it always was: the league's
 * DISPLAY/marketing domain, free text the Studio writes. `custom_domain` is
 * the SERVING one — unique, verified, and the only one the host gate trusts.
 */
export const LEAGUE_URL_DDL: readonly string[] = [
  `alter table public.leagues add column if not exists custom_domain text`,
  `alter table public.leagues add column if not exists custom_domain_token text`,
  `alter table public.leagues add column if not exists custom_domain_status text not null default 'none'`,
  `alter table public.leagues add column if not exists custom_domain_verified_at timestamptz`,
  // One domain, one league — a second claim on a taken hostname must fail at
  // the database, not just in the handler.
  `create unique index if not exists uq_leagues_custom_domain
     on public.leagues(custom_domain) where custom_domain is not null`,
]
