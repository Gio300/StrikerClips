import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * A single minimized session living in the global picture-in-picture dock.
 *
 * `render` is a function (not a stashed element) so the minimized content is
 * re-created when the widget mounts it — the surface that pushed the session
 * has usually navigated away and unmounted by then.
 */
export type PipSession = {
  /** Stable id (e.g. `reel:<reelId>`), used to de-dupe / replace. */
  id: string
  /** Short title shown on the PiP title bar. */
  title: string
  /** Route to send the user back to when they maximize. */
  restorePath: string
  /** Renders the minimized content (e.g. the video player). */
  render: () => ReactNode
}

type PipContextValue = {
  session: PipSession | null
  /** Push (or replace) the minimized session into the dock. */
  minimize: (session: PipSession) => void
  /** Clear the dock without navigating (the ✕ / close control). */
  close: () => void
}

const PipContext = createContext<PipContextValue | null>(null)

/**
 * PipProvider — holds the currently-minimized session for the whole app. Mount
 * it high in the tree (Layout) so the session survives route changes: a user
 * can minimize a reel, browse elsewhere, then maximize it back.
 */
export function PipProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PipSession | null>(null)

  const minimize = useCallback((next: PipSession) => setSession(next), [])
  const close = useCallback(() => setSession(null), [])

  const value = useMemo<PipContextValue>(
    () => ({ session, minimize, close }),
    [session, minimize, close],
  )

  return <PipContext.Provider value={value}>{children}</PipContext.Provider>
}

/**
 * Access the PiP dock. Safe to call anywhere under <PipProvider>; returns a
 * no-op fallback if the provider is missing so a stray caller never crashes.
 */
export function usePip(): PipContextValue {
  const ctx = useContext(PipContext)
  if (!ctx) {
    return { session: null, minimize: () => {}, close: () => {} }
  }
  return ctx
}
