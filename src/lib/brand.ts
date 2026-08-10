/** Single source of truth for product name and default share copy. */
export const BRAND = {
  name: 'TKO',
  /** Domain-style wordmark used where the full brand reads better. */
  domain: 'tko.cam',
  /** Two-tone wordmark halves (TKO / .cam). */
  nameParts: ['TKO', '.cam'] as const,
  /** One line — every angle of the knockout, one cam. */
  tagline: 'Every angle of the knockout. One cam.',
  defaultShareTitle: (title?: string) => title?.trim() || 'Check out this TKO clip',
} as const

/**
 * SUPPORT — where a human (or the next best thing) can be reached.
 *
 * There is no ticketing system and no support inbox staffed by anyone but the
 * founder, so "get help" deliberately points at exactly two real places: the
 * in-app guided assistant, and the Facebook page where a person actually reads
 * and replies. Single source of truth so the Help page, the phone "More" sheet
 * and the legal pages can never drift apart.
 */
export const SUPPORT = {
  facebookHandle: 'tkocam',
  facebookUrl: 'https://facebook.com/tkocam',
  /** Shown as the link text — no scheme, it reads better on a phone. */
  facebookLabel: 'Facebook support',
  email: 'awakengiovanni3000@gmail.com',
} as const
