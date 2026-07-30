import { BrandLogo } from '@/components/BrandLogo'
import { BRAND } from '@/lib/brand'
import { VideoShowcase } from '@/components/VideoShowcase'
import { InstallAppButton } from '@/components/InstallAppButton'
import { MarketingFeatureShowcase } from '@/components/MarketingFeatureShowcase'
import { PublicAskTko } from '@/components/PublicAskTko'

/**
 * TKO.cam marketing landing page.
 *
 * Rendered two ways from the SAME component:
 *   • Standalone marketing SITE (npm run build:site → dist-site/), served at the
 *     root of tko.cam. This is the primary consumer.
 *   • Inside the app at /marketing and /download (legacy entry points).
 *
 * The actual product lives under /app (hosted web deploy) — see the router
 * basename in src/main.tsx and the server config in serve.mjs / server/index.ts.
 *
 * APP LINKS: `appHref()` resolves to the deployed app. When VITE_APP_URL is set
 * (e.g. https://tko.cam) it deep-links there; otherwise it falls back to the
 * same-origin '/app' base, which is where the app is mounted on the web host.
 */
const APP_ORIGIN = (import.meta.env.VITE_APP_URL || '').replace(/\/+$/, '')

function appHref(path = '/'): string {
  if (!path || path === '/') return APP_ORIGIN || '/'
  return `${APP_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`
}

export function Marketing() {
  return (
    <div className="min-h-screen bg-dark text-gray-100">
      {/* HEADER */}
      <header className="sticky top-0 z-30 backdrop-blur bg-dark/70 border-b border-dark-border">
        {/* Thin blue "gives back" trim. */}
        <div className="h-0.5 bg-trust" aria-hidden />
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-2.5">
            <BrandLogo as="span" variant="horizontal" className="text-lg" />
          </a>
          <nav className="flex items-center gap-2 text-sm">
            <a href="#features" className="hidden sm:block text-gray-300 hover:text-white px-3 py-1.5">
              Features
            </a>
            <a href="#showcase" className="hidden sm:block text-gray-300 hover:text-white px-3 py-1.5">
              Watch
            </a>
            <a href="#get" className="hidden sm:block text-gray-300 hover:text-white px-3 py-1.5">
              Get the app
            </a>
            <InstallAppButton
              mode="open-or-install"
              label="Install TKO"
              appHref={appHref('/')}
            />
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section id="top" className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage:
              'radial-gradient(70% 60% at 50% -10%, rgba(255,122,24,0.20) 0%, transparent 60%), radial-gradient(40% 50% at 85% 0%, rgba(47,129,247,0.14) 0%, transparent 70%)',
          }}
        />
        <div className="max-w-4xl mx-auto px-6 pt-20 pb-16 md:pt-28 md:pb-20 text-center">
          <div className="flex justify-center mb-8">
            <BrandLogo as="h1" variant="mark" className="text-6xl md:text-7xl" />
          </div>
          <div className="inline-flex items-center gap-2 mb-6 pill-kunai whitespace-nowrap">
            <span className="live-dot" /> {BRAND.tagline}
          </div>
          <h2 className="text-4xl md:text-6xl font-bold leading-[1.05] mb-6 tracking-tight">
            Every angle of the
            <br />
            <span className="brand-gradient">knockout.</span> One cam.
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto mb-8">
            TKO turns a stack of squad clips into one cinematic, multi-angle reel — then runs your
            brackets, powers your clan, and lets an in-app AI direct the whole thing. The tournament
            platform that gives back.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {/* Real PWA install, when the browser can offer one. Silent
                otherwise (already installed, or no install path at all). */}
            <InstallAppButton label="Install TKO" />
            <a href={appHref('/')} className="btn-ghost text-base px-7 py-3">
              Open in browser
            </a>
            <a href="#showcase" className="btn-ghost text-base px-7 py-3">
              Watch the reel
            </a>
          </div>
          <p className="text-xs text-gray-500 mt-4">Android app or browser. Pick either and start.</p>
        </div>
      </section>

      {/* FEATURES */}
      <MarketingFeatureShowcase appHref={appHref} />

      {/* VIDEO SHOWCASE */}
      <VideoShowcase />

      {/* GIVES BACK BANNER */}
      <section className="border-t border-dark-border bg-dark-card/30">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <div className="text-xs uppercase tracking-wider text-trust mb-3">Why TKO is different</div>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">
            The tournament platform that <span className="text-trust">gives back.</span>
          </h2>
          <p className="text-gray-400 max-w-2xl mx-auto mb-6">
            The Oracle rewards prestige, not wagers — no cash, no gambling, ever. Clans and creators
            share in the platform, and the tools that used to need a full production crew now run on one
            AI director. TKO exists so the people who build the scene keep more of it.
          </p>
          <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-300">
            <span className="flex items-center gap-2"><span className="text-leaf">●</span> Clans that earn</span>
            <span className="flex items-center gap-2"><span className="text-trust">●</span> Prestige, not wagering</span>
            <span className="flex items-center gap-2"><span className="text-chakra">●</span> AI director included</span>
          </div>
        </div>
      </section>

      {/* GET THE APP */}
      <section id="get" className="border-t border-dark-border">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Get into the app</h2>
          <p className="text-gray-400 max-w-2xl mx-auto mb-8">
            Install the Android app directly. If your device cannot install the APK, continue in the browser.
          </p>
          <div className="flex flex-wrap justify-center items-start gap-4 mb-6">
            {/* Primary path for testers: a one-tap install of the PWA, which is
                what the in-app update prompt can then keep current. Falls back
                to Add-to-Home-Screen instructions on iOS, and renders nothing
                at all where no install is possible — never a dead button. */}
            <InstallAppButton label="Install TKO" />
            <a href={appHref('/')} className="btn-primary text-base px-7 py-3">
              Open the web app
            </a>
          </div>
          {/* App-store badges. TODO: replace href={appHref('/')} with the real
              store URLs once published:
                Google Play → https://play.google.com/store/apps/details?id=cam.tko
                App Store   → https://apps.apple.com/app/idXXXXXXXXXX
          */}
          <div className="flex flex-wrap justify-center items-center gap-3">
            <StoreBadge kind="play" />
            <StoreBadge kind="apple" />
          </div>
          <p className="text-xs text-gray-500 mt-4">Coming soon to Google Play and the App Store.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-dark-border">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <BrandLogo as="span" variant="horizontal" className="text-sm" />
            <span className="hidden sm:inline">· {BRAND.tagline}</span>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            <a href={appHref('/')} className="hover:text-white">Open in browser</a>
            <a href={appHref('/legal')} className="hover:text-white">Legal &amp; Agreements</a>
            <a href={appHref('/terms')} className="hover:text-white">Terms</a>
            <a href={appHref('/privacy')} className="hover:text-white">Privacy</a>
            <a href={appHref('/data-deletion')} className="hover:text-white">Data Deletion</a>
          </nav>
        </div>
        <div className="max-w-6xl mx-auto px-6 pb-8 text-xs text-gray-600">
          © {new Date().getFullYear()} {BRAND.name} · {BRAND.domain}
        </div>
      </footer>

      <PublicAskTko appHref={appHref} />
    </div>
  )
}

/**
 * App-store style badge. Self-contained (no external image), on-brand dark pill
 * matching the official badge layout: small glyph + two-line label. Currently
 * links wherever `href` points (the web app); swap in real store URLs at the
 * call site TODO above once the apps are published.
 */
function StoreBadge({ kind }: { kind: 'play' | 'apple' }) {
  const isPlay = kind === 'play'
  return (
    <div
      className="inline-flex items-center gap-3 rounded-lg border border-dark-border bg-black px-4 py-2.5 text-left opacity-60"
      aria-label={isPlay ? 'Get it on Google Play' : 'Download on the App Store'}
    >
      {isPlay ? <GooglePlayGlyph /> : <AppleGlyph />}
      <span className="leading-tight">
        <span className="block text-[10px] uppercase tracking-wide text-gray-400">
          {isPlay ? 'Get it on' : 'Download on the'}
        </span>
        <span className="block text-base font-semibold text-white -mt-0.5">
          {isPlay ? 'Google Play' : 'App Store'}
        </span>
      </span>
    </div>
  )
}

function GooglePlayGlyph() {
  return (
    <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24" aria-hidden>
      <path d="M3.6 2.3a1 1 0 0 0-.6.9v17.6a1 1 0 0 0 .6.9l10-9.7-10-9.7z" fill="#00d4ff" />
      <path d="M16.3 8.4 5.9 2.5l8.9 8.6 1.5-2.7z" fill="#ff7a18" />
      <path d="M16.3 15.6l-1.5-2.7-8.9 8.6 10.4-5.9z" fill="#ffb63d" />
      <path d="M20.4 10.9 16.3 8.4l-1.5 2.7 1.5 2.7 4.1-2.5a1.2 1.2 0 0 0 0-2.1z" fill="#2f81f7" />
    </svg>
  )
}

function AppleGlyph() {
  return (
    <svg className="w-6 h-6 shrink-0 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.5 12c0-2.4 2-3.5 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.9C5.7 6.7 3 9.5 3 14.4c0 1.5.3 3.1 1 4.7.9 2.1 2.6 4.3 4.5 4.2 1 0 1.6-.6 3-.6s1.9.6 3 .6c1.9 0 3.4-2.1 4.3-4.2.5-1.1.8-2.2 1-3.3-2.4-.8-3.3-3-3.3-3.8zM14.7 4.4c.7-.9 1.2-2.1 1.1-3.4-1.1.1-2.4.7-3.1 1.6-.7.7-1.3 2-1.1 3.2 1.2 0 2.4-.6 3.1-1.4z" />
    </svg>
  )
}
