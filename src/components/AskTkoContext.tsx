import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

/**
 * AskTkoContext — the shared state for the "Ask TKO" guided assistant.
 *
 * The assistant lives ONCE at the app root (mounted in Layout, a sibling of the
 * routed <Outlet/>), so its state survives route changes — a user can open a
 * guide, tap a deep-link CTA that navigates to another screen, and the panel is
 * still there. That persistence is the same idea as the picture-in-picture dock
 * (PipProvider): mount high, keep the session alive across navigation.
 *
 * Three visible modes:
 *   • 'closed' — only the small "Ask TKO" FAB pill shows.
 *   • 'open'   — the near-full-screen guided panel is expanded.
 *   • 'min'    — the panel is docked as a small PiP-style card (still alive,
 *                still on the current guide/step), with a maximize control.
 *
 * Entry points around the app (the King registration gate, Go Live, the clip
 * link spot) call `open('<guideId>')` to jump the user straight into the right
 * walkthrough.
 */

export type AskTkoMode = 'closed' | 'open' | 'min'

type AskTkoValue = {
  /** Current visible mode of the assistant. */
  mode: AskTkoMode
  /** The active guide id, or null for the picker / free-text chat. */
  guideId: string | null
  /**
   * Open (expand) the panel. Pass a guide id to jump straight to that guide,
   * `null` to open the picker/chat, or omit the arg to keep the current guide.
   */
  open: (guideId?: string | null) => void
  /** Collapse the panel to the docked PiP-style card (keeps guide + step). */
  minimize: () => void
  /** Close all the way back to the FAB pill. */
  close: () => void
  /** Choose (or clear, with null) the active guide from inside the panel. */
  setGuide: (id: string | null) => void
}

const AskTkoCtx = createContext<AskTkoValue | null>(null)

export function AskTkoProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AskTkoMode>('closed')
  const [guideId, setGuideId] = useState<string | null>(null)

  const open = useCallback((next?: string | null) => {
    if (next !== undefined) setGuideId(next)
    setMode('open')
  }, [])
  const minimize = useCallback(() => setMode('min'), [])
  const close = useCallback(() => setMode('closed'), [])
  const setGuide = useCallback((id: string | null) => setGuideId(id), [])

  const value = useMemo<AskTkoValue>(
    () => ({ mode, guideId, open, minimize, close, setGuide }),
    [mode, guideId, open, minimize, close, setGuide],
  )

  return <AskTkoCtx.Provider value={value}>{children}</AskTkoCtx.Provider>
}

/**
 * Access the Ask-TKO assistant. Safe anywhere under <AskTkoProvider>; returns a
 * no-op fallback if the provider is missing so a stray caller never crashes.
 */
export function useAskTko(): AskTkoValue {
  const ctx = useContext(AskTkoCtx)
  if (!ctx) {
    return {
      mode: 'closed',
      guideId: null,
      open: () => {},
      minimize: () => {},
      close: () => {},
      setGuide: () => {},
    }
  }
  return ctx
}
