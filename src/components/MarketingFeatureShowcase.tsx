import {
  Aperture,
  BarChart3,
  Bot,
  Clapperboard,
  Crown,
  Gem,
  Radio,
  Shield,
  Sparkles,
  Swords,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

type Accent = 'kunai' | 'chakra' | 'trust' | 'leaf' | 'accent'

type Feature = {
  title: string
  eyebrow: string
  body: string
  image: string
  alt: string
  icon: LucideIcon
  accent: Accent
  appPath: string
}

const BASE = import.meta.env.BASE_URL || '/'
const asset = (path: string) => `${BASE}${path.replace(/^\/+/, '')}`

/**
 * OPERATOR RULE: this build must NOT ship or serve video files — YouTube is the
 * storage layer. Video sources live in media_source/videos/ (excluded from the
 * Vite build; see media_source/README.md) and stream from the tko.cam origin
 * until they have YouTube uploads to embed. Small poster/feature IMAGES still
 * come from public/ via asset().
 */
const MEDIA_BASE = 'https://tko.cam/'
const video = (path: string) => `${MEDIA_BASE}${path.replace(/^\/+/, '')}`

const FEATURES: Feature[] = [
  {
    title: 'AI live director',
    eyebrow: 'Up to eight angles',
    body: 'Run the show from one control room. Leave automatic switching on, tap a camera to focus it, combine angles, replay a moment, or cast the program live.',
    image: 'features/live-director.jpg',
    alt: 'TKO live control room with program output, camera bank, host camera, chat, audio meter, and director controls',
    icon: Aperture,
    accent: 'kunai',
    appPath: '/live',
  },
  {
    title: 'TKO King tournaments',
    eyebrow: 'Enter the ladder',
    body: 'Register, find your matchup, submit results, and follow every round through a live tournament bracket with verified match footage.',
    image: 'features/tko-king.jpg',
    alt: 'TKO King eight-player tournament bracket showing quarterfinals, semifinals, championship, and winner',
    icon: Crown,
    accent: 'chakra',
    appPath: '/tko-king',
  },
  {
    title: 'Shinobi Conquest',
    eyebrow: 'Territory that moves',
    body: 'See which clans hold each land, challenge an owner, and watch control of the map change with the results.',
    image: 'features/shinobi-conquest.jpg',
    alt: 'Shinobi Conquest map with territories and current clan land holders',
    icon: Swords,
    accent: 'trust',
    appPath: '/conquest',
  },
  {
    title: 'Oracle calls and rewards',
    eyebrow: 'Call the outcome',
    body: 'Make match predictions, build an Oracle record, and unlock badges and cosmetic rewards for correct calls.',
    image: 'features/oracle-rewards.jpg',
    alt: 'TKO rewards screen showing collectible artifacts and Oracle-related rewards',
    icon: Sparkles,
    accent: 'leaf',
    appPath: '/oracle',
  },
  {
    title: 'Clans and crew spaces',
    eyebrow: 'Build together',
    body: 'Create or join a clan, organize members, open a shared space, and carry the same identity into tournaments and Conquest.',
    image: 'features/clans.jpg',
    alt: 'TKO clan screen with options to manage, find, or create a clan',
    icon: Users,
    accent: 'kunai',
    appPath: '/clans',
  },
  {
    title: 'Stat checks and fair play',
    eyebrow: 'Verified competition',
    body: 'Capture the player loadout and clothing boosts at Sakura Inn, attach the verified build to the match, and use it for tournament eligibility and fair play review.',
    image: 'features/stat-checks.jpg',
    alt: 'Shinobi Striker Sakura Inn loadout with TKO verification of clothing boosts and tournament eligibility',
    icon: BarChart3,
    accent: 'accent',
    appPath: '/stat-check',
  },
  {
    title: 'Forge artifacts',
    eyebrow: 'Create usable gear',
    body: 'Build collectible items, choose their rarity and capabilities, then add them to your collection or marketplace.',
    image: 'features/forge.jpg',
    alt: 'TKO artifact forge with rarity, collection, and power controls',
    icon: Gem,
    accent: 'trust',
    appPath: '/forge',
  },
  {
    title: 'Creator marketplace',
    eyebrow: 'Clans and creators earn',
    body: 'Offer digital gear and community products from a storefront, while buyers can clearly see balances, packages, and rewards.',
    image: 'features/marketplace.jpg',
    alt: 'TKO store showing balances, packages, rewards, and marketplace controls',
    icon: Wallet,
    accent: 'leaf',
    appPath: '/shop',
  },
  {
    title: 'Ask TKO in the app',
    eyebrow: 'Guidance in context',
    body: 'Get help with clips, tournaments, stat checks, clans, and app workflows without leaving the screen you are using.',
    image: 'features/ask-tko.jpg',
    alt: 'Ask TKO assistant open over the TKO app',
    icon: Bot,
    accent: 'chakra',
    appPath: '/ai',
  },
  {
    title: 'Go live your way',
    eyebrow: 'OBS, YouTube, or a live link',
    body: 'Start from a console link, connect OBS, run a watch party, or open the full control room when you need every angle.',
    image: 'features/go-live.jpg',
    alt: 'TKO go live setup with broadcast, watch party, and event options',
    icon: Radio,
    accent: 'kunai',
    appPath: '/go-live',
  },
]

const ACCENTS: Record<Accent, { icon: string; border: string; label: string }> = {
  kunai: {
    icon: 'bg-kunai/15 text-kunai',
    border: 'hover:border-kunai/50',
    label: 'text-kunai',
  },
  chakra: {
    icon: 'bg-chakra/15 text-chakra',
    border: 'hover:border-chakra/50',
    label: 'text-chakra',
  },
  trust: {
    icon: 'bg-trust/15 text-trust',
    border: 'hover:border-trust/50',
    label: 'text-trust',
  },
  leaf: {
    icon: 'bg-leaf/15 text-leaf',
    border: 'hover:border-leaf/50',
    label: 'text-leaf',
  },
  accent: {
    icon: 'bg-accent/15 text-accent',
    border: 'hover:border-accent/50',
    label: 'text-accent',
  },
}

export function MarketingFeatureShowcase({
  appHref,
}: {
  appHref: (path?: string) => string
}) {
  return (
    <section id="features" className="scroll-mt-16 border-t border-dark-border">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-10 max-w-3xl">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-accent">
            Real product. Real screens.
          </div>
          <h2 className="mb-3 text-3xl font-bold tracking-tight md:text-4xl">
            See every part of TKO before you join.
          </h2>
          <p className="text-gray-400">
            Watch the synchronized director work, inspect the competition tools, and see the
            clan, creator, and community systems exactly where they live in the app.
          </p>
        </div>

        <div className="mb-10 overflow-hidden rounded-lg border border-dark-border bg-dark-card lg:grid lg:grid-cols-[1.45fr_0.75fr]">
          <div className="aspect-video bg-black">
            <video
              className="h-full w-full object-cover"
              controls
              playsInline
              preload="metadata"
              poster={asset('features/synchronized-squad.jpg')}
            >
              <source src={video('videos/tko-public-live-demo-1080p.mp4')} type="video/mp4" />
              <source src={video('videos/tko-automatch-demo.mp4')} type="video/mp4" />
            </video>
          </div>
          <div className="flex flex-col justify-center border-t border-dark-border p-6 lg:border-l lg:border-t-0">
            <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-accent/15 text-accent">
              <Clapperboard size={22} aria-hidden />
            </span>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
              Synchronized squad view
            </p>
            <h3 className="mb-3 text-2xl font-bold">Every angle. One match.</h3>
            <p className="mb-5 text-sm leading-relaxed text-gray-400">
              Watch one real four-player match move through squad, split-screen, and focused
              replay views while the host, chat, match sound, and Oracle countdown stay live.
            </p>
            <a href="#showcase-in-action" className="inline-flex items-center gap-2 text-sm font-semibold text-white hover:text-accent">
              Watch the full example
              <span aria-hidden>→</span>
            </a>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {FEATURES.map((feature) => (
            <FeatureCard key={feature.title} feature={feature} appHref={appHref} />
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-dark-border pt-8 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-trust/15 text-trust">
              <Shield size={20} aria-hidden />
            </span>
            <div>
              <p className="font-semibold text-white">Public tour here. Personal data stays in the app.</p>
              <p className="mt-1 text-sm text-gray-400">
                Sign in to view your own stats, rooms, tournament rules, messages, and clan activity.
              </p>
            </div>
          </div>
          <a href={appHref('/')} className="btn-primary shrink-0">
            Open TKO
          </a>
        </div>
      </div>
    </section>
  )
}

function FeatureCard({
  feature,
  appHref,
}: {
  feature: Feature
  appHref: (path?: string) => string
}) {
  const Icon = feature.icon
  const accent = ACCENTS[feature.accent]

  return (
    <article className={`group overflow-hidden rounded-lg border border-dark-border bg-dark-card transition-colors ${accent.border}`}>
      <div className="aspect-video overflow-hidden border-b border-dark-border bg-black">
        <img
          src={asset(feature.image)}
          alt={feature.alt}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
        />
      </div>
      <div className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${accent.icon}`}>
            <Icon size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <p className={`text-[11px] font-semibold uppercase tracking-wider ${accent.label}`}>
              {feature.eyebrow}
            </p>
            <h3 className="mt-1 text-lg font-semibold text-white">{feature.title}</h3>
          </div>
        </div>
        <p className="text-sm leading-relaxed text-gray-400">{feature.body}</p>
        <a
          href={appHref(feature.appPath)}
          className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-gray-200 hover:text-white"
        >
          Open in the app
          <span aria-hidden>→</span>
        </a>
      </div>
    </article>
  )
}
