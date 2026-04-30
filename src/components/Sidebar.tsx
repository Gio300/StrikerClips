import { NavLink } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { BrandLogo } from '@/components/BrandLogo'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'

const NAV_ITEMS: { to: string; label: string; Icon: () => JSX.Element }[] = [
  { to: '/', label: 'Home', Icon: HomeIcon },
  { to: '/reels', label: 'Reels', Icon: ReelsIcon },
  { to: '/tournaments', label: 'Tournaments', Icon: TournamentsIcon },
  { to: '/boards', label: 'Boards', Icon: BoardsIcon },
  { to: '/live', label: 'Live', Icon: LiveIcon },
  { to: '/ai', label: 'AI', Icon: AIIcon },
  { to: '/rankings', label: 'Rankings', Icon: RankingsIcon },
  { to: '/dashboard', label: 'Dashboard', Icon: DashboardIcon },
  { to: '/profile', label: 'Profile', Icon: ProfileIcon },
]

export function Sidebar() {
  const { user } = useAuth()
  const { count: unreadCount } = useUnreadNotifications()

  return (
    <aside className="w-16 md:w-64 shrink-0 bg-dark-card/70 backdrop-blur-sm border-r border-dark-border flex flex-col sticky top-0 h-screen">
      <div className="p-4 border-b border-dark-border">
        <NavLink to="/" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
          <div className="relative w-9 h-9 rounded-lg bg-gradient-kunai flex items-center justify-center shadow-md">
            <ShurikenIcon />
          </div>
          <span className="hidden md:block">
            <BrandLogo as="span" className="text-base" />
          </span>
        </NavLink>
      </div>

      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'text-white bg-dark-elevated'
                  : 'text-gray-400 hover:text-white hover:bg-dark-elevated/60'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-gradient-kunai" />
                )}
                <span className={isActive ? 'text-kunai' : ''}>
                  <Icon />
                </span>
                <span className="hidden md:block text-sm font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
        {user && (
          <NavLink
            to="/notifications"
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                isActive
                  ? 'text-white bg-dark-elevated'
                  : 'text-gray-400 hover:text-white hover:bg-dark-elevated/60'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-gradient-kunai" />
                )}
                <span className={`relative ${isActive ? 'text-kunai' : ''}`}>
                  <BellIcon />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[1rem] h-4 px-1 rounded-full bg-kunai text-[10px] font-bold text-white flex items-center justify-center leading-none">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
                <span className="hidden md:block text-sm font-medium">Notifications</span>
              </>
            )}
          </NavLink>
        )}
      </nav>

      <div className="p-2 border-t border-dark-border space-y-0.5">
        <NavLink
          to="/marketing"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-chakra hover:bg-chakra/10 transition-colors"
        >
          <DownloadIcon />
          <span className="hidden md:block text-sm font-medium">Get the app</span>
        </NavLink>
        {!user && (
          <NavLink
            to="/login"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-kunai hover:bg-kunai/10 transition-colors"
          >
            <LoginIcon />
            <span className="hidden md:block text-sm font-medium">Sign in</span>
          </NavLink>
        )}
      </div>
    </aside>
  )
}

function ShurikenIcon() {
  return (
    <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
    </svg>
  )
}

function HomeIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function ReelsIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="14" rx="2" strokeWidth={1.8} />
      <path strokeLinecap="round" strokeWidth={1.8} d="M10 9.5l5 2.5-5 2.5z" fill="currentColor" />
    </svg>
  )
}

function TournamentsIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 21h8M12 17v4M5 4h14v6a7 7 0 11-14 0V4z" />
      <path strokeLinecap="round" strokeWidth={1.8} d="M19 6h2a2 2 0 010 4M5 6H3a2 2 0 000 4" />
    </svg>
  )
}

function BoardsIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z M8 11h8M8 15h5" />
    </svg>
  )
}

function LiveIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function AIIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  )
}

function RankingsIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21h18M6 21V10m6 11V4m6 17v-7" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

function LoginIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
      />
    </svg>
  )
}

function DashboardIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.8}
        d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h4v-7h4v7h4a1 1 0 001-1V10"
      />
      <path strokeLinecap="round" strokeWidth={1.8} d="M3 18h2m14 0h2M9 14h6" />
    </svg>
  )
}
