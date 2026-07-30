import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  Crown,
  GitBranch,
  LogIn,
  Plus,
  Search,
  SlidersHorizontal,
  Swords,
  Trophy,
  Users,
  UsersRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { isKingPit } from '@/lib/tkoKing'
import type { Tournament, TournamentStatus } from '@/types/database'

type TournamentRow = Pick<
  Tournament,
  'id' | 'name' | 'description' | 'status' | 'created_at' | 'created_by' | 'start_at' | 'end_at' | 'format'
>

const FILTERS = ['all', 'open', 'live', 'closed', 'draft'] as const

type TournamentTarget = 'king_1v1' | 'clan_battle' | 'open_bracket'
type TournamentWizardStep = 'target' | 'configure' | 'review'

const TOURNAMENT_TARGETS = {
  king_1v1: {
    title: 'TKO King 1v1',
    description: 'A focused head-to-head challenge for two Shinobi.',
    defaultDescription: 'A head-to-head 1v1 challenge to find the stronger Shinobi.',
    defaultRules:
      'TKO King 1v1 rules:\n- One player versus one player.\n- All matches must be recorded.\n- Stat check video is required for entry.\n- The host verifies the final result.',
    Icon: Crown,
  },
  clan_battle: {
    title: 'Clan Battle',
    description: 'Put two crews into a structured team competition.',
    defaultDescription: 'A team competition for clans to settle a matchup and build prestige.',
    defaultRules:
      'Clan Battle rules:\n- Each clan confirms its active roster.\n- All matches must be recorded.\n- Stat check video is required for entry.\n- The host verifies the final result.',
    Icon: UsersRound,
  },
  open_bracket: {
    title: 'Open Community Bracket',
    description: 'Open registration and let the community compete.',
    defaultDescription: 'An open community bracket with verified players and recorded results.',
    defaultRules:
      'Open bracket rules:\n- Registration is open to eligible players.\n- All matches must be recorded.\n- Stat check video is required for entry.\n- The host verifies the final result.',
    Icon: GitBranch,
  },
} as const

export function Tournaments() {
  const { user, loading: authLoading } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tournaments, setTournaments] = useState<TournamentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | TournamentStatus>('all')
  const [query, setQuery] = useState('')
  const createRequested = searchParams.get('create') === '1'

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

  useEffect(() => {
    if (user && createRequested) setShowCreate(true)
  }, [createRequested, user])

  function closeCreate() {
    setShowCreate(false)
    if (!createRequested) return
    const next = new URLSearchParams(searchParams)
    next.delete('create')
    setSearchParams(next, { replace: true })
  }

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return tournaments.filter((tournament) => {
      if (isKingPit(tournament)) return false
      if (statusFilter !== 'all' && tournament.status !== statusFilter) return false
      if (!normalizedQuery) return true
      return `${tournament.name} ${tournament.description ?? ''}`.toLowerCase().includes(normalizedQuery)
    })
  }, [query, statusFilter, tournaments])
  const signInReturn = createRequested ? '/tournaments?create=1' : '/tournaments'

  return (
    <div className="page-shell pb-44 sm:pb-32">
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
          {user && !showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary hidden sm:inline-flex">
              <Plus size={17} />
              Create tournament
            </button>
          )}
          {!authLoading && !user && (
            <Link
              to="/login"
              state={{
                from: signInReturn,
                reason: 'Sign in to create a tournament',
              }}
              className="btn-primary"
            >
              <LogIn size={17} />
              Sign in to create
            </Link>
          )}
        </div>
      </header>

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Search tournaments</span>
          <Search
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tournaments, clans, or formats"
            className="h-11 w-full rounded-lg border border-dark-border bg-dark-card pl-10 pr-4 text-sm text-white outline-none transition-colors placeholder:text-gray-600 focus:border-kunai"
          />
        </label>
        {user && !showCreate && (
          <button onClick={() => setShowCreate(true)} className="btn-primary h-11 sm:hidden">
            <Plus size={17} />
            Create
          </button>
        )}
      </div>

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
          onCancel={closeCreate}
          onCreated={(tournament) => {
            setTournaments((current) => [tournament, ...current])
            closeCreate()
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
            {query.trim()
              ? `No tournaments match "${query.trim()}".`
              : statusFilter === 'all'
              ? 'No tournaments have been created yet.'
              : `No ${statusFilter} tournaments right now.`}
          </p>
          {user && statusFilter === 'all' && !showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4">
              <Plus size={17} />
              Create the first tournament
            </button>
          )}
          {!authLoading && !user && statusFilter === 'all' && (
            <Link
              to="/login"
              state={{
                from: signInReturn,
                reason: 'Sign in to create a tournament',
              }}
              className="btn-primary mt-4"
            >
              <LogIn size={17} />
              Sign in to create
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((tournament) => (
            <TournamentCard key={tournament.id} tournament={tournament} />
          ))}
        </div>
      )}

      <TkoKingDock />
    </div>
  )
}

function TkoKingDock() {
  return (
    <aside className="fixed bottom-[calc(8.5rem+env(safe-area-inset-bottom))] left-3 right-3 z-40 sm:bottom-5 sm:left-1/2 sm:right-auto sm:w-[26rem] sm:-translate-x-1/2">
      <Link
        to="/king"
        className="flex min-h-16 items-center gap-3 rounded-lg border border-kunai/50 bg-dark-card/95 px-3 py-3 shadow-2xl backdrop-blur-md transition-colors hover:border-kunai"
        aria-label="Open the TKO King ladder"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kunai/15 text-kunai">
          <Crown size={21} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <strong className="truncate text-sm text-white">TKO King</strong>
            <span className="rounded-full border border-leaf/30 bg-leaf/10 px-2 py-0.5 text-[9px] font-semibold uppercase text-leaf">
              Always open
            </span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-gray-400">The permanent 1-on-1 ladder</span>
        </span>
        <span className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg bg-kunai px-3 text-xs font-bold text-dark">
          Enter
          <ArrowRight size={14} />
        </span>
      </Link>
    </aside>
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
  const [step, setStep] = useState<TournamentWizardStep>('target')
  const [target, setTarget] = useState<TournamentTarget | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [rules, setRules] = useState('')
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

  function chooseTarget(nextTarget: TournamentTarget) {
    const preset = TOURNAMENT_TARGETS[nextTarget]
    setTarget(nextTarget)
    setDescription(preset.defaultDescription)
    setRules(preset.defaultRules)
    setServerId('')
    setAdvanced(false)
    setError('')
    setStep('configure')
  }

  function reviewTournament() {
    if (!name.trim() || !target) return
    setError('')
    setStep('review')
  }

  async function createTournament() {
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

  const preset = target ? TOURNAMENT_TARGETS[target] : null
  const selectedServer = servers.find((server) => server.id === serverId)

  return (
    <section className="mb-6 rounded-lg border border-dark-border bg-dark-card p-5">
      <WizardProgress step={step} />

      {step === 'target' && (
        <div className="mt-5">
          <h2 className="text-lg font-semibold text-white">What are you running?</h2>
          <p className="mt-1 text-sm text-gray-400">Choose the closest format.</p>

          <div className="mt-4 grid gap-2">
            {(Object.entries(TOURNAMENT_TARGETS) as [
              TournamentTarget,
              (typeof TOURNAMENT_TARGETS)[TournamentTarget],
            ][]).map(([id, option]) => {
              const Icon = option.Icon
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => chooseTarget(id)}
                  className="group flex min-h-20 w-full items-center gap-4 rounded-lg border border-dark-border px-4 py-3 text-left transition-colors hover:border-kunai/60 hover:bg-dark-elevated"
                >
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-dark-elevated text-kunai">
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-white">{option.title}</span>
                    <span className="mt-0.5 block text-sm text-gray-400">{option.description}</span>
                  </span>
                  <ArrowRight size={18} className="shrink-0 text-gray-600 transition-colors group-hover:text-kunai" />
                </button>
              )
            })}
          </div>

          <button type="button" onClick={onCancel} className="btn-ghost mt-4">Cancel</button>
        </div>
      )}

      {step === 'configure' && preset && target && (
        <div className="mt-5">
          <WizardHeading
            title="Configure tournament"
            backLabel="Choose another format"
            onBack={() => setStep('target')}
            icon={<preset.Icon size={20} />}
            context={preset.title}
          />

          <div className="mt-5 space-y-4">
            <Field label="Tournament name" required>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={
                  target === 'king_1v1'
                    ? 'Friday Night 1v1'
                    : target === 'clan_battle'
                      ? 'AI Clan vs Rival Squad'
                      : 'Summer Community Cup'
                }
                className="field"
                required
                autoFocus
              />
            </Field>

            <Field label="Description">
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                placeholder="Tell players what they are entering."
                className="field resize-none"
              />
            </Field>

            {target === 'clan_battle' && (
              <Field label="Host clan">
                <select value={serverId} onChange={(event) => setServerId(event.target.value)} className="field">
                  <option value="">Community hosted</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.id}>{server.name}</option>
                  ))}
                </select>
                {servers.length === 0 && (
                  <span className="mt-1 block text-xs text-gray-500">
                    No clan yet. <Link to="/boards/create" className="text-accent hover:underline">Create one first</Link>.
                  </span>
                )}
              </Field>
            )}

            <button
              type="button"
              onClick={() => setAdvanced((current) => !current)}
              aria-expanded={advanced}
              className="flex min-h-11 w-full items-center justify-between rounded-lg border border-dark-border px-3 text-sm font-semibold text-gray-300 transition-colors hover:border-gray-500 hover:text-white"
            >
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal size={16} />
                Advanced settings
              </span>
              <ChevronDown
                size={17}
                className={`transition-transform ${advanced ? 'rotate-180' : ''}`}
              />
            </button>

            {advanced && (
              <div className="space-y-4 border-l-2 border-dark-border pl-4">
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
                  {target !== 'clan_battle' && (
                    <Field label="Host clan">
                      <select value={serverId} onChange={(event) => setServerId(event.target.value)} className="field">
                        <option value="">Community hosted</option>
                        {servers.map((server) => (
                          <option key={server.id} value={server.id}>{server.name}</option>
                        ))}
                      </select>
                    </Field>
                  )}
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
              </div>
            )}
          </div>

          {error && <p className="mt-4 text-sm text-kunai">{error}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={reviewTournament}
              disabled={!name.trim()}
              className="btn-primary"
            >
              Review
              <ArrowRight size={17} />
            </button>
            <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}

      {step === 'review' && preset && (
        <div className="mt-5">
          <WizardHeading
            title="Review tournament"
            backLabel="Edit tournament"
            onBack={() => setStep('configure')}
            icon={<Check size={20} />}
            context="Ready to create"
          />

          <dl className="mt-5 divide-y divide-dark-border border-y border-dark-border">
            <ReviewRow label="Format" value={preset.title} />
            <ReviewRow label="Name" value={name.trim()} />
            <ReviewRow label="Registration" value={statusLabel(status)} />
            <ReviewRow label="Host" value={selectedServer?.name ?? 'Community hosted'} />
            <ReviewRow label="Starts" value={startAt ? formatStart(new Date(startAt).toISOString()) : 'Date TBD'} />
            <ReviewRow
              label="Rules"
              value={rules.trim().split('\n').filter(Boolean)[0] ?? 'Standard recorded-match rules'}
            />
          </dl>

          {description.trim() && <p className="mt-4 text-sm text-gray-400">{description.trim()}</p>}
          {error && <p className="mt-4 text-sm text-kunai">{error}</p>}

          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void createTournament()}
              disabled={submitting}
              className="btn-primary"
            >
              {submitting ? 'Creating...' : 'Create tournament'}
            </button>
            <button type="button" onClick={() => setStep('configure')} className="btn-ghost">
              Edit
            </button>
            <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button>
          </div>
        </div>
      )}
    </section>
  )
}

function WizardProgress({ step }: { step: TournamentWizardStep }) {
  const activeIndex = step === 'target' ? 0 : step === 'configure' ? 1 : 2
  const labels = ['Target', 'Configure', 'Review']

  return (
    <div aria-label={`Step ${activeIndex + 1} of 3: ${labels[activeIndex]}`}>
      <div className="flex gap-1.5">
        {labels.map((label, index) => (
          <span
            key={label}
            className={`h-1.5 flex-1 rounded-full ${index <= activeIndex ? 'bg-kunai' : 'bg-dark-elevated'}`}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="font-semibold text-white">Step {activeIndex + 1} of 3</span>
        <span className="text-gray-500">{labels[activeIndex]}</span>
      </div>
    </div>
  )
}

function WizardHeading({
  title,
  backLabel,
  onBack,
  icon,
  context,
}: {
  title: string
  backLabel: string
  onBack: () => void
  icon: React.ReactNode
  context: string
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label={backLabel}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dark-border text-gray-400 transition-colors hover:text-white"
      >
        <ChevronLeft size={20} />
      </button>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-dark-elevated text-kunai">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <p className="mt-0.5 truncate text-sm text-gray-400">{context}</p>
      </div>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 py-3 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-white">{value}</dd>
    </div>
  )
}

function statusLabel(status: TournamentStatus): string {
  const labels: Record<TournamentStatus, string> = {
    draft: 'Draft',
    open: 'Open registration',
    live: 'Live now',
    closed: 'Closed',
  }
  return labels[status]
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
