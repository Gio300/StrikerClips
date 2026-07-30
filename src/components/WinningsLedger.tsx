import { useEffect, useMemo, useState } from 'react'
import { getLedger, loadLedger, ledgerTotals, subscribeLedger, type LedgerEntry } from '@/lib/ledger'

/**
 * Giving and prestige ledger shown only on the user's own profile.
 *
 * Reads settled results and awarded prizes from `wallet_ledger` (select-'owner',
 * so only you see your own rows). The rows are written by the server at the
 * moment the thing they describe happens, so this is an auditable record.
 */
export function WinningsLedger({ userId }: { userId: string }) {
  const [entries, setEntries] = useState<LedgerEntry[]>(() => getLedger(userId))

  useEffect(() => {
    setEntries(getLedger(userId))
    const unsub = subscribeLedger(() => setEntries(getLedger(userId)))
    void loadLedger(userId)
    return unsub
  }, [userId])

  const { totalWon, totalPrizes } = useMemo(() => ledgerTotals(entries), [entries])

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-6 mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
        <h2 className="text-lg font-semibold">Prestige &amp; Giving</h2>
        <span className="rounded-full border border-leaf/30 bg-leaf/10 px-2.5 py-0.5 text-[11px] text-leaf">
          Giver reputation
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-4">
        Your {`✨`} donations, tournament sponsorships, and prediction prestige — the good you've done for the
        community — show here.
      </p>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="rounded-lg border border-dark-border bg-dark p-3">
          <p className="text-xs text-gray-500">Prestige earned</p>
          <p className="text-xl font-semibold text-leaf">
            {totalWon.toLocaleString()} <span className="text-xs text-gray-500">pts</span>
          </p>
        </div>
        <div className="rounded-lg border border-dark-border bg-dark p-3">
          <p className="text-xs text-gray-500">Badges &amp; sponsorships</p>
          <p className="text-xl font-semibold text-accent">{totalPrizes.toLocaleString()}</p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dark-border bg-dark p-8 text-center text-gray-400 text-sm">
          Nothing yet — your giving, sponsorships, and prediction prestige will show here.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">Result</th>
                <th className="py-2 pr-3 font-medium">Amount</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-dark-border">
                  <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                    {new Date(e.date).toLocaleDateString()}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="text-gray-200">{e.event}</span>
                    <span className="ml-1 text-[11px] text-gray-500 capitalize">· {e.kind}</span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className={e.result === 'Win' ? 'text-leaf' : 'text-red-400'}>
                      {e.result}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-gray-200 whitespace-nowrap">
                    {e.prize ? e.prize : `${e.amount.toLocaleString()} Give Points`}
                  </td>
                  <td className="py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        e.status === 'Paid'
                          ? 'border border-leaf/30 bg-leaf/10 text-leaf'
                          : 'border border-dark-border bg-dark text-gray-400'
                      }`}
                    >
                      {e.status === 'Paid' ? 'Recorded' : e.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
