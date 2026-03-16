import { useEffect, useRef } from 'react'
import { adConfig } from '@/lib/adConfig'

type AdSlotProps = {
  slotId: string
  className?: string
}

/**
 * Renders an ad slot. When AdSense client and slot ID are configured,
 * displays the ad. Otherwise renders a placeholder for development.
 */
export function AdSlot({ slotId, className = '' }: AdSlotProps) {
  const ref = useRef<HTMLDivElement>(null)
  const slotKey = adConfig.slots[slotId]

  useEffect(() => {
    if (!adConfig.clientId || !slotKey || !ref.current) return
    try {
      ;(window as { adsbygoogle?: unknown[] }).adsbygoogle = (window as { adsbygoogle?: unknown[] }).adsbygoogle ?? []
      ;(window as { adsbygoogle: unknown[] }).adsbygoogle.push({})
    } catch {
      // AdSense script may not be loaded
    }
  }, [slotKey])

  if (!slotKey) {
    return (
      <div className={`min-h-[90px] rounded-lg border border-dashed border-dark-border bg-dark-border/10 flex items-center justify-center text-gray-500 text-sm ${className}`}>
        Ad slot: {slotId}
      </div>
    )
  }

  return (
    <div className={className}>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={adConfig.clientId}
        data-ad-slot={slotKey}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}
