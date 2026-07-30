import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { ActionCard } from '@/components/ui/ActionCard'
import {
  canJoin,
  joinBlockMessage,
  clanSummary,
  isDiscoverable,
  payClanFee,
} from '@/lib/clans'
import { clanLabel } from '@/lib/identity'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'
import type { Server } from '@/types/database'

/**
 * Clan Discovery — "find a clan".
 *
 * Lists clans that are OPEN / recruiting (and not full), each as an ActionCard
 * showing name, spots left and the join fee (or "Free to join"). Tapping a card
 * attempts to join: it enforces `canJoin` (cap ∩ recruiting ∩ affordability); on
 * a paid clan it deducts the fee from the user's Token wallet and books the 80/20
 * split (clan treasury / platform); on success the user becomes a Member
 * (`clan_members` insert). Blocks fail closed with a clear message and a link to
 * buy Tokens when short. See docs/economy-clans-villages.md §5.3.
 */

type Counts = Record<string, number>

export function ClanDiscovery() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { tokens } = useWallet()

  const [clans, setClans] = useState<Server[]>([])
  const [counts, setCounts] = useState<Counts>({})
  const [myClanIds, setMyClanIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; msg: string; ok: boolean } | null>(null)

  const load = useCallback(async () => {
    // Recruiting clans. (Filtering client-side too keeps the mock backend honest.)
    const { data: serverRows } = await supabase
      .from('servers')
      .select('*')
      .eq('is_recruiting', true)
      .order('name')
    const recruiting = ((serverRows ?? []) as Server[]).filter((s) => s.is_recruiting)

    // Member counts per clan (group all clan_members client-side — robust on mock + real).
    const { data: memberRows } = await supabase.from('clan_members').select('server_id, user_id')
    const rows = (memberRows ?? []) as { server_id: string; user_id: string }[]
    const c: Counts = {}
    const mine = new Set<string>()
    for (const r of rows) {
      c[r.server_id] = (c[r.server_id] ?? 0) + 1
      if (r.user_id === userId) mine.add(r.server_id)
    }
    setCounts(c)
    setMyClanIds(mine)
    setClans(recruiting)
    setLoading(false)
  }, [userId])

  useEffect(() => {
    void load()
  }, [load])

  function showFlash(id: string, msg: string, ok: boolean) {
    setFlash({ id, msg, ok })
    setTimeout(() => setFlash((f) => (f && f.id === id && f.msg === msg ? null : f)), 3500)
  }

  async function attemptJoin(clan: Server) {
    if (!userId) {
      showFlash(clan.id, 'Sign in to join a clan.', false)
      return
    }
    if (myClanIds.has(clan.id)) return
    const memberCount = counts[clan.id] ?? 0
    const fee = clan.join_fee_tokens ?? 0
    if (IS_MOBILE_STORE_BUILD && fee > 0) {
      showFlash(clan.id, 'Paid clan joining is unavailable in this version.', false)
      return
    }
    const check = canJoin(
      { maxMembers: clan.max_members ?? undefined, isRecruiting: !!clan.is_recruiting, joinFeeTokens: fee },
      memberCount,
      tokens,
    )
    if (!check.ok) {
      showFlash(clan.id, joinBlockMessage(check.reason), false)
      return
    }
    setBusyId(clan.id)
    try {
      // Charge the fee SERVER-SIDE: one request debits the wallet, credits the
      // clan's treasury 80%, writes the clan_dues_payments receipt and books the
      // wallet_ledger row. The amount comes from the clan's own
      // `join_fee_tokens`, not from this page — and if the debit fails we do NOT
      // seat the member.
      if (fee > 0) {
        const paid = await payClanFee(clan.id, userId, 'join')
        if (!paid.ok) {
          showFlash(
            clan.id,
            paid.reason === 'insufficient'
              ? 'Not enough Tokens for that join fee.'
              : "Couldn't take the join fee just now — nothing was charged.",
            false,
          )
          return
        }
      }
      await supabase.from('clan_members').insert({ server_id: clan.id, user_id: userId, role: 'member' })
      // Mirror into server_members so the chat/host-dropdown reads see the join.
      await supabase.from('server_members').insert({ server_id: clan.id, user_id: userId, role: 'member' })
      showFlash(
        clan.id,
        fee > 0 ? `Joined ${clan.name}! ${fee.toLocaleString()} Tokens spent.` : `Joined ${clan.name}!`,
        true,
      )
      await load()
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Finding clans…</div>
      </div>
    )
  }

  const discoverable = clans.filter((c) => {
    const joinFeeTokens = c.join_fee_tokens ?? 0
    return (
      (!IS_MOBILE_STORE_BUILD || joinFeeTokens <= 0) &&
      isDiscoverable(
        {
          maxMembers: c.max_members ?? undefined,
          isRecruiting: !!c.is_recruiting,
          joinFeeTokens,
        },
        counts[c.id] ?? 0,
      )
    )
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Find a clan</h1>
          <p className="text-sm text-gray-500 mt-1">Clans recruiting right now. Tap one to join.</p>
        </div>
        {!IS_MOBILE_STORE_BUILD && (
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-dark-border bg-dark-card px-4 py-2 text-center">
              <div className="text-lg font-bold text-accent">{tokens.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-gray-500">Your Tokens</div>
            </div>
            <Link
              to="/store"
              className="px-3 py-2 rounded-lg border border-dark-border bg-dark-card text-sm text-accent hover:border-accent/50 transition-colors"
            >
              Get more
            </Link>
          </div>
        )}
      </div>

      {discoverable.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="mb-4">
            {IS_MOBILE_STORE_BUILD
              ? 'No free clans are recruiting right now.'
              : 'No clans are recruiting right now.'}
          </p>
          <Link to="/boards/create" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
            Start your own clan
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {discoverable.map((clan) => {
            const s = clanSummary(
              { name: clan.name, maxMembers: clan.max_members ?? undefined, isRecruiting: !!clan.is_recruiting, joinFeeTokens: clan.join_fee_tokens ?? 0 },
              counts[clan.id] ?? 0,
            )
            const joined = myClanIds.has(clan.id)
            const busy = busyId === clan.id
            const sub = `${s.spotsLeft} of ${s.maxMembers} spots left · ${s.free ? 'Free to join' : `${s.joinFeeTokens.toLocaleString()} TKN`}`
            const isFlash = flash && flash.id === clan.id
            return (
              <div key={clan.id}>
                <ActionCard
                  emoji="🛡️"
                  label={clanLabel(clan.name, clan.clan_tag)}
                  sublabel={sub}
                  onClick={joined || busy ? undefined : () => void attemptJoin(clan)}
                  aria-label={
                    joined
                      ? `${clanLabel(clan.name, clan.clan_tag)} — joined`
                      : `Join ${clanLabel(clan.name, clan.clan_tag)}`
                  }
                  trailing={
                    <span
                      className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                        joined
                          ? 'border border-leaf/40 bg-leaf/10 text-leaf'
                          : busy
                            ? 'border border-dark-border text-gray-500'
                            : s.free
                              ? 'bg-accent text-dark'
                              : 'bg-accent text-dark'
                      }`}
                    >
                      {joined ? '✓ Joined' : busy ? '…' : s.free ? 'Join' : `Join · ${s.joinFeeTokens.toLocaleString()}`}
                    </span>
                  }
                  hideChevron
                />
                {isFlash && (
                  <p className={`mt-1 px-1 text-xs ${flash!.ok ? 'text-leaf' : 'text-red-400'}`}>
                    {flash!.msg}
                    {!IS_MOBILE_STORE_BUILD && !flash!.ok && flash!.msg.includes('Tokens') && (
                      <Link to="/store" className="ml-1 underline text-accent">
                        Buy Tokens
                      </Link>
                    )}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {!IS_MOBILE_STORE_BUILD && (
        <p className="mt-8 text-xs text-gray-500 text-center">
          Join fees are paid in Tokens and split 80% to the clan treasury, 20% platform fee.
          Tokens have no cash value.
        </p>
      )}
    </div>
  )
}

export default ClanDiscovery
