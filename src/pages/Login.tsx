import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { BrandLogo } from '@/components/BrandLogo'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

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
    navigate('/')
  }

  async function handleOAuth(provider: 'google' | 'github' | 'facebook') {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({ provider })
    if (error) setError(error.message)
  }

  const inputCls = 'w-full px-4 py-2.5 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-kunai/60 focus:ring-2 focus:ring-kunai/20 transition-shadow'

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10 animate-fade-in">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <BrandLogo as="h1" className="text-3xl block" />
        </div>
        <div className="rounded-2xl border border-dark-border bg-dark-card/80 backdrop-blur p-8 shadow-md">
          <h1 className="text-xl font-semibold text-center mb-6">Welcome back</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="you@example.com" required />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1.5">Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="••••••••" required />
            </div>
            {error && <p className="text-kunai text-sm">{error}</p>}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? 'Signing in…' : 'Sign in'}
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
            Don't have an account?{' '}
            <Link to="/signup" className="text-kunai hover:underline font-medium">Sign up</Link>
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
