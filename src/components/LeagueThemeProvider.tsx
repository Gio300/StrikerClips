/**
 * LeagueThemeProvider — React wiring for src/lib/leagueTheme.ts.
 *
 * Mounted once at the app root (src/main.tsx) it resolves WHICH league this
 * page load belongs to and writes the `--league-*` CSS variables onto <html>,
 * so the tailwind palette (tailwind.config.js) and therefore ALL app chrome
 * re-skins to the league. Resolution order (see src/lib/leagueDomain.ts):
 *
 *   1. ADDRESS TAKEOVER — served from any of the league's three addresses
 *      (`tko.cam/<slug>` · `<slug>.tko.cam` · the league's own domain — see
 *      src/lib/leagueUrls.ts) or forced by the ?league= preview param, the
 *      whole app IS that league: the slug resolves via resolveLeagueAddress(),
 *      the config loads via fetchLeagueBySlug() (seeded launch leagues paint
 *      instantly, the API refines), and the document title follows the league.
 *      All three rungs are ONE takeover — deliberately indistinguishable in
 *      effect. An ADDRESS is the ONLY takeover: on bare tko.cam the global
 *      chrome stays stock TKO even for signed-in league members (operator
 *      2026-08-03 — league branding lives on league addresses only;
 *      member-scoped surfaces read getActiveLeagueSlug() themselves).
 *   2. STORED — a config saved via saveLeagueTheme('active') (Studio apply).
 *   3. Nothing — the inline variables are removed and the index.css defaults
 *      (the stock TKO look) apply untouched.
 *
 * Everything fails soft: a dead API or unknown slug means the stock look,
 * never a broken app.
 *
 * <LeagueThemeScope> is the second half of the trick: it applies a config to
 * its OWN subtree only. The Studio's PhonePreview wraps real app markup in a
 * scope fed by the draft config, which is what makes the pull-out preview
 * "the actual app" in the league's skin while the surrounding studio keeps
 * the stock chrome.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation } from 'react-router-dom'
import {
  ACTIVE_LEAGUE_KEY,
  applyLeagueTheme,
  clearLeagueTheme,
  loadLeagueTheme,
  saveLeagueTheme,
  subscribeLeagueTheme,
  type LeagueConfig,
  type LeaguePatch,
} from '@/lib/leagueTheme'
import { fetchLeagueBySlug } from '@/lib/leagueConfig'
import {
  resolveLeagueAddress,
  resolveTakeover,
  seedLeagueBySlug,
  toThemeConfig,
} from '@/lib/leagueDomain'
import {
  isClaimableCustomDomain,
  normalizeHost,
  stripLeaguePathPrefix,
} from '@/lib/leagueUrls'
import { fetchLeagueSlugForHost } from '@/lib/leagueUrlApi'
import { brandDisplayName, leagueAppleTouchIcon } from '@/lib/pwaManifest'
import { leagueDisplayBrand, TKO_DISPLAY_BRAND, type LeagueDisplayBrand } from '@/lib/displayBrand'
import { LeagueBottomAttribution, LeagueVisibleBranding } from '@/components/LeagueVisibleBranding'

/** Where the active league identity came from (brand hierarchy hangs off this). */
export type LeagueSource = 'domain' | 'stored' | null

type LeagueThemeContextValue = {
  /** The active league config, or null for the stock TKO chrome. */
  league: LeagueConfig | null
  /**
   * 'domain' = the app is served AS this league (full takeover),
   * 'stored' = a locally applied config (color skin only, TKO branding).
   * There is deliberately no 'member' source: on tko.cam the chrome stays
   * stock TKO regardless of the visitor's league membership (2026-08-03).
   */
  source: LeagueSource
  /** Short user-facing product and assistant labels for this address. */
  display: LeagueDisplayBrand
  /** Merge a partial config into the active league and re-skin live. */
  setLeague: (patch: LeaguePatch) => void
  /** Back to stock chrome. */
  clearLeague: () => void
}

const LeagueThemeContext = createContext<LeagueThemeContextValue>({
  league: null,
  source: null,
  display: TKO_DISPLAY_BRAND,
  setLeague: () => {},
  clearLeague: () => {},
})

export function useLeagueTheme(): LeagueThemeContextValue {
  return useContext(LeagueThemeContext)
}

export function LeagueThemeProvider({
  themeKey = ACTIVE_LEAGUE_KEY,
  children,
}: {
  /** Storage key — "active" for the signed-in user's league. */
  themeKey?: string
  children: ReactNode
}) {
  const [stored, setStoredState] = useState<LeagueConfig | null>(
    () => loadLeagueTheme(themeKey),
  )

  // Follow external changes (Studio saves, other tabs) via the event bus.
  useEffect(() => {
    setStoredState(loadLeagueTheme(themeKey))
    return subscribeLeagueTheme(() => setStoredState(loadLeagueTheme(themeKey)))
  }, [themeKey])

  // The ADDRESS this page is served AS — `?league=` preview, then the
  // `tko.cam/<slug>` PATH prefix, then the hostname. The hostname and path
  // halves are fixed for the whole page load (the prefix is baked into the
  // router basename in main.tsx, so client-side navigation can never change
  // it); the ?league= preview half is re-read on every navigation (it's sticky
  // in sessionStorage, so in-app links keep the takeover and `?league=off`
  // ends it). NOTE: this provider therefore expects to live inside the router
  // — which is exactly where main.tsx mounts it.
  const { search } = useLocation()
  const address = useMemo(() => resolveLeagueAddress(undefined, search), [search])

  // RUNG 3 refinement. A CUSTOM domain's slug is a database fact, not a string
  // fact: `thebiggestleague.com` might belong to the league `blaze`. The
  // hostname heuristic (first label) is the instant guess that paints the
  // first frame; GET /api/league/by-host corrects it if they differ. Purely
  // additive and fail-soft — a 404, an outage or a cross-origin refusal simply
  // leaves the guess standing, which is how shinobistrikerleague.com resolved
  // before this endpoint existed and how it still resolves if it is ever down.
  const [hostSlug, setHostSlug] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const host = normalizeHost(window.location.hostname)
    // Only real claimable domains — the apex, its subdomains, localhost and
    // LAN IPs are all decided without a round trip.
    if (!isClaimableCustomDomain(host)) return
    let alive = true
    fetchLeagueSlugForHost(host).then((slug) => { if (alive && slug) setHostSlug(slug) })
    return () => { alive = false }
  }, [])

  const domainSlug =
    address.source === 'hostname' && hostSlug ? hostSlug : address.slug

  // ONLY the address re-skins the chrome. The signed-in member's league
  // (fetchMemberLeague → setActiveLeagueSlug) is deliberately NOT consulted
  // here — bare tko.cam always wears the stock TKO chrome (operator 2026-08-03).
  const { slug: takeoverSlug, source: takeoverSource } = resolveTakeover(domainSlug, null)

  // The takeover config: seeds paint the first frame (SSL ships bundled),
  // then GET /api/league/:slug/config refines. Fail-soft: unknown slug + dead
  // API resolve to null and the app keeps the stock (or stored) look.
  const [takeover, setTakeover] = useState<LeagueConfig | null>(() => {
    const seed = seedLeagueBySlug(takeoverSlug)
    return seed ? toThemeConfig(seed) : null
  })
  useEffect(() => {
    if (!takeoverSlug) {
      setTakeover(null)
      return
    }
    let alive = true
    const seed = seedLeagueBySlug(takeoverSlug)
    setTakeover(seed ? toThemeConfig(seed) : null)
    fetchLeagueBySlug(takeoverSlug).then((cfg) => {
      if (!alive) return
      if (cfg) {
        setTakeover(toThemeConfig(cfg))
        return
      }
      // NO SUCH LEAGUE, and the slug came from the PATH. `tko.cam/<slug>` is
      // shape-matched optimistically at boot (the router basename must be
      // decided before the first paint, long before any API answer), so a
      // typo'd or retired address would otherwise leave the app mounted under
      // a phantom prefix. Drop the prefix and reload: the same URL minus the
      // slug is the ordinary app, which is the softest possible landing. The
      // hostname rungs never do this — a wrong hostname is the operator's DNS
      // to fix, not the browser's.
      if (address.source === 'path') {
        const back = stripLeaguePathPrefix()
        if (typeof window !== 'undefined' && back !== window.location.pathname) {
          window.location.replace(`${back}${window.location.search}${window.location.hash}`)
        }
      }
    })
    return () => { alive = false }
  }, [takeoverSlug, address.source])

  const league = takeover ?? stored
  const source: LeagueSource = takeover ? takeoverSource : stored ? 'stored' : null
  const display = useMemo(
    () => leagueDisplayBrand({ slug: league?.slug, name: league?.name, source }),
    [league?.slug, league?.name, source],
  )

  // Skin the whole document; restore stock defaults on unmount.
  useEffect(() => {
    const el = document.documentElement
    applyLeagueTheme(el, league)
    return () => applyLeagueTheme(el, null)
  }, [league])

  // On a league domain the browser tab — AND the iOS home-screen entry — are
  // the league's, not TKO's.
  //
  // The manifest half is served per host (server/app.ts GET /manifest.json),
  // but iOS "Add to Home Screen" ignores the manifest entirely and reads these
  // two <head> tags out of the live DOM at the moment the user taps it. So a
  // league install on an iPhone would still say TKO with TKO's mark unless
  // they follow the takeover too. Only touched for a DOMAIN takeover, only
  // when the league actually ships a 180px icon, and fully restored on
  // unmount — anything else leaves tko.cam's static tags exactly as they are.
  useEffect(() => {
    if (typeof document === 'undefined') return
    if (source !== 'domain' || !league?.name) return
    const name = brandDisplayName(league.name) || league.name
    const previousTitle = document.title
    document.title = league.tagline ? `${name} — ${league.tagline}` : name

    const restore: Array<() => void> = []
    const setAttr = (selector: string, attr: string, value: string) => {
      const el = document.querySelector(selector)
      if (!el) return
      const had = el.getAttribute(attr)
      el.setAttribute(attr, value)
      restore.push(() => {
        if (had === null) el.removeAttribute(attr)
        else el.setAttribute(attr, had)
      })
    }
    setAttr('meta[name="apple-mobile-web-app-title"]', 'content', name)
    const touchIcon = leagueAppleTouchIcon(league.slug, import.meta.env.BASE_URL || '/')
    if (touchIcon) setAttr('link[rel="apple-touch-icon"]', 'href', touchIcon)

    return () => {
      document.title = previousTitle
      for (const undo of restore) undo()
    }
  }, [source, league])

  const setLeague = useCallback((patch: LeaguePatch) => {
    // saveLeagueTheme broadcasts; the subscription above pulls the new state.
    saveLeagueTheme(themeKey, patch)
  }, [themeKey])

  const clearLeague = useCallback(() => {
    clearLeagueTheme(themeKey)
  }, [themeKey])

  return (
    <LeagueThemeContext.Provider value={{ league, source, display, setLeague, clearLeague }}>
      <LeagueVisibleBranding display={display} />
      {children}
      <LeagueBottomAttribution display={display} />
    </LeagueThemeContext.Provider>
  )
}

/**
 * Scope a league skin to a subtree without touching the document. CSS
 * variables cascade, so everything rendered inside picks up the league's
 * palette while the rest of the page keeps whatever the provider (or the
 * defaults) set. Pass `league={null}` to preview the stock TKO look.
 */
export function LeagueThemeScope({
  league,
  className,
  children,
}: {
  league: LeagueConfig | null
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (ref.current) applyLeagueTheme(ref.current, league)
  }, [league])
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
