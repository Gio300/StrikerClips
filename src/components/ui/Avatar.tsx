import { useState } from 'react'
import { avatarAccentFor, initialsFor, isSafeAvatarUrl, type AvatarAccent } from '@/lib/avatar'

/**
 * Avatar — the one way a person is drawn anywhere in the app.
 *
 * Shows `src` when there is a usable picture, and otherwise a clean
 * initials-in-a-circle chip tinted with a stable brand accent derived from the
 * user id / name (so the same person is the same colour in chat, on the clan
 * roster and in the trophy closet). A broken image URL falls back to the same
 * initials chip instead of leaving a torn-image glyph.
 *
 * Deliberately unopinionated about layout: it renders one fixed-size circle and
 * nothing else, so callers can drop it into a flex row exactly where they used
 * to hand-roll an <img>.
 */

export interface AvatarProps {
  /** profiles.avatar_url — null/empty renders the initials fallback. */
  src?: string | null
  /** Display name used for the initials + the accessible label. */
  name?: string | null
  /** Stable seed for the accent colour. Defaults to `name`. */
  seed?: string | null
  /** Circle edge in px. */
  size?: number
  className?: string
  /** Alt text override. Defaults to the name (decorative when unnamed). */
  alt?: string
}

// Full class strings — Tailwind can't see interpolated names.
const ACCENT_CLASS: Record<AvatarAccent, string> = {
  accent: 'bg-accent/20 text-accent',
  kunai: 'bg-kunai/20 text-kunai',
  leaf: 'bg-leaf/20 text-leaf',
  chakra: 'bg-chakra/20 text-chakra',
  trust: 'bg-trust/20 text-trust',
}

export function Avatar({ src, name, seed, size = 40, className = '', alt }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  const usable = !!src && isSafeAvatarUrl(src) && !failed
  const label = alt ?? (name ? `${name}'s profile picture` : '')
  const box = { width: size, height: size }

  if (usable) {
    return (
      <img
        src={src!}
        alt={label}
        loading="lazy"
        onError={() => setFailed(true)}
        style={box}
        className={`rounded-full object-cover shrink-0 bg-dark-elevated ${className}`}
      />
    )
  }

  const accent = ACCENT_CLASS[avatarAccentFor(seed ?? name)]
  return (
    <span
      role="img"
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
      style={{ ...box, fontSize: Math.max(9, Math.round(size * 0.4)) }}
      className={`rounded-full shrink-0 inline-flex items-center justify-center font-bold leading-none select-none ${accent} ${className}`}
    >
      {initialsFor(name)}
    </span>
  )
}

export default Avatar
