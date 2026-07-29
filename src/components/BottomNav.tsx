import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Bell,
  Bot,
  ChevronRight,
  Clapperboard,
  Crown,
  Download,
  FileText,
  Film,
  Gem,
  Hammer,
  HelpCircle,
  Home,
  Link2,
  LogIn,
  LogOut,
  Menu,
  MessageCircleMore,
  PenLine,
  Plus,
  Radio,
  RadioTower,
  Search,
  Shirt,
  ShoppingBag,
  Sparkles,
  Swords,
  Ticket,
  Trophy,
  UserRound,
  UsersRound,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { InstallAppButton } from '@/components/InstallAppButton'

type PrimaryNavItem = {
  to: string
  label: string
  Icon: LucideIcon
  end?: boolean
  create?: boolean
}

const PRIMARY: readonly PrimaryNavItem[] = [
  { to: '/', label: 'Home', Icon: Home, end: true },
  { to: '/video', label: 'Watch', Icon: Clapperboard },
  { to: '/highlight/create', label: 'Create', Icon: Plus, create: true },
  { to: '/tournaments', label: 'Play', Icon: Trophy },
] as const

type SheetItem = {
  to: string
  label: string
  Icon: LucideIcon
  badge?: number
}

type CreateAction = {
  to: string
  label: string
  description: string
  Icon: LucideIcon
  iconClassName: string
}

const CREATE_ACTIONS: readonly CreateAction[] = [
  {
    to: '/profile?tab=wall',
    label: 'Post to Wall',
    description: 'Share an update with your followers.',
    Icon: PenLine,
    iconClassName: 'bg-accent/10 text-accent',
  },
  {
    to: '/highlight/create',
    label: 'Build a Reel',
    description: 'Turn your best clips into a highlight.',
    Icon: Film,
    iconClassName: 'bg-chakra/10 text-chakra',
  },
  {
    to: '/go-live',
    label: 'Go Live',
    description: 'Start broadcasting to your audience.',
    Icon: RadioTower,
    iconClassName: 'bg-kunai/10 text-kunai',
  },
] as const

export function BottomNav() {
  const { user } = useAuth()
  const { count: unreadCount } = useUnreadNotifications()
  const navigate = useNavigate()
  const location = useLocation()
  const [createOpen, setCreateOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)

  useEffect(() => {
    setCreateOpen(false)
    setMoreOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!createOpen && !moreOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [createOpen, moreOpen])

  useEffect(() => {
    if (!createOpen && !moreOpen) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setCreateOpen(false)
      setMoreOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [createOpen, moreOpen])

  async function handleSignOut() {
    setMoreOpen(false)
    await supabase.auth.signOut()
    navigate('/')
  }

  const explore: SheetItem[] = [
    { to: '/chat', label: 'Connect (Chat)', Icon: MessageCircleMore },
    { to: '/clans', label: 'Clans & crews', Icon: UsersRound },
    { to: '/conquest', label: 'Conquest map', Icon: Swords },
    { to: '/live', label: 'Broadcast studio', Icon: Radio },
    { to: '/discover', label: 'Player search', Icon: Search },
    { to: '/rankings', label: 'Power rankings', Icon: Crown },
    { to: '/profile', label: 'My profile', Icon: UserRound },
  ]

  const studio: SheetItem[] = user
    ? [
        { to: '/connect', label: 'Connected apps', Icon: Link2 },
        { to: '/rewards', label: 'Artifact collection', Icon: Gem },
        { to: '/forge', label: 'Forge an item', Icon: Hammer },
        { to: '/notifications', label: 'Notifications', Icon: Bell, badge: unreadCount },
      ]
    : []

  const account: SheetItem[] = [
    { to: '/shop', label: 'Creator marketplace', Icon: Shirt },
    { to: '/store', label: 'Tokens & Give Points', Icon: ShoppingBag },
    { to: '/oracle', label: 'Oracle calls', Icon: Bot },
    { to: '/redeem', label: 'Redeem pass', Icon: Ticket },
    { to: '/marketing', label: 'Install TKO', Icon: Download },
    { to: '/help', label: 'Help center', Icon: HelpCircle },
    { to: '/legal', label: 'Terms & privacy', Icon: FileText },
  ]

  return (
    <>
      {createOpen && (
        <CreateActionMenu onClose={() => setCreateOpen(false)} />
      )}

      {moreOpen && (
        <div className="fixed inset-0 z-[70] sm:hidden" role="dialog" aria-modal="true" aria-label="TKO menu">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/70"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[84vh] overflow-y-auto rounded-t-lg border-t border-dark-border bg-dark-card pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-dark-border bg-dark-card px-4 py-3">
              <h2 className="font-semibold text-white">Menu</h2>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-dark-elevated hover:text-white"
                aria-label="Close menu"
              >
                <X size={19} />
              </button>
            </div>

            <div className="px-3 py-3">
              <NavLink to="/upgrade" className="mb-4 flex min-h-11 items-center gap-3 rounded-lg bg-kunai px-3 text-sm font-semibold text-white">
                <Sparkles size={18} />
                Membership
                <ChevronRight size={17} className="ml-auto" />
              </NavLink>

              <SheetGroup label="Explore" items={explore} />
              {studio.length > 0 && <SheetGroup label="Studio" items={studio} />}
              <SheetGroup label="TKO" items={account} />

              <InstallAppButton variant="subtle" className="mt-3 block w-full [&>button]:w-full" />

              {!user ? (
                <SheetLink to="/login" label="Sign in" Icon={LogIn} />
              ) : (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-gray-400 hover:bg-dark-elevated hover:text-white"
                >
                  <LogOut size={18} />
                  Sign out
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-[65] border-t border-dark-border bg-dark/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm sm:hidden"
      >
        <div className="grid h-16 grid-cols-5">
          {PRIMARY.map(({ to, label, Icon, end, create }) => (
            create ? (
              <button
                key={to}
                type="button"
                onClick={() => {
                  setMoreOpen(false)
                  setCreateOpen((open) => !open)
                }}
                className="flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium text-white"
                aria-label="Create"
                aria-haspopup="dialog"
                aria-expanded={createOpen}
                aria-controls="create-action-menu"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-lg bg-kunai text-white transition-shadow ${
                    createOpen ? 'shadow-kunai' : ''
                  }`}
                >
                  <Plus
                    size={20}
                    strokeWidth={2}
                    className={`transition-transform ${createOpen ? 'rotate-45' : ''}`}
                  />
                </span>
                <span className="leading-none">Create</span>
              </button>
            ) : (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                    isActive ? 'text-white' : 'text-gray-500'
                  }`
                }
                aria-label={label}
              >
                {({ isActive }) => (
                  <>
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                      isActive ? 'bg-dark-elevated text-kunai' : ''
                    }`}>
                      <Icon size={19} strokeWidth={2} />
                    </span>
                    <span className="leading-none">{label}</span>
                  </>
                )}
              </NavLink>
            )
          ))}
          <button
            type="button"
            onClick={() => {
              setCreateOpen(false)
              setMoreOpen(true)
            }}
            className="relative flex min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium text-gray-500"
            aria-label="More"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg">
              <Menu size={19} />
            </span>
            <span className="leading-none">More</span>
            {user && unreadCount > 0 && (
              <span className="absolute right-[25%] top-2 h-2 w-2 rounded-full bg-kunai" aria-hidden />
            )}
          </button>
        </div>
      </nav>
    </>
  )
}

function CreateActionMenu({ onClose }: { onClose: () => void }) {
  return (
    <div
      id="create-action-menu"
      className="fixed inset-0 z-[70] sm:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-action-menu-title"
    >
      <button
        type="button"
        aria-label="Close create menu"
        onClick={onClose}
        className="absolute inset-0 bg-black/70"
      />
      <div className="absolute inset-x-0 bottom-0 animate-slide-up rounded-t-lg border-t border-dark-border bg-dark-card pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        <div className="flex items-start justify-between border-b border-dark-border px-4 py-4">
          <div>
            <h2 id="create-action-menu-title" className="font-semibold text-white">
              Create
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">Choose what you want to share.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-dark-elevated hover:text-white"
            aria-label="Close create menu"
          >
            <X size={19} />
          </button>
        </div>

        <div className="px-3 py-3">
          <div className="divide-y divide-dark-border overflow-hidden rounded-lg border border-dark-border bg-dark">
            {CREATE_ACTIONS.map(({ to, label, description, Icon, iconClassName }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className="flex min-h-[4.75rem] items-center gap-3 px-3 py-3 transition-colors hover:bg-dark-elevated focus-visible:bg-dark-elevated focus-visible:outline-none"
              >
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${iconClassName}`}>
                  <Icon size={21} strokeWidth={2} aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-white">{label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">{description}</span>
                </span>
                <ChevronRight size={17} className="ml-auto shrink-0 text-gray-600" aria-hidden />
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function SheetGroup({ label, items }: { label: string; items: SheetItem[] }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 px-3 text-[10px] font-semibold uppercase text-gray-600">{label}</h3>
      <div>
        {items.map((item) => (
          <SheetLink key={item.to} {...item} />
        ))}
      </div>
    </section>
  )
}

function SheetLink({ to, label, Icon, badge }: SheetItem) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors ${
          isActive
            ? 'bg-dark-elevated text-white'
            : 'text-gray-400 hover:bg-dark-elevated hover:text-white'
        }`
      }
    >
      <Icon size={18} className="shrink-0" />
      <span>{label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto rounded-full bg-kunai px-1.5 text-[10px] font-bold leading-5 text-white">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
      <ChevronRight size={15} className="ml-auto shrink-0 text-gray-600" />
    </NavLink>
  )
}
