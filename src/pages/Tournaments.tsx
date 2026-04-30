import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Tournament, TournamentStatus } from '@/types/database'

type TournamentRow = Pick<
  Tournament,
  'id' | 'name' | 'description' | 'status' | 'created_at' | 'created_by' | 'start_at' | 'end_at'
>

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
        .select('id, name, description, status, created_at, created_by, start_at, end_at')
        .order('start_at', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false })
      setTournaments((data ?? []) as TournamentRow[])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = statusFilter === 'all' ? tournaments : tournaments.filter((t) => t.status === statusFilter)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold mb-1">Tournaments</h1>
          <p className="text-gray-400">
            Browse open tournaments, enter the ones you want to play, and see results from the ones you ran.
          </p>
        </div>
        {user && !showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg bg-accent text-dark font-medium hover:bg-accent/90"
          >
            Create tournament
          </button>
        )}
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-1 mt-4 mb-6">
        {(['all', 'open', 'live', 'closed', 'draft'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1 rounded-full text-xs uppercase tracking-wider transition-colors ${
              statusFilter === s
                ? 'bg-accent text-dark'
                : 'border border-dark-border text-gray-400 hover:border-accent/50'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      {showCreate && user && (
        <CreateTournamentForm
          userId={user.id}
          onCancel={() => setShowCreate(false)}
          onCreated={(t) => {
            setTournaments((prev) => [t, ...prev])
            setShowCreate(false)
          }}
        />
      )}

      {loading ? (
        <div className="animate-pulse text-gray-400">Loading tournaments...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <p className="text-gray-400 mb-4">
            {statusFilter === 'all'
              ? 'No tournaments yet.'
              : `No ${statusFilter} tournaments right now.`}
          </p>
          {user && statusFilter === 'all' && !showCreate && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-accent hover:underline"
            >
              Create one
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((t) => (
            <Link
              key={t.id}
              to={`/tournaments/${t.id}`}
              className="block rounded-xl border border-dark-border bg-dark-card p-6 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="font-semibold text-lg">{t.name}</h2>
                <StatusPill status={t.status as TournamentStatus} />
              </div>
              {t.description && (
                <p className="text-gray-400 text-sm mt-1 line-clamp-2">{t.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-gray-500">
                {t.start_at ? (
                  <span>
                    Starts {new Date(t.start_at).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                ) : (
                  <span>Date TBD</span>
                )}
                {t.end_at && (
                  <span>· ends {new Date(t.end_at).toLocaleDateString()}</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: TournamentStatus | undefined }) {
  if (!status) return null
  const map: Record<TournamentStatus, { cls: string; label: string }> = {
    draft: { cls: 'border-gray-500/40 bg-gray-500/10 text-gray-400', label: 'Draft' },
    open: { cls: 'border-leaf/40 bg-leaf/10 text-leaf', label: 'Open' },
    live: { cls: 'border-kunai/40 bg-kunai/10 text-kunai animate-pulse', label: 'Live' },
    closed: { cls: 'border-dark-border bg-dark text-gray-500', label: 'Closed' },
  }
  const m = map[status]
  if (!m) return null
  return (
    <span className={`text-[11px] px-2 py-0.5 rounded-full border uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  CreateTournamentForm — full organizer setup in one screen.
//  Captures: name, description, rules, schedule, optional host clan,
//  initial status (draft / open).
// ─────────────────────────────────────────────────────────────────────────

function CreateTournamentForm({
  userId,
  onCancel,
  onCreated,
}: {
  userId: string
  onCancel: () => void
  onCreated: (t: TournamentRow) => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState(
    'Default rules:\n- No banned characters or buffs.\n- All matches recorded.\n- Stat check video required for entry.',
  )
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [status, setStatus] = useState<TournamentStatus>('open')
  const [serverId, setServerId] = useState<string>('')
  const [prizePool, setPrizePool] = useState('')

  const [servers, setServers] = useState<{ id: string; name: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // Pull only the servers (clans) the user is a member of — they shouldn't
  // be able to host a tournament under someone else's clan.
  useEffect(() => {
    async function load() {
      const { data: members } = await supabase
        .from('server_members')
        .select('server_id')
        .eq('user_id', userId)
      const ids = (members ?? []).map((m) => m.server_id)
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
    load()
  }, [userId])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setError('')

    const payload: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      rules: rules.trim() || null,
      created_by: userId,
      status,
      prize_pool: prizePool.trim() || null,
      start_at: startAt ? new Date(startAt).toISOString() : null,
      end_at: endAt ? new Date(endAt).toISOString() : null,
      server_id: serverId || null,
    }

    const { data, error: err } = await supabase
      .from('tournaments')
      .insert(payload)
      .select('id, name, description, status, created_at, created_by, start_at, end_at')
      .single()

    setSubmitting(false)
    if (err || !data) {
      setError(err?.message ?? 'Could not create tournament.')
      return
    }
    onCreated(data as TournamentRow)
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-dark-border bg-dark-card p-6 mb-6 space-y-5">
      <h2 className="font-semibold text-lg">Create tournament</h2>

      {/* Basics */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. ReelOne Spring Showdown"
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            required
          />
        </Field>
        <Field label="Status">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TournamentStatus)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
          >
            <option value="draft">Draft (only you can see it)</option>
            <option value="open">Open (players can enter)</option>
            <option value="live">Live (in progress)</option>
            <option value="closed">Closed</option>
          </select>
        </Field>
      </div>

      <Field label="Description (short tagline)">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="One-liner that shows up on the tournaments list."
          className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white resize-none"
        />
      </Field>

      {/* Schedule */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Start date / time">
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
          />
        </Field>
        <Field label="End date / time (optional)">
          <input
            type="datetime-local"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
          />
        </Field>
      </div>

      {/* Host clan + prize pool */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Host clan / server (optional)">
          <select
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
          >
            <option value="">No host — community tournament</option>
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {servers.length === 0 && (
            <p className="text-[11px] text-gray-500 mt-1">
              You're not in any clans yet.{' '}
              <Link to="/servers/new" className="text-accent hover:underline">
                Create one
              </Link>{' '}
              to host under it (e.g. KMH).
            </p>
          )}
        </Field>
        <Field label="Prize pool (optional)">
          <input
            type="text"
            value={prizePool}
            onChange={(e) => setPrizePool(e.target.value)}
            placeholder="e.g. $500 cash + ReelOne Pro"
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
          />
        </Field>
      </div>

      {/* Rules */}
      <Field
        label="Rules"
        hint="Players must agree to these rules before they can enter and submit a stat check."
      >
        <textarea
          value={rules}
          onChange={(e) => setRules(e.target.value)}
          rows={6}
          className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white resize-y font-mono text-sm"
        />
      </Field>

      {error && <p className="text-kunai text-sm">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="px-4 py-2 rounded-lg bg-accent text-dark font-medium disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create tournament'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-dark-border text-gray-400 hover:border-accent/40"
        >
          Cancel
        </button>
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
      <span className="block text-sm text-gray-400 mb-1">
        {label}
        {required && <span className="text-kunai ml-0.5">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[11px] text-gray-500 mt-1">{hint}</span>}
    </label>
  )
}
