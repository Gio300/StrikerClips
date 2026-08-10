import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { LegalFooter } from '@/components/LegalFooter'
import { requestPasswordReset } from '@/lib/authExtensions'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const result = await requestPasswordReset(email)
    setBusy(false)
    if (result.error) {
      setError('The reset email could not be sent. Check your connection and try again.')
      return
    }
    setSent(true)
  }

  return (
    <div className="min-h-screen flex flex-col animate-fade-in">
      <div className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="text-center mb-6"><BrandLogo as="h1" className="text-3xl block" /></div>
          <div className="rounded-lg border border-dark-border bg-dark-card/80 p-8 shadow-md">
            <h1 className="text-xl font-semibold text-center mb-2">Reset your password</h1>
            {sent ? (
              <div className="space-y-5 text-center">
                <p className="text-sm text-gray-300">If that email belongs to an account, a one-time reset link is on its way.</p>
                <Link to="/login" className="btn-primary inline-flex">Back to sign in</Link>
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <label className="block text-sm text-gray-400">
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="mt-1.5 w-full px-4 py-2.5 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-kunai/60 focus:ring-2 focus:ring-kunai/20"
                    autoComplete="email"
                    required
                  />
                </label>
                <button type="submit" className="btn-primary w-full" disabled={busy}>
                  {busy ? 'Sending...' : 'Send reset link'}
                </button>
                {error && <p role="alert" className="text-sm text-kunai">{error}</p>}
                <p className="text-center text-sm"><Link to="/login" className="text-kunai hover:underline">Back to sign in</Link></p>
              </form>
            )}
          </div>
        </div>
      </div>
      <LegalFooter />
    </div>
  )
}
