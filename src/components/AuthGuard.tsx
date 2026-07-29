import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'

/**
 * Human-friendly reason for the login wall, chosen from the path the user was
 * trying to reach. Keeps the redirect explaining *why* they hit a sign-in
 * screen instead of dumping them on a blank login.
 */
export function authWallReason(path: string): string {
  if (path.startsWith('/highlight/create')) return 'Sign in to create a reel'
  if (path.startsWith('/go-live') || path.startsWith('/live/host')) return 'Sign in to go live'
  if (path.startsWith('/boards/create')) return 'Sign in to start a clan'
  if (path.startsWith('/boards') || path.startsWith('/chat')) return 'Sign in to join the chat'
  if (path.startsWith('/matches/create') || path.startsWith('/create-match')) return 'Sign in to create a match'
  if (path.startsWith('/my-clips')) return 'Sign in to see your clips'
  if (path.startsWith('/profile')) return 'Sign in to view your profile'
  if (path.startsWith('/redeem')) return 'Sign in to redeem a pass'
  return 'Sign in to continue'
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  if (!user) {
    // Pass where the user was headed + why, so Login can explain the wall and
    // return them there after a successful sign-in.
    const from = location.pathname + location.search
    return (
      <Navigate
        to="/login"
        replace
        state={{ from, reason: authWallReason(location.pathname) }}
      />
    )
  }

  return <>{children}</>
}
