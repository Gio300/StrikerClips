import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, ExternalLink, Handshake, MapPinned, Send, X } from 'lucide-react'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import {
  fetchClanAllianceDashboard,
  proposeClanAlliance,
  reviewClanAlliance,
  type ClanAllianceDashboard,
  type ClanAllianceRequest,
} from '@/lib/organizerApi'

const ALLIANCE_ERROR: Record<string, string> = {
  alliance_request_already_pending: 'These clans already have a proposal waiting for review.',
  clans_belong_to_different_villages: 'Both clans already belong to different villages.',
  clan_manager_required: 'Only a clan leader or officer can send this proposal.',
  target_clan_manager_required: 'Only a leader or officer of the invited clan can review this proposal.',
}

function messageFor(error: string | null): string {
  return ALLIANCE_ERROR[error || ''] || error || 'That village action could not be completed.'
}

export function ClanAlliancePanel({ serverId, initialTarget = '' }: { serverId: string; initialTarget?: string }) {
  const [dashboard, setDashboard] = useState<ClanAllianceDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [targetClanId, setTargetClanId] = useState(initialTarget)
  const [villageName, setVillageName] = useState('')

  const load = useCallback(async () => {
    const result = await fetchClanAllianceDashboard(serverId)
    if (!result.ok || !result.data) {
      setNotice(messageFor(result.error))
      setDashboard(null)
    } else {
      setDashboard(result.data)
      if (initialTarget && result.data.eligible_clans.some((clan) => clan.id === initialTarget)) {
        setTargetClanId(initialTarget)
      }
    }
    setLoading(false)
  }, [initialTarget, serverId])

  useEffect(() => { void load() }, [load])

  const target = useMemo(
    () => dashboard?.eligible_clans.find((clan) => clan.id === targetClanId) || null,
    [dashboard?.eligible_clans, targetClanId],
  )

  useEffect(() => {
    if (!dashboard || !target || villageName.trim()) return
    setVillageName(`${dashboard.clan.name} + ${target.name}`.slice(0, 100))
  }, [dashboard, target, villageName])

  async function propose() {
    if (!targetClanId || !dashboard) return
    setBusy('propose')
    const result = await proposeClanAlliance(serverId, targetClanId, villageName.trim())
    setBusy('')
    if (!result.ok) {
      setNotice(messageFor(result.error))
      return
    }
    setNotice('Alliance proposal sent to the other clan leaders.')
    setTargetClanId('')
    setVillageName('')
    await load()
  }

  async function review(request: ClanAllianceRequest, decision: 'accept' | 'reject') {
    setBusy(`review:${request.id}`)
    const result = await reviewClanAlliance(request.id, decision)
    setBusy('')
    if (!result.ok) {
      setNotice(messageFor(result.error))
      return
    }
    setNotice(decision === 'accept' ? 'Alliance accepted. Your shared village is ready.' : 'Alliance proposal declined.')
    await load()
  }

  if (loading) return <p className="text-sm text-gray-500">Loading village controls...</p>
  if (!dashboard) return <p className="border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{notice}</p>

  return (
    <div className="space-y-3">
      {notice && (
        <div className="flex items-start justify-between gap-3 border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-gray-200">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      {dashboard.village && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-dark-border py-4">
          <div className="flex min-w-0 items-center gap-3">
            <MapPinned className="shrink-0 text-kunai" size={22} />
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{dashboard.village.name}</p>
              <p className="text-xs text-gray-500">
                {dashboard.village.clans.length} clans · {dashboard.village.territories.length} territories
              </p>
            </div>
          </div>
          <Link to={`/villages/${dashboard.village.id}`} className="btn-ghost min-h-10 px-3 text-sm">
            Shared dashboard <ExternalLink size={15} />
          </Link>
        </div>
      )}

      {!dashboard.can_manage && !dashboard.village && (
        <p className="text-sm text-gray-400">Your clan has not formed a village yet. A leader or officer can propose an alliance.</p>
      )}

      {dashboard.can_manage && (
        <>
          <CollapsibleSection
            id={`incoming-alliance-${serverId}`}
            label="Incoming proposals"
            count={dashboard.incoming.filter((request) => request.status === 'pending').length}
            hint="Leader review"
          >
            <div className="divide-y divide-dark-border">
              {dashboard.incoming.filter((request) => request.status === 'pending').length === 0 && (
                <p className="py-2 text-sm text-gray-500">No proposal is waiting.</p>
              )}
              {dashboard.incoming.filter((request) => request.status === 'pending').map((request) => (
                <div key={request.id} className="flex items-center gap-3 py-3">
                  <Handshake className="shrink-0 text-accent" size={19} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{request.from_clan_name}</p>
                    <p className="truncate text-xs text-gray-500">Proposed village: {request.proposed_village_name}</p>
                  </div>
                  <button
                    type="button"
                    title="Accept proposal"
                    aria-label={`Accept alliance with ${request.from_clan_name}`}
                    disabled={busy === `review:${request.id}`}
                    onClick={() => void review(request, 'accept')}
                    className="grid h-10 w-10 place-items-center bg-leaf text-black disabled:opacity-50"
                  >
                    <Check size={18} />
                  </button>
                  <button
                    type="button"
                    title="Decline proposal"
                    aria-label={`Decline alliance with ${request.from_clan_name}`}
                    disabled={busy === `review:${request.id}`}
                    onClick={() => void review(request, 'reject')}
                    className="grid h-10 w-10 place-items-center border border-red-500/40 text-red-300 disabled:opacity-50"
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            id={`new-alliance-${serverId}`}
            label="Propose an alliance"
            hint={dashboard.village ? 'Invite a clan into the village' : 'Create a shared village'}
          >
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-gray-400">Clan</label>
                <select
                  value={targetClanId}
                  onChange={(event) => { setTargetClanId(event.target.value); setVillageName('') }}
                  className="min-h-11 w-full border border-dark-border bg-dark px-3 text-sm text-white"
                >
                  <option value="">Choose a clan</option>
                  {dashboard.eligible_clans.map((clan) => (
                    <option key={clan.id} value={clan.id}>
                      {clan.clan_tag ? `[${clan.clan_tag}] ` : ''}{clan.name} · {clan.member_count} members
                    </option>
                  ))}
                </select>
              </div>
              {!dashboard.village && (
                <div>
                  <label className="mb-1 block text-xs text-gray-400">Village name</label>
                  <input
                    value={villageName}
                    onChange={(event) => setVillageName(event.target.value.slice(0, 100))}
                    className="min-h-11 w-full border border-dark-border bg-dark px-3 text-sm text-white"
                    placeholder="Shared village name"
                  />
                </div>
              )}
              <button
                type="button"
                disabled={!targetClanId || busy === 'propose'}
                onClick={() => void propose()}
                className="btn-primary min-h-11 px-4 text-sm disabled:opacity-50"
              >
                <Send size={16} /> {busy === 'propose' ? 'Sending...' : 'Send proposal'}
              </button>
            </div>
          </CollapsibleSection>

          {dashboard.outgoing.length > 0 && (
            <CollapsibleSection id={`outgoing-alliance-${serverId}`} label="Sent proposals" count={dashboard.outgoing.length}>
              <div className="divide-y divide-dark-border">
                {dashboard.outgoing.map((request) => (
                  <div key={request.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="truncate text-gray-300">{request.to_clan_name}</span>
                    <span className="shrink-0 text-xs capitalize text-gray-500">{request.status}</span>
                  </div>
                ))}
              </div>
            </CollapsibleSection>
          )}
        </>
      )}
    </div>
  )
}
