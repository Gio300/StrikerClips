import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { BrandLogo } from '@/components/BrandLogo'
import { AvailabilityHint } from '@/components/ui'
import { useIdentityAvailability } from '@/hooks/useIdentityAvailability'
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legalVersions'

export function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  // 13+ age gate. A single self-attested consent checkbox: the server no longer
  // requires a date of birth (see server/app.ts /auth/signup) and instead accepts
  // the `age_consent_13_plus` flag sent below.
  const [ageConsent, setAgeConsent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  // Carried through from the auth wall (see AuthGuard) when the user was pushed
  // here via Login. On instant/local backends we drop them back at `from`.
  const wall = (location.state as { from?: string; reason?: string } | null) ?? null
  const from = wall?.from
  const reason = wall?.reason

  // Usernames are unique platform-wide (case-insensitively). Check as they type
  // so nobody gets to the confirm-email step only to be silently renamed by the
  // `handle_new_user` trigger's collision fallback.
  // `required: false` keeps the field optional exactly as before — leaving it
  // blank still lets the server derive a handle from the email. It only blocks
  // once you've typed something that's malformed or already claimed.
  const usernameCheck = useIdentityAvailability('username', username, { required: false })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (usernameCheck.blocked) {
      setError(usernameCheck.message || 'Pick an available username.')
      return
    }
    if (!ageConsent) {
      setError('Please confirm you are 13 or older to create an account.')
      return
    }
    if (!termsAccepted) {
      setError('Please agree to the Terms of Service and Privacy Policy to create an account.')
      return
    }
    if (confirmPassword && confirmPassword !== password) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: usernameCheck.value || undefined,
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
          privacy_accepted: true,
          privacy_version: PRIVACY_VERSION,
          // 13+ self-attestation. The server accepts this consent flag in place
          // of a date of birth (see server/app.ts /auth/signup).
          age_consent_13_plus: true,
          age_verified_13_plus: true,
          age_attested_at: new Date().toISOString(),
        },
      },
    })
    if (error) {
      setLoading(false)
      setError(error.message)
      return
    }
    // If a session already exists (local/instant backends), skip the
    // "check your email" step and drop the new user straight into the app.
    const { data: sess } = await supabase.auth.getSession()
    setLoading(false)
    if (sess?.session) {
      navigate(from || '/', { replace: true })
      return
    }
    setSent(true)
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-kunai/60 focus:ring-2 focus:ring-kunai/20 transition-shadow'

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 animate-fade-in">
        <div className="max-w-md text-center rounded-2xl border border-dark-border bg-dark-card/80 backdrop-blur p-10">
          <div className="w-14 h-14 rounded-full bg-gradient-kunai flex items-center justify-center mx-auto mb-4 shadow-kunai">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M3 8l9 6 9-6m-18 0v10a2 2 0 002 2h14a2 2 0 002-2V8m-18 0V6a2 2 0 012-2h14a2 2 0 012 2v2" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Check your email</h1>
          <p className="text-gray-400 mb-6">
            We've sent a confirmation link to <strong className="text-white">{email}</strong>
          </p>
          <Link to="/login" className="text-kunai hover:underline font-medium">Back to sign in →</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10 animate-fade-in">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <BrandLogo as="h1" className="text-3xl block" />
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card/80 backdrop-blur p-8 shadow-md">
          <h1 className="text-xl font-semibold text-center mb-6">Create your account</h1>
          {reason && (
            <div className="mb-5 rounded-lg border border-kunai/40 bg-kunai/10 px-4 py-3 text-center text-sm text-white">
              {reason}
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} placeholder="striker_fan" autoComplete="username" />
              <AvailabilityHint
                state={usernameCheck}
                onPick={setUsername}
                hint="3–20 characters — letters, numbers and underscores. Yours alone."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" required />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" required minLength={6} />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Confirm password <span className="text-gray-600">(optional)</span></label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} className={inputCls} placeholder="••••••••" minLength={6} />
              {confirmPassword && confirmPassword !== password && (
                <p className="text-kunai text-xs mt-1">Passwords do not match.</p>
              )}
            </div>
            {error && <p className="text-kunai text-sm">{error}</p>}
            <label className="flex items-start gap-2 cursor-pointer text-sm text-gray-400">
              <input
                type="checkbox"
                checked={ageConsent}
                onChange={(e) => setAgeConsent(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-kunai shrink-0"
                required
                aria-required="true"
              />
              <span>I'm 13 or older.</span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer text-sm text-gray-400">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-kunai shrink-0"
                required
                aria-required="true"
              />
              <span>
                I agree to the{' '}
                <Link to="/terms" className="text-kunai hover:underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link to="/privacy" className="text-kunai hover:underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
            <button type="submit" disabled={loading || !termsAccepted || !ageConsent || usernameCheck.blocked} className="btn-primary w-full">
              {loading ? 'Creating…' : 'Create account'}
            </button>
            {(!termsAccepted || !ageConsent) && (
              <p className="text-xs text-gray-500 text-center -mt-2">
                Confirm you're 13+ and agree to the Terms and Privacy Policy above to enable Create account.
              </p>
            )}

            <div className="flex flex-wrap justify-center gap-4 pt-1 text-xs text-gray-500">
              <Link to="/terms" className="hover:text-gray-300">Terms</Link>
              <Link to="/privacy" className="hover:text-gray-300">Privacy</Link>
              <Link to="/data-deletion" className="hover:text-gray-300">Data Deletion</Link>
            </div>
          </form>

          <p className="mt-6 text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link to="/login" state={wall ?? undefined} className="text-kunai hover:underline font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
