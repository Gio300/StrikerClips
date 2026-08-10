import { useEffect, useState } from 'react'
import {
  CircleUserRound,
  Clapperboard,
  FolderOpen,
  Gem,
  GitBranch,
  LayoutDashboard,
  Library,
  Link2,
  MessageCircle,
  Play,
  Radio,
  Search,
  Smartphone,
  Trophy,
  Tv,
  UserPlus,
} from 'lucide-react'
import { BigMenu, type BigMenuItem } from '@/components/BigMenu'
import { LegalFooter } from '@/components/LegalFooter'
import { ActionCard } from '@/components/ui/ActionCard'
import { TkoKingHero } from '@/components/TkoKingHero'
import { NextBattlesStrip } from '@/components/NextBattlesStrip'
import { RecentVideosStrip } from '@/components/RecentVideosStrip'
import { NextStep } from '@/components/NextStep'
import { LiveSessionsStrip } from '@/components/LiveSessionsStrip'
import type { NinjaIconName } from '@/components/ui/NinjaIcon'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useInstallLabel } from '@/hooks/useInstallLabel'
import { CODE_REDEMPTION_ENABLED, IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

type Section = 'video' | 'clans' | 'tournaments' | 'live' | 'me'

/**
 * The one menu row whose copy names the app being installed. SUBMENUS is a
 * module constant (it has no hooks), so the league's name is stitched in at
 * render — the same string the button on /marketing will show.
 */
const INSTALL_ITEM_ID = 'get-app'

const SUBMENUS: Record<Section, { title: string; subtitle: string; items: BigMenuItem[] }> = {
  video: {
    title: 'Video studio',
    subtitle: 'Create, manage, or watch.',
    items: [
      {
        id: 'make-clip',
        icon: Clapperboard,
        label: 'Create a reel',
        sub: 'Add footage, arrange angles, and publish',
        to: '/highlight/create',
        primary: true,
      },
      {
        id: 'my-clips',
        icon: FolderOpen,
        label: 'My studio',
        sub: 'Continue drafts and manage finished reels',
        to: '/my-clips',
      },
      {
        id: 'recent-videos',
        icon: Library,
        label: 'Multi-angle matches',
        sub: 'See matches TKO assembled for the squad',
        to: '/videos',
      },
      {
        id: 'watch-reels',
        icon: Play,
        label: 'Watch feed',
        sub: 'Browse reels from players and clans',
        to: '/reels',
      },
    ],
  },
  clans: {
    title: 'Clans and chat',
    subtitle: 'Your crew lives here.',
    items: [
      {
        id: 'my-clans',
        icon: MessageCircle,
        label: 'My clans',
        sub: 'Boards, channels, and chat',
        to: '/boards',
        primary: true,
      },
      {
        id: 'find-clan',
        icon: Search,
        label: 'Find a clan',
        sub: 'Discover clans recruiting now',
        to: '/clans/discover',
      },
      {
        id: 'create-clan',
        icon: UserPlus,
        label: 'Create a clan',
        sub: 'Start a new crew space',
        to: '/boards/create',
      },
    ],
  },
  tournaments: {
    title: 'Tournaments',
    subtitle: 'Find a competition or build one.',
    items: [
      {
        id: 'browse-tournaments',
        icon: Trophy,
        label: 'Find a tournament',
        sub: 'Search open brackets and live events',
        to: '/tournaments',
        primary: true,
      },
      {
        id: 'create-tournament',
        icon: GitBranch,
        label: 'Create a tournament',
        sub: 'Pick a format, then configure it',
        to: '/tournaments?create=1',
      },
    ],
  },
  live: {
    title: 'Live',
    subtitle: 'Go on air or tune in.',
    items: [
      {
        id: 'live-menu',
        icon: Radio,
        label: 'Live control room',
        sub: 'Go live, host, or watch',
        to: '/live',
        primary: true,
      },
      {
        id: 'watch-live',
        icon: Tv,
        label: 'Watch live',
        sub: 'Catch active streams',
        to: '/live?do=watch',
      },
      {
        id: 'go-live',
        icon: Radio,
        label: 'Go live',
        sub: 'Add your stream and other players',
        to: '/live?do=golive',
      },
    ],
  },
  me: {
    title: 'Me',
    subtitle: 'Your profile and account.',
    items: [
      {
        id: 'my-profile',
        icon: CircleUserRound,
        label: 'My profile',
        sub: 'Trophies, clips, and stats',
        to: '/profile',
        primary: true,
      },
      {
        id: 'post-clip',
        icon: Link2,
        label: 'Connected apps',
        sub: 'Bring in clips from your accounts',
        to: '/browser',
      },
      {
        id: 'redeem',
        icon: Gem,
        label: 'Redeem a pass',
        sub: 'Unlock a code',
        to: '/redeem',
      },
      {
        id: 'get-app',
        icon: Smartphone,
        label: 'Get the app',
        // Rewritten per league at render — see INSTALL_ITEM_ID above.
        sub: 'Install TKO on this device',
        to: '/marketing',
      },
    ],
  },
}

const LAUNCHER: {
  id: string
  icon: NinjaIconName
  label: string
  sub: string
  to: string
  primary?: boolean
}[] = [
  { id: 'create', icon: 'create', label: 'Create', sub: 'Pick what you want to make', to: '/create', primary: true },
  { id: 'watch', icon: 'watch', label: 'Watch', sub: 'Reels from the squad', to: '/reels' },
  { id: 'play', icon: 'trophy', label: 'Play', sub: 'Tournaments and brackets', to: '/tournaments' },
  { id: 'clans', icon: 'clan', label: 'Clans', sub: 'Your crew and chat', to: '/boards' },
  { id: 'live', icon: 'live', label: 'Live', sub: 'Watch or go on air', to: '/live' },
  { id: 'shop', icon: 'shop', label: 'Shop', sub: 'Rep your team', to: '/shop' },
  { id: 'connect', icon: 'chat', label: 'Connect', sub: 'Talk across clans and make rooms', to: '/chat' },
  { id: 'me', icon: 'user', label: 'Me', sub: 'Trophies, clips, and stats', to: '/profile' },
]

export function HomeMenu({ initialSection }: { initialSection?: Section }) {
  const [section, setSection] = useState<Section | null>(initialSection ?? null)
  const { isPremium } = useEntitlements()
  const installLabel = useInstallLabel()

  useEffect(() => {
    setSection(initialSection ?? null)
  }, [initialSection])

  if (section != null) {
    const items =
      section === 'me' && isPremium
        ? [
            SUBMENUS.me.items[0],
            {
              id: 'creator-dashboard',
              icon: LayoutDashboard,
              label: 'Creator dashboard',
              sub: 'Goals, live stats, and hosting',
              to: '/creator',
            } as BigMenuItem,
            ...SUBMENUS.me.items.slice(1),
          ]
        : SUBMENUS[section].items

    const branded = items
      .filter((item) => !IS_MOBILE_STORE_BUILD || item.id !== INSTALL_ITEM_ID)
      .filter((item) => CODE_REDEMPTION_ENABLED || item.id !== 'redeem')
      .map((item) =>
        item.id === INSTALL_ITEM_ID ? { ...item, sub: `${installLabel} on this device` } : item,
      )

    return (
      <div className="w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
        <BigMenu
          key={section}
          title={SUBMENUS[section].title}
          subtitle={SUBMENUS[section].subtitle}
          items={branded}
          onBack={() => setSection(null)}
        />
      </div>
    )
  }

  return (
    <div className="w-full max-w-5xl px-4 py-6 md:px-8 md:py-10">
      <div className="mb-6 animate-fade-in">
        <h1 className="text-3xl font-bold md:text-4xl">What do you want to do?</h1>
        <p className="mt-1 text-sm text-gray-400 md:text-base">Pick a goal, then configure it.</p>
      </div>

      <div className="mb-5">
        <NextStep />
      </div>

      <TkoKingHero />
      <NextBattlesStrip />
      <LiveSessionsStrip />
      <RecentVideosStrip />

      <div className="grid animate-slide-up grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4 lg:grid-cols-4">
        {LAUNCHER.filter((item) => !IS_MOBILE_STORE_BUILD || item.id !== 'shop').map((item) => (
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

      {/* The launcher is `/` for a SIGNED-IN visitor, so it carries the same
          legal row the signed-out landings do — the root path shows the links
          in either auth state. See src/components/LegalFooter.tsx. */}
      <LegalFooter className="mt-10" />
    </div>
  )
}
