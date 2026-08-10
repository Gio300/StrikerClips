import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { CommandBar } from './CommandBar'
import { PowerBar } from './PowerBar'
import { Splash } from './Splash'
import { FreeUserAdSlot } from './AdGate'
import { AdRollPixel } from './AdRollPixel'
import { PipProvider } from './pip/PipContext'
import { PipWidget } from './pip/PipWidget'
import { AskTkoProvider } from './AskTkoContext'
import { MessageNotificationOverlay } from './MessageNotificationOverlay'
import { LegalAcceptanceGate } from './LegalAcceptanceGate'
import { UnreadNotificationsProvider } from '@/hooks/useUnreadNotifications'

export function Layout() {
  return (
    <UnreadNotificationsProvider>
    <AskTkoProvider>
    <PipProvider>
    <div className="relative flex min-h-screen bg-dark text-gray-100">
      {/* AdRoll retargeting pixel — inert until VITE_ADROLL_ADV_ID +
          VITE_ADROLL_PIX_ID are set (see src/lib/adConfig.ts). Renders nothing. */}
      <AdRollPixel />
      {/* Launch splash (~5s) + hidden founder passphrase unlock. On a league
          domain with a bundled splash video (e.g. shinobistrikerleague.com)
          the league's motion graphic plays instead of the static lockup. */}
      <Splash />
      <Sidebar />
      {/* min-w-0 lets the content column shrink instead of forcing horizontal
          overflow when a child is wide. The bottom padding on phones is
          `--tko-chat-fab-clear` keeps page actions above the fixed phone nav
          and the one global chat button. It collapses to a plain gutter once
          the sidebar returns. */}
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto pb-[var(--tko-chat-fab-clear)] sm:pb-6">
        {/* Persistent power-level indicator — sticky at the top of the
            content column so every routed page shows it. */}
        <PowerBar />
        {/* Center + cap the content on very wide screens; full width on phones. */}
        <div className="mx-auto w-full max-w-screen-2xl">
          <Outlet />
          {/* Site-level house ad — free users only; paid/founder skip it via
              hidesAds() inside FreeUserAdSlot. */}
          <div className="px-3 sm:px-6 pb-6">
            <FreeUserAdSlot slotId="feed-inline" className="max-w-5xl mx-auto" />
          </div>
        </div>
      </main>
      {/* Phone-only bottom navigation (hidden at sm+ where the sidebar shows). */}
      <BottomNav />
      {/* One inbox button globally; Ask TKO lives as a pinned conversation. */}
      <CommandBar />
      <MessageNotificationOverlay />
      <LegalAcceptanceGate />
      {/* Account setup now lives at /setup. Keeping it out of the global shell
          makes "Not now" real and prevents legacy welcome/YouTube overlays. */}
      {/* Global picture-in-picture dock — shows the currently-minimized session
          (e.g. a reel player) as a floating card above the bottom nav. */}
      <PipWidget />
      {/* "New version available — Update". Renders nothing until a newer build
          is detected (waiting service worker, or a /version.json build id that
          differs from ours). Docks above the bottom nav AND the Ask-TKO FAB.
          Tapping Update reloads onto the new build WITHOUT clearing storage, so
          the `kc_token` session survives. */}
    </div>
    </PipProvider>
    </AskTkoProvider>
    </UnreadNotificationsProvider>
  )
}
