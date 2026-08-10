import { BellOff, BellRing, Loader2 } from 'lucide-react'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { shouldShowPushControl } from '@/lib/webPush'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { WEB_PUSH_PROMPTS_ENABLED } from '@/lib/storeBuild'

/**
 * The opt-in for phone notifications.
 *
 * Renders NOTHING at all when the feature cannot work — no VAPID keys on the
 * server, no push support in this browser, or the initial probe is still
 * running. A dead toggle is worse than no toggle: it teaches members that the
 * feature is broken.
 *
 * The button is the ONLY thing on this page that can ask for notification
 * permission, and it asks on tap. See the header of usePushNotifications.
 *
 * Three states are visible:
 *   off      — "Turn on" (asks permission, then subscribes)
 *   on       — "Turn off" (unsubscribes this device; permission is left alone,
 *              because revoking it is the browser's business, not ours)
 *   blocked  — no button, just the truth about what happened and where to fix it
 */
export function PushNotificationToggle({ className = '' }: { className?: string }) {
  const { state, busy, error, loading, enable, disable } = usePushNotifications()
  const { league } = useLeagueTheme()
  const brandName = league?.name || 'TKO'

  if (!WEB_PUSH_PROMPTS_ENABLED || loading) return null
  if (!shouldShowPushControl(state)) return null

  const on = state === 'on'
  const blocked = state === 'blocked'

  return (
    <div className={`rounded-lg border border-dark-border bg-dark-card p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${on ? 'bg-accent/15 text-accent' : 'bg-dark-elevated text-gray-500'}`}
        >
          {on ? <BellRing size={19} aria-hidden /> : <BellOff size={19} aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Notifications on this device</p>
          <p className="mt-1 text-xs leading-5 text-gray-400">
            {blocked
              ? `Your browser is blocking notifications for ${brandName}. Allow notifications for this site in your browser settings, then come back here.`
              : on
                ? 'This device buzzes when someone messages you or @mentions you. You will not be notified about a conversation you are already reading.'
                : 'Get a small note on your phone when someone messages you or @mentions you.'}
          </p>

          {!blocked && (
            <button
              type="button"
              onClick={() => {
                // A USER GESTURE. This is the only path to requestPermission().
                void (on ? disable() : enable())
              }}
              disabled={busy}
              className={`mt-3 inline-flex min-h-10 items-center gap-2 rounded-md px-4 text-xs font-semibold transition-colors disabled:opacity-60 ${on ? 'border border-dark-border bg-dark-elevated text-gray-300 hover:border-accent/40 hover:text-white' : 'bg-accent text-dark hover:brightness-110'}`}
            >
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden />}
              {on ? 'Turn off' : 'Turn on'}
            </button>
          )}

          {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    </div>
  )
}
