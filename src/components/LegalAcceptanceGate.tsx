import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { callFn } from '@/lib/backend'
import { supabase } from '@/lib/supabase'
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legalVersions'

type LegalMetadata = {
  terms_accepted?: boolean
  terms_version?: string
  terms_accepted_at?: string
  privacy_accepted?: boolean
  privacy_version?: string
}

export function hasCurrentLegalAcceptance(metadata: LegalMetadata | null | undefined): boolean {
  return metadata?.terms_accepted === true
    && metadata?.privacy_accepted === true
    && metadata?.terms_version === TERMS_VERSION
    && metadata?.privacy_version === PRIVACY_VERSION
    && !Number.isNaN(new Date(String(metadata?.terms_accepted_at || '')).getTime())
}

export function LegalAcceptanceGate() {
  const { user, loading, refreshUser } = useAuth()
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState('')

  if (loading || !user || accepted || hasCurrentLegalAcceptance(user.user_metadata as LegalMetadata)) return null

  const accept = async () => {
    if (!checked || saving) return
    setSaving(true)
    setError('')
    const result = await callFn<{ ok: boolean; error?: string }>('accept-current-legal', {
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
    })
    if (!result?.ok) {
      setError(result?.error || 'The agreement could not be recorded. Try again.')
      setSaving(false)
      return
    }
    // The server write is authoritative. Unblock the member immediately, then
    // refresh in the background so the accepted versions survive navigation
    // and reload without making the modal wait on a second request.
    setAccepted(true)
    setSaving(false)
    void refreshUser()
  }

  return (
    <div
      className="fixed inset-0 z-[10020] grid place-items-center bg-black/90 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-gate-title"
    >
      <section className="w-full max-w-md border border-white/15 bg-[#111214] p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center bg-kunai/15 text-kunai">
            <ShieldCheck aria-hidden="true" size={22} />
          </span>
          <div>
            <h2 id="legal-gate-title" className="text-lg font-semibold text-white">Before you continue</h2>
            <p className="text-sm text-gray-400">Review and accept the current member agreement.</p>
          </div>
        </div>

        <label className="flex cursor-pointer items-start gap-3 border-y border-white/10 py-4 text-sm leading-6 text-gray-200">
          <input
            type="checkbox"
            checked={checked}
            onChange={(event) => setChecked(event.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 accent-kunai"
          />
          <span>
            I agree to the <Link className="text-kunai underline" to="/terms" target="_blank">Terms of Service</Link>
            {' '}and <Link className="text-kunai underline" to="/privacy" target="_blank">Privacy Policy</Link>.
          </span>
        </label>

        {error && <p className="mt-3 text-sm text-red-300" role="alert">{error}</p>}

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            className="text-sm text-gray-400 hover:text-white"
            onClick={() => void supabase.auth.signOut()}
          >
            Sign out
          </button>
          <button
            type="button"
            disabled={!checked || saving}
            onClick={() => void accept()}
            className="min-h-11 bg-kunai px-5 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Recording...' : 'Accept and continue'}
          </button>
        </div>
      </section>
    </div>
  )
}
