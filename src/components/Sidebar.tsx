import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Bell,
  Bot,
  Clapperboard,
  FileText,
  Gem,
  Hammer,
  HelpCircle,
  Home,
  Link2,
  LogIn,
  LogOut,
  MessageCircleMore,
  Mic2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Sparkles,
  Swords,
  Ticket,
  Trophy,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { canHost } from '@/lib/tkoKing'
import { BrandLogo } from '@/components/BrandLogo'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { useInstallLabel } from '@/hooks/useInstallLabel'
import { InstallAppButton } from '@/components/InstallAppButton'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

type NavItem = {
  to: string
  label: string
  Icon: LucideIcon
  end?: boolean
  badge?: number
}

const PLAY_NAV: NavItem[] = [
  { to: '/', label: 'Home', Icon: Home, end: true },
  { to: '/video', label: 'Watch', Icon: Clapperboard },
  { to: '/tournaments', label: 'Tournaments', Icon: Trophy },
  { to: '/conquest', label: 'Conquest', Icon: Swords },
  { to: '/live', label: 'Live', Icon: Radio },
]

const COMMUNITY_NAV: NavItem[] = [
  { to: '/messages', label: 'Chats', Icon: MessageCircleMore },
  { to: '/clans', label: 'Clans', Icon: UsersRound },
  { to: '/discover', label: 'Search', Icon: Search },
  { to: '/profile', label: 'Profile', Icon: UserRound },
]

const MARKET_NAV: NavItem[] = IS_MOBILE_STORE_BUILD
  ? [{ to: '/oracle', label: 'Oracle', Icon: Bot }]
  : [
      { to: '/shop', label: 'Team Shop', Icon: Shirt },
      { to: '/store', label: 'Store', Icon: ShoppingBag },
      { to: '/oracle', label: 'Oracle', Icon: Bot },
    ]

const SIDEBAR_PREF_KEY = 'tko_sidebar_open'

export function Sidebar() {
  const { user } = useAuth()
  const { league } = useLeagueTheme()
  const brandName = league?.name || 'TKO'
  const { count: unreadCount } = useUnreadNotifications()
  // "Install TKO" on tko.cam, "Install <league>" on a league address.
  const installLabel = useInstallLabel()
  const navigate = useNavigate()

  // Operator 2026-08-02: "people don't need to see the side panel all the
  // time" — the sidebar defaults SLID-AWAY everywhere; the floating opener
  // brings it back, and the choice sticks for the session.
  const [pref, setPref] = useState<boolean | null>(() => {
    try {
      const raw = sessionStorage.getItem(SIDEBAR_PREF_KEY)
      return raw == null ? null : raw === '1'
    } catch {
      return null
    }
  })
  const open = pref ?? false

  function setOpenPref(next: boolean) {
    setPref(next)
    try { sessionStorage.setItem(SIDEBAR_PREF_KEY, next ? '1' : '0') } catch { /* best-effort */ }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpenPref(true)}
        aria-label="Open menu"
        title="Open menu"
        className="fixed left-2 top-2 z-40 hidden h-10 w-10 items-center justify-center rounded-lg border border-dark-border bg-dark-card/90 text-gray-300 shadow-lg backdrop-blur transition-colors hover:border-accent hover:text-accent sm:flex"
      >
        <PanelLeftOpen size={18} />
      </button>
    )
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col border-r border-dark-border bg-dark-card sm:flex md:w-[232px]">
      <div className="flex h-16 items-center justify-center gap-2 border-b border-dark-border px-3 md:justify-start">
        <NavLink to="/" className="transition-opacity hover:opacity-80" aria-label={`${brandName} home`}>
          <BrandLogo variant="icon" className="text-base md:hidden" />
          <BrandLogo className="hidden text-base md:inline-flex" />
        </NavLink>
        <button
          type="button"
          onClick={() => setOpenPref(false)}
          aria-label="Hide menu"
          title="Hide menu"
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-gray-500 transition-colors hover:text-accent"
        >
          <PanelLeftClose size={16} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavLink
          to="/create"
          className="mb-4 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-kunai px-3 text-sm font-semibold text-white transition-colors hover:bg-kunai-dark md:justify-start"
          title="Create"
        >
          <Plus size={19} />
          <span className="hidden md:block">Create</span>
        </NavLink>

        <NavGroup label="Play" items={PLAY_NAV} />
        <NavGroup label="Community" items={COMMUNITY_NAV} />

        {user && (
          <NavGroup
            label="Studio"
            items={[
              { to: '/connect', label: 'Connected accounts', Icon: Link2 },
              ...(IS_MOBILE_STORE_BUILD
                ? [{ to: '/settings', label: 'Account settings', Icon: Settings2 }]
                : [{ to: '/settings', label: 'Account & payouts', Icon: Settings2 }]),
              { to: '/privacy-settings', label: 'Privacy', Icon: ShieldCheck },
              ...(canHost(user) ? [{ to: '/host', label: 'Host', Icon: Mic2 }] : []),
              { to: '/rewards', label: 'Artifacts', Icon: Gem },
              { to: '/forge', label: 'Forge', Icon: Hammer },
              { to: '/notifications', label: 'Notifications', Icon: Bell, badge: unreadCount },
            ]}
          />
        )}

        <NavGroup label="Marketplace" items={MARKET_NAV} />
      </nav>

      <div className="border-t border-dark-border p-2">
        {!IS_MOBILE_STORE_BUILD && <NavRow to="/upgrade" label="Membership" Icon={Sparkles} />}
        <NavRow to="/redeem" label="Redeem pass" Icon={Ticket} />
        {/* THE INSTALL IS THE INSTALL, not a trip to the pitch page. Operator
            2026-08-07: "shouldn't be taken to TKO.cam to download app.. should
            just be able to download right from the more link.. that should
            start the download."

            This was a NavRow to /marketing, so the member left the app, landed
            on sales copy, and had to find the button again. InstallAppButton
            fires the browser's own prompt against the manifest of the host they
            are already on -- so on a league domain a member installs the
            LEAGUE's app, which is the whole point of the white label. It
            renders nothing once installed, and falls back to help text on
            browsers with no prompt (iOS), which the NavRow never did. */}
        {!IS_MOBILE_STORE_BUILD && (
          <InstallAppButton
            variant="subtle"
            label={installLabel}
            className="block w-full [&>button]:w-full [&>button]:justify-start"
          />
        )}
        <NavRow to="/help" label="Help" Icon={HelpCircle} />
        <NavRow to="/legal" label="Legal" Icon={FileText} />
        {!user ? (
          <NavRow to="/login" label="Sign in" Icon={LogIn} />
        ) : (
          <button
            type="button"
            onClick={handleSignOut}
            className="flex min-h-9 w-full items-center justify-center gap-3 rounded-lg px-3 text-gray-500 transition-colors hover:bg-dark-elevated hover:text-white md:justify-start"
            title="Sign out"
          >
            <LogOut size={18} />
            <span className="hidden text-sm font-medium md:block">Sign out</span>
          </button>
        )}
      </div>
    </aside>
  )
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="mb-4">
      <div className="mb-1 hidden px-3 text-[10px] font-semibold uppercase text-gray-600 md:block">
        {label}
      </div>
      <div className="space-y-0.5">
        {items.map((item) => (
          <NavRow key={item.to} {...item} />
        ))}
      </div>
    </div>
  )
}

function NavRow({ to, label, Icon, end, badge }: NavItem) {
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        `relative flex min-h-9 items-center justify-center gap-3 rounded-lg px-3 transition-colors md:justify-start ${
          isActive
            ? 'bg-dark-elevated text-white'
            : 'text-gray-500 hover:bg-dark-elevated/70 hover:text-white'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-kunai" />}
          <span className="relative shrink-0">
            <Icon size={18} className={isActive ? 'text-kunai' : ''} />
            {badge != null && badge > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-kunai px-1 text-[9px] font-bold text-white">
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </span>
          <span className="hidden truncate text-sm font-medium md:block">{label}</span>
        </>
      )}
    </NavLink>
  )
}
