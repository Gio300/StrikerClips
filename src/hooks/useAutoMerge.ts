import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { autoMergeEnabled, hasContentTier } from '@/lib/entitlements'
import { isYouTubeLinked } from '@/lib/youtubeLink'
import { supabase } from '@/lib/supabase'

export interface AutoMergeState {
  /** Both conditions met — the user's clips may enter the cross-user merge. */
  enabled: boolean
  /** (a) YouTube connected: a valid persisted or cached channel identity. */
  youtubeConnected: boolean
  /** (b) An active paid CONTENT tier (pro/supporter/creator). The ad-only
   *  ad_free tier and free do NOT satisfy the auto-merge requirement. */
  hasPaid: boolean
  /** Still resolving the YouTube-connected signal. */
  loading: boolean
  /** Future recorded clips stay out of cross-player matching when true. */
  optedOut: boolean
  saving: boolean
  setOptedOut: (value: boolean) => Promise<boolean>
}

/**
 * Resolve the AUTO-MERGE unlock for the signed-in user: their clips get
 * auto-matched + merged with OTHER users' angles only when they've BOTH
 * connected YouTube AND hold a paid tier (see `autoMergeEnabled` in
 * lib/entitlements).
 *
 * "YouTube connected" is true only for a valid channel identity. A saved video
 * or local clip library alone does not satisfy the account-channel requirement.
 */
export function useAutoMerge(): AutoMergeState {
  const { user } = useAuth()
  const ent = useEntitlements()
  const hasPaid = hasContentTier(ent)
  const [youtubeConnected, setYoutubeConnected] = useState(false)
  const [loading, setLoading] = useState(true)
  const [optedOut, setOptedOutState] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!user) {
      setYoutubeConnected(false)
      setOptedOutState(false)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    ;(async () => {
      try {
        const [youtube, profile] = await Promise.all([
          isYouTubeLinked(user.id),
          supabase.from('profiles').select('auto_merge_opt_out').eq('id', user.id).maybeSingle(),
        ])
        if (alive) {
          setYoutubeConnected(youtube)
          setOptedOutState(profile.data?.auto_merge_opt_out === true)
        }
      } catch {
        if (alive) setYoutubeConnected(false)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [user?.id])

  const setOptedOut = async (value: boolean): Promise<boolean> => {
    if (!user || saving) return false
    setSaving(true)
    const previous = optedOut
    setOptedOutState(value)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ auto_merge_opt_out: value })
        .eq('id', user.id)
      if (error) throw error
      return true
    } catch {
      setOptedOutState(previous)
      return false
    } finally {
      setSaving(false)
    }
  }

  return {
    enabled: !optedOut && autoMergeEnabled({ youtubeConnected, entitlements: ent }),
    youtubeConnected,
    hasPaid,
    loading,
    optedOut,
    saving,
    setOptedOut,
  }
}
