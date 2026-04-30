import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { BrandLogo } from '@/components/BrandLogo'
import { BRAND } from '@/lib/brand'

export function Signup() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!termsAccepted) {
      setError(`Accept the ${BRAND.name} terms to create an account.`)
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          username: username || undefined,
          terms_v1: true,
          terms_accepted_at: new Date().toISOString(),
        },
      },
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
  }

  async function handleOAuth(provider: 'google' | 'github' | 'facebook') {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({ provider })
    if (error) setError(error.message)
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
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Username</label>
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} placeholder="striker_fan" />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" required />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" required minLength={6} />
            </div>
            {error && <p className="text-kunai text-sm">{error}</p>}
            <label className="flex items-start gap-2 cursor-pointer text-sm text-gray-400">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-kunai shrink-0"
              />
              <span>
                I agree to the content &amp; monetization terms for {BRAND.name} (hosting, multi-angle use, and public
                sharing when you use the product as intended). See the{' '}
                <Link to="/terms" className="text-kunai hover:underline">
                  summary
                </Link>
                . Not legal advice — you’ll add real counsel at launch.
              </span>
            </label>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Creating…' : 'Create account'}
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="flex-1 h-px bg-dark-border" />
            <span className="text-xs text-gray-500 uppercase tracking-wider">or continue with</span>
            <div className="flex-1 h-px bg-dark-border" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <OAuthBtn label="Google" onClick={() => handleOAuth('google')} />
            <OAuthBtn label="Facebook" onClick={() => handleOAuth('facebook')} brand="facebook" />
            <OAuthBtn label="GitHub" onClick={() => handleOAuth('github')} />
          </div>

          <p className="mt-6 text-center text-sm text-gray-400">
            Already have an account?{' '}
            <Link to="/login" className="text-kunai hover:underline font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}

function OAuthBtn({ label, onClick, brand }: { label: string; onClick: () => void; brand?: 'facebook' }) {
  const hover = brand === 'facebook'
    ? 'hover:border-[#1877F2]/60 hover:text-[#1877F2]'
    : 'hover:border-kunai/50 hover:text-white'
  return (
    <button
      type="button"
      onClick={onClick}
      className={`py-2 rounded-lg border border-dark-border bg-dark-card text-gray-300 ${hover} transition-colors text-sm font-medium`}
    >
      {label}
    </button>
  )
}
