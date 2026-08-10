import { MessageCircle, Zap } from 'lucide-react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useMessageUnread } from '@/hooks/useMessageUnread'

/** The app's one floating action: open the conversation inbox. */
export function ChatFab() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const { count } = useMessageUnread()
  if (!user || pathname === '/messages') return null

  return (
    <Link
      to="/messages"
      aria-label={count > 0 ? `Open chats, ${count} unread` : 'Open chats'}
      title="Chats"
      className="pointer-events-auto fixed bottom-[var(--tko-chat-fab-bottom)] right-4 z-[69] flex h-14 w-14 items-center justify-center rounded-full border border-accent/60 bg-accent text-dark shadow-2xl transition-transform hover:scale-105 active:scale-95"
    >
      <MessageCircle className="h-6 w-6 fill-current" aria-hidden />
      <Zap className="absolute -right-1 -top-1 h-5 w-5 rounded-full border-2 border-dark bg-kunai p-0.5 text-white" aria-hidden />
      {count > 0 && (
        <span className="absolute -left-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  )
}

export default ChatFab
