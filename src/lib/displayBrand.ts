export const SSL_LEAGUE_SLUG = 'shinobistrikerleague'

export type DisplayBrandContext = {
  slug?: string | null
  name?: string | null
  source?: 'domain' | 'stored' | null
}

export type LeagueDisplayBrand = {
  isSsl: boolean
  productName: 'SSL' | 'TKO'
  assistantName: 'Ask SSL' | 'Ask TKO'
}

export const TKO_DISPLAY_BRAND: LeagueDisplayBrand = {
  isSsl: false,
  productName: 'TKO',
  assistantName: 'Ask TKO',
}

export const SSL_DISPLAY_BRAND: LeagueDisplayBrand = {
  isSsl: true,
  productName: 'SSL',
  assistantName: 'Ask SSL',
}

/** User-facing King labels; internal route, API, and database names stay TKO. */
export function kingDisplayName(display: LeagueDisplayBrand): string {
  return `${display.productName} King`
}

export function kingLadderDisplayName(display: LeagueDisplayBrand): string {
  return `${kingDisplayName(display)} ladder`
}

/** Inline logo/splash attribution follows entitlement, except SSL uses only its global bottom line. */
export function shouldShowInlineTkoAttribution(
  display: LeagueDisplayBrand,
  hasCleanBrand: boolean,
): boolean {
  return !display.isSsl && !hasCleanBrand
}

function compact(value: string | null | undefined): string {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * SSL naming is an address takeover, never a membership-wide rename. A player
 * using bare tko.cam keeps TKO wording even when their account belongs to SSL.
 */
export function leagueDisplayBrand(context: DisplayBrandContext): LeagueDisplayBrand {
  if (context.source !== 'domain') return TKO_DISPLAY_BRAND
  const slug = compact(context.slug)
  const name = compact(context.name)
  return slug === SSL_LEAGUE_SLUG || name === 'shinobistrikerleague' || name === 'ssl'
    ? SSL_DISPLAY_BRAND
    : TKO_DISPLAY_BRAND
}

const ATTRIBUTION = 'Powered by TKO.cam'
const ATTRIBUTION_TOKEN = '\u0000TKO_ATTRIBUTION\u0000'
const SSL_PUBLIC_ORIGIN = 'https://shinobistrikerleague.com'

/**
 * Rewrite platform-owned UI copy for the SSL app. Internal keys, routes, API
 * payloads, and stored content never pass through here. The one approved TKO
 * attribution remains byte-for-byte exact.
 */
export function rewriteVisibleBrandText(value: string, display: LeagueDisplayBrand): string {
  if (!display.isSsl || !value) return value
  return value
    .split(ATTRIBUTION).join(ATTRIBUTION_TOKEN)
    // A visible link must remain a real link. Replacing only the wordmark in
    // `https://tko.cam/...` would produce the invalid-looking `https://SSL/...`.
    .replace(/https?:\/\/(?:www\.)?tko\.cam(?=\/|\b)/gi, SSL_PUBLIC_ORIGIN)
    .replace(/Ask TKO/g, display.assistantName)
    .replace(/TKO\.cam/g, display.productName)
    // BRAND.domain is intentionally lowercase. On an SSL legal/support page it
    // must resolve to the real public domain rather than leak the house URL.
    .replace(/\btko\.cam\b/g, 'shinobistrikerleague.com')
    .replace(/\bTKO\b/g, display.productName)
    .split(ATTRIBUTION_TOKEN).join(ATTRIBUTION)
}
