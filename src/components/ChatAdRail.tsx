import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AdSlot } from '@/components/AdSlot'
import { chatAdRotateMs } from '@/lib/adConfig'
import { useAdsHidden } from '@/hooks/useAdsHidden'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

/**
 * ChatAdRail — the ONE ad unit inside chat.
 *
 * Operator's brief, verbatim: "small add at the bottom that changes every once
 * in a while". So this is deliberately NOT an ad injected every N messages:
 *
 *   • ONE unit, pinned under the message list, outside the scroll area. The
 *     conversation is never interrupted and scroll position is never disturbed.
 *   • 320×50 'strip' shape — the shortest slot AdSlot serves.
 *   • The creative SWAPS on a timer (default 45s, VITE_AD_CHAT_ROTATE_SECONDS),
 *     which is what turns one placement into repeat impressions without adding
 *     a second placement.
 *   • The timer is paused while the tab is hidden — an unwatched tab must not
 *     bill impressions, which is both an AdSense policy matter and the reason
 *     Notifications.tsx polls the same way.
 *   • The reader can close it for the session.
 *
 * ENTITLEMENT: it renders for nobody entitled to ad-free — the retired-but-still
 * -honoured `ad_free` tier and every higher member tier, AND members of (or visitors on
 * the address of) a league whose plan carries `member_ad_free`. AdSlot enforces
 * the same answer internally; the check here also stops the rotation timer and
 * the surrounding chrome (border, label, upgrade link) from existing at all, so
 * an entitled reader sees a chat panel with no trace of ad furniture.
 *
 * Mounted on the PUBLIC chat surfaces only: StreamChat (live / stage / merged),
 * TournamentChat and ChatSpace channels. Direct messages carry no inventory.
 */
export function ChatAdRail({ className = '' }: { className?: string }) {
  const { adsHidden, resolved, reason } = useAdsHidden()
  const [closed, setClosed] = useState(false)
  const [rotation, setRotation] = useState(0)

  const active = resolved && !adsHidden && !closed

  useEffect(() => {
    if (!active) return
    if (typeof window === 'undefined') return
    const period = chatAdRotateMs()
    const id = window.setInterval(() => {
      // Don't burn a rotation (or an impression) on a backgrounded tab.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      setRotation((r) => r + 1)
    }, period)
    return () => window.clearInterval(id)
  }, [active])

  if (!active) return null

  return (
    <div className={`relative border-t border-dark-border bg-dark/40 px-2 py-1.5 ${className}`}>
      <AdSlot slotId="chat-inline" shape="strip" rotation={rotation} className="w-full" />
      <div className="mt-1 flex items-center justify-between gap-2 px-0.5">
        {/* Never pitch an upgrade at someone whose league already covers it —
            though if `reason` were set we would not be rendering at all. No
            price is quoted: the $1.99 rung was retired and the ladder's prices
            live in src/pages/Upgrade.tsx alone. */}
        {!IS_MOBILE_STORE_BUILD && (
          <Link to="/upgrade" className="text-[10px] text-gray-500 hover:text-accent">
            {reason ? 'Manage your plan' : 'Remove ads'}
          </Link>
        )}
        <button
          type="button"
          onClick={() => setClosed(true)}
          aria-label="Hide the ad in this chat"
          className="text-[10px] text-gray-600 hover:text-gray-300"
        >
          Hide
        </button>
      </div>
    </div>
  )
}

export default ChatAdRail
