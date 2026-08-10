import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LogOut, Settings } from 'lucide-react'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { useAuth } from '@/hooks/useAuth'
import {
  fetchMyClanRosterMemberships,
  fetchMyManagedClans,
  removeClanRosterMember,
  type ManagedClan,
  type MyClanRosterMembership,
} from '@/lib/organizerApi'

const ROLE_LABEL: Record<string, string> = {
  captain: 'Captain',
  starter: 'Starter',
  substitute: 'Substitute',
  coach: 'Coach',
}

export function MyClanRostersPanel() {
  const { user } = useAuth()
  const location = useLocation()
  const [rosters, setRosters] = useState<MyClanRosterMembership[]>([])
  const [managedClans, setManagedClans] = useState<ManagedClan[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [memberships, managed] = await Promise.all([
      fetchMyClanRosterMemberships(),
      fetchMyManagedClans(),
    ])
    setRosters(memberships.ok && memberships.data ? memberships.data.rosters : [])
    setManagedClans(managed.ok && managed.data ? managed.data.clans : [])
    if (!memberships.ok || !managed.ok) {
      setNotice(
        memberships.error
        || managed.error
        || 'Your clan roster tools could not be loaded.',
      )
    }
    setLoading(false)
  }, [user])

  useEffect(() => { void load() }, [load])

  const openedFromNotification = location.hash === '#my-clan-rosters'
  useEffect(() => {
    if (!openedFromNotification) return
    document.getElementById('my-clan-rosters')?.scrollIntoView({ block: 'start' })
  }, [loading, openedFromNotification])

  if (!user) return null

  async function leave(roster: MyClanRosterMembership) {
    if (!window.confirm(`Leave ${roster.name}?`)) return
    setBusy(roster.id)
    setNotice(null)
    const result = await removeClanRosterMember(roster.id, user!.id)
    setBusy(null)
    if (!result.ok) {
      setNotice(result.error || 'You could not leave that roster.')
      return
    }
    setRosters((current) => current.filter((item) => item.id !== roster.id))
    setNotice(`You left ${roster.name}.`)
  }

  return (
    <div id="my-clan-rosters" className="mt-8 scroll-mt-24">
      <CollapsibleSection
        id="my-clan-rosters"
        label="My clan rosters"
        count={rosters.length}
        openRequested={openedFromNotification}
      >
        {notice && (
          <p className="mb-3 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-gray-200">
            {notice}
          </p>
        )}
        {!loading && managedClans.length > 0 && (
          <div className="mb-4 rounded-lg border border-accent/30 bg-accent/10 p-3">
            <p className="text-sm text-gray-200">
              As a clan leader or officer, build reusable lineups and add members in clan management.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {managedClans.map((clan) => (
                <Link
                  key={clan.id}
                  to={`/clans/${clan.id}/manage`}
                  className="inline-flex min-h-9 items-center gap-2 rounded-md border border-accent/50 px-3 text-xs font-semibold text-accent hover:bg-accent/10"
                >
                  <Settings size={14} /> Manage {clan.clan_tag ? `[${clan.clan_tag}]` : clan.name} rosters
                </Link>
              ))}
            </div>
          </div>
        )}
        {!loading && managedClans.length === 0 && (
          <p className="mb-4 text-sm text-gray-500">
            Clan leaders and officers build reusable rosters and add members. Ask your clan manager to add you.
          </p>
        )}
        {loading ? (
          <p className="text-sm text-gray-500">Loading your rosters...</p>
        ) : rosters.length === 0 ? (
          <p className="text-sm text-gray-500">You are not on a reusable clan roster yet.</p>
        ) : (
          <div className="space-y-2">
            {rosters.map((roster) => (
              <div key={roster.id} className="flex min-h-12 items-center gap-3 rounded-lg border border-dark-border bg-dark-card px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-white">{roster.name}</p>
                  <p className="truncate text-xs text-gray-500">
                    {roster.clan_tag ? `[${roster.clan_tag}] ` : ''}{roster.clan_name} · {ROLE_LABEL[roster.member_role] || roster.member_role}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === roster.id}
                  onClick={() => void leave(roster)}
                  className="flex min-h-9 items-center gap-1 rounded-md border border-red-500/40 px-3 text-xs font-semibold text-red-400 disabled:opacity-50"
                >
                  <LogOut size={14} /> {busy === roster.id ? 'Leaving' : 'Leave'}
                </button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}

export default MyClanRostersPanel
