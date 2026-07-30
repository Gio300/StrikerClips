import { ShieldCheck } from 'lucide-react'

export function StoreUnavailable() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-xl items-center px-4 py-12">
      <section className="w-full rounded-2xl border border-dark-border bg-dark-card p-6 text-center shadow-xl">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-leaf/10 text-leaf">
          <ShieldCheck size={25} />
        </div>
        <h1 className="mt-4 text-xl font-bold text-white">Purchases unavailable in this version</h1>
        <p className="mt-2 text-sm leading-6 text-gray-400">
          Your existing membership, earned Tokens, Give Points, artifacts, and creator access
          continue to work normally. Digital checkout is not offered in this store-distributed app.
        </p>
      </section>
    </main>
  )
}
