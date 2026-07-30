import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { notify } from '@/lib/notifications'
import { recordActivity } from '@/lib/activity'
import {
  getFollowPrefs,
  setFollowPrefs,
  clearFollowPrefs,
  DEFAULT_FOLLOW_PREFS,
  type FollowPrefs,
} from '@/lib/followPrefs'

/**
 * Follow control with a granular-notification dropdown.
 *
 * - The main button follows / unfollows (writes the `follows` table).
 * - The caret opens a compact menu of per-creator notification toggles
 *   (tournaments / live / clips / posts), persisted per (follower, target)
 *   via followPrefs (localStorage today; a `follow_prefs` table later).
 * - Following also fires a notification to the target and seeds all-on prefs.
 */
export function FollowControl({
  followerId,
  targetId,
  targetUsername,
  isFollowing,
  onFollowChange,
}: {
  followerId: string
  targetId: string
  targetUsername?: string | null
  isFollowing: boolean
  onFollowChange: (next: boolean) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [prefs, setPrefs] = useState<FollowPrefs>(() => getFollowPrefs(followerId, targetId))
  const wrapRef = useRef<HTMLDivElement>(null)

  // Keep prefs in sync when the target (or follower) changes.
  useEffect(() => {
    setPrefs(getFollowPrefs(followerId, targetId))
  }, [followerId, targetId])

  // Close the menu on any outside click.
  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  async function toggleFollow() {
    if (busy || !followerId || !targetId || followerId === targetId) return
    setBusy(true)
    try {
      if (isFollowing) {
        await supabase.from('follows').delete().eq('follower_id', followerId).eq('following_id', targetId)
        clearFollowPrefs(followerId, targetId)
        setMenuOpen(false)
        onFollowChange(false)
      } else {
        await supabase.from('follows').insert({ follower_id: followerId, following_id: targetId })
        // Seed all-on prefs so the dropdown reflects the default immediately.
        setFollowPrefs(followerId, targetId, { ...DEFAULT_FOLLOW_PREFS })
        setPrefs({ ...DEFAULT_FOLLOW_PREFS })
        // Best-effort: let the creator know they gained a follower.
        void notify({
          userId: targetId,
          kind: 'follow',
          title: 'New follower',
          body: 'Someone started following you.',
          link: `/profile/${followerId}`,
          relatedId: followerId,
        })
        // Feed activity so "you followed X" shows on your Activity tab.
        void recordActivity(followerId, 'follow', targetId, { username: targetUsername })
        onFollowChange(true)
      }
    } finally {
      setBusy(false)
    }
  }

  function togglePref(k: keyof FollowPrefs) {
    const next = { ...prefs, [k]: !prefs[k] }
    setPrefs(next)
    setFollowPrefs(followerId, targetId, next)
  }

  const rows: { key: keyof FollowPrefs; label: string }[] = [
    { key: 'tournaments', label: 'New tournaments' },
    { key: 'live', label: 'Going live' },
    { key: 'clips', label: 'New clips/reels' },
    { key: 'posts', label: 'Posts' },
  ]

  return (
    <div ref={wrapRef} className="relative inline-flex">
      <div className="inline-flex rounded-lg overflow-hidden">
        <button
          type="button"
          onClick={toggleFollow}
          disabled={busy}
          title={
            targetUsername
              ? `${isFollowing ? 'Unfollow' : 'Follow'} @${targetUsername}`
              : undefined
          }
          className={`px-4 py-2 text-sm font-medium disabled:opacity-50 ${
            isFollowing ? 'border border-dark-border text-gray-400' : 'bg-accent text-dark'
          }`}
        >
          {isFollowing ? 'Following' : 'Follow'}
        </button>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-label="Notification preferences"
          aria-expanded={menuOpen}
          className={`px-2 py-2 border-l text-sm ${
            isFollowing
              ? 'border-dark-border border-y border-r text-gray-400 hover:text-accent'
              : 'bg-accent/90 text-dark border-dark/10 hover:bg-accent'
          }`}
        >
          <span aria-hidden>▾</span>
        </button>
      </div>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-2 z-20 w-56 rounded-lg border border-dark-border bg-dark-card p-2 shadow-lg">
          <p className="px-2 py-1 text-[11px] uppercase tracking-wider text-gray-500">
            Notify me about
          </p>
          {!isFollowing && (
            <p className="px-2 pb-1 text-[11px] text-gray-500">
              Follow to receive these updates.
            </p>
          )}
          <div className="space-y-0.5">
            {rows.map(({ key, label }) => (
              <label
                key={key}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-300 ${
                  isFollowing ? 'cursor-pointer hover:bg-dark-border/30' : 'opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={prefs[key]}
                  disabled={!isFollowing}
                  onChange={() => togglePref(key)}
                  className="accent-accent h-4 w-4"
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
