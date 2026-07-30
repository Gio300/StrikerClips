import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { adConfig } from '@/lib/adConfig'
import { useEntitlements } from '@/hooks/useEntitlements'
import { hidesAds } from '@/lib/tiers'

type AdShape = 'banner' | 'leaderboard' | 'square' | 'mobile-banner'
type AdSlotProps = {
  /** Logical slot id. Used to look up an AdSense slot ID and pick a default house ad. */
  slotId: string
  /** Visual aspect / target placement. Defaults to 'banner'. */
  shape?: AdShape
  /** When true, shows a small ✕ that lets a free user hide this one slot. */
  dismissable?: boolean
  className?: string
}

/**
 * Renders an ad slot anywhere a video is shown.
 *
 * Behavior:
 *   1. If AdSense client + slot ID are configured for this slotId, serves a
 *      real Google AdSense unit.
 *   2. Otherwise renders a clickable in-house "house ad" placeholder that
 *      promotes the village (signup, create, tournaments). Looks like a real
 *      ad, is clickable, and works the same regardless of where the reel
 *      gets reposted — every share leads back here, where this slot lives.
 *
 * The house ad pool rotates per slot+page-load so different placements show
 * different creatives, demonstrating where ads will appear without spamming
 * the same one twice.
 */
export function AdSlot({ slotId, shape = 'banner', dismissable = false, className = '' }: AdSlotProps) {
  const ref = useRef<HTMLModElement>(null)
  const { tier } = useEntitlements()
  const [dismissed, setDismissed] = useState(false)
  // Paid tiers (ad_free / pro / supporter / creator + founder) never see ads —
  // every slot everywhere short-circuits here, so nothing has to remember to
  // wrap AdSlot in a gate.
  const adsHidden = hidesAds(tier)
  // AdSense publisher id + per-slot ids come from the single config surface
  // (src/lib/adConfig.ts → VITE_ADSENSE_CLIENT / VITE_ADSENSE_<SLOT>). When both
  // the client and this slot's id are set we serve a real unit; otherwise the
  // house-ad fallback below renders. Paid users never reach here (FreeUserAdSlot
  // / AdGate short-circuit on hidesAds()).
  const slotKey = adConfig.slots[slotId]
  const hasAdsense = Boolean(adConfig.clientId && slotKey)

  useEffect(() => {
    if (!hasAdsense || !ref.current) return
    try {
      const w = window as { adsbygoogle?: unknown[] }
      w.adsbygoogle = w.adsbygoogle ?? []
      w.adsbygoogle.push({})
    } catch {
      // AdSense script may not be loaded yet — this just no-ops; we'll still
      // render the AdSense slot tag below so it picks up when available.
    }
  }, [hasAdsense, slotKey])

  // Stable creative per (slotId, mount) so it doesn't flicker on re-render.
  const creative = useMemo(() => pickCreative(slotId), [slotId])
  const heightClass = SHAPE_HEIGHT[shape]

  // Paid users (and anyone who dismissed this slot) get nothing.
  if (adsHidden || dismissed) return null

  if (hasAdsense) {
    return (
      <div className={`relative ${heightClass} ${className}`}>
        <span className="absolute -top-2 left-2 z-10 px-1.5 py-0.5 rounded bg-dark text-[10px] uppercase tracking-wide text-gray-500 border border-dark-border">
          Ad
        </span>
        <ins
          ref={ref}
          className="adsbygoogle block w-full h-full"
          style={{ display: 'block' }}
          data-ad-client={adConfig.clientId}
          data-ad-slot={slotKey}
          data-ad-format="auto"
          data-full-width-responsive="true"
        />
      </div>
    )
  }

  // No AdSense id for this slot. By default we render a clearly-labeled
  // PLACEHOLDER (so the team can see the ad's footprint in every flow); with
  // VITE_AD_HOUSE_ADS=1 we serve a clickable in-house creative instead.
  const fallback = adConfig.houseAds ? (
    <HouseAd creative={creative} shape={shape} className={className} />
  ) : (
    <AdPlaceholder shape={shape} className={className} />
  )

  if (!dismissable) return fallback
  return (
    <div className="relative">
      {fallback}
      <button
        type="button"
        aria-label="Hide this ad"
        onClick={() => setDismissed(true)}
        className="absolute top-1 right-1 z-20 h-6 w-6 flex items-center justify-center rounded-full bg-black/60 text-gray-300 text-xs hover:text-white hover:bg-black/80 border border-dark-border"
      >
        ✕
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* Labeled placeholder (default when AdSense isn't configured)                */
/* ------------------------------------------------------------------------- */

const SHAPE_LABEL: Record<AdShape, string> = {
  'banner': 'Banner ad · 320×110',
  'leaderboard': 'Leaderboard ad · 728×90',
  'square': 'Square ad · 300×250',
  'mobile-banner': 'Mobile banner · 320×100',
}

/**
 * A tasteful, clearly-labeled "your ad here" box shown at the slot's real size.
 * This is what makes ad real-estate VISIBLE before any network is wired: an
 * "Advertisement" pill, a dashed frame, and the placement's target dimensions.
 */
function AdPlaceholder({ shape, className }: { shape: AdShape; className: string }) {
  return (
    <div
      role="img"
      aria-label="Advertisement placeholder"
      className={`relative ${SHAPE_HEIGHT[shape]} rounded-lg border border-dashed border-dark-border bg-dark-elevated/40 overflow-hidden flex flex-col items-center justify-center text-center px-4 ${className}`}
    >
      <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/50 text-[10px] uppercase tracking-wide text-gray-400 border border-dark-border">
        Advertisement
      </span>
      <div className="text-sm font-semibold text-gray-300">Sponsored — your ad here</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{SHAPE_LABEL[shape]}</div>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* House ads                                                                  */
/* ------------------------------------------------------------------------- */

type Creative = {
  id: string
  to: string
  eyebrow: string
  headline: string
  body: string
  cta: string
  accent: 'kunai' | 'chakra' | 'leaf'
}

const CREATIVES: Creative[] = [
  {
    id: 'create-reel',
    to: '/highlight/create',
    eyebrow: 'Sponsored · TKO',
    headline: 'Every angle, one clutch reel',
    body: 'Combine up to 8 angles: action cam, ultra director, squad grid. Built for any game.',
    cta: 'Create a highlight',
    accent: 'kunai',
  },
  {
    id: 'tournaments',
    to: '/tournaments',
    eyebrow: 'Sponsored · Tournaments',
    headline: 'Run your bracket in 30 seconds',
    body: 'Open brackets, power-level seeding, and shared reels — all in your browser.',
    cta: 'Start a tournament',
    accent: 'chakra',
  },
  {
    id: 'signup',
    to: '/signup',
    eyebrow: 'Sponsored · TKO',
    headline: 'Free account. Unlimited reels.',
    body: 'Connect YouTube, invite friends, run tournaments, and share your best angles.',
    cta: 'Sign up free',
    accent: 'leaf',
  },
  {
    id: 'live',
    to: '/live',
    eyebrow: 'Sponsored · Live',
    headline: 'Watch community streams',
    body: 'Ranked sets, bracket finals, and watch parties — right in the hub.',
    cta: 'Watch live',
    accent: 'kunai',
  },
  {
    id: 'rankings',
    to: '/rankings',
    eyebrow: 'Sponsored · Power level',
    headline: 'Where do you rank?',
    body: 'Climb the power-level board with every reel and ranked W you upload.',
    cta: 'See the rankings',
    accent: 'chakra',
  },
]

function pickCreative(slotId: string): Creative {
  // Deterministic but varied: mix slotId hash with the day so refreshes get a
  // different placement each session, but renders within a session are stable.
  const seed = (hashCode(slotId) + new Date().getDate()) % CREATIVES.length
  return CREATIVES[(seed + CREATIVES.length) % CREATIVES.length]
}

function hashCode(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i)
    h |= 0
  }
  return h
}

const SHAPE_HEIGHT: Record<AdShape, string> = {
  'banner': 'min-h-[110px]',
  'leaderboard': 'min-h-[90px]',
  'square': 'min-h-[260px]',
  'mobile-banner': 'min-h-[100px]',
}

const ACCENT_GRADIENT: Record<Creative['accent'], string> = {
  kunai: 'from-kunai/20 via-kunai/5 to-transparent',
  chakra: 'from-chakra/20 via-chakra/5 to-transparent',
  leaf: 'from-leaf/20 via-leaf/5 to-transparent',
}
const ACCENT_TEXT: Record<Creative['accent'], string> = {
  kunai: 'text-kunai',
  chakra: 'text-chakra',
  leaf: 'text-leaf',
}
const ACCENT_BORDER: Record<Creative['accent'], string> = {
  kunai: 'border-kunai/30',
  chakra: 'border-chakra/30',
  leaf: 'border-leaf/30',
}

function HouseAd({ creative, shape, className }: { creative: Creative; shape: AdShape; className: string }) {
  const isSquare = shape === 'square'
  return (
    <Link
      to={creative.to}
      className={`relative block ${SHAPE_HEIGHT[shape]} rounded-lg border ${ACCENT_BORDER[creative.accent]} bg-gradient-to-br ${ACCENT_GRADIENT[creative.accent]} overflow-hidden hover:border-accent/60 transition-colors group ${className}`}
    >
      {/* Sponsored label, AdSense-style */}
      <span className="absolute top-2 right-2 z-10 px-1.5 py-0.5 rounded bg-black/60 text-[10px] uppercase tracking-wide text-gray-400 border border-dark-border">
        Ad
      </span>
      {/* faint shuriken motif */}
      <div className="pointer-events-none absolute -bottom-6 -right-6 text-[140px] opacity-[0.04] select-none" aria-hidden>✦</div>

      <div className={`relative h-full p-4 flex ${isSquare ? 'flex-col justify-between' : 'items-center gap-4'}`}>
        <div className="min-w-0 flex-1">
          <div className={`text-[11px] uppercase tracking-wide mb-1 ${ACCENT_TEXT[creative.accent]}`}>{creative.eyebrow}</div>
          <div className="font-semibold text-white truncate">{creative.headline}</div>
          <div className="text-sm text-gray-400 mt-1 line-clamp-2">{creative.body}</div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-md border ${ACCENT_BORDER[creative.accent]} ${ACCENT_TEXT[creative.accent]} text-sm font-semibold group-hover:bg-accent/10`}>
          {creative.cta}
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </span>
      </div>
    </Link>
  )
}
