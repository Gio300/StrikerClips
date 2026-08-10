import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { LegalFooter } from '@/components/LegalFooter'
import { resetPassword } from '@/lib/authExtensions'

export function ResetPassword() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const token = params.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setBusy(true)
    setError('')
    const result = await resetPassword(token, password)
    setBusy(false)
    if (result.error) return setError('That reset link is expired or already used.')
    navigate('/', { replace: true })
  }

  const inputClass = 'mt-1.5 w-full px-4 py-2.5 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-kunai/60 focus:ring-2 focus:ring-kunai/20'
  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6"><BrandLogo as="h1" className="text-3xl block" /></div>
          <div className="rounded-lg border border-dark-border bg-dark-card/80 p-8 shadow-md">
            <h1 className="text-xl font-semibold text-center mb-5">Choose a new password</h1>
            {!token ? (
              <div className="space-y-4 text-center text-sm">
                <p className="text-gray-300">This reset link is incomplete.</p>
                <Link to="/forgot-password" className="text-kunai hover:underline">Request another link</Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <label className="block text-sm text-gray-400">New password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} autoComplete="new-password" required />
                </label>
                <label className="block text-sm text-gray-400">Confirm password
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} autoComplete="new-password" required />
                </label>
                {error && <p role="alert" className="text-kunai text-sm">{error}</p>}
                <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Updating...' : 'Update password'}</button>
              </form>
            )}
          </div>
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
