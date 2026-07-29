import { useAppUpdate } from '@/hooks/useAppUpdate'

/**
 * "New version available" toast.
 *
 * FALLBACK ONLY: the app now force-updates automatically — the /version.json
 * poll reloads onto a newer build on its own (see src/hooks/useAppUpdate.ts),
 * and the service worker skip-waits + claims immediately (public/sw.js). This
 * toast only surfaces in the rare case the auto-reload loop guard suppressed the
 * reload (a stale edge served a build we already reloaded onto), giving the user
 * a manual way forward instead of silently bouncing.
 *
 * SESSION SAFETY: tapping Update posts SKIP_WAITING to the waiting worker and
 * reloads. It clears no storage — the JWT stays in localStorage under
 * `kc_token`, `AuthProvider` rehydrates from it on boot, and the tester lands on
 * the new build already signed in.
 *
 * PLACEMENT (phone-first): docks above BOTH the fixed <BottomNav/> (z-65, ~3.5rem
 * tall) and the "Ask TKO" command FAB (which sits at 4.75rem + safe-area). At
 * `sm` and up the bottom nav is gone and the FAB tucks to bottom-5, so the toast
 * moves to the bottom-right above it. z-[68] keeps it under the More sheet
 * (z-70) and the Ask-TKO panel (z-75), which are modal.
 */
export function UpdateBanner() {
  const { updateReady, applyUpdate, dismiss } = useAppUpdate()
  if (!updateReady) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[68] left-3 right-3 bottom-[calc(8.5rem+env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:bottom-20 sm:w-[23rem] animate-slide-up"
    >
      <div className="flex items-center gap-3 rounded-xl border border-kunai/40 bg-dark-card/95 backdrop-blur px-3.5 py-3 shadow-2xl">
        <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
          <span className="absolute inline-flex h-full w-full rounded-full bg-kunai opacity-60 animate-ping" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-kunai" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-tight text-white">New version available</div>
          <div className="text-xs text-gray-400 leading-tight mt-0.5">
            Update to get the latest build. You&rsquo;ll stay signed in.
          </div>
        </div>
        <button
          type="button"
          onClick={applyUpdate}
          className="btn-primary shrink-0 px-3.5 py-1.5 text-sm"
        >
          Update
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss update notice"
          className="shrink-0 -mr-1 rounded-md px-1.5 py-1 text-lg leading-none text-gray-500 hover:text-white"
        >
          ×
        </button>
      </div>
    </div>
  )
}
