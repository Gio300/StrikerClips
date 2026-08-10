import { useCallback, useDeferredValue, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { ActionCard } from '@/components/ui/ActionCard'
import { clanSummary } from '@/lib/clans'
import { clanLabel } from '@/lib/identity'
import { applyToClan, fetchMyClanApplications } from '@/lib/organizerApi'
import type { Server } from '@/types/database'

type Counts = Record<string, number>

export function clanCapacityLabel(memberCount: number, maxMembers: number): string {
  const members = Math.max(0, Math.floor(memberCount))
  const capacity = Math.max(0, Math.floor(maxMembers))
  return `${Math.max(0, capacity - members)} open spots · ${members}/${capacity} members`
}

export function clanApplicationErrorMessage(error: string | null | undefined): string {
  const messages: Record<string, string> = {
    already_a_clan_member: 'You are already a member of this clan.',
    clan_is_full: 'This clan is full.',
    clan_not_found: 'That clan is no longer available.',
    authentication_required: 'Sign in to apply to a clan.',
  }
  return messages[error || ''] || 'Application could not be sent. Try again.'
}

/**
 * Clan Discovery is an application surface, not a client-side membership door.
 * Recruiting clans are sorted first, but closed clans remain reachable so their
 * leaders can still receive and review applications.
 */
export function ClanDiscovery() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const { tokens } = useWallet()

  const [clans, setClans] = useState<Server[]>([])
  const [counts, setCounts] = useState<Counts>({})
  const [myClanIds, setMyClanIds] = useState<Set<string>>(new Set())
  const [applications, setApplications] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; msg: string; ok: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [loadError, setLoadError] = useState('')
  const deferredSearch = useDeferredValue(search.trim())

  const load = useCallback(async () => {
    let clanQuery = supabase
      .from('servers')
      .select('*')
      .eq('kind', 'clan')
      .order('is_recruiting', { ascending: false })
      .limit(50)
    if (deferredSearch) clanQuery = clanQuery.ilike('name', `%${deferredSearch}%`)
    const { data: serverRows, error: clansError } = await clanQuery
    if (clansError) {
      setLoadError(clansError.message || 'Clans could not be loaded.')
      setClans([])
      setLoading(false)
      return
    }
    setLoadError('')
    const allClans = ((serverRows ?? []) as Server[])
      .filter((server) => server.kind === 'clan')
      .sort((a, b) => (
        Number(Boolean(b.is_recruiting)) - Number(Boolean(a.is_recruiting))
        || a.name.localeCompare(b.name)
      ))

    const clanIds = allClans.map((clan) => clan.id)
    const { data: memberRows } = clanIds.length
      ? await supabase.from('clan_members').select('server_id, user_id').in('server_id', clanIds)
      : { data: [] }
    const rows = (memberRows ?? []) as { server_id: string; user_id: string }[]
    const nextCounts: Counts = {}
    const mine = new Set<string>()
    for (const row of rows) {
      nextCounts[row.server_id] = (nextCounts[row.server_id] ?? 0) + 1
      if (row.user_id === userId) mine.add(row.server_id)
    }

    let nextApplications: Record<string, string> = {}
    if (userId) {
      const result = await fetchMyClanApplications()
      if (result.ok && result.data) {
        nextApplications = Object.fromEntries(
          result.data.applications.map((application) => [application.server_id, application.status]),
        )
      }
    }
    setCounts(nextCounts)
    setMyClanIds(mine)
    setApplications(nextApplications)
    setClans(allClans)
    setLoading(false)
  }, [deferredSearch, userId])

  useEffect(() => {
    void load()
  }, [load])

  function showFlash(id: string, msg: string, ok: boolean) {
    setFlash({ id, msg, ok })
    setTimeout(() => setFlash((current) => (
      current?.id === id && current.msg === msg ? null : current
    )), 3500)
  }

  async function attemptApply(clan: Server) {
    if (!userId) {
      showFlash(clan.id, 'Sign in to apply to a clan.', false)
      return
    }
    if (myClanIds.has(clan.id) || applications[clan.id] === 'pending') return
    if ((counts[clan.id] ?? 0) >= (clan.max_members ?? 100)) {
      showFlash(clan.id, 'This clan is full.', false)
      return
    }
    setBusyId(clan.id)
    try {
      const result = await applyToClan(clan.id, '')
      if (!result.ok || !result.data) {
        showFlash(clan.id, clanApplicationErrorMessage(result.error), false)
        return
      }
      setApplications((current) => ({ ...current, [clan.id]: 'pending' }))
      showFlash(clan.id, `Application sent to ${clan.name}.`, true)
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Finding clans...</div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Find a clan</h1>
          <p className="text-sm text-gray-500 mt-1">
            Apply to any clan. Recruiting clans are actively looking for players.
          </p>
        </div>
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
      </div>

      <label className="relative mb-5 block">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
        <span className="sr-only">Search clans</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search clans by name"
          className="w-full rounded-lg border border-dark-border bg-dark py-2.5 pl-10 pr-3 text-sm text-white placeholder-gray-500 outline-none focus:border-accent"
        />
      </label>

      {loadError && (
        <p role="alert" className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Clans could not be loaded. Try again in a moment.
        </p>
      )}

      {!loadError && clans.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="mb-4">{deferredSearch ? `No clans match “${deferredSearch}”.` : 'No clans have been created yet.'}</p>
          {!deferredSearch && (
            <Link to="/boards/create" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
              Start your own clan
            </Link>
          )}
        </div>
      ) : !loadError ? (
        <div className="space-y-3">
          {clans.map((clan) => {
            const summary = clanSummary(
              {
                name: clan.name,
                maxMembers: clan.max_members ?? undefined,
                isRecruiting: Boolean(clan.is_recruiting),
                joinFeeTokens: clan.join_fee_tokens ?? 0,
              },
              counts[clan.id] ?? 0,
            )
            const joined = myClanIds.has(clan.id)
            const applicationStatus = applications[clan.id]
            const busy = busyId === clan.id
            const fee = summary.free
              ? 'No join fee'
              : `${summary.joinFeeTokens.toLocaleString()} TKN if accepted`
            const recruiting = clan.is_recruiting ? 'Recruiting' : 'Applications reviewed'
            const sublabel = `${recruiting} | ${clanCapacityLabel(counts[clan.id] ?? 0, summary.maxMembers)} | ${fee}`
            const disabled = joined || busy || applicationStatus === 'pending' || summary.isFull
            return (
              <div key={clan.id}>
                <ActionCard
                  icon="clan"
                  label={clanLabel(clan.name, clan.clan_tag)}
                  sublabel={sublabel}
                  onClick={disabled ? undefined : () => void attemptApply(clan)}
                  aria-label={joined ? `${clan.name}, joined` : `Apply to ${clan.name}`}
                  trailing={(
                    <span className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg ${
                      joined
                        ? 'border border-leaf/40 bg-leaf/10 text-leaf'
                        : applicationStatus === 'pending'
                          ? 'border border-accent/40 bg-accent/10 text-accent'
                          : summary.isFull
                            ? 'border border-dark-border text-gray-500'
                            : 'bg-accent text-dark'
                    }`}>
                      {joined
                        ? 'Joined'
                        : applicationStatus === 'pending'
                          ? 'Pending'
                          : busy
                            ? 'Sending...'
                            : summary.isFull
                              ? 'Full'
                              : 'Apply'}
                    </span>
                  )}
                  hideChevron
                />
                {flash?.id === clan.id && (
                  <p className={`mt-1 px-1 text-xs ${flash.ok ? 'text-leaf' : 'text-red-400'}`}>
                    {flash.msg}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : null}

      {clans.length === 50 && (
        <p className="mt-6 text-center text-xs text-gray-500">Showing the first 50 clans. Search by name to narrow the list.</p>
      )}

      <p className="mt-8 text-xs text-gray-500 text-center">
        A join fee is collected only after approval and split 80% to the clan treasury and 20% to the platform.
      </p>
    </div>
  )
}

export default ClanDiscovery
