import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import { CommandBar } from './CommandBar'
import { Onboarding } from './Onboarding'
import { PowerBar } from './PowerBar'
import { Splash } from './Splash'
import { FreeUserAdSlot } from './AdGate'
import { AdRollPixel } from './AdRollPixel'
import { PipProvider } from './pip/PipContext'
import { PipWidget } from './pip/PipWidget'
import { AskTkoProvider } from './AskTkoContext'
import { UpdateBanner } from './UpdateBanner'
import ConnectYouTubePrompt from './ConnectYouTubePrompt'

export function Layout() {
  return (
    <AskTkoProvider>
    <PipProvider>
    <div className="relative flex min-h-screen bg-dark text-gray-100">
      {/* AdRoll retargeting pixel — inert until VITE_ADROLL_ADV_ID +
          VITE_ADROLL_PIX_ID are set (see src/lib/adConfig.ts). Renders nothing. */}
      <AdRollPixel />
      {/* tko.cam launch splash (~5s) + hidden founder passphrase unlock. */}
      <Splash />
      <Sidebar />
      {/* min-w-0 lets the content column shrink instead of forcing horizontal
          overflow when a child is wide. The bottom padding on phones clears the
          fixed <BottomNav/> AND the floating "Ask TKO" FAB (which docks ~4.75rem
          above the nav), so no primary button ever sits underneath the pill on
          narrow (iPhone) widths. It collapses toward 0 once the sidebar returns
          (sm+), where the FAB tucks into the corner clear of content. */}
      <main className="flex-1 min-w-0 overflow-x-hidden overflow-y-auto pb-[calc(7.5rem+env(safe-area-inset-bottom))] sm:pb-6">
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
      {/* Unified voice + browser + typed-command bar (replaces the two
          separate floating buttons). VoiceButton.tsx stays exported for its
          `dispatchDirector`, which CommandBar imports. */}
      <CommandBar />
      <Onboarding />
      {/* Mandatory "connect your YouTube" gate — appears for signed-in players
          who haven't linked a YouTube (the whole match-merge engine needs their
          own clips). Self-gates; fires the UnlockReveal on connect. */}
      <ConnectYouTubePrompt />
      {/* Global picture-in-picture dock — shows the currently-minimized session
          (e.g. a reel player) as a floating card above the bottom nav. */}
      <PipWidget />
      {/* "New version available — Update". Renders nothing until a newer build
          is detected (waiting service worker, or a /version.json build id that
          differs from ours). Docks above the bottom nav AND the Ask-TKO FAB.
          Tapping Update reloads onto the new build WITHOUT clearing storage, so
          the `kc_token` session survives. */}
      <UpdateBanner />
    </div>
    </PipProvider>
    </AskTkoProvider>
  )
}
