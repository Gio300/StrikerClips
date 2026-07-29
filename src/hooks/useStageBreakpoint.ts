import { useEffect, useState } from 'react'
import { breakpointForWidth, type StageBreakpoint } from '@/lib/stageLayout'

/**
 * Live viewport breakpoint for the multi-angle stages.
 *
 * Why JS and not just CSS: the phone rule isn't only about sizing panes, it
 * changes *behaviour* — the director is held to single shots, Quad disappears
 * from the controls, and the angle strip renders cheap thumbnails instead of
 * live embeds. CSS can't express any of that, so the breakpoint has to be a
 * value React can branch on.
 *
 * Resize-aware on purpose: rotating a phone or unfolding a Fold has to move
 * the stage between modes without a reload.
 */
export function useStageBreakpoint(): StageBreakpoint {
  const [bp, setBp] = useState<StageBreakpoint>(() =>
    typeof window === 'undefined' ? 'desktop' : breakpointForWidth(window.innerWidth),
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const read = () => setBp(breakpointForWidth(window.innerWidth))
    read()
    window.addEventListener('resize', read)
    window.addEventListener('orientationchange', read)
    return () => {
      window.removeEventListener('resize', read)
      window.removeEventListener('orientationchange', read)
    }
  }, [])

  return bp
}
