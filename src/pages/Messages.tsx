import { useSearchParams } from 'react-router-dom'
import { DirectMessages } from '@/components/social/DirectMessages'
import { useAuth } from '@/hooks/useAuth'

export function Messages() {
  const { user } = useAuth()
  const [params] = useSearchParams()
  const conversationId = params.get('conversation')

  return (
    <main className="mx-auto w-full max-w-7xl px-0 py-0 sm:px-4 sm:py-4 lg:px-6">
      {user && <DirectMessages userId={user.id} initialConversationId={conversationId} />}
    </main>
  )
}
