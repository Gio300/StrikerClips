import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { Link } from 'react-router-dom'
import UnlockReveal from '@/components/UnlockReveal'

/**
 * Redeem a comp / founder pass. Calls the `redeem-code` edge function, which
 * validates the code server-side and grants a Pro month (see migration 013).
 */
export function Redeem() {
  const { user, refreshUser } = useAuth()
  const { isPremium, tierExpiresAt } = useEntitlements()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [reveal, setReveal] = useState<{ title: string; subtitle: string } | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    const c = code.trim().toUpperCase()
    if (!c) { setMsg({ ok: false, text: 'Enter a code.' }); return }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('redeem-code', { body: { code: c } })
      if (error) throw new Error(error.message)
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error)
      const host = (data as { host?: boolean })?.host === true
      const expires = (data as { expires_at?: string })?.expires_at
      setMsg({
        ok: true,
        text: host
          ? 'Host code accepted! You can now host and run ANY tournament or battle on TKO.'
          : expires
            ? `Redeemed! You're Pro through ${new Date(expires).toLocaleDateString()}. Refresh to see it everywhere.`
            : 'Redeemed! Your Pro month is active.',
      })
      setReveal({
        title: host ? 'HOST UNLOCKED' : 'PRO UNLOCKED',
        subtitle: host
          ? 'You can now host any tournament or battle on TKO.'
          : expires
            ? `Pro through ${new Date(expires).toLocaleDateString()}.`
            : 'Your Pro month is active.',
      })
      setCode('')
      // Pull fresh user metadata so the just-granted tier shows up immediately
      // (and is persisted for the next reload) without a full page refresh.
      await refreshUser()
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : 'Could not redeem that code.' })
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Redeem a pass</h1>
        <p className="text-gray-400 mb-4">Sign in first, then enter your code.</p>
        <Link to="/login" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Sign in</Link>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold">Redeem a pass</h1>
      <p className="text-sm text-gray-500 mt-1">Got a founder / comp code? Drop it in for a free Pro month — no card needed.</p>

      {isPremium && (
        <div className="mt-4 rounded-lg border border-accent/40 bg-accent/10 p-3 text-sm text-accent">
          You're already Pro{tierExpiresAt ? ` through ${new Date(tierExpiresAt).toLocaleDateString()}` : ''}. Codes stack — redeem another to extend.
        </div>
      )}

      <form onSubmit={submit} className="mt-6 space-y-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="TKO-XXXX-XXXX"
          autoCapitalize="characters"
          className="w-full px-4 py-3 rounded-lg bg-dark border border-dark-border text-white tracking-widest uppercase focus:outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {busy ? 'Redeeming…' : 'Redeem'}
        </button>
      </form>

      {msg && (
        <p className={`mt-4 text-sm ${msg.ok ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</p>
      )}

      <UnlockReveal
        open={!!reveal}
        emoji="🏆"
        accent="#00e5ff"
        title={reveal?.title ?? ''}
        subtitle={reveal?.subtitle}
        onClose={() => setReveal(null)}
      />
    </div>
  )
}
