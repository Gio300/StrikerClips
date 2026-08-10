import { useMemo } from 'react'
import { domainLeagueSlug } from '@/lib/leagueDomain'
import { activeLeagueSlug as hostLeagueSlug } from '@/lib/leagueUrls'

/**
 * Bundled league marks: slug -> public asset (relative to the deploy base).
 * Extend by dropping a transparent PNG in public/leagues/ and adding a line
 * here (source of truth for the render side lives in
 * Loras/assets/leagues/<slug>/logo_watermark.png — keep them the same image so
 * live, reels, and factory videos wear one mark).
 */
const LEAGUE_MARKS: Record<string, string> = {
  shinobistrikerleague: 'leagues/shinobistrikerleague.png',
  // circusrunaways: add ONLY once public/leagues/circusrunaways.png exists —
  // an entry here with no file resolves to a 404 and paints a broken-image
  // icon over every live stage and reel player, which is worse than the
  // monogram fallback this map is allowed to return null for.
}

/**
 * Bundled league splash MOTION GRAPHICS: slug -> public mp4 (relative to the
 * deploy base). A league with an entry here gets its video as the app-load
 * splash on its own domain (see Splash.tsx); leagues without one keep the
 * static lockup. Keep these small (H.264, muted, <2 MB) — they ship in the
 * bundle upload.
 */
const LEAGUE_SPLASH_VIDEOS: Record<string, string> = {
  shinobistrikerleague: 'leagues/shinobistrikerleague-splash.mp4',
}

/** Resolve a bundled public asset path under the deploy base. */
function publicAsset(rel: string): string {
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '')
  return `${base}/${rel}`
}

/**
 * The bundled logo asset for a league slug, or null. Served under the deploy
 * base ('/' on mobile, '/app/' on the hosted web deploy) so the same lookup
 * works everywhere. Shared with BrandLogo so the header/sidebar/splash wear
 * the exact same mark as the live/reel watermark.
 */
export function leagueMarkFor(slug: string | null | undefined): string | null {
  const rel = slug ? LEAGUE_MARKS[slug] : undefined
  return rel ? publicAsset(rel) : null
}

/**
 * The bundled splash video for a league slug, or null. Same deploy-base rule
 * as leagueMarkFor. Splash.tsx consumes this on a DOMAIN takeover only.
 */
export function leagueSplashVideoFor(slug: string | null | undefined): string | null {
  const rel = slug ? LEAGUE_SPLASH_VIDEOS[slug] : undefined
  return rel ? publicAsset(rel) : null
}

/**
 * THE hostname → league rule, re-exported from src/lib/leagueUrls.ts where it
 * now lives (moved 2026-08-06 so server/app.ts can build the per-host PWA
 * manifest from the identical rule instead of a second copy of it). Every
 * existing importer of `activeLeagueSlug` from this module is unchanged — the
 * only difference is that the browser default for `hostname` is applied here.
 */
export { KNOWN_LEAGUE_HOSTS } from '@/lib/leagueUrls'

export function activeLeagueSlug(
  hostname = typeof window !== 'undefined' ? window.location.hostname : '',
): string | null {
  return hostLeagueSlug(hostname)
}

/**
 * Small league logo pinned upper-right over every live stage and reel player
 * when the app is running AS a league (operator 2026-08-02: "I need to see the
 * Shinobi Striker League logo as a small overlay upper right on every live and
 * reel on shinobistrikerleague.com"). Decorative, never intercepts clicks;
 * renders nothing on tko.cam or for leagues without a bundled mark.
 */
export function LeagueWatermark({ className = '' }: { className?: string }) {
  // domainLeagueSlug = the hostname rule below plus the ?league= preview
  // override, so a local takeover preview shows the watermark too.
  const src = useMemo(() => leagueMarkFor(domainLeagueSlug()), [])
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      className={`pointer-events-none absolute right-2 top-2 z-30 h-9 w-auto opacity-90 drop-shadow-lg sm:h-10 ${className}`}
    />
  )
}
