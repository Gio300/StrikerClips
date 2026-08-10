import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Castle, MapPinned, Shield, Trophy, Users } from 'lucide-react'
import { fetchVillage, type Village } from '@/lib/organizerApi'

export function VillageDashboard() {
  const { villageId = '' } = useParams()
  const [village, setVillage] = useState<Village | null>(null)
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const result = await fetchVillage(villageId)
    if (!result.ok || !result.data) {
      setError(result.status === 403 ? 'This village dashboard is private to its member clans.' : (result.error || 'Village unavailable.'))
    } else {
      setVillage(result.data.village)
      setCanManage(result.data.can_manage)
      setError('')
    }
    setLoading(false)
  }, [villageId])

  useEffect(() => { void load() }, [load])

  if (loading) return <div className="page-shell text-sm text-gray-500">Loading village...</div>
  if (!village) {
    return (
      <div className="page-shell max-w-2xl">
        <Link to="/clans" className="inline-flex items-center gap-2 text-sm text-gray-400"><ArrowLeft size={16} /> Clans</Link>
        <h1 className="mt-5 text-2xl font-bold text-white">Village unavailable</h1>
        <p className="mt-2 text-sm text-gray-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="page-shell max-w-6xl">
      <header className="border-b border-dark-border pb-5">
        <Link to="/clans" className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"><ArrowLeft size={16} /> Clans</Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold uppercase text-kunai"><Castle size={15} /> Shared village</p>
            <h1 className="mt-1 text-2xl font-bold text-white">{village.name}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {village.clans.length} allied clans · {village.clans.reduce((sum, clan) => sum + Number(clan.member_count || 0), 0)} members
            </p>
          </div>
          <Link to="/conquest" className="btn-primary min-h-10 px-3 text-sm"><MapPinned size={16} /> Conquest map</Link>
        </div>
      </header>

      <div className="my-5 grid grid-cols-3 divide-x divide-dark-border border-y border-dark-border py-3">
        <VillageStat icon={Shield} label="Clans" value={String(village.clans.length)} />
        <VillageStat icon={MapPinned} label="Territories" value={String(village.territories.length)} />
        <VillageStat icon={Trophy} label="Events" value={String(village.tournaments.length)} />
      </div>

      {!village.home_territory_id && (
        <div className="mb-5 flex items-start gap-3 border border-kunai/30 bg-kunai/10 p-4">
          <MapPinned className="mt-0.5 shrink-0 text-kunai" size={20} />
          <div>
            <p className="font-semibold text-white">No village home claimed</p>
            <p className="mt-1 text-sm text-gray-400">
              {canManage ? 'Choose an unclaimed territory on the Conquest map to establish this village.' : 'A clan leader or officer can establish the village on the Conquest map.'}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-7 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center gap-2 border-b border-dark-border pb-2">
            <Users size={17} className="text-accent" />
            <h2 className="font-semibold text-white">Allied clans</h2>
          </div>
          <div className="divide-y divide-dark-border">
            {village.clans.map((clan) => (
              <Link key={clan.id} to={`/boards/${clan.id}`} className="flex items-center justify-between gap-3 py-3 hover:bg-white/[0.02]">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{clan.clan_tag ? `[${clan.clan_tag}] ` : ''}{clan.name}</p>
                  <p className="text-xs text-gray-500">{clan.member_count} members</p>
                </div>
                <span className="text-xs tabular-nums text-gray-400">{Number(clan.total_points || 0).toLocaleString()} pts</span>
              </Link>
            ))}
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2 border-b border-dark-border pb-2">
            <MapPinned size={17} className="text-kunai" />
            <h2 className="font-semibold text-white">Territory</h2>
          </div>
          {village.territories.length === 0 ? (
            <p className="py-3 text-sm text-gray-500">No territory held yet.</p>
          ) : (
            <div className="divide-y divide-dark-border">
              {village.territories.map((territory) => (
                <div key={territory.id} className="flex items-center justify-between gap-3 py-3">
                  <span className="font-medium text-gray-200">{territory.name}</span>
                  <span className="text-xs text-gray-500">{territory.id === village.home_territory_id ? 'Village home' : 'Held'}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function VillageStat({ icon: Icon, label, value }: { icon: typeof Shield; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-2 px-2 text-center">
      <Icon size={16} className="shrink-0 text-gray-500" />
      <div className="min-w-0">
        <p className="text-lg font-bold text-white">{value}</p>
        <p className="truncate text-[10px] uppercase text-gray-500">{label}</p>
      </div>
    </div>
  )
}
