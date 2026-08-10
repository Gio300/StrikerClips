import { useEffect, useState } from 'react'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { BrandLogo } from '@/components/BrandLogo'
import { useAuth } from '@/hooks/useAuth'
import { createSessionTransfer } from '@/lib/authExtensions'

export function SessionBridge() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [params] = useSearchParams()
  const [error, setError] = useState('')
  const target = params.get('target') || ''
  const path = params.get('path') || '/'

  useEffect(() => {
    if (!user || !target) return
    let active = true
    createSessionTransfer(target, path).then(({ data, error: transferError }) => {
      if (!active) return
      if (transferError || !data?.url) setError('This sign-in handoff could not be completed.')
      else window.location.replace(data.url)
    })
    return () => { active = false }
  }, [path, target, user])

  if (loading) return null
  if (!target) return <Navigate to="/login" replace />
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search, reason: 'Sign in once to continue with the same account.' }} />
  }
  return (
    <div className="min-h-screen grid place-items-center px-6 text-center">
      <div><BrandLogo as="h1" className="text-3xl block mb-5" /><p className="text-gray-300">{error || 'Connecting your account...'}</p></div>
    </div>
  )
}
