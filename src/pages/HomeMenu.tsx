import { useEffect, useState } from 'react'
import { BigMenu, type BigMenuItem } from '@/components/BigMenu'
import { ActionCard } from '@/components/ui/ActionCard'
import { TkoKingHero } from '@/components/TkoKingHero'
import { NextBattlesStrip } from '@/components/NextBattlesStrip'
import { RecentVideosStrip } from '@/components/RecentVideosStrip'
import { NextStep } from '@/components/NextStep'
import { LiveSessionsStrip } from '@/components/LiveSessionsStrip'
import type { NinjaIconName } from '@/components/ui/NinjaIcon'

// The five top-level sections. Everything is a tap → slide → a few big
// options → tap → destination. No typing to get anywhere.
type Section = 'video' | 'clans' | 'tournaments' | 'live' | 'me'

const SUBMENUS: Record<Section, { title: string; subtitle: string; items: BigMenuItem[] }> = {
  video: {
    title: 'Video',
    subtitle: 'Make it, keep it, watch it.',
    items: [
      { id: 'make-clip', icon: '🎬', label: 'Make a clip', sub: 'Turn your plays into a reel', to: '/highlight/create', primary: true },
      { id: 'my-clips', icon: '📁', label: 'My clips', sub: 'Everything you have made', to: '/my-clips' },
      { id: 'recent-videos', icon: '🆕', label: 'Recent videos', sub: 'Freshly produced multi-angle videos', to: '/videos' },
      { id: 'watch-reels', icon: '▶️', label: 'Watch reels', sub: 'See the best of the squad', to: '/reels' },
    ],
  },
  clans: {
    title: 'Clans & Chat',
    subtitle: 'Your crew lives here.',
    items: [
      { id: 'my-clans', icon: '💬', label: 'My clans', sub: 'Boards, channels and chat', to: '/boards', primary: true },
      { id: 'find-clan', icon: '🛡️', label: 'Find a clan', sub: 'Discover clans recruiting now', to: '/clans/discover' },
      { id: 'create-clan', icon: '➕', label: 'Create a clan', sub: 'Start a new board', to: '/boards/create' },
    ],
  },
  tournaments: {
    title: 'Tournaments',
    subtitle: 'Compete and prove it.',
    items: [
      { id: 'browse-tournaments', icon: '🏆', label: 'Browse tournaments', sub: 'Find a bracket to join', to: '/tournaments', primary: true },
      { id: 'stat-checks', icon: '📊', label: 'Stat checks', sub: 'Verify results and ranks', to: '/stat-check-room' },
    ],
  },
  live: {
    title: 'Live',
    subtitle: 'Go on air or tune in.',
    items: [
      { id: 'watch-live', icon: '📺', label: 'Watch live', sub: 'Catch active streams', to: '/live?tab=watch', primary: true },
      { id: 'go-live', icon: '🔴', label: 'Go live', sub: 'Start your own stream', to: '/go-live' },
      { id: 'control-room', icon: '🎛️', label: 'Control room', sub: 'Host tools and direction', to: '/live?tab=host' },
    ],
  },
  me: {
    title: 'Me',
    subtitle: 'You and your account.',
    items: [
      { id: 'my-profile', icon: '👤', label: 'My profile', sub: 'Trophies, clips and stats', to: '/profile', primary: true },
      { id: 'post-clip', icon: '🎥', label: 'Post a clip', sub: 'Grab a clip from your apps', to: '/browser' },
      { id: 'redeem', icon: '🎟️', label: 'Redeem a pass', sub: 'Unlock a code', to: '/redeem' },
      { id: 'get-app', icon: '📲', label: 'Get the app', sub: 'Download for desktop', to: '/marketing' },
    ],
  },
}

// The home launcher: a guided grid of big ActionCards. One tap → the focused
// page for that job. One-word labels, ninja icons, no menus to hunt through.
// Each card links straight to its destination (Video/Clans drill into a
// sub-menu via the sidebar's /video and /clans routes; from here we funnel
// straight to the page people actually want).
const LAUNCHER: {
  id: string
  icon: NinjaIconName
  label: string
  sub: string
  to: string
  primary?: boolean
}[] = [
  { id: 'create', icon: 'create', label: 'Create', sub: 'Turn plays into a reel', to: '/highlight/create', primary: true },
  { id: 'watch', icon: 'watch', label: 'Watch', sub: 'Reels from the squad', to: '/reels' },
  { id: 'play', icon: 'trophy', label: 'Play', sub: 'Tournaments & brackets', to: '/tournaments' },
  { id: 'clans', icon: 'clan', label: 'Clans', sub: 'Your crew & chat', to: '/boards' },
  { id: 'live', icon: 'live', label: 'Live', sub: 'Watch or go on air', to: '/live' },
  { id: 'shop', icon: 'shop', label: 'Shop', sub: 'Rep your team', to: '/shop' },
  // "Connect" is now the OPEN CROSS-CLAN CHAT builder: anyone (not just your own
  // clan) can talk + follow each other, and "Make a chat" spins up new rooms.
  // Reuses the existing open-space chat UI (src/pages/Chat.tsx).
  { id: 'connect', icon: 'chat', label: 'Connect (Chat)', sub: 'Talk across clans · make rooms', to: '/chat' },
  { id: 'me', icon: 'user', label: 'Me', sub: 'Trophies, clips & stats', to: '/profile' },
]

export function HomeMenu({ initialSection }: { initialSection?: Section }) {
  const [section, setSection] = useState<Section | null>(initialSection ?? null)

  // Keep the view in sync if the route (and its initialSection) changes.
  useEffect(() => {
    setSection(initialSection ?? null)
  }, [initialSection])

  // Sidebar mirror routes (/video, /clans) still open the drill-down sub-menu.
  if (section != null) {
    return (
      <div className="px-4 md:px-8 py-6 md:py-10 w-full max-w-5xl">
        <BigMenu
          key={section}
          title={SUBMENUS[section].title}
          subtitle={SUBMENUS[section].subtitle}
          items={SUBMENUS[section].items}
          onBack={() => setSection(null)}
        />
      </div>
    )
  }

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 w-full max-w-5xl">
      <div className="mb-6 animate-fade-in">
        <h1 className="text-3xl md:text-4xl font-bold">What do you want to do?</h1>
        <p className="text-sm md:text-base text-gray-400 mt-1">Pick one. Big buttons, no menus to hunt through.</p>
      </div>

      {/* Guided next-step — surfaces the one logical next move for where the
          user is (connect YouTube → make a clip → join a clan → enter the
          ladder). Dismissible; disappears once they're set up. */}
      <div className="mb-5">
        <NextStep />
      </div>

      {/* PRIME placement — the featured TKO King pit leads the home page. */}
      <TkoKingHero />

      {/* Advertise the King's live + upcoming battles right under the hero. */}
      <NextBattlesStrip />

      {/* Who's live right now + the freshest produced multi-angle videos. Each
          strip renders nothing when it has no content, so a quiet app stays
          clean. */}
      <LiveSessionsStrip />
      <RecentVideosStrip />

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4 animate-slide-up">
        {LAUNCHER.map((item) => (
          <ActionCard
            key={item.id}
            orientation="vertical"
            icon={item.icon}
            label={item.label}
            sublabel={item.sub}
            to={item.to}
            selected={item.primary}
          />
        ))}
      </div>

      {/* Home-feed ad real estate is rendered ONCE by the app shell (Layout's
          FreeUserAdSlot below the routed content). We intentionally don't add a
          second slot here, so free users never see two stacked "Sponsored"
          banners on the launcher. */}
    </div>
  )
}
