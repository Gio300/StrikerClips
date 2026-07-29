import { useEffect, useState } from 'react'
import {
  blockUser,
  loadMyBlockOf,
  setBlockScope,
  unblockUser,
  unfollowUser,
} from '@/lib/blockingService'
import {
  BLOCK_CLIP_WARNING,
  BLOCK_SCOPE_COPY,
  UNFOLLOW_FIRST_BODY,
  UNFOLLOW_FIRST_TITLE,
  type BlockFact,
} from '@/lib/blocking'

/**
 * Block / unfollow, in that order of emphasis — deliberately.
 *
 * Most people who open this menu want the other person's posts to stop, and
 * UNFOLLOW does that at no cost. Block is the heavy option: it removes the pair
 * from each other's multi-angle clips, INCLUDING clips of matches the blocker
 * won, and that's exactly the sort of thing people only discover months later
 * and feel cheated by. So it's stated in plain words before the confirm, not
 * after.
 *
 * If they do block, they choose how far it reaches: never auto-linked (the
 * default, so tournaments still work), or never in the same live at all.
 */
export function BlockControl({
  userId,
  targetId,
  targetUsername,
  isFollowing,
  onUnfollowed,
  onBlockChange,
}: {
  userId: string
  targetId: string
  targetUsername?: string | null
  isFollowing?: boolean
  onUnfollowed?: () => void
  onBlockChange?: (blocked: boolean) => void
}) {
  const [step, setStep] = useState<'closed' | 'choose' | 'confirm'>('closed')
  const [existing, setExisting] = useState<BlockFact | null>(null)
  const [hide, setHide] = useState(false)
  const [busy, setBusy] = useState(false)
  const who = targetUsername ? `@${targetUsername}` : 'this person'

  useEffect(() => {
    let cancelled = false
    loadMyBlockOf(userId, targetId).then((b) => {
      if (cancelled) return
      setExisting(b)
      setHide(b?.hideInSharedLives ?? false)
    })
    return () => {
      cancelled = true
    }
  }, [userId, targetId])

  if (!userId || !targetId || userId === targetId) return null

  async function doUnfollow() {
    setBusy(true)
    try {
      await unfollowUser(userId, targetId)
      onUnfollowed?.()
      setStep('closed')
    } finally {
      setBusy(false)
    }
  }

  async function doBlock() {
    setBusy(true)
    try {
      const ok = await blockUser({ blockerId: userId, blockedId: targetId, hideInSharedLives: hide })
      if (ok) {
        setExisting({ blockerId: userId, blockedId: targetId, hideInSharedLives: hide })
        onBlockChange?.(true)
        onUnfollowed?.()
      }
      setStep('closed')
    } finally {
      setBusy(false)
    }
  }

  async function doUnblock() {
    setBusy(true)
    try {
      const ok = await unblockUser(userId, targetId)
      if (ok) {
        setExisting(null)
        onBlockChange?.(false)
      }
      setStep('closed')
    } finally {
      setBusy(false)
    }
  }

  async function toggleScope(next: boolean) {
    setHide(next)
    await setBlockScope(userId, targetId, next)
    setExisting((b) => (b ? { ...b, hideInSharedLives: next } : b))
  }

  // ── Already blocked: show what it's doing + how to undo it ────────────────
  if (existing) {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-card p-3 max-w-sm">
        <p className="text-sm text-white">You blocked {who}.</p>
        <label className="flex items-start gap-2 mt-2 cursor-pointer">
          <input
            type="checkbox"
            checked={hide}
            onChange={(e) => toggleScope(e.target.checked)}
            className="accent-accent h-4 w-4 mt-0.5 shrink-0"
          />
          <span>
            <span className="block text-xs text-gray-300">{BLOCK_SCOPE_COPY.hide.label}</span>
            <span className="block text-[11px] text-gray-500">{BLOCK_SCOPE_COPY.hide.help}</span>
          </span>
        </label>
        <p className="text-[11px] text-gray-500 mt-2">{BLOCK_CLIP_WARNING}</p>
        <button
          type="button"
          onClick={doUnblock}
          disabled={busy}
          className="mt-3 text-sm text-accent hover:underline disabled:opacity-50"
        >
          {busy ? 'Working…' : 'Unblock'}
        </button>
      </div>
    )
  }

  if (step === 'closed') {
    return (
      <button
        type="button"
        onClick={() => setStep('choose')}
        className="px-3 py-2 rounded-lg border border-dark-border text-sm text-gray-400 hover:text-red-400 hover:border-red-400/40"
      >
        Block
      </button>
    )
  }

  // ── Step 1: the softer option FIRST ───────────────────────────────────────
  if (step === 'choose') {
    return (
      <div className="rounded-lg border border-dark-border bg-dark-card p-4 max-w-sm">
        <p className="font-semibold text-white text-sm">{UNFOLLOW_FIRST_TITLE}</p>
        <p className="text-xs text-gray-400 mt-1">{UNFOLLOW_FIRST_BODY}</p>
        <div className="mt-3 flex flex-col gap-2">
          <button
            type="button"
            onClick={doUnfollow}
            disabled={busy || isFollowing === false}
            className="px-3 py-2 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-40"
          >
            {isFollowing === false ? `You don't follow ${who}` : `Unfollow ${who}`}
          </button>
          <button
            type="button"
            onClick={() => setStep('confirm')}
            className="px-3 py-2 rounded-lg border border-dark-border text-sm text-gray-400 hover:text-red-400 hover:border-red-400/40"
          >
            No, block them
          </button>
          <button
            type="button"
            onClick={() => setStep('closed')}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // ── Step 2: the honest warning + an explicit confirm ──────────────────────
  return (
    <div className="rounded-lg border border-red-400/40 bg-red-400/5 p-4 max-w-sm">
      <p className="font-semibold text-white text-sm">Block {who}?</p>
      <p className="text-xs text-gray-300 mt-2">{BLOCK_CLIP_WARNING}</p>

      <fieldset className="mt-3 space-y-2">
        <legend className="text-[11px] uppercase tracking-wider text-gray-500">
          Shared live streams
        </legend>
        {([false, true] as const).map((v) => {
          const copy = v ? BLOCK_SCOPE_COPY.hide : BLOCK_SCOPE_COPY.coappear
          return (
            <label key={String(v)} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="block-scope"
                checked={hide === v}
                onChange={() => setHide(v)}
                className="accent-accent h-4 w-4 mt-0.5 shrink-0"
              />
              <span>
                <span className="block text-xs text-gray-200">{copy.label}</span>
                <span className="block text-[11px] text-gray-500">{copy.help}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={doBlock}
          disabled={busy}
          className="px-3 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold disabled:opacity-50"
        >
          {busy ? 'Blocking…' : 'Yes, block them'}
        </button>
        <button
          type="button"
          onClick={() => setStep('choose')}
          className="px-3 py-2 rounded-lg border border-dark-border text-sm text-gray-400"
        >
          Back
        </button>
      </div>
    </div>
  )
}
