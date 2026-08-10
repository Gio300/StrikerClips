import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { BrandLogo } from '@/components/BrandLogo'
import { LegalFooter } from '@/components/LegalFooter'
import { Capacitor } from '@capacitor/core'
import { Browser as CapacitorBrowser } from '@capacitor/browser'
import { LogIn } from 'lucide-react'
import { sessionBridgeUrl } from '@/lib/authExtensions'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { league } = useLeagueTheme()
  const brandName = league?.name || 'TKO'

  // Where the auth wall sent us from, and why (see AuthGuard). We return the
  // user to `from` after signing in, and show `reason` above the form.
  const wall = (location.state as { from?: string; reason?: string } | null) ?? null
  const from = wall?.from
  const reason = wall?.reason
  const bridgeUrl = typeof window !== 'undefined' ? sessionBridgeUrl(from || '/') : null

  async function continueWithTko() {
    if (!bridgeUrl) return
    if (Capacitor.isNativePlatform()) await CapacitorBrowser.open({ url: bridgeUrl })
    else window.location.assign(bridgeUrl)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    navigate(from || '/', { replace: true })
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-kunai/60 focus:ring-2 focus:ring-kunai/20 transition-shadow'

  return (
    // A column, so the legal footer sits at the BOTTOM of the surface rather
    // than under the card: on a league's own domain this page IS the signed-out
    // root (signedOutLandingPath), and the compliance screenshot has to show
    // the links plainly. See src/components/LegalFooter.tsx.
    <div className="min-h-screen flex flex-col animate-fade-in">
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <BrandLogo as="h1" className="text-3xl block" />
          </div>
          <div className="rounded-lg border border-dark-border bg-dark-card/80 backdrop-blur p-8 shadow-md">
            <h1 className="text-xl font-semibold text-center mb-6">Welcome back</h1>
            {reason && (
              <div className="mb-5 rounded-lg border border-kunai/40 bg-kunai/10 px-4 py-3 text-center text-sm text-white">
                {reason}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" required />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">Password</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" required />
                <div className="mt-2 text-right">
                  <Link to="/forgot-password" className="text-xs text-kunai hover:underline">Forgot password?</Link>
                </div>
              </div>
              {error && <p className="text-kunai text-sm">{error}</p>}
              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>

            {bridgeUrl && (
              <div className="mt-5 border-t border-dark-border pt-5">
                <button type="button" onClick={continueWithTko} className="btn-secondary w-full inline-flex items-center justify-center gap-2">
                  <LogIn size={18} aria-hidden="true" />
                  Continue with {brandName} account
                </button>
              </div>
            )}

            <p className="mt-6 text-center text-sm text-gray-400">
              Don't have an account?{' '}
              <Link to="/signup" state={wall ?? undefined} className="text-kunai hover:underline font-medium">Sign up</Link>
            </p>
          </div>
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
