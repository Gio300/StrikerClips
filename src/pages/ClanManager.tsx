import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Handshake, MessageCircle, Settings, Swords, Trophy, Users } from 'lucide-react'
import { ClanAlliancePanel } from '@/components/ClanAlliancePanel'
import { ClanSettingsPanel } from '@/components/ClanSettingsPanel'
import { useAuth } from '@/hooks/useAuth'
import { fetchMyManagedClans } from '@/lib/organizerApi'
import { supabase } from '@/lib/supabase'
import { clanTournamentCreationPath } from '@/lib/tournamentCreation'
import type { Server } from '@/types/database'

type ManagerSection = 'clan' | 'village'

export function ClanManager() {
  const { serverId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const requestedSection = search.get('section') === 'village' ? 'village' : 'clan'
  const [section, setSection] = useState<ManagerSection>(requestedSection)
  const [server, setServer] = useState<Server | null>(null)
  const [authorized, setAuthorized] = useState<boolean | null>(null)

  useEffect(() => {
    setSection(requestedSection)
  }, [requestedSection])

  useEffect(() => {
    if (!serverId) return
    let alive = true
    ;(async () => {
      const [managed, clan] = await Promise.all([
        fetchMyManagedClans(),
        supabase.from('servers').select('*').eq('id', serverId).single(),
      ])
      if (!alive) return
      setServer((clan.data as Server | null) || null)
      setAuthorized(Boolean(managed.ok && managed.data?.clans.some((row) => row.id === serverId)))
    })()
    return () => { alive = false }
  }, [serverId])

  function openSection(next: ManagerSection) {
    setSection(next)
    navigate(`/clans/${serverId}/manage?section=${next}`, { replace: true })
  }

  if (authorized === null) return <div className="page-shell text-sm text-gray-500">Loading clan management...</div>
  if (!authorized || !server || !user) {
    return (
      <div className="page-shell max-w-2xl">
        <Link to={serverId ? `/boards/${serverId}` : '/boards'} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft size={16} /> Back to clan
        </Link>
        <h1 className="mt-5 text-2xl font-bold text-white">Clan management unavailable</h1>
        <p className="mt-2 text-sm text-gray-400">Only this clan's leader or officers can use its management dashboard.</p>
      </div>
    )
  }

  return (
    <div className="page-shell max-w-5xl">
      <header className="border-b border-dark-border pb-5">
        <Link to={`/boards/${serverId}`} className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white">
          <ArrowLeft size={16} /> Clan board
        </Link>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-kunai">Leader dashboard</p>
            <h1 className="mt-1 text-2xl font-bold text-white">
              {server.clan_tag ? `[${server.clan_tag}] ` : ''}{server.name}
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to={`/clans/${serverId}/chat`} className="btn-ghost min-h-10 px-3 text-sm">
              <MessageCircle size={16} /> Chat
            </Link>
            <Link to={clanTournamentCreationPath(serverId, 'clan_internal')} className="btn-ghost min-h-10 px-3 text-sm">
              <Users size={16} /> Run an in-clan event
            </Link>
            <Link to={clanTournamentCreationPath(serverId, 'clan_battle')} className="btn-primary min-h-10 px-3 text-sm">
              <Trophy size={16} /> Host an inter-clan tournament
            </Link>
          </div>
        </div>
      </header>

      <nav className="my-5 grid grid-cols-2 border border-dark-border p-1" aria-label="Clan management sections">
        <button
          type="button"
          onClick={() => openSection('clan')}
          className={`flex min-h-11 items-center justify-center gap-2 text-sm font-semibold ${section === 'clan' ? 'bg-accent text-dark' : 'text-gray-400 hover:text-white'}`}
        >
          <Settings size={17} /> Clan
        </button>
        <button
          type="button"
          onClick={() => openSection('village')}
          className={`flex min-h-11 items-center justify-center gap-2 text-sm font-semibold ${section === 'village' ? 'bg-kunai text-black' : 'text-gray-400 hover:text-white'}`}
        >
          <Handshake size={17} /> Village
        </button>
      </nav>

      {section === 'clan' ? (
        <ClanSettingsPanel server={server} viewerId={user.id} standalone onChanged={() => setServer({ ...server })} />
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-dark-border pb-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Village and alliances</h2>
              <p className="text-sm text-gray-500">Form a village with another clan, then claim a shared home on the Conquest map.</p>
            </div>
            <Link to="/conquest" className="grid h-10 w-10 shrink-0 place-items-center border border-dark-border text-gray-300" title="Open Conquest map">
              <Swords size={18} />
            </Link>
          </div>
          <ClanAlliancePanel serverId={serverId} initialTarget={search.get('target') || ''} />
        </>
      )}
    </div>
  )
}
