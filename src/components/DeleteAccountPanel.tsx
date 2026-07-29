import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { BRAND } from '@/lib/brand'
import { supabase } from '@/lib/supabase'
import { deleteAccount, isDeleteConfirmed, DELETE_CONFIRM_WORD, type AccountClient } from '@/lib/account'

/**
 * "Delete my account" — the in-app deletion flow required by Google Play and
 * Apple 5.1.1(v).
 *
 * Three deliberate steps, because this is irreversible:
 *   1. a plainly-labelled button that does nothing but open the confirmation;
 *   2. a confirmation that states in plain words what is destroyed and that it
 *      cannot be undone, and makes the user TYPE the word DELETE;
 *   3. the call, then an immediate sign-out and a return home.
 *
 * Rendered on both /profile (where a user looks for it) and /data-deletion
 * (the publicly linkable URL Play requires in the listing).
 */
export function DeleteAccountPanel({ className = '' }: { className?: string }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirmed = isDeleteConfirmed(typed)

  async function handleDelete() {
    if (!confirmed || busy) return
    setBusy(true)
    setError('')
    // The shim's loose `any` surface vs. the narrow slice we actually use.
    const result = await deleteAccount(supabase as unknown as AccountClient)
    if (!result.ok) {
      setBusy(false)
      setError(result.error)
      return
    }
    // The session is already torn down by deleteAccount(). Leave for a neutral
    // page rather than a route that will immediately bounce off the auth wall.
    navigate('/', { replace: true })
  }

  if (!user) {
    return (
      <div className={`rounded-xl border border-dark-border bg-dark-card p-5 ${className}`}>
        <h2 className="text-base font-semibold text-white">Delete your account</h2>
        <p className="text-sm text-gray-400 mt-2">
          <Link to="/login" className="text-kunai hover:underline">Sign in</Link> to delete your{' '}
          {BRAND.name} account from here. If you can no longer access the account, use the email
          method described below instead.
        </p>
      </div>
    )
  }

  return (
    <div className={`rounded-xl border border-red-900/50 bg-red-950/20 p-5 ${className}`}>
      <h2 className="text-base font-semibold text-white">Delete your account</h2>
      <p className="text-sm text-gray-400 mt-1">
        Permanently deletes your {BRAND.name} account and the data tied to it.
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => { setOpen(true); setError('') }}
          className="mt-4 px-4 py-2 rounded-lg border border-red-500/60 text-red-300 hover:bg-red-500/10 text-sm font-semibold"
        >
          Delete my account
        </button>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-lg border border-red-500/40 bg-dark/60 p-4 text-sm text-gray-300 space-y-2">
            <p className="text-white font-semibold">This is permanent and cannot be undone.</p>
            <p>Deleting your account immediately removes:</p>
            <ul className="list-disc list-inside space-y-1 text-gray-400">
              <li>Your login, email and password.</li>
              <li>Your profile, username and clan tag — both are released for anyone else to claim.</li>
              <li>Your clips, reels, posts, comments, chat messages and follows.</li>
              <li>Your tournament registrations, battle records and trophies.</li>
              <li>Any Tokens, cosmetic assets and badges, which are forfeited and have no cash value.</li>
            </ul>
            <p className="text-gray-400">
              If you lead a clan, leadership passes to your longest-serving officer (or member). A clan
              with no other members is disbanded.
            </p>
            <p className="text-gray-500 text-xs">
              A small amount of data may be retained where the law requires it — see the{' '}
              <Link to="/data-deletion" className="text-kunai hover:underline">deletion policy</Link>.
            </p>
          </div>

          <label className="block text-sm text-gray-400">
            Type <span className="text-white font-mono font-semibold">{DELETE_CONFIRM_WORD}</span> to confirm:
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-label={`Type ${DELETE_CONFIRM_WORD} to confirm account deletion`}
              className="mt-1.5 w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white font-mono tracking-widest focus:outline-none focus:border-red-500/60"
              placeholder={DELETE_CONFIRM_WORD}
            />
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={!confirmed || busy}
              className="px-4 py-2 rounded-lg bg-red-600 text-white font-semibold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? 'Deleting…' : 'Permanently delete my account'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setTyped(''); setError('') }}
              disabled={busy}
              className="px-4 py-2 rounded-lg border border-dark-border text-gray-400 text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
