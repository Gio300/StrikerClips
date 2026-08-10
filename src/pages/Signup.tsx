import { useState } from 'react'
import { Eye, EyeOff, MailCheck } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { LegalLinks } from '@/components/LegalFooter'
import { supabase } from '@/lib/supabase'
import { PRIVACY_VERSION, TERMS_VERSION } from '@/lib/legalVersions'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'

function safeReturnTo(value: string | undefined): string {
  return value?.startsWith('/') && !value.startsWith('//') && !value.startsWith('/setup') ? value : '/'
}

export function Signup() {
  const { display } = useLeagueTheme()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [ageConsent, setAgeConsent] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const wall = (location.state as { from?: string; reason?: string } | null) ?? null
  const returnTo = safeReturnTo(wall?.from)
  const inputCls = 'w-full rounded-lg border border-dark-border bg-dark px-4 py-3 text-white placeholder-gray-500 outline-none transition-shadow focus:border-kunai/60 focus:ring-2 focus:ring-kunai/20'

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (loading) return
    setError('')
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    if (password.length < 6) {
      setError('Use a password with at least 6 characters.')
      return
    }
    if (confirmPassword !== password) {
      setError('Passwords do not match.')
      return
    }
    if (!ageConsent) {
      setError('Confirm that you are 13 or older.')
      return
    }
    if (!termsAccepted) {
      setError('Agree to the Terms of Service and Privacy Policy to create your account.')
      return
    }

    setLoading(true)
    const acceptedAt = new Date().toISOString()
    const { data, error: signupError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          terms_accepted: true,
          terms_version: TERMS_VERSION,
          terms_accepted_at: acceptedAt,
          privacy_accepted: true,
          privacy_version: PRIVACY_VERSION,
          age_consent_13_plus: true,
          age_verified_13_plus: true,
          age_attested_at: acceptedAt,
        },
      },
    })
    if (signupError) {
      setLoading(false)
      setError(signupError.message)
      return
    }

    const { data: current } = await supabase.auth.getSession()
    setLoading(false)
    if (data?.session || current?.session) {
      const query = returnTo === '/' ? '' : `?returnTo=${encodeURIComponent(returnTo)}`
      navigate(`/setup${query}`, { replace: true, state: { returnTo } })
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6">
        <div className="w-full max-w-md rounded-lg border border-dark-border bg-dark-card p-8 text-center">
          <MailCheck className="mx-auto h-10 w-10 text-kunai" aria-hidden />
          <h1 className="mt-4 text-xl font-semibold">Check your email</h1>
          <p className="mt-2 text-sm text-gray-400">
            We sent a confirmation link to <strong className="text-white">{email}</strong>.
          </p>
          <Link
            to="/login"
            state={{ from: '/setup', reason: 'Sign in to finish your quick setup' }}
            className="mt-6 inline-block font-medium text-kunai hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <BrandLogo as="h1" className="mb-6 block text-center text-3xl" />
        <div className="rounded-xl border border-dark-border bg-dark-card p-6 shadow-md sm:p-8">
          <div className="mb-5">
            <h2 className="text-xl font-semibold text-white">Create your account</h2>
            <p className="mt-1 text-sm text-gray-400">Just the essentials. {display.assistantName} handles the rest with you.</p>
          </div>

          {wall?.reason && (
            <div className="mb-4 rounded-lg border border-kunai/40 bg-kunai/10 px-4 py-3 text-center text-sm text-white">
              {wall.reason}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm text-gray-400">Email</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className={inputCls}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm text-gray-400">Password</span>
              <span className="relative block">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={`${inputCls} pr-12`}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((shown) => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-gray-500 hover:text-gray-200"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
                </button>
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm text-gray-400">Confirm password</span>
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={inputCls}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </label>

            <div className="space-y-3 pt-1">
              <label className="flex cursor-pointer items-start gap-3 text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={ageConsent}
                  onChange={(event) => setAgeConsent(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-kunai"
                  required
                />
                <span>I am 13 or older.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-5 text-gray-300">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(event) => setTermsAccepted(event.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-kunai"
                  required
                />
                <span>
                  I agree to the <Link to="/terms" className="text-kunai hover:underline">Terms of Service</Link> and{' '}
                  <Link to="/privacy" className="text-kunai hover:underline">Privacy Policy</Link>.
                </span>
              </label>
            </div>

            <button
              type="submit"
              disabled={loading || !ageConsent || !termsAccepted}
              className="btn-primary w-full"
            >
              {loading ? 'Creating...' : 'Create account'}
            </button>
            {error && <p role="alert" className="text-sm text-kunai">{error}</p>}
            <LegalLinks className="pt-1" />
          </form>

          <p className="mt-6 text-center text-xs text-gray-500">
            Already have an account?{' '}
            <Link to="/login" state={wall ?? undefined} className="font-medium text-gray-300 hover:text-white hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}

export const signupTestables = { safeReturnTo }
