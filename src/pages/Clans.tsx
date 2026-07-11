import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { AdSlot } from '@/components/AdSlot'
import ClanEmblem, { ICONS } from '@/components/ClanEmblem'
import { listClans, createClan } from '@/lib/clans'
import type { Clan, ClanJoinMode } from '@/types/database'

const JOIN_MODES: { value: ClanJoinMode; label: string }[] = [
  { value: 'open', label: 'Open — anyone can join' },
  { value: 'request', label: 'Request — approval required' },
  { value: 'invite', label: 'Invite only' },
]

export default function Clans() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [clans, setClans] = useState<Clan[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  // Create-clan form state.
  const [tag, setTag] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState<string>(ICONS[0])
  const [bg, setBg] = useState('#ef4444')
  const [fg, setFg] = useState('#0a0814')
  const [joinMode, setJoinMode] = useState<ClanJoinMode>('open')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const rows = await listClans()
        if (!cancelled) setClans(rows)
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load clans.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!user) {
      setFormError('Sign in to create a clan.')
      return
    }
    const cleanTag = tag.trim().toUpperCase()
    if (cleanTag.length < 2 || cleanTag.length > 6) {
      setFormError('Tag must be 2–6 characters.')
      return
    }
    if (!name.trim()) {
      setFormError('Enter a clan name.')
      return
    }
    setCreating(true)
    try {
      const clan = await createClan({
        tag: cleanTag,
        name: name.trim(),
        description: description.trim() || null,
        emblem_icon: icon,
        emblem_bg: bg,
        emblem_fg: fg,
        join_mode: joinMode,
      })
      navigate(`/clans/${clan.id}`)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create clan.')
      setCreating(false)
    }
  }

  const topClans = clans.slice(0, 3)
  const restClans = clans.slice(3)

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      {/* Hero */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold">Clans</h1>
          <p className="text-gray-400 mt-1">
            Form a squad, rep your tag, climb the points leaderboard.
          </p>
        </div>
        <button
          onClick={() => setShowCreate((v) => !v)}
          className="btn-primary self-start sm:self-auto"
        >
          {showCreate ? 'Close' : 'Create clan'}
        </button>
      </div>

      <AdSlot slotId="landing-mid" shape="leaderboard" className="mb-6" />

      {/* Create panel */}
      {showCreate && (
        <form onSubmit={handleCreate} className="card p-5 mb-8 space-y-4">
          <h2 className="text-lg font-semibold">Start a clan</h2>

          <div className="flex flex-col sm:flex-row gap-4">
            <div className="sm:w-28">
              <label className="block text-sm text-gray-400 mb-1">Tag</label>
              <input
                type="text"
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                maxLength={6}
                placeholder="KILL"
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white font-mono uppercase focus:outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Killcam Legends"
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={280}
              rows={2}
              placeholder="Who are you and who should join?"
              className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent resize-none"
            />
          </div>

          {/* Emblem builder */}
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex items-center gap-3">
              <ClanEmblem icon={icon} bg={bg} fg={fg} size={64} />
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <span className="w-14">Back</span>
                  <input
                    type="color"
                    value={bg}
                    onChange={(e) => setBg(e.target.value)}
                    className="h-7 w-10 rounded bg-transparent border border-dark-border"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-400">
                  <span className="w-14">Icon</span>
                  <input
                    type="color"
                    value={fg}
                    onChange={(e) => setFg(e.target.value)}
                    className="h-7 w-10 rounded bg-transparent border border-dark-border"
                  />
                </label>
              </div>
            </div>

            <div className="flex-1">
              <label className="block text-sm text-gray-400 mb-1">Icon</label>
              <div className="flex flex-wrap gap-2">
                {ICONS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setIcon(key)}
                    title={key}
                    className={`rounded-lg p-0.5 border transition-colors ${
                      icon === key ? 'border-accent' : 'border-dark-border hover:border-gray-500'
                    }`}
                  >
                    <ClanEmblem icon={key} bg={bg} fg={fg} size={40} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="sm:w-72">
            <label className="block text-sm text-gray-400 mb-1">Join mode</label>
            <select
              value={joinMode}
              onChange={(e) => setJoinMode(e.target.value as ClanJoinMode)}
              className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            >
              {JOIN_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {formError && <p className="text-kunai text-sm">{formError}</p>}

          <div className="flex items-center gap-3">
            <button type="submit" disabled={creating} className="btn-primary">
              {creating ? 'Creating…' : 'Create clan'}
            </button>
            {!user && (
              <span className="text-sm text-gray-500">
                <Link to="/login" className="text-accent hover:underline">
                  Log in
                </Link>{' '}
                to create one.
              </span>
            )}
          </div>
        </form>
      )}

      {/* Leaderboard */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold">Leaderboard</h2>
        <span className="text-xs uppercase tracking-wider text-gray-500">by points</span>
      </div>

      {loading ? (
        <div className="py-16 flex items-center justify-center">
          <div className="animate-pulse text-accent">Loading clans…</div>
        </div>
      ) : loadError ? (
        <p className="text-kunai text-sm py-8">{loadError}</p>
      ) : clans.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p>No clans yet. Be the first to plant a flag.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {topClans.map((clan, i) => (
            <ClanRow key={clan.id} clan={clan} rank={i + 1} />
          ))}

          {restClans.length > 0 && (
            <AdSlot slotId="feed-inline" shape="banner" className="my-4" />
          )}

          {restClans.map((clan, i) => (
            <ClanRow key={clan.id} clan={clan} rank={i + 4} />
          ))}
        </div>
      )}
    </div>
  )
}

function rankColor(rank: number): string {
  if (rank === 1) return 'text-chakra'
  if (rank === 2) return 'text-gray-300'
  if (rank === 3) return 'text-kunai'
  return 'text-gray-500'
}

function ClanRow({ clan, rank }: { clan: Clan; rank: number }) {
  return (
    <Link to={`/clans/${clan.id}`} className="card card-hover flex items-center gap-3 sm:gap-4 p-3">
      <div className={`w-7 shrink-0 text-center text-lg font-bold tabular-nums ${rankColor(rank)}`}>
        {rank}
      </div>
      <ClanEmblem clan={clan} size={44} />
      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">
          <span className="text-chakra font-mono mr-1.5">[{clan.tag}]</span>
          {clan.name}
        </div>
        <div className="text-xs text-gray-400 mt-0.5">
          {clan.member_count} {clan.member_count === 1 ? 'member' : 'members'}
        </div>
      </div>
      <div className="hidden sm:block text-sm tabular-nums">
        <span className="text-leaf">{clan.wins}W</span>
        <span className="text-gray-600 mx-1">/</span>
        <span className="text-kunai">{clan.losses}L</span>
      </div>
      <div className="text-right shrink-0">
        <div className="text-lg font-bold text-accent tabular-nums">{clan.points.toLocaleString()}</div>
        <div className="text-[10px] uppercase tracking-wider text-gray-500">points</div>
      </div>
    </Link>
  )
}
