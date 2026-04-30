import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { donationsEnabled } from '@/lib/featureFlags'

/**
 * DonateButton — opens a tip modal and kicks the donor over to Stripe
 * Checkout. If donations aren't configured at the deploy level, the button
 * renders disabled with an explanatory tooltip rather than throwing or
 * silently failing.
 */
export function DonateButton({
  creatorId,
  creatorUsername,
  className = '',
}: {
  creatorId: string
  creatorUsername: string
  className?: string
}) {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState<number>(500) // cents
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (creatorId === user?.id) {
    // Don't let creators tip themselves.
    return null
  }

  if (!donationsEnabled) {
    return (
      <button
        type="button"
        disabled
        title="Donations not configured on this deploy yet."
        className={`px-3 py-1.5 rounded-lg border border-dark-border text-gray-500 text-sm cursor-not-allowed ${className}`}
      >
        Tip (setup pending)
      </button>
    )
  }

  async function handleTip() {
    setError(null)
    setBusy(true)
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('donations-create', {
        body: {
          creator_id: creatorId,
          amount_cents: amount,
          message: message.trim() || null,
          success_url: `${window.location.origin}/profile/${creatorId}?tip=ok`,
          cancel_url: window.location.href,
        },
      })
      if (fnErr) throw fnErr
      const url = (data as { url?: string } | null)?.url
      if (!url) throw new Error('No checkout URL returned')
      window.location.href = url
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold hover:bg-accent/90 ${className}`}
      >
        Tip @{creatorUsername}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-dark-border bg-dark-card shadow-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-dark-border flex items-center justify-between">
              <h3 className="font-semibold">Send a tip to @{creatorUsername}</h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-white"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <span className="block text-xs uppercase tracking-wider text-gray-400 mb-2">Amount</span>
                <div className="grid grid-cols-4 gap-2">
                  {[200, 500, 1000, 2000].map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setAmount(c)}
                      className={`px-2 py-2 rounded-lg border text-sm font-semibold transition-colors ${
                        amount === c
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-dark-border text-gray-300 hover:border-accent/40'
                      }`}
                    >
                      ${(c / 100).toFixed(0)}
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(100, parseInt(e.target.value, 10) || 0))}
                  className="mt-2 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm font-mono"
                />
                <p className="text-[11px] text-gray-500 mt-1">USD cents · ${(amount / 100).toFixed(2)}</p>
              </div>
              <label className="block">
                <span className="block text-xs uppercase tracking-wider text-gray-400 mb-1">Message (optional)</span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={2}
                  maxLength={140}
                  placeholder="GG! That ult was insane."
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm resize-none"
                />
              </label>
              {error && <p className="text-kunai text-xs">{error}</p>}
            </div>
            <div className="px-5 py-3 border-t border-dark-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 text-sm hover:border-accent/40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTip}
                disabled={busy || amount < 100}
                className="px-4 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Redirecting…' : `Tip $${(amount / 100).toFixed(2)}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
