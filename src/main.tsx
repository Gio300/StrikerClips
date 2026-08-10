import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './hooks/AuthContext'
import { LeagueThemeProvider } from './components/LeagueThemeProvider'
import { resolveLeagueAddress, routerBasename } from './lib/leagueDomain'
import { syncManifestLink } from './lib/pwaManifest'
import { registerServiceWorker } from './lib/swClient'
import { THIRD_PARTY_AD_TECH_ENABLED } from './lib/storeBuild'
import './index.css'

// Android WebViews do not consistently expose safe-area-inset-top even when
// the status bar overlays the page. Mark native builds so the shared header can
// reserve a small, reliable status-bar inset without changing the website.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add('capacitor-native')
}

// Router basename is driven off Vite's resolved BASE_URL so the app "just
// works" wherever it is served: '/' for the mobile (Capacitor) build and
// '/app/' for the hosted web deploy (VITE_BASE_PATH=/app/ → BASE_URL=/app/).
// No per-route path changes are needed — every <Route> stays relative.
//
// PLUS the league PATH rung (operator 2026-08-04): on `tko.cam/<slug>` the
// basename becomes '/<slug>', so React Router strips the prefix on the way in
// and re-adds it to every <Link>. That single line is what makes
// `tko.cam/shinobistrikerleague/tournaments/abc` route exactly like
// `/tournaments/abc` does on the league's own domain — same routes, same
// takeover, links that stay inside the league. routerBasename() only ever
// returns a prefix for a slug-shaped first segment that is NOT one of the
// app's own route names (RESERVED_ROOT_PATHS in src/lib/leagueUrls.ts);
// LeagueThemeProvider drops it again if no such league actually exists.
const basename = routerBasename() || '/'

// PWA IDENTITY on the PATH rung (operator 2026-08-06). The server builds
// /manifest.json from the request's HOSTNAME. Keep the slug in the URL on EVERY
// league address anyway: Chromium can retain the old host manifest even after
// the server starts returning the league identity at the same `/manifest.json`
// URL. The query changes that URL once for existing installs while remaining
// harmless on hostname rungs (the server still treats the Host header as the
// source of truth). It is required outright on `tko.cam/<slug>` and `?league=`.
// Only the href moves; the service worker's scope is still BASE_URL and the
// update prompt is untouched. Wrapped because an unresolvable address must
// leave the static TKO manifest standing rather than break the boot.
//
// A browser may already have fetched the static manifest before this module
// runs, so re-reading the changed href is best-effort in Chromium. The initial
// href remains a valid fallback, and the server resolves hostname rungs before
// a byte is sent.
try {
  const address = resolveLeagueAddress()
  if (address.slug) {
    syncManifestLink(document, import.meta.env.BASE_URL || '/', address.slug)
  }
} catch {
  /* keep the static manifest */
}

const adsClient = import.meta.env.VITE_ADSENSE_CLIENT
if (THIRD_PARTY_AD_TECH_ENABLED && adsClient && typeof document !== 'undefined') {
  const s = document.createElement('script')
  s.async = true
  s.crossOrigin = 'anonymous'
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`
  document.head.appendChild(s)
}

// PWA: register the service worker under the deploy base ('/app/sw.js' on the
// web, '/sw.js' if ever served at the root). Production + HTTPS only, and never
// inside the Capacitor APK — see src/lib/swClient.ts. Registering here as well
// as in useAppUpdate() means the app is installable even on routes that never
// mount the Layout (e.g. /marketing).
void registerServiceWorker(import.meta.env.BASE_URL || '/')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={basename}>
      <AuthProvider>
        {/* League skin: reads the stored league config and drives the
            --league-* CSS variables the tailwind palette resolves through,
            so a league config re-skins ALL app chrome. No config = the
            stock TKO look (index.css defaults). */}
        <LeagueThemeProvider>
          <App />
        </LeagueThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
