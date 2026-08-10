import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'

/** Store-build landing page for every web-only digital checkout route. */
export function StoreUnavailable() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-12">
      <section className="w-full rounded-2xl border border-dark-border bg-dark-card p-6 text-center shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-leaf/10 text-leaf">
          <ShieldCheck size={25} aria-hidden />
        </div>
        <h1 className="mt-4 text-xl font-bold text-white">Purchases unavailable in this version</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          Your existing membership and earned access still work normally. Digital checkout,
          tips, and paid competition are not offered in this store-distributed app.
        </p>
        <Link
          to="/rewards"
          className="mt-5 inline-flex min-h-11 items-center rounded-lg border border-leaf/50 px-4 text-sm font-semibold text-leaf"
        >
          View my earned collection
        </Link>
      </section>
    </main>
  )
}
