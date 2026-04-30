import { useEffect, useMemo, useState } from 'react'
import { BrandLogo } from '@/components/BrandLogo'
import { BRAND } from '@/lib/brand'
import {
  detectDevice,
  getDownloads,
  type DeviceId,
  type DownloadTarget,
} from '@/lib/downloads'

const HERO_IMG = `${import.meta.env.BASE_URL}marketing/marketing-hero.png`
const ONDEVICE_IMG = `${import.meta.env.BASE_URL}marketing/marketing-ondevice.png`

/**
 * Cross-surface link helper.
 *
 * - Standalone marketing site (VITE_APP_URL set): all CTAs become absolute
 *   URLs to the deployed app, e.g. https://app.example.com/signup.
 * - In-app build (VITE_APP_URL empty): respect Vite's BASE_URL so paths
 *   resolve correctly when the app is served under a sub-path like
 *   /StrikerClips/. A full-page reload is acceptable here — these are
 *   context switches, not in-app navigation.
 */
function appHref(path: string): string {
  const explicit = import.meta.env.VITE_APP_URL || ''
  if (explicit) {
    const base = explicit.replace(/\/$/, '')
    return `${base}${path.startsWith('/') ? path : `/${path}`}`
  }
  const base = import.meta.env.BASE_URL || '/'
  const cleaned = path.startsWith('/') ? path.slice(1) : path
  return `${base}${cleaned}`
}

const FEATURES: { title: string; body: string; emoji: string }[] = [
  {
    emoji: '◆',
    title: 'Every angle, one reel',
    body: 'Up to 8 perspectives — single, side-by-side, picture-in-picture, 2×2 squad, or director cut that flows between them.',
  },
  {
    emoji: '⚡',
    title: 'Director cuts on action',
    body: 'When clips are public on YouTube, our director uses each video’s “most replayed” signal so the camera lingers where the heat is.',
  },
  {
    emoji: '✦',
    title: 'Friend invites',
    body: 'Start a reel with one clip and lock the rest. Share the link; the reel unlocks when teammates upload their angle.',
  },
  {
    emoji: '🏆',
    title: 'Tournaments & clans',
    body: 'Open brackets, power-level seeding, and squad boards — built for the people who actually run them, not pros only.',
  },
  {
    emoji: '🎙',
    title: 'Optional AI commentary',
    body: 'Lightweight in-browser; full play-by-play and music bed in the install app. Add-ons start around $0.99 a reel.',
  },
  {
    emoji: '$',
    title: 'Free to start, ad-supported',
    body: 'Watch a 30-second sponsor before each free reel build, or upgrade to skip on every build. Creators get paid through the platform’s ad split.',
  },
]

export function Marketing() {
  const downloads = useMemo(() => getDownloads(), [])
  const [active, setActive] = useState<DeviceId>('web')

  useEffect(() => {
    setActive(detectDevice())
  }, [])

  const current = downloads.find((d) => d.id === active) ?? downloads[0]
  const contactEmail = import.meta.env.VITE_CONTACT_EMAIL || ''

  return (
    <div className="min-h-screen bg-dark text-gray-100">
      {/* HEADER */}
      <header className="sticky top-0 z-30 backdrop-blur bg-dark/70 border-b border-dark-border">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-kunai flex items-center justify-center shadow-md">
              <ShurikenIcon />
            </div>
            <BrandLogo as="span" className="text-base" />
          </a>
          <nav className="flex items-center gap-2 text-sm">
            <a href="#features" className="hidden sm:block text-gray-300 hover:text-white px-3 py-1.5">
              Features
            </a>
            <a href="#download" className="hidden sm:block text-gray-300 hover:text-white px-3 py-1.5">
              Download
            </a>
            <a href={appHref('/')} className="text-gray-300 hover:text-white px-3 py-1.5">
              Open web app
            </a>
            <a href={appHref('/signup')} className="btn-primary">
              Sign up free
            </a>
          </nav>
        </div>
      </header>

      {/* HERO */}
      <section id="top" className="relative overflow-hidden">
        <div
          className="absolute inset-0 -z-10 opacity-60"
          style={{
            backgroundImage: `radial-gradient(60% 60% at 50% 0%, rgba(255,85,48,0.18) 0%, transparent 60%)`,
          }}
        />
        <div className="max-w-6xl mx-auto px-6 pt-16 pb-12 md:pt-24 md:pb-16">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-6">
              <div className="inline-flex items-center gap-2 mb-5 pill-kunai whitespace-nowrap">
                <span className="live-dot" /> {BRAND.tagline}
              </div>
              <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-5 tracking-tight">
                Every angle.
                <br />
                Every clutch.
                <br />
                <span className="brand-gradient">{BRAND.name}.</span>
              </h1>
              <p className="text-lg text-gray-400 max-w-xl mb-7">
                Combine squad clips into one cinematic reel — single screen, side-by-side, picture-in-picture, or a
                director cut that flows between them. Run brackets, invite friends, share anywhere. Built for any game.
              </p>
              <div className="flex flex-wrap gap-3">
                <a href="#download" className="btn-primary">
                  Download {current.name}
                </a>
                <a href={appHref('/')} className="btn-ghost">
                  Try the web app
                </a>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                Web works on every device. Install app brings on-device AI &amp; stream tools — no extra cloud bill.
              </p>
            </div>
            <div className="lg:col-span-6">
              <div className="relative rounded-2xl overflow-hidden border border-dark-border shadow-2xl">
                <img
                  src={HERO_IMG}
                  alt="Multi-angle reel composition"
                  className="block w-full h-auto"
                  loading="eager"
                />
                <div className="pointer-events-none absolute inset-0 ring-1 ring-white/5 rounded-2xl" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-t border-dark-border">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">What it does</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              {BRAND.name} turns a stack of clips into a real reel. Everything ships free; advanced creator tools are
              add-ons, billed when used.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-dark-border bg-dark-card p-5 hover:border-kunai/40 transition-colors"
              >
                <div className="text-2xl text-kunai mb-3" aria-hidden>
                  {f.emoji}
                </div>
                <h3 className="font-semibold text-lg mb-1">{f.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ON-DEVICE AI BANNER */}
      <section className="border-t border-dark-border bg-dark-card/30">
        <div className="max-w-6xl mx-auto px-6 py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
          <div className="lg:col-span-6 order-2 lg:order-1">
            <div className="rounded-2xl overflow-hidden border border-dark-border">
              <img
                src={ONDEVICE_IMG}
                alt="On-device AI illustration"
                className="block w-full h-auto"
                loading="lazy"
              />
            </div>
          </div>
          <div className="lg:col-span-6 order-1 lg:order-2">
            <div className="text-xs uppercase tracking-wider text-chakra mb-3">On-device AI</div>
            <h2 className="text-3xl font-bold tracking-tight mb-4">
              Your hardware does the heavy lift.
            </h2>
            <p className="text-gray-400 mb-4">
              The install app uses your machine for the smart stuff — clutch detection, narration, faster renders. We
              don’t pay a per-user cloud bill, so the product stays cheap (or free) and you keep your footage local
              when you want.
            </p>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex gap-2"><span className="text-leaf">●</span> Local action / clutch finder</li>
              <li className="flex gap-2"><span className="text-leaf">●</span> Optional narration and music bed</li>
              <li className="flex gap-2"><span className="text-leaf">●</span> Cloud only when you choose to publish</li>
            </ul>
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section id="download" className="border-t border-dark-border">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="text-center mb-10">
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">Pick your device</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">
              The web app is fully featured for reels and tournaments. Desktop and mobile builds add stream tools and
              on-device AI when they’re ready.
            </p>
          </div>

          {/* Big cards grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
            {downloads.map((d) => (
              <DeviceTile
                key={d.id}
                target={d}
                active={d.id === active}
                onSelect={() => setActive(d.id)}
              />
            ))}
          </div>

          {/* Active panel */}
          <DownloadPanel target={current} />
        </div>
      </section>

      {/* CONTACT */}
      <section id="contact" className="border-t border-dark-border bg-dark-card/30">
        <div className="max-w-6xl mx-auto px-6 py-12">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            <div className="md:col-span-7">
              <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-2">Need help, partnerships, or press?</h2>
              <p className="text-gray-400">
                Bug reports, partnership pitches, and press inquiries — drop us a line. The product itself lives in
                the app; this page is just the front door.
              </p>
            </div>
            <div className="md:col-span-5">
              {contactEmail ? (
                <a
                  href={`mailto:${contactEmail}?subject=${encodeURIComponent(`${BRAND.name} — `)}`}
                  className="btn-primary inline-flex"
                >
                  Email {contactEmail}
                </a>
              ) : (
                <div className="text-sm text-gray-500">
                  Set <code className="text-gray-300">VITE_CONTACT_EMAIL</code> to enable a one-click contact button.
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-dark-border">
        <div className="max-w-6xl mx-auto px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <BrandLogo as="span" className="text-sm" />
            <span>· {BRAND.tagline}</span>
          </div>
          <nav className="flex flex-wrap gap-4">
            <a href={appHref('/')} className="hover:text-white">Web app</a>
            <a href={appHref('/terms')} className="hover:text-white">Terms</a>
            <a href={appHref('/signup')} className="hover:text-white">Sign up</a>
            <a href={appHref('/login')} className="hover:text-white">Sign in</a>
            <a href="#contact" className="hover:text-white">Contact</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}

function DeviceTile({
  target,
  active,
  onSelect,
}: {
  target: DownloadTarget
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group rounded-xl border p-4 text-left transition-colors ${
        active
          ? 'border-kunai bg-kunai/10 shadow-kunai'
          : 'border-dark-border bg-dark-card hover:border-kunai/40'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <DeviceIcon icon={target.icon} active={active} />
        <span className={`font-semibold ${active ? 'text-white' : 'text-gray-200'}`}>
          {target.name}
        </span>
      </div>
      <div className="text-xs text-gray-500 line-clamp-2">{target.blurb}</div>
      {target.id !== 'web' && !target.url && (
        <div className="mt-2 inline-block text-[10px] uppercase tracking-wide text-chakra/90 border border-chakra/30 px-1.5 py-0.5 rounded">
          Coming soon
        </div>
      )}
    </button>
  )
}

function DownloadPanel({ target }: { target: DownloadTarget }) {
  const isWeb = target.id === 'web'
  const isAvailable = isWeb || Boolean(target.url)
  const ctaLabel = isWeb
    ? 'Open the web app'
    : isAvailable
      ? `Download for ${target.name}`
      : `Notify me when ${target.name} is ready`

  return (
    <div className="rounded-2xl border border-dark-border bg-dark-card overflow-hidden">
      <div className="p-6 md:p-8 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        <div className="md:col-span-7">
          <div className="text-xs uppercase tracking-wider text-kunai mb-2">{target.name}</div>
          <h3 className="text-2xl font-semibold mb-3">{target.blurb}</h3>
          <ul className="space-y-2 text-sm text-gray-300 mb-5">
            {target.perks.map((p) => (
              <li key={p} className="flex items-start gap-2">
                <span className="text-leaf mt-0.5">●</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {isWeb ? (
              <a href={appHref('/')} className="btn-primary">
                {ctaLabel}
              </a>
            ) : isAvailable ? (
              <a href={target.url} className="btn-primary" rel="noopener">
                {ctaLabel}
              </a>
            ) : (
              <a href={appHref('/signup')} className="btn-primary">
                {ctaLabel}
              </a>
            )}
            <a href={appHref('/')} className="btn-ghost">
              Try in browser first
            </a>
          </div>
          {!isWeb && !isAvailable && (
            <p className="text-xs text-gray-500 mt-3">
              Sign up — we’ll email you the day the {target.name} build drops.
            </p>
          )}
        </div>
        <div className="md:col-span-5">
          <div className="rounded-xl border border-dark-border bg-dark/60 p-4">
            <div className="text-xs uppercase tracking-wider text-chakra mb-2">What you get</div>
            <ul className="text-sm text-gray-300 space-y-1.5">
              <li>· Multi-angle composer (single / SxS / PiP / 2×2 / director)</li>
              <li>· Friend-invite reels &amp; share links</li>
              <li>· Brackets, boards, rankings</li>
              {!isWeb && <li>· On-device AI commentary &amp; clutch finder</li>}
              {!isWeb && <li>· OBS-style live tools (where the platform allows)</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShurikenIcon() {
  return (
    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
    </svg>
  )
}

function DeviceIcon({ icon, active }: { icon: DownloadTarget['icon']; active: boolean }) {
  const cls = `w-5 h-5 ${active ? 'text-kunai' : 'text-gray-300'}`
  switch (icon) {
    case 'globe':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18" />
        </svg>
      )
    case 'windows':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor">
          <path d="M3 5l8-1v8H3V5zm0 8h8v8l-8-1v-7zm9-9l9-1v10h-9V4zm0 9h9v10l-9-1V13z" />
        </svg>
      )
    case 'apple':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor">
          <path d="M16.5 12c0-2.4 2-3.5 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.9C5.7 6.7 3 9.5 3 14.4c0 1.5.3 3.1 1 4.7.9 2.1 2.6 4.3 4.5 4.2 1 0 1.6-.6 3-.6s1.9.6 3 .6c1.9 0 3.4-2.1 4.3-4.2.5-1.1.8-2.2 1-3.3-2.4-.8-3.3-3-3.3-3.8zM14.7 4.4c.7-.9 1.2-2.1 1.1-3.4-1.1.1-2.4.7-3.1 1.6-.7.7-1.3 2-1.1 3.2 1.2 0 2.4-.6 3.1-1.4z" />
        </svg>
      )
    case 'linux':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2c-2 0-3.5 2-3.5 4 0 1.6.5 2.5.5 3.5 0 1.5-2 3-3 5-1 2-2 5-1 7 .5 1 2 1 3 .5.5 2 2 2 3.5 2h2c1.5 0 3 0 3.5-2 1 .5 2.5.5 3-.5 1-2 0-5-1-7-1-2-3-3.5-3-5 0-1 .5-1.9.5-3.5 0-2-1.5-4-3.5-4z" />
        </svg>
      )
    case 'phone':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
          <rect x="6" y="2" width="12" height="20" rx="2" />
          <path d="M11 18h2" strokeLinecap="round" />
        </svg>
      )
    case 'android':
      return (
        <svg className={cls} viewBox="0 0 24 24" fill="currentColor">
          <path d="M6 9c-1 0-2 1-2 2v6c0 1 1 2 2 2s2-1 2-2v-6c0-1-1-2-2-2zm12 0c-1 0-2 1-2 2v6c0 1 1 2 2 2s2-1 2-2v-6c0-1-1-2-2-2zM7 9h10v9.5c0 .8-.7 1.5-1.5 1.5H14v3h-2v-3h-2v3H8v-3h-1.5C7.7 20 7 19.3 7 18.5V9zm5-7c-3 0-5.5 2-6 4.7L7 8h10l1-1.3C17.5 4 15 2 12 2zm-3 4.5a.5.5 0 110-1 .5.5 0 010 1zm6 0a.5.5 0 110-1 .5.5 0 010 1z" />
        </svg>
      )
  }
}
