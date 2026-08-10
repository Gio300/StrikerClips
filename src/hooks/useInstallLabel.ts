import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { brandDisplayName, installLabel } from '@/lib/pwaManifest'

/**
 * WHOSE APP AM I INSTALLING? (operator 2026-08-06 — on
 * shinobistrikerleague.com "install so it should say and it should install the
 * app they are on.. this is taking me to TKO").
 *
 * "Install TKO" used to be typed into six different components, so a member on
 * a league domain was invited to install a product they had never heard of —
 * while the manifest underneath now hands them the LEAGUE's app. One hook, one
 * string, so the button and the home-screen icon can never disagree again.
 *
 * The rule is the settled one, copied from BrandLogo and for the same reason:
 * only an ADDRESS takeover (`source === 'domain'`) changes the brand. On bare
 * tko.cam it says "Install TKO" even for a signed-in league member, because
 * that is the app tko.cam installs.
 */
export function useInstallBrandName(): string | null {
  const { league, source } = useLeagueTheme()
  if (source !== 'domain') return null
  return brandDisplayName(league?.name) || null
}

/** The label itself: "Install TKO", or "Install Shinobi Striker League". */
export function useInstallLabel(): string {
  return installLabel(useInstallBrandName())
}
