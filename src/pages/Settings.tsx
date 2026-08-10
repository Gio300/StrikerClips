import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Shield, Sparkles, UserRound, WalletCards } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { YouTubeChannelSettings } from '@/components/YouTubeChannelSettings'
import { PushNotificationToggle } from '@/components/PushNotificationToggle'
import { LiveLinkSettings } from '@/components/LiveLinkSettings'
import { ManageSubscriptionPanel } from '@/components/ManageSubscriptionPanel'
import { CreatorPayoutsCard } from '@/components/CreatorPayoutsCard'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { OwnershipClaimsPanel } from '@/components/OwnershipClaimsPanel'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

export function SettingsPage() {
  const { user } = useAuth()
  const { display } = useLeagueTheme()
  const location = useLocation()

  useEffect(() => {
    const sectionId = location.hash.replace(/^#/, '')
    if (!sectionId) return
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [location.hash])

  if (!user) return null

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-7">
        <h1 className="text-2xl font-bold text-white">{IS_MOBILE_STORE_BUILD ? 'Account settings' : 'Account & payouts'}</h1>
        <p className="mt-1 text-sm text-gray-400">
          {IS_MOBILE_STORE_BUILD
            ? 'Your channel, profile, and app preferences.'
            : 'Your channel, payment account, profile, and app preferences.'}
        </p>
      </header>

      <section className="border-b border-dark-border pb-7">
        <Link
          to="/setup?returnTo=%2Fsettings"
          state={{ returnTo: '/settings' }}
          className="flex min-h-14 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-dark-elevated"
        >
          <Sparkles size={20} className="text-accent" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">Continue setup with {display.assistantName}</span>
            <span className="block truncate text-xs text-gray-500">Gamer tag, YouTube, clan, roster, and follows</span>
          </span>
          <ChevronRight size={18} className="text-gray-600" aria-hidden />
        </Link>
      </section>

      <OwnershipClaimsPanel productName={display.productName} />

      <section id="youtube" className="scroll-mt-6 border-b border-dark-border pb-7">
        <YouTubeChannelSettings userId={user.id} />
      </section>

      {!IS_MOBILE_STORE_BUILD && <section id="payouts" className="scroll-mt-6 border-b border-dark-border py-7">
        <div className="mb-4 flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent">
            <WalletCards size={20} aria-hidden />
          </span>
          <div>
            <h2 className="font-semibold text-white">Stripe payout account</h2>
            <p className="mt-1 text-sm text-gray-400">Every player can connect Stripe now so eligible creator, clan, and tournament earnings have somewhere to be paid.</p>
          </div>
        </div>
        <CreatorPayoutsCard />
      </section>}

      <section className="border-b border-dark-border py-7">
        <h2 className="mb-3 text-lg font-semibold text-white">Profile</h2>
        <Link
          to="/profile"
          className="flex min-h-14 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-dark-elevated"
        >
          <UserRound size={20} className="text-accent" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-white">Edit profile information</span>
            <span className="block truncate text-xs text-gray-500">Username, profile image, and bio</span>
          </span>
          <ChevronRight size={18} className="text-gray-600" aria-hidden />
        </Link>
      </section>

      {!IS_MOBILE_STORE_BUILD && <section className="border-b border-dark-border py-7">
        <h2 className="mb-3 text-lg font-semibold text-white">Notifications</h2>
        <PushNotificationToggle />
      </section>}

      <section className="border-b border-dark-border py-7">
        <h2 className="mb-3 text-lg font-semibold text-white">Live video</h2>
        <LiveLinkSettings userId={user.id} />
      </section>

      {!IS_MOBILE_STORE_BUILD && <section className="border-b border-dark-border py-7">
        <h2 className="mb-3 text-lg font-semibold text-white">Membership</h2>
        <ManageSubscriptionPanel returnTo="/settings" />
      </section>}

      <section className="pt-7">
        <Link
          to="/account/delete"
          className="flex min-h-12 items-center gap-3 rounded-lg px-2 text-gray-400 transition-colors hover:bg-dark-elevated hover:text-white"
        >
          <Shield size={19} aria-hidden />
          <span className="flex-1 text-sm">Privacy and account deletion</span>
          <ChevronRight size={18} className="text-gray-600" aria-hidden />
        </Link>
      </section>
    </main>
  )
}
