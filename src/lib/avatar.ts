/**
 * Avatar helpers — the pure half of profile pictures.
 *
 * A user's picture is just `profiles.avatar_url`. It may be:
 *   • an http(s) URL the user pasted, or
 *   • a small `data:image/...` URL produced client-side by AvatarPicker, which
 *     downscales whatever the user picked to AVATAR_SIZE_PX square JPEG before
 *     it ever reaches Postgres. There is no blob storage wired for images, and
 *     inventing one for a 12 KB thumbnail would be new infra for no gain.
 *
 * Everything here is DOM-free and dependency-free so it unit-tests offline; the
 * canvas work lives in avatarImage.ts and the rendering in components/ui/Avatar.
 */

/** Square edge (px) every uploaded avatar is downscaled to before saving. */
export const AVATAR_SIZE_PX = 256

/**
 * Hard cap on a stored data URL. 96 KB of base64 ≈ a 256×256 JPEG at q0.8 with
 * a lot of headroom; anything larger means the encode went wrong and we refuse
 * rather than push a fat blob into a text column that ships with every profile
 * read.
 */
export const AVATAR_MAX_BYTES = 96_000

/** Brand accents an initials avatar may be tinted with. */
export const AVATAR_ACCENTS = ['accent', 'kunai', 'leaf', 'chakra', 'trust'] as const
export type AvatarAccent = (typeof AVATAR_ACCENTS)[number]

/**
 * Up to two initials for a display name. Handles "@name", "first last",
 * punctuation and emoji-only names (which fall back to '?').
 */
export function initialsFor(name?: string | null): string {
  const cleaned = (name ?? '').replace(/^@+/, '').trim()
  if (!cleaned) return '?'
  const words = cleaned.split(/[\s._-]+/).filter(Boolean)
  const letters: string[] = []
  for (const w of words) {
    const m = w.match(/[\p{L}\p{N}]/u)
    if (m) letters.push(m[0].toUpperCase())
    if (letters.length === 2) break
  }
  if (letters.length === 0) return '?'
  return letters.join('')
}

/**
 * Stable accent for a user — same seed always gets the same colour, so a person
 * looks the same in chat, on the roster and in the trophy closet.
 */
export function avatarAccentFor(seed?: string | null): AvatarAccent {
  const s = (seed ?? '').trim().toLowerCase()
  if (!s) return 'accent'
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return AVATAR_ACCENTS[(h >>> 0) % AVATAR_ACCENTS.length]
}

/** Byte length of a data URL's payload (base64 → bytes), 0 for non-data URLs. */
export function dataUrlBytes(value: string): number {
  const comma = value.indexOf(',')
  if (!value.startsWith('data:') || comma < 0) return 0
  const body = value.slice(comma + 1)
  if (!/;base64$/i.test(value.slice(0, comma))) return body.length
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((body.length * 3) / 4) - padding)
}

/**
 * Is this a value we're willing to store in `avatar_url` and render in an
 * <img src>? Only https/http images and small base64 image data URLs — never
 * `javascript:`, `data:text/html`, or an SVG data URL (SVG in an <img> is inert
 * in every current browser, but it is a scriptable format and not worth it for
 * a profile picture).
 */
export function isSafeAvatarUrl(value: string): boolean {
  const v = value.trim()
  if (!v) return false
  if (v.startsWith('data:')) {
    if (!/^data:image\/(png|jpe?g|webp|gif);base64,/i.test(v)) return false
    return dataUrlBytes(v) > 0 && dataUrlBytes(v) <= AVATAR_MAX_BYTES
  }
  if (!/^https?:\/\//i.test(v)) return false
  // Reject control characters / whitespace smuggled into a URL.
  return !/[\s<>"']/.test(v)
}

/**
 * Normalize what the user typed/produced into something storable, or null when
 * it isn't acceptable. Empty string means "clear my picture" and returns null
 * with `cleared: true` at the call site — callers treat null as "no picture".
 */
export function normalizeAvatarUrl(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  return isSafeAvatarUrl(v) ? v : null
}
