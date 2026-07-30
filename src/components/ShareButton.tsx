import { useState } from 'react'
import { shareLink } from '@/lib/share'

/**
 * ShareButton — one tap to share a link. Uses the phone's native share sheet
 * when available, otherwise copies the link. Flashes a confirmation.
 */
export function ShareButton({ url, title, text, className }: { url: string; title?: string; text?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'shared' | 'copied' | 'failed'>('idle')

  const label =
    state === 'copied' ? 'Link copied ✓' :
    state === 'shared' ? 'Shared ✓' :
    state === 'failed' ? 'Try again' :
    'Share'

  return (
    <button
      type="button"
      onClick={async () => {
        const r = await shareLink({ url, title, text })
        setState(r === 'failed' ? 'failed' : r)
        setTimeout(() => setState('idle'), 1800)
      }}
      className={className ?? 'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-dark-border text-gray-200 text-sm hover:border-accent/50 shrink-0'}
    >
      <span aria-hidden>🔗</span>{label}
    </button>
  )
}

export default ShareButton
