import { useEffect, useState } from 'react'
import { AdSlot } from '@/components/AdSlot'
import { BRAND } from '@/lib/brand'

const DEFAULT_SECONDS = 30

type Props = {
  isPremium: boolean
  onUnlocked: () => void
}

/**
 * Free accounts must view this panel while a sponsor message plays. Paid or
 * `VITE_CREATION_AD_SECONDS=0` skips the wait.
 */
export function CreationSponsorGate({ isPremium, onUnlocked }: Props) {
  const secEnv = import.meta.env.VITE_CREATION_AD_SECONDS
  const requiredSec =
    secEnv === '' || secEnv === undefined
      ? DEFAULT_SECONDS
      : Math.max(0, Number(secEnv) || 0)

  const [left, setLeft] = useState(requiredSec)

  useEffect(() => {
    if (isPremium || requiredSec === 0) {
      onUnlocked()
      return
    }
    let remaining = requiredSec
    setLeft(remaining)
    const t = setInterval(() => {
      remaining -= 1
      setLeft(remaining)
      if (remaining <= 0) {
        clearInterval(t)
        onUnlocked()
      }
    }, 1000)
    return () => clearInterval(t)
  }, [isPremium, requiredSec, onUnlocked])

  if (isPremium || requiredSec === 0) {
    return (
      <p className="text-sm text-gray-500">
        {isPremium
          ? `${BRAND.name} Pro: sponsor step skipped.`
          : 'Dev: creation sponsor step disabled (VITE_CREATION_AD_SECONDS=0).'}
      </p>
    )
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card/80 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-white">Sponsor message</h2>
        <span className="text-sm font-mono tabular-nums text-chakra" aria-live="polite">
          {left > 0 ? `Continue in ${left}s` : 'Unlocked'}
        </span>
      </div>
      <p className="text-xs text-gray-500">
        Free accounts help keep {BRAND.name} running. You can’t submit your reel until this
        finishes — or upgrade to skip.
      </p>
      <div className="min-h-[260px]">
        <AdSlot slotId="create-gate" shape="square" className="w-full" />
      </div>
    </div>
  )
}
