/**
 * Creator Agreement — the explicit, timestamped license a creator grants when
 * they upload/build on KillCam. This is the legal backbone of the business:
 * every upload records an immutable `creator_agreements` row (migration 013)
 * capturing WHAT was granted, for WHICH content, under WHICH version, with a
 * hash of the exact text the creator saw.
 *
 * Keep VERSION and TEXT in lockstep: any change to the granted rights MUST bump
 * the version so old acceptances aren't silently reinterpreted.
 */
import { supabase } from './supabase'
import { BRAND } from './brand'

export const CREATOR_AGREEMENT_VERSION = 'killcam-creator-1.0'

/** Creator's share of net ad revenue attributable to their content, in basis
 * points. 5000 = 50%. This is the number shown in the UI and stored on the
 * agreement so a later change doesn't rewrite past terms. */
export const REV_SHARE_BPS = 5000

export const REV_SHARE_PERCENT = REV_SHARE_BPS / 100

/**
 * The canonical agreement text. Shown at upload and hashed into the record.
 * Plain-language but operative. Not a substitute for counsel-reviewed full ToS,
 * but it is a real, specific grant.
 */
export const CREATOR_AGREEMENT_TEXT = [
  `KillCam Creator Agreement (${CREATOR_AGREEMENT_VERSION})`,
  ``,
  `By submitting a clip you confirm you own it or have all rights to it, and you`,
  `grant ${BRAND.name} a non-exclusive, worldwide, royalty-free, sublicensable`,
  `license to:`,
  `  1. HOST and store your clip and any derivatives;`,
  `  2. EDIT and COMBINE it with other creators' clips into synced multi-angle`,
  `     edits and other derivative works;`,
  `  3. DISTRIBUTE and publicly display those works, including publishing them to`,
  `     the ${BRAND.name} YouTube channel and embedding them back on ${BRAND.domain};`,
  `  4. MONETIZE those works (display ads, YouTube ads, sponsorships).`,
  ``,
  `In return, ${BRAND.name} pays participating creators a ${REV_SHARE_PERCENT}% share of`,
  `net advertising revenue attributable to works that include their clip, tracked`,
  `in your creator dashboard. You keep ownership of your original clip and may`,
  `request takedown of your original at any time (already-published combined`,
  `masters may persist where distribution is out of our control, e.g. YouTube).`,
  ``,
  `Raw uploads are transient: once a combined master is confirmed published, the`,
  `raw source may be deleted from our servers to control cost. You are responsible`,
  `for clearing music and third-party IP in your footage.`,
].join('\n')

/** SHA-256 hex of the exact agreement text (audit / dispute defense). */
export async function agreementHash(text: string = CREATOR_AGREEMENT_TEXT): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(text)
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return '' // Non-fatal: the row still records version + timestamp + grants.
  }
}

type RecordOpts = {
  scope: 'account' | 'clip' | 'reel'
  userId: string
  clipId?: string | null
  reelId?: string | null
}

/**
 * Insert the immutable acceptance record. Best-effort but surfaces errors so a
 * caller can decide whether to hard-fail the publish. We record the full set of
 * grants = true and the rev-share in effect at acceptance time.
 */
export async function recordCreatorAgreement(opts: RecordOpts): Promise<{ error: string | null }> {
  const content_sha256 = await agreementHash()
  const user_agent = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 500) : null
  const { error } = await supabase.from('creator_agreements').insert({
    user_id: opts.userId,
    scope: opts.scope,
    clip_id: opts.clipId ?? null,
    reel_id: opts.reelId ?? null,
    agreement_version: CREATOR_AGREEMENT_VERSION,
    content_sha256,
    grant_host: true,
    grant_edit_combine: true,
    grant_distribute: true,
    grant_youtube: true,
    grant_monetize: true,
    rev_share_bps: REV_SHARE_BPS,
    user_agent,
  })
  return { error: error ? error.message : null }
}
