import { BRAND } from '@/lib/brand'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { leagueMarkFor } from '@/components/LeagueWatermark'
import { TKO_NEUTRAL } from '@/lib/leagueTheme'
import { leagueCan } from '@/lib/leaguePlans'
import { shouldShowInlineTkoAttribution } from '@/lib/displayBrand'

type BrandLogoVariant = 'horizontal' | 'mark' | 'icon'

type BrandLogoProps = {
  className?: string
  as?: 'span' | 'h1'
  variant?: BrandLogoVariant
  /**
   * Pin the stock TKO lockup even while a league takeover is active. Used on
   * TKO's own product surfaces — the league gateway, pricing, Studio and
   * marketing pages — where TKO is the brand being pitched.
   */
  tko?: boolean
}

/**
 * Product-shell lockup. Campaign raster assets stay available for exports,
 * while this code-native mark remains sharp in compact navigation.
 *
 * BRAND HIERARCHY (operator 2026-08-02 / 2026-08-03): when the app is served
 * AS a league (domain takeover, e.g. shinobistrikerleague.com) this component
 * renders the LEAGUE's logo + name everywhere it is mounted — sidebar,
 * splash, login — with TKO reduced to a small "Powered by TKO.cam" line. The
 * Enterprise tier is fully white-label: no TKO at all. League branding lives
 * on league DOMAINS only: on tko.cam the lockup is ALWAYS TKO, even for
 * signed-in league members (2026-08-03 — no more "crossed logos"). A
 * 'stored' color skin (Studio apply) keeps the TKO lockup — colors only.
 */
export function BrandLogo({
  className = '',
  as: Tag = 'span',
  variant = 'horizontal',
  tko = false,
}: BrandLogoProps) {
  const { league, source, display } = useLeagueTheme()
  const markOnly = variant === 'mark'
  const iconOnly = variant === 'icon'

  // Only a DOMAIN takeover swaps the identity — on tko.cam the chrome is
  // always TKO, whatever league the visitor belongs to.
  const takeover = !tko && league?.name && source === 'domain' ? league : null

  if (takeover) {
    const logo = takeover.logo_url || leagueMarkFor(takeover.slug)
    const monogram = takeover.name.trim().charAt(0).toUpperCase() || 'L'
    // White-label is a PURCHASED capability, so it reads the entitlement rather
    // than the tier string. The old `tier !== 'enterprise'` test trusted a
    // column any league owner could set on themselves through the Studio —
    // and it missed Dynasty, which also buys clean branding.
    // SSL has one global attribution at the app bottom, never repeated under
    // logos. Other league takeovers keep their entitlement behavior.
    const poweredBy = shouldShowInlineTkoAttribution(
      display,
      leagueCan('clean_brand', takeover.tier, takeover.plan_status),
    )
    return (
      <Tag
        className={`inline-flex select-none items-center ${markOnly ? 'flex-col gap-3 text-center' : 'gap-2.5'} ${className}`}
        aria-label={takeover.name}
      >
        {logo ? (
          <img
            src={logo}
            alt=""
            className={`${markOnly ? 'h-[2.4em]' : 'h-[1.8em]'} w-auto shrink-0 object-contain`}
          />
        ) : (
          <span
            className={`flex shrink-0 items-center justify-center rounded-lg bg-kunai font-bold text-on-primary ${
              markOnly ? 'h-[2em] w-[2em] text-[1em]' : 'h-[1.8em] w-[1.8em] text-[0.9em]'
            }`}
            aria-hidden
          >
            {monogram}
          </span>
        )}
        {!iconOnly && (
          <span className={`flex min-w-0 flex-col ${markOnly ? 'items-center' : ''}`}>
            <span
              className={`font-brand font-bold uppercase leading-tight text-ink ${
                markOnly ? 'text-[0.5em]' : 'text-[0.62em]'
              }`}
            >
              {takeover.name}
            </span>
            {poweredBy && (
              // The clean DUAL lockup (operator 2026-08-03): league logo/name
              // primary, the real TKO.cam wordmark smaller beneath — two
              // brands side by side, never a mixed/hybrid composite mark.
              <span
                data-tko-attribution
                className={`mt-0.5 inline-flex items-baseline gap-1 font-normal normal-case leading-tight text-ink-muted/80 ${
                  markOnly ? 'text-[10px]' : 'text-[9px]'
                }`}
              >
                Powered by
                <span className="font-brand font-bold">
                  <span className="text-ink">{BRAND.nameParts[0]}</span>
                  {/* text-cam, not text-kunai — follows the stock lockup's
                      --brand-cam contrast token (boards override it). */}
                  <span className="text-cam">{BRAND.nameParts[1]}</span>
                </span>
              </span>
            )}
          </span>
        )}
      </Tag>
    )
  }

  return (
    <Tag
      className={`inline-flex select-none items-center ${markOnly ? 'flex-col gap-3' : 'gap-2.5'} ${className}`}
      aria-label={BRAND.domain}
    >
      <svg
        viewBox="0 0 40 40"
        role="img"
        aria-hidden="true"
        className={markOnly ? 'h-[1.55em] w-[1.55em]' : 'h-[1.8em] w-[1.8em] shrink-0'}
      >
        <path
          d="M4 13V6h7M29 6h7v7M36 27v7h-7M11 34H4v-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* TKO neutral mark — sapphire lens, spring-green baseline (palette v2). */}
        <circle cx="20" cy="20" r="10" fill={TKO_NEUTRAL.blue} />
        <path d="M17 14.8 26 20l-9 5.2Z" fill="white" />
        <path d="M8 37h24" stroke={TKO_NEUTRAL.teal} strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      {!iconOnly && (
        <span className={`font-brand font-bold leading-none ${markOnly ? 'text-[0.72em]' : 'text-[1em]'}`}>
          <span className="text-ink">TKO</span>
          {/* --brand-cam: kunai by default; the bright boards/Studio override
              it (their kunai is a CTA plate tone, illegible as text there). */}
          <span className="text-cam">.cam</span>
        </span>
      )}
    </Tag>
  )
}
