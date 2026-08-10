import { useEffect, useState } from 'react'
import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { exchangeSessionTransfer, sessionTransferTarget } from '@/lib/authExtensions'

const handled = new Set<string>()

export function SessionTransferReceiver() {
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    async function receive(rawUrl: string, native: boolean) {
      let parsed: URL
      try { parsed = new URL(rawUrl) } catch { return }
      const code = parsed.searchParams.get('auth_code') || ''
      if (!code || handled.has(code)) return
      handled.add(code)
      const target = native ? sessionTransferTarget() : window.location.origin
      const result = await exchangeSessionTransfer(code, target)
      if (!active) return
      if (result.error) {
        setError('Sign-in link expired. Try again.')
        return
      }
      if (native) {
        const path = String(result.data?.return_path || parsed.searchParams.get('path') || '/')
        window.location.replace(path.startsWith('/') ? path : '/')
      } else {
        const clean = new URL(window.location.href)
        clean.searchParams.delete('auth_code')
        window.history.replaceState({}, '', clean.pathname + clean.search + clean.hash)
      }
    }

    if (Capacitor.isNativePlatform()) {
      void CapacitorApp.getLaunchUrl().then((launch) => {
        if (launch?.url) void receive(launch.url, true)
      })
      let remove: (() => Promise<void>) | undefined
      void CapacitorApp.addListener('appUrlOpen', ({ url }) => void receive(url, true))
        .then((listener) => { remove = () => listener.remove() })
      return () => { active = false; void remove?.() }
    }
    void receive(window.location.href, false)
    return () => { active = false }
  }, [])

  if (!error) return null
  return <div role="alert" className="fixed top-4 left-1/2 z-[100] -translate-x-1/2 rounded-lg border border-kunai/50 bg-dark-card px-4 py-3 text-sm text-white shadow-lg">{error}</div>
}
