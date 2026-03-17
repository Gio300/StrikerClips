import { NavLink } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { BrandLogo } from '@/components/BrandLogo'

export function Sidebar() {
  const { user } = useAuth()

  return (
    <aside className="w-16 md:w-64 bg-dark-card border-r border-dark-border flex flex-col">
      <div className="p-4 border-b border-dark-border">
        <NavLink to="/" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
          <div className="w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6v12l8-6 8 6V6H4z" strokeLinejoin="round"/>
              <circle cx="12" cy="12" r="2" fill="currentColor"/>
            </svg>
          </div>
          <span className="hidden md:block font-semibold text-lg">
            <BrandLogo as="span" className="text-lg" />
          </span>
        </NavLink>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        <NavLink
          to="/"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
            }`
          }
        >
          <HomeIcon />
          <span className="hidden md:block">Home</span>
        </NavLink>
        <NavLink
          to="/tournaments"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
            }`
          }
        >
          <TournamentsIcon />
          <span className="hidden md:block">Tournaments</span>
        </NavLink>
        <NavLink
          to="/boards"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
            }`
          }
        >
          <BoardsIcon />
          <span className="hidden md:block">Boards</span>
        </NavLink>
        <NavLink
          to="/live"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
            }`
          }
        >
          <LiveIcon />
          <span className="hidden md:block">Live</span>
        </NavLink>
        <NavLink
          to="/ai"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
            }`
          }
        >
          <AIIcon />
          <span className="hidden md:block">AI</span>
        </NavLink>
        <NavLink
          to="/rankings"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
            }`
          }
        >
          <RankingsIcon />
          <span className="hidden md:block">Rankings</span>
        </NavLink>
        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
              isActive ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
            }`
          }
        >
          <ProfileIcon />
          <span className="hidden md:block">Profile</span>
        </NavLink>
      </nav>
      <div className="p-2 border-t border-dark-border">
        {!user && (
          <NavLink
            to="/login"
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-accent hover:bg-accent/10 transition-colors"
          >
            <LoginIcon />
            <span className="hidden md:block">Sign in</span>
          </NavLink>
        )}
      </div>
    </aside>
  )
}

function HomeIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  )
}

function TournamentsIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  )
}

function LiveIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function AIIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  )
}

function RankingsIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  )
}

function BoardsIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  )
}

function ProfileIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  )
}

function LoginIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
    </svg>
  )
}
