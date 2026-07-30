import { Link } from 'react-router-dom'
import { useUnreadNotifications } from '@/hooks/useUnreadNotifications'
import { useAuth } from '@/hooks/useAuth'

/**
 * NotificationBell — the always-visible bell in the top bar. Shows a live unread
 * count and taps through to the Notifications page, where each item links to
 * whatever it's about (a new reel you're in, a clip, a follow, etc.). Mounted in
 * PowerBar so every page has it.
 */
export default function NotificationBell() {
  const { user } = useAuth()
  const { count } = useUnreadNotifications()
  if (!user) return null

  return (
    <Link
      to="/notifications"
      aria-label={count > 0 ? `${count} new notifications` : 'Notifications'}
      className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/5 transition-colors"
    >
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-none stroke-gray-200" strokeWidth="1.8" aria-hidden>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}
