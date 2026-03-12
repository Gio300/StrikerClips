import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

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

  async function handleOAuth(provider: 'google' | 'github') {
    setError('')
    const { error } = await supabase.auth.signInWithOAuth({ provider })
    if (error) setError(error.message)
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 animate-fade-in">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-dark-border bg-dark-card p-8 shadow-glow">
          <h1 className="text-2xl font-bold text-center mb-6">Sign in</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                placeholder="••••••••"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>
          <div className="mt-4 flex gap-4">
            <button
              type="button"
              onClick={() => handleOAuth('google')}
              className="flex-1 py-2 rounded-lg border border-dark-border hover:border-accent/50 text-gray-300 hover:text-accent transition-colors"
            >
              Google
            </button>
            <button
              type="button"
              onClick={() => handleOAuth('github')}
              className="flex-1 py-2 rounded-lg border border-dark-border hover:border-accent/50 text-gray-300 hover:text-accent transition-colors"
            >
              GitHub
            </button>
          </div>
          <p className="mt-6 text-center text-sm text-gray-400">
            Don't have an account?{' '}
            <Link to="/signup" className="text-accent hover:underline">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
