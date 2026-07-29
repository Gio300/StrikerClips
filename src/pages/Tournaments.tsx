import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  CalendarDays,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Trophy,
  Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { TkoKingHero } from '@/components/TkoKingHero'
import type { Tournament, TournamentStatus } from '@/types/database'

type TournamentRow = Pick<
  Tournament,
  'id' | 'name' | 'description' | 'status' | 'created_at' | 'created_by' | 'start_at' | 'end_at'
>

const FILTERS = ['all', 'open', 'live', 'closed', 'draft'] as const

export function Tournaments() {
  const { user } = useAuth()
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | TournamentStatus>('all')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('tournaments')
        .select('*')
        .order('start_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      setTournaments((data ?? []) as TournamentRow[])
      setLoading(false)
    }
    void load()
  }, [])

  const filtered = statusFilter === 'all'
    ? tournaments
    : tournaments.filter((tournament) => tournament.status === statusFilter)

  return (
    <div className="page-shell">
      <header className="mb-5 flex flex-col gap-4 border-b border-dark-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-kunai">
            <Trophy size={16} />
            <span className="text-xs font-semibold uppercase">Competition hub</span>
          </div>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Tournaments</h1>
          <p className="mt-2 max-w-2xl text-sm text-gray-400">
            Run brackets, verify players, stream every round, and build clan prestige through open competition.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/stat-check-room" className="btn-ghost">
            <ShieldCheck size={17} />
            Stat checks
          </Link>
          {user && !showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary">
              <Plus size={17} />
              Create
            </button>
          )}
        </div>
      </header>

      <TkoKingHero />

      <div className="my-5 flex items-center gap-2 overflow-x-auto border-b border-dark-border pb-3">
        <SlidersHorizontal size={15} className="shrink-0 text-gray-500" />
        {FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStatusFilter(filter)}
            className={`min-h-8 shrink-0 rounded-lg px-3 text-xs font-semibold capitalize transition-colors ${
              statusFilter === filter
                ? 'bg-white text-dark'
                : 'text-gray-400 hover:bg-dark-elevated hover:text-white'
            }`}
          >
            {filter}
          </button>
        ))}
      </div>

      {showCreate && user && (
        <CreateTournamentForm
          userId={user.id}
          onCancel={() => setShowCreate(false)}
          onCreated={(tournament) => {
            setTournaments((current) => [tournament, ...current])
            setShowCreate(false)
          }}
        />
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          {[0, 1].map((item) => (
            <div key={item} className="h-48 animate-pulse rounded-lg border border-dark-border bg-dark-card" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex min-h-56 flex-col items-center justify-center rounded-lg border border-dashed border-dark-border bg-dark-card/60 p-6 text-center">
          <Trophy size={32} className="mb-3 text-gray-600" />
          <p className="text-sm text-gray-400">
            {statusFilter === 'all'
              ? 'No tournaments have been created yet.'
              : `No ${statusFilter} tournaments right now.`}
          </p>
          {user && statusFilter === 'all' && !showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
              <Plus size={17} />
              Create the first tournament
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((tournament) => (
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      )}
    </div>
  )
}

function TournamentCard({ tournament }: { tournament: TournamentRow }) {
  return (
    <Link
      to={`/tournaments/${tournament.id}`}
      className="group flex min-h-48 flex-col rounded-lg border border-dark-border bg-dark-card p-5 transition-colors hover:border-gray-500"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dark-elevated text-kunai">
            <Swords size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-white">{tournament.name}</h2>
            <p className="mt-0.5 text-xs text-gray-500">Verified community competition</p>
          </div>
        </div>
        <StatusPill status={tournament.status as TournamentStatus} />
      </div>

      {tournament.description && (
        <p className="mt-4 line-clamp-2 text-sm text-gray-400">{tournament.description}</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <Users size={14} />
          Open registration
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck size={14} />
          Stat checks
        </span>
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays size={14} />
          {tournament.start_at ? formatStart(tournament.start_at) : 'Date TBD'}
        </span>
        <ArrowRight size={15} className="ml-auto text-gray-600 transition-colors group-hover:text-white" />
      </div>
    </Link>
  )
}

function formatStart(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function StatusPill({ status }: { status: TournamentStatus | undefined }) {
  if (!status) return null
  const map: Record<TournamentStatus, { cls: string; label: string }> = {
    draft: { cls: 'border-gray-500/40 bg-gray-500/10 text-gray-400', label: 'Draft' },
    open: { cls: 'border-leaf/40 bg-leaf/10 text-leaf', label: 'Open' },
    live: { cls: 'border-kunai/40 bg-kunai/10 text-kunai', label: 'Live' },
    closed: { cls: 'border-dark-border bg-dark text-gray-500', label: 'Closed' },
  }
  const item = map[status]

  return (
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${item.cls}`}>
      {item.label}
    </span>
  )
}

function CreateTournamentForm({
  userId,
  onCancel,
  onCreated,
}: {
  userId: string
  onCancel: () => void
  onCreated: (tournament: TournamentRow) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState(
    'Default rules:\n- No banned characters or buffs.\n- All matches recorded.\n- Stat check video required for entry.',
  )
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [status, setStatus] = useState<TournamentStatus>('open')
  const [serverId, setServerId] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [servers, setServers] = useState<{ id: string; name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadClans() {
      const { data: members } = await supabase
        .from('server_members')
        .select('server_id')
        .eq('user_id', userId)
      const ids = (members ?? []).map((member) => member.server_id)
      if (ids.length === 0) {
        setServers([])
        return
      }
      const { data: rows } = await supabase
        .from('servers')
        .select('id, name')
        .in('id', ids)
      setServers((rows ?? []) as { id: string; name: string }[])
    }
    void loadClans()
  }, [userId])

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError('')

    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      rules: rules.trim() || null,
      created_by: userId,
      status,
      start_at: startAt ? new Date(startAt).toISOString() : null,
      end_at: endAt ? new Date(endAt).toISOString() : null,
      server_id: serverId || null,
    }

    const { data, error: insertError } = await supabase
      .from('tournaments')
      .insert(payload)
      .select('id, name, description, status, created_at, created_by, start_at, end_at')
      .single()

    setSubmitting(false)
    if (insertError || !data) {
      setError(insertError?.message ?? 'Could not create tournament.')
      return
    }
    onCreated(data as TournamentRow)
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 space-y-5 rounded-lg border border-dark-border bg-dark-card p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">Create tournament</h2>
          <p className="mt-1 text-xs text-gray-500">Players compete for rank, artifacts, and clan prestige.</p>
        </div>
        <button
          type="button"
          onClick={() => setAdvanced((current) => !current)}
          className="btn-ghost shrink-0 text-sm"
        >
          <SlidersHorizontal size={15} />
          {advanced ? 'Basic' : 'Advanced'}
        </button>
      </div>

      <Field label="Name" required>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Spring Showdown"
          className="field"
          required
        />
      </Field>

      <Field label="Description">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
          placeholder="A short description for the tournament list."
          className="field resize-none"
        />
      </Field>

      {!advanced && (
        <p className="text-xs text-gray-500">
          This opens registration immediately with standard stat-check rules. Use Advanced for schedule, clan, and rules.
        </p>
      )}

      {advanced && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as TournamentStatus)}
                className="field"
              >
                <option value="draft">Draft</option>
                <option value="open">Open registration</option>
                <option value="live">Live now</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
            <Field label="Host clan">
              <select value={serverId} onChange={(event) => setServerId(event.target.value)} className="field">
                <option value="">Community tournament</option>
                {servers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date and time">
              <input
                type="datetime-local"
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                className="field"
              />
            </Field>
            <Field label="End date and time">
              <input
                type="datetime-local"
                value={endAt}
                onChange={(event) => setEndAt(event.target.value)}
                className="field"
              />
            </Field>
          </div>

          <Field label="Rules" hint="Players agree to these rules before entering or submitting a stat check.">
            <textarea
              value={rules}
              onChange={(event) => setRules(event.target.value)}
              rows={6}
              className="field resize-y font-mono"
            />
          </Field>

          {servers.length === 0 && (
            <p className="text-xs text-gray-500">
              Want a clan-hosted event? <Link to="/boards/create" className="text-accent hover:underline">Create a clan</Link>.
            </p>
          )}
        </>
      )}

      {error && <p className="text-sm text-kunai">{error}</p>}

      <div className="flex gap-2">
        <button type="submit" disabled={submitting || !name.trim()} className="btn-primary">
          {submitting ? 'Creating...' : 'Create tournament'}
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
      </div>
    </form>
  )
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-gray-400">
        {label}
        {required && <span className="ml-0.5 text-kunai">*</span>}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-gray-500">{hint}</span>}
    </label>
  )
}
