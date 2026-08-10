import { Pause, Play, Zap } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAutoMerge } from '@/hooks/useAutoMerge'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

/**
 * AUTO-MERGE status and future-use consent for the signed-in player.
 */
export function AutoMergeStatus({ className }: { className?: string }) {
  const {
    enabled,
    youtubeConnected,
    hasPaid,
    loading,
    optedOut,
    saving,
    setOptedOut,
  } = useAutoMerge()

  if (loading) return null

  if (enabled) {
    return (
      <div
        className={`flex items-center gap-3 rounded-lg border border-leaf/40 bg-leaf/10 px-4 py-3 text-sm text-leaf ${className ?? ''}`}
      >
        <Zap size={17} aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Auto-merge: on.</span>{' '}
          New recorded games can be synchronized with other players' cameras.
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void setOptedOut(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-leaf/40 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/5 disabled:opacity-50"
        >
          <Pause size={14} aria-hidden="true" />
          Pause
        </button>
      </div>
    )
  }

  if (optedOut && youtubeConnected && hasPaid) {
    return (
      <div
        className={`flex items-center gap-3 rounded-lg border border-dark-border bg-dark-card px-4 py-3 text-sm text-gray-300 ${className ?? ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-white">Future auto-merge: paused.</div>
          <p className="mt-1 text-xs text-gray-400">
            New recorded games will not use your camera. Active live broadcasts cannot be changed.
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void setOptedOut(false)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-dark disabled:opacity-50"
        >
          <Play size={14} aria-hidden="true" />
          Turn on
        </button>
      </div>
    )
  }

  const needs: { label: string; to: string }[] = []
  if (!youtubeConnected) needs.push({ label: 'Connect YouTube', to: '/connect' })
  if (!hasPaid && !IS_MOBILE_STORE_BUILD) needs.push({ label: 'Go Pro', to: '/upgrade' })

  return (
    <div
      className={`rounded-lg border border-dark-border bg-dark-card px-4 py-3 text-sm text-gray-300 ${className ?? ''}`}
    >
      <div className="font-semibold text-white">Auto-merge: locked.</div>
      <p className="mt-1 text-xs text-gray-400">
        {IS_MOBILE_STORE_BUILD
          ? 'Connect YouTube to finish setup. Automatic merging also requires eligible account access.'
          : 'Connect YouTube and subscribe to synchronize recorded games across players.'}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {needs.map((need) => (
          <Link
            key={need.to}
            to={need.to}
            className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-dark"
          >
            {need.label}
          </Link>
        ))}
      </div>
    </div>
  )
}

export default AutoMergeStatus
