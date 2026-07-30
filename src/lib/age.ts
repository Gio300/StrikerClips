/**
 * AGE GATE (13+).
 *
 * The Terms require account holders to be at least 13, and both app stores'
 * families/UGC policies expect that to be enforced at signup rather than merely
 * asserted in prose. This module is the single source of truth for the rule.
 *
 * We ask for a DATE OF BIRTH rather than an "I am 13+" checkbox: a computed age
 * is a stronger attestation (it is a specific factual claim, it is auditable
 * after the fact, and it lets us re-check the same value server-side).
 *
 * Pure — no React, no storage, no Date.now() unless the caller omits `now`.
 * server/app.ts mirrors this rule inline (it cannot import from src/); keep the
 * two in sync if MIN_AGE_YEARS ever changes.
 */

/** Minimum account age, in years. */
export const MIN_AGE_YEARS = 13

/** Oldest plausible birth date, in years — catches typos like year 0202. */
export const MAX_AGE_YEARS = 120

/** ISO calendar date, `YYYY-MM-DD` — exactly what <input type="date"> emits. */
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export type AgeCheckReason = 'required' | 'invalid' | 'future' | 'implausible' | 'too_young'

export type AgeCheck =
  | { ok: true; age: number }
  | { ok: false; reason: AgeCheckReason; age: number | null; message: string }

/**
 * Parse `YYYY-MM-DD` into UTC calendar parts, rejecting non-existent dates
 * (`2011-02-30`) that Date would otherwise roll forward.
 */
function parseIsoDate(value: string): { y: number; m: number; d: number } | null {
  const m = ISO_DATE.exec(value.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  return { y, m: mo, d }
}

/**
 * Whole years elapsed between `dob` and `now`, by the calendar (a birthday
 * counts on the day it lands, not the day after). Returns null for a date we
 * cannot parse. Compared in UTC so a device timezone can never shift the answer
 * by a day across the 13th birthday boundary.
 */
export function ageOnDate(dob: string, now: Date = new Date()): number | null {
  const parts = parseIsoDate(String(dob ?? ''))
  if (!parts) return null
  const nY = now.getUTCFullYear()
  const nM = now.getUTCMonth() + 1
  const nD = now.getUTCDate()
  let age = nY - parts.y
  // Birthday hasn't happened yet this year → one year younger.
  if (nM < parts.m || (nM === parts.m && nD < parts.d)) age -= 1
  return age
}

/** Human-readable rejection copy, so every surface says the same thing. */
const MESSAGES: Record<AgeCheckReason, string> = {
  required: 'Enter your date of birth to continue.',
  invalid: 'Enter a valid date of birth (YYYY-MM-DD).',
  future: 'Date of birth cannot be in the future.',
  implausible: 'Please check your date of birth.',
  too_young: `You must be at least ${MIN_AGE_YEARS} years old to create an account.`,
}

/**
 * Validate a date of birth for signup. Fails closed: anything we cannot read as
 * a real past date old enough to qualify is a rejection, never a pass.
 */
export function validateDateOfBirth(dob: string | null | undefined, now: Date = new Date()): AgeCheck {
  const raw = String(dob ?? '').trim()
  if (!raw) return { ok: false, reason: 'required', age: null, message: MESSAGES.required }
  const age = ageOnDate(raw, now)
  if (age === null) return { ok: false, reason: 'invalid', age: null, message: MESSAGES.invalid }
  if (age < 0) return { ok: false, reason: 'future', age, message: MESSAGES.future }
  if (age > MAX_AGE_YEARS) return { ok: false, reason: 'implausible', age, message: MESSAGES.implausible }
  if (age < MIN_AGE_YEARS) return { ok: false, reason: 'too_young', age, message: MESSAGES.too_young }
  return { ok: true, age }
}

/** Convenience predicate. */
export function isOldEnough(dob: string | null | undefined, now: Date = new Date()): boolean {
  return validateDateOfBirth(dob, now).ok
}

/**
 * The latest date of birth that still qualifies, as `YYYY-MM-DD`. Feed this to
 * an <input type="date" max=...> so the picker itself discourages under-13
 * entries (a UX nudge only — `validateDateOfBirth` is the actual gate).
 */
export function maxEligibleDob(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear() - MIN_AGE_YEARS, now.getUTCMonth(), now.getUTCDate()))
  return d.toISOString().slice(0, 10)
}

/** What we persist on the account when signup passes the gate. */
export type AgeAttestation = {
  date_of_birth: string
  age_at_signup: number
  age_verified_13_plus: true
  age_attested_at: string
}

export function buildAgeAttestation(dob: string, now: Date = new Date()): AgeAttestation | null {
  const check = validateDateOfBirth(dob, now)
  if (!check.ok) return null
  return {
    date_of_birth: String(dob).trim(),
    age_at_signup: check.age,
    age_verified_13_plus: true,
    age_attested_at: now.toISOString(),
  }
}
