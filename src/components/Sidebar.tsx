import { NavLink, useNavigate } from 'react-router-dom'
import {
  Bell,
  Bot,
  Clapperboard,
  Download,
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
  Plus,
  Radio,
  Search,
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
  { to: '/chat', label: 'Connect (Chat)', Icon: MessageCircleMore },
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

export function Sidebar() {
  const { user } = useAuth()
  const { count: unreadCount } = useUnreadNotifications()
  const navigate = useNavigate()

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <aside className="sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col border-r border-dark-border bg-dark-card sm:flex md:w-[232px]">
      <div className="flex h-16 items-center justify-center border-b border-dark-border px-3 md:justify-start">
        <NavLink to="/" className="transition-opacity hover:opacity-80" aria-label="TKO home">
          <BrandLogo variant="icon" className="text-base md:hidden" />
          <BrandLogo className="hidden text-base md:inline-flex" />
        </NavLink>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <NavLink
          to="/highlight/create"
          className="mb-4 flex min-h-10 items-center justify-center gap-2 rounded-lg bg-kunai px-3 text-sm font-semibold text-white transition-colors hover:bg-kunai-dark md:justify-start"
          title="Create reel"
        >
          <Plus size={19} />
          <span className="hidden md:block">Create reel</span>
        </NavLink>

        <NavGroup label="Play" items={PLAY_NAV} />
        <NavGroup label="Community" items={COMMUNITY_NAV} />

        {user && (
          <NavGroup
            label="Studio"
            items={[
              { to: '/connect', label: 'Connected accounts', Icon: Link2 },
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
        {!IS_MOBILE_STORE_BUILD && <NavRow to="/marketing" label="Install TKO" Icon={Download} />}
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
