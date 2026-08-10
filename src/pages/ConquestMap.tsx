import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Crown, MapPinned, Shield, Swords, Users, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { standings, kageTitle, type ClanLand } from '@/lib/conquest'
import { pointFor, CONQUEST_POINTS } from '@/lib/conquestLayout'
import { artifactTierFor, holdDays, tierLabel, BATTLE_FORMATS } from '@/lib/conquestMechanics'
import { LandUnlockModal, type LandUnlock } from '@/components/LandUnlockModal'
import { claimVillageHome } from '@/lib/organizerApi'

/**
 * ConquestMap — Shinobi Conquest drawn on the painted ninja-world map.
 *
 * The map image is the board. Over it we light up one interactive control point
 * per territory: it glows in the holding clan's color (or sits dim + unclaimed),
 * shows the clan/village tag and how many occupy it, and pulses white for the
 * clan YOU'RE in so you can always see where you stand. Tap a point to open its
 * detail — who holds it, how long, the artifact tier it's producing — and to
 * challenge, unite, or claim. Winning land fires the unlock celebration.
 *
 * Live + DB-backed (territories + clans). The struggle is ongoing: battles
 * (found videos or scheduled matches) move ownership, which relights the map.
 */
interface Territory {
  id: string
  name: string
  owner_clan_id: string | null
  owner_village_id: string | null
  captured_at?: string | null
}
interface Clan { id: string; name: string; clan_tag: string | null }
interface VillageInfo { id: string; name: string }

/** Stable, vivid color per clan id. */
function clanColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return `hsl(${h % 360} 75% 58%)`
}

function withAlpha(color: string, alpha: number): string {
  return color.replace(/\)$/, ` / ${alpha})`)
}

const MAP_SRC = `${import.meta.env.BASE_URL}conquest-map.webp`

export function ConquestMap() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [terr, setTerr] = useState<Territory[]>([])
  const [clans, setClans] = useState<Record<string, Clan>>({})
  const [villages, setVillages] = useState<Record<string, VillageInfo>>({})
  const [occupancy, setOccupancy] = useState<Record<string, number>>({})
  const [myClanId, setMyClanId] = useState<string | null>(null)
  const [myVillageId, setMyVillageId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [claimBusy, setClaimBusy] = useState(false)
  const [actionMessage, setActionMessage] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [hoveredClan, setHoveredClan] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [unlock, setUnlock] = useState<LandUnlock | null>(
    (location.state as { landUnlock?: LandUnlock } | null)?.landUnlock ?? null,
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const sb = supabase as unknown as {
          from: (t: string) => any
        }
        const { data } = await sb.from('territories').select('*').order('row').order('col')
        const rows = (data ?? []) as Territory[]
        const ownerIds = [...new Set(rows.map((t) => t.owner_clan_id).filter(Boolean))] as string[]
        const villageIds = [...new Set(rows.map((t) => t.owner_village_id).filter(Boolean))] as string[]
        let byId: Record<string, Clan> = {}
        let villagesById: Record<string, VillageInfo> = {}
        const occ: Record<string, number> = {}
        if (ownerIds.length) {
          try {
            const { data: cs } = await sb.from('servers').select('id, name, clan_tag').in('id', ownerIds)
            byId = Object.fromEntries(((cs ?? []) as Clan[]).map((c) => [c.id, c]))
          } catch { /* clans best-effort */ }
          // Occupancy: how many members sit in each holding clan (best-effort).
          try {
            const { data: mems } = await sb.from('clan_members').select('server_id').in('server_id', ownerIds)
            for (const m of (mems ?? []) as { server_id: string }[]) occ[m.server_id] = (occ[m.server_id] ?? 0) + 1
          } catch { /* occupancy optional */ }
        }
        if (villageIds.length) {
          try {
            const { data: villageRows } = await sb.from('villages').select('id, name').in('id', villageIds)
            villagesById = Object.fromEntries(((villageRows ?? []) as VillageInfo[]).map((village) => [village.id, village]))
          } catch { /* village labels are optional during schema rollout */ }
        }
        // Which clan am I in? (drives the "you are here" glow.)
        let mine: string | null = null
        let myVillage: string | null = null
        if (user?.id) {
          try {
            const { data: mm } = await sb.from('clan_members').select('server_id').eq('user_id', user.id)
            mine = ((mm ?? []) as { server_id: string }[])[0]?.server_id ?? null
          } catch { /* not in a clan / no table */ }
          if (mine) {
            try {
              const { data: memberships } = await sb.from('village_clans').select('village_id').eq('server_id', mine)
              myVillage = ((memberships ?? []) as { village_id: string }[])[0]?.village_id ?? null
            } catch { /* clan has not joined a village */ }
          }
        }
        if (alive) {
          setTerr(rows)
          setClans(byId)
          setVillages(villagesById)
          setOccupancy(occ)
          setMyClanId(mine)
          setMyVillageId(myVillage)
        }
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [user?.id, refreshTick])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefreshTick((tick) => tick + 1)
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const land: ClanLand[] = useMemo(() => {
    const count: Record<string, number> = {}
    for (const t of terr) if (t.owner_clan_id) count[t.owner_clan_id] = (count[t.owner_clan_id] ?? 0) + 1
    return Object.entries(count).map(([clanId, n]) => ({
      clanId, land: n,
      clanName: clans[clanId]?.name ?? 'Unknown clan',
      clanTag: clans[clanId]?.clan_tag ?? null,
    }))
  }, [terr, clans])

  const board = standings(land)
  const claimed = terr.filter((t) => t.owner_clan_id).length

  const placed = useMemo(() => {
    let spare = 0
    return terr.map((t) => {
      const known = CONQUEST_POINTS[t.name.trim().toLowerCase()]
      return { t, pt: pointFor(t.name, known ? 0 : spare++) }
    })
  }, [terr])

  const influence = useMemo(() => buildInfluenceShapes(placed, clans), [placed, clans])
  const boardTotal = Math.max(1, terr.length)

  const selTerr = placed.find((p) => p.t.id === selected)?.t ?? null
  const selClan = selTerr?.owner_clan_id ? clans[selTerr.owner_clan_id] : null
  const selVillage = selTerr?.owner_village_id ? villages[selTerr.owner_village_id] : null
  const selOcc = selTerr?.owner_clan_id ? Math.max(1, occupancy[selTerr.owner_clan_id] ?? 1) : 0
  const selHold = holdDays(selTerr?.captured_at)
  const selTier = selTerr?.owner_clan_id ? artifactTierFor(selHold, selOcc) : null
  const selMine = Boolean(
    (selTerr?.owner_village_id && selTerr.owner_village_id === myVillageId)
      || (selTerr?.owner_clan_id && selTerr.owner_clan_id === myClanId),
  )

  async function actionFor(t: Territory) {
    if (!t.owner_clan_id) {
      if (!user) {
        navigate('/login', { state: { from: '/conquest', reason: 'Sign in to claim territory' } })
        return
      }
      if (!myClanId) {
        navigate('/clans/discover')
        return
      }
      if (!myVillageId) {
        navigate(`/clans/${myClanId}/manage?section=village`)
        return
      }
      setClaimBusy(true)
      setActionMessage('')
      const result = await claimVillageHome(myVillageId, t.id)
      setClaimBusy(false)
      if (!result.ok) {
        const known: Record<string, string> = {
          village_manager_required: 'A clan leader or officer must establish the village home.',
          village_home_already_claimed: 'Your village already has a home territory.',
          territory_already_claimed: 'Another village claimed this territory first. Choose another open point.',
        }
        setActionMessage(known[result.error || ''] || result.error || 'The territory could not be claimed.')
        return
      }
      setActionMessage(`${result.data?.village.name || 'Your village'} established its home at ${t.name}.`)
      setRefreshTick((tick) => tick + 1)
    } else if (selMine) {
      navigate('/tournaments', { state: { defendTerritory: t.name } })
    } else {
      navigate('/tournaments', { state: { challengeClan: t.owner_clan_id, territory: t.name } })
    }
  }

  return (
    <div className="page-shell">
      <header className="mb-5 border-b border-dark-border pb-5">
        <div className="flex items-center gap-2 text-kunai">
          <MapPinned size={16} />
          <span className="text-xs font-semibold uppercase">Clan campaign</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Shinobi Conquest</h1>
        <p className="mt-2 max-w-3xl text-sm text-gray-400">
          Clans hold land, defend it in 1v1 through 4v4 battles, and produce stronger artifacts the longer they stay in control.
        </p>
      </header>

      {actionMessage && (
        <div className="mb-4 flex items-start justify-between gap-3 border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-gray-200">
          <span>{actionMessage}</span>
          <button type="button" onClick={() => setActionMessage('')} aria-label="Dismiss" className="text-gray-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="mb-5 grid grid-cols-3 divide-x divide-dark-border border-y border-dark-border py-3">
        <ConquestStat icon={MapPinned} label="Land held" value={`${claimed}/${terr.length || 20}`} />
        <ConquestStat icon={Crown} label="Leading clans" value={String(board.length)} />
        <ConquestStat icon={Users} label="Your side" value={myClanId ? 'Active' : 'Unclaimed'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        {/* the living map */}
        <div className="relative overflow-hidden rounded-lg border border-dark-border bg-black">
          <div className="relative w-full">
            <img src={MAP_SRC} alt="The shinobi world" className="block w-full select-none" draggable={false} />

            {loading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-gray-300">
                Lighting up the map…
              </div>
            ) : (
              <>
                <svg
                  className="pointer-events-none absolute inset-0 h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  {influence.map((shape) => {
                    const active = hoveredClan === shape.clanId || selTerr?.owner_clan_id === shape.clanId
                    const color = clanColor(shape.clanId)
                    if (shape.kind === 'circle') {
                      return (
                        <circle
                          key={shape.shapeId}
                          cx={shape.center.x}
                          cy={shape.center.y}
                          r={active ? 5.6 : 4.6}
                          fill={color}
                          fillOpacity={active ? 0.3 : 0.12}
                          stroke={color}
                          strokeWidth={active ? 1.2 : 0.7}
                          vectorEffect="non-scaling-stroke"
                          className="transition-all duration-200"
                        />
                      )
                    }
                    if (shape.kind === 'line') {
                      return (
                        <g key={shape.shapeId}>
                          <line
                            x1={shape.points[0].x}
                            y1={shape.points[0].y}
                            x2={shape.points[1].x}
                            y2={shape.points[1].y}
                            stroke={color}
                            strokeWidth={active ? 7 : 5}
                            strokeLinecap="round"
                            opacity={active ? 0.3 : 0.16}
                          />
                          <line
                            x1={shape.points[0].x}
                            y1={shape.points[0].y}
                            x2={shape.points[1].x}
                            y2={shape.points[1].y}
                            stroke={color}
                            strokeWidth={active ? 1.2 : 0.7}
                            vectorEffect="non-scaling-stroke"
                          />
                        </g>
                      )
                    }
                    return (
                      <polygon
                        key={shape.shapeId}
                        points={shape.points.map((point) => `${point.x},${point.y}`).join(' ')}
                        fill={color}
                        fillOpacity={active ? 0.28 : 0.12}
                        stroke={color}
                        strokeWidth={active ? 1.2 : 0.7}
                        vectorEffect="non-scaling-stroke"
                        className="transition-all duration-200"
                      />
                    )
                  })}
                </svg>

                {influence.filter((shape) => shape.showLabel).map((shape) => {
                  const color = clanColor(shape.clanId)
                  const mine = shape.clanId === myClanId
                  return (
                    <button
                      key={`label-${shape.shapeId}`}
                      type="button"
                      onClick={() => setSelected(shape.territoryId)}
                      onMouseEnter={() => setHoveredClan(shape.clanId)}
                      onMouseLeave={() => setHoveredClan(null)}
                      className="absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded border bg-black/85 px-2 py-1 text-left shadow-lg transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-white"
                      style={{
                        left: `${shape.center.x}%`,
                        top: `${shape.center.y}%`,
                        borderColor: color,
                        color,
                        fontSize: `${Math.min(15, 10 + shape.land * 0.75)}px`,
                      }}
                    >
                      <span className="block max-w-28 truncate font-bold">
                        {shape.clan.clan_tag ? `[${shape.clan.clan_tag}]` : shape.clan.name}
                        {mine ? ' · YOU' : ''}
                      </span>
                      <span className="block text-[9px] font-medium text-gray-300">
                        {shape.land} {shape.land === 1 ? 'land' : 'lands'} · {Math.round((shape.land / boardTotal) * 100)}%
                      </span>
                    </button>
                  )
                })}

                {placed.map(({ t, pt }) => {
                  const owned = t.owner_clan_id ? clanColor(t.owner_clan_id) : null
                  const clan = t.owner_clan_id ? clans[t.owner_clan_id] : null
                  const isSel = t.id === selected
                  const mine = !!t.owner_clan_id && t.owner_clan_id === myClanId
                  const ring = owned ?? '#718096'
                  const size = pt.great ? 24 : 18
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setSelected(isSel ? null : t.id)}
                      onMouseEnter={() => setHoveredClan(t.owner_clan_id)}
                      onMouseLeave={() => setHoveredClan(null)}
                      className="conquest-point group absolute z-20 -translate-x-1/2 -translate-y-1/2"
                      style={{ left: `${pt.x}%`, top: `${pt.y}%` }}
                      aria-label={t.name}
                      title={`${t.name}${clan ? ` - ${clan.clan_tag ?? clan.name}` : ' - unclaimed'}`}
                    >
                      <span
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-transform duration-200 group-hover:scale-150"
                        style={{
                          width: size + 18,
                          height: size + 18,
                          background: `radial-gradient(circle, ${withAlpha(ring, 0.4)}, transparent 70%)`,
                          animation: owned ? 'cqpulse 2.4s ease-in-out infinite' : undefined,
                        }}
                      />
                      <span
                        className="relative block rounded-full border-2 transition-transform duration-200 group-hover:scale-125"
                        style={{
                          width: size,
                          height: size,
                          background: owned ? ring : 'rgba(10,16,30,.82)',
                          borderColor: mine ? '#ffffff' : ring,
                          boxShadow: `0 0 ${owned ? 14 : 7}px ${withAlpha(ring, owned ? 0.73 : 0.47)}${mine ? ', 0 0 20px #fff' : ''}`,
                        }}
                      />
                      <span className="absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-black/85 px-1.5 py-0.5 text-[9px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                        {t.name} · {clan ? clan.clan_tag ?? clan.name : 'Open'}
                      </span>
                      {isSel && (
                        <span
                          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white"
                          style={{ width: size + 12, height: size + 12 }}
                        />
                      )}
                    </button>
                  )
                })}
              </>
            )}
          </div>

          {/* tap-a-point detail */}
          {selTerr && (
            <div className="border-t border-dark-border bg-dark-card px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-bold text-white">{selTerr.name}</div>
                  <div className="text-xs text-gray-500">
                    {(CONQUEST_POINTS[selTerr.name.trim().toLowerCase()]?.nation) ?? 'Frontier'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-dark-elevated hover:text-white"
                  aria-label="Close territory details"
                >
                  <X size={16} />
                </button>
              </div>

              {selClan ? (
                <div className="mt-2 text-sm text-gray-300">
                  Held by{' '}
                  <span className="font-semibold" style={{ color: clanColor(selTerr.owner_clan_id!) }}>
                    {selClan.clan_tag ? `[${selClan.clan_tag}] ` : ''}{selClan.name}
                  </span>
                  {selMine && <span className="ml-1 rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white">YOUR CLAN</span>}
                  {selVillage && <p className="mt-1 text-xs font-semibold text-kunai">{selVillage.name}</p>}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
                    <span>Occupied by <span className="text-gray-200">{selOcc}</span></span>
                    <span>Held <span className="text-gray-200">{selHold}</span>d</span>
                    {selTier && (
                      <span>Producing <span className="font-semibold text-accent">{tierLabel(selTier)}</span> artifacts</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-sm text-gray-400">Unclaimed. Found a clan here — or take it in battle.</p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void actionFor(selTerr)}
                  disabled={claimBusy}
                  className="btn-primary min-h-9 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  <Swords size={15} />
                  {!selTerr.owner_clan_id
                    ? claimBusy
                      ? 'Claiming...'
                      : !user
                        ? 'Sign in to claim'
                        : !myClanId
                          ? 'Join or start a clan'
                          : !myVillageId
                            ? 'Form a village to claim'
                            : 'Claim village home'
                    : selMine ? 'Defend this land' : 'Challenge for it'}
                </button>
                {selClan && !selMine && myClanId && (!selTerr.owner_village_id || selTerr.owner_village_id !== myVillageId) && (
                  <button
                    type="button"
                    onClick={() => navigate(`/clans/${myClanId}/manage?section=village&target=${selTerr.owner_clan_id}`)}
                    className="btn-ghost min-h-9 px-3 py-1.5 text-sm"
                  >
                    <Shield size={15} />
                    Propose to unite
                  </button>
                )}
              </div>
              {selClan && !selMine && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BATTLE_FORMATS.map((f) => (
                    <span key={f} className="rounded border border-dark-border px-1.5 py-0.5 text-[10px] text-gray-400">{f}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* standings */}
        <div>
          <h2 className="text-sm font-semibold uppercase text-gray-500">Land holders</h2>
          <div className="mt-3 space-y-2">
            {board.length === 0 && (
              <div className="rounded-lg border border-dark-border bg-dark p-3 text-sm text-gray-500">
                No land held yet. Found a clan on the map and fight for territory.
              </div>
            )}
            {board.map((c) => (
              <button
                key={c.clanId}
                type="button"
                onMouseEnter={() => setHoveredClan(c.clanId)}
                onMouseLeave={() => setHoveredClan(null)}
                onClick={() => {
                  const territory = placed.find(({ t }) => t.owner_clan_id === c.clanId)
                  if (territory) setSelected(territory.t.id)
                }}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${c.clanId === myClanId ? 'border-white/40 bg-white/5' : 'border-dark-border bg-dark hover:border-gray-500'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 font-semibold text-white">
                    <span className="h-3 w-3 rounded-sm" style={{ background: clanColor(c.clanId) }} />
                    {c.clanTag ? `[${c.clanTag}] ` : ''}{c.clanName}
                    {c.clanId === myClanId && <span className="text-[10px] font-bold text-white/70">YOU</span>}
                  </span>
                  <span className="inline-flex items-center gap-1 text-sm tabular-nums text-gray-400">
                    <MapPinned size={13} />
                    {c.land}
                  </span>
                </div>
                <div className="mt-1 text-[11px] font-semibold" style={{ color: c.title.color }}>
                  {c.rank === 0 && c.title.name === 'Kage' ? kageTitle(0) : c.title.name}
                  {c.rank === 0 && <span className="ml-1 text-gray-500">· reigning</span>}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-dark-elevated">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(5, (c.land / boardTotal) * 100)}%`,
                      background: clanColor(c.clanId),
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-gray-500">
                  {Math.round((c.land / boardTotal) * 100)}% world control
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>

      <LandUnlockModal unlock={unlock} onClose={() => setUnlock(null)} />

      <style>{`@keyframes cqpulse{0%,100%{transform:translate(-50%,-50%) scale(1);opacity:.7}50%{transform:translate(-50%,-50%) scale(1.35);opacity:.25}}`}</style>
    </div>
  )
}

type InfluencePoint = { x: number; y: number }
type InfluenceShape = {
  shapeId: string
  clanId: string
  clan: Clan
  land: number
  showLabel: boolean
  territoryId: string
  center: InfluencePoint
  points: InfluencePoint[]
  kind: 'circle' | 'line' | 'polygon'
}

function buildInfluenceShapes(
  placed: { t: Territory; pt: InfluencePoint }[],
  clans: Record<string, Clan>,
): InfluenceShape[] {
  const grouped = new Map<string, { territoryId: string; point: InfluencePoint }[]>()
  for (const { t, pt } of placed) {
    if (!t.owner_clan_id || !clans[t.owner_clan_id]) continue
    const group = grouped.get(t.owner_clan_id) ?? []
    group.push({ territoryId: t.id, point: { x: pt.x, y: pt.y } })
    grouped.set(t.owner_clan_id, group)
  }

  return [...grouped.entries()].flatMap(([clanId, holdings]) => {
    const clusters = nearbyClusters(holdings, 26).sort((a, b) => b.length - a.length)
    return clusters.map((cluster, index) => {
      const points = cluster.map((item) => item.point)
      const center = points.reduce(
        (sum, point) => ({ x: sum.x + point.x / points.length, y: sum.y + point.y / points.length }),
        { x: 0, y: 0 },
      )
      const hull = points.length > 2 ? expandHull(convexHull(points), center, 4) : points
      return {
        shapeId: `${clanId}-${index}`,
        clanId,
        clan: clans[clanId],
        land: holdings.length,
        showLabel: index === 0,
        territoryId: cluster[0].territoryId,
        center,
        points: hull,
        kind: points.length === 1 ? 'circle' : points.length === 2 ? 'line' : 'polygon',
      }
    })
  })
}

function nearbyClusters(
  holdings: { territoryId: string; point: InfluencePoint }[],
  maxDistance: number,
): { territoryId: string; point: InfluencePoint }[][] {
  const remaining = new Set(holdings.map((_, index) => index))
  const clusters: { territoryId: string; point: InfluencePoint }[][] = []
  while (remaining.size) {
    const first = remaining.values().next().value as number
    remaining.delete(first)
    const queue = [first]
    const cluster: { territoryId: string; point: InfluencePoint }[] = []
    while (queue.length) {
      const current = queue.shift() as number
      cluster.push(holdings[current])
      for (const candidate of [...remaining]) {
        const a = holdings[current].point
        const b = holdings[candidate].point
        if (Math.hypot(a.x - b.x, a.y - b.y) <= maxDistance) {
          remaining.delete(candidate)
          queue.push(candidate)
        }
      }
    }
    clusters.push(cluster)
  }
  return clusters
}

function convexHull(points: InfluencePoint[]): InfluencePoint[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: InfluencePoint, a: InfluencePoint, b: InfluencePoint) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: InfluencePoint[] = []
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop()
    lower.push(point)
  }
  const upper: InfluencePoint[] = []
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop()
    upper.push(point)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

function expandHull(points: InfluencePoint[], center: InfluencePoint, amount: number): InfluencePoint[] {
  return points.map((point) => {
    const dx = point.x - center.x
    const dy = point.y - center.y
    const length = Math.hypot(dx, dy) || 1
    return {
      x: Math.max(1, Math.min(99, point.x + (dx / length) * amount)),
      y: Math.max(1, Math.min(99, point.y + (dy / length) * amount)),
    }
  })
}

function ConquestStat({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof MapPinned
  label: string
  value: string
}) {
  return (
    <div className="flex min-w-0 items-center justify-center gap-2 px-2 text-center sm:gap-3">
      <Icon size={16} className="hidden shrink-0 text-gray-500 sm:block" />
      <div className="min-w-0">
        <div className="truncate text-xs text-gray-500">{label}</div>
        <div className="truncate text-sm font-semibold text-white">{value}</div>
      </div>
    </div>
  )
}
