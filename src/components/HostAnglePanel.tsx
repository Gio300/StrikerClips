import { useEffect, useState } from 'react'
import { Avatar } from '@/components/ui'
import { supabase } from '@/lib/supabase'
import { useEntitlements } from '@/hooks/useEntitlements'
import { tierLevel, LEVEL_TIER_NAME, isTopTierKey } from '@/lib/tiers'
import { extractYouTubeId } from '@/lib/youtubeApi'
import {
  addAngle,
  loadAngles,
  removeAngle,
  stopAngle,
  restartAngle,
  refreshLiveAngles,
  setHostFeed,
  assembleTeam,
  searchPeople,
  inviteToCoStream,
  loadStreamInvites,
  type LiveAngleRow,
  type LiveInviteRow,
  type PersonHit,
} from '@/lib/liveAngles'

/**
 * HostAnglePanel — the host's control for assembling a multi-angle live show.
 *
 * The host's own stream is angle 1. Here they SEARCH a player by name and ADD
 * their stream as another angle: TKO pulls the player's linked YouTube live URL
 * automatically, or the host pastes any stream link. Every added angle shows up
 * for viewers to switch between (see LiveControlLayout).
 *
 * Only rendered for the host (isHost) of a stored stream. Inline SVG, Tailwind
 * core classes, no new deps — matches the dark/branded control-room styling.
 */

function SearchIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}
function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}
function UserPlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </svg>
  )
}
function StopIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </svg>
  )
}
function PlayIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}
function UsersIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

type Props = {
  liveStreamId: string
  /** Called after an angle is added or removed, so a parent can reload its view. */
  onChanged?: () => void
}

export function HostAnglePanel({ liveStreamId, onChanged }: Props) {
  const { tier } = useEntitlements()
  const myLevel = tierLevel(tier)
  const myTierName = LEVEL_TIER_NAME[Math.max(1, myLevel)] ?? 'Pro'
  const isTopTier = isTopTierKey(tier)

  // The host's OWN feed (angle 1) status — stopping it never ends the session.
  const [hostFeedStatus, setHostFeedStatus] = useState<'live' | 'stopped'>('live')
  const [teamNote, setTeamNote] = useState('')

  const [angles, setAngles] = useState<LiveAngleRow[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const [pasteLabel, setPasteLabel] = useState('')
  const [error, setError] = useState('')
  const [showPaste, setShowPaste] = useState(false)

  // ── Co-stream INVITES (role-based) ────────────────────────────────────────
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteHits, setInviteHits] = useState<PersonHit[]>([])
  const [inviteSearching, setInviteSearching] = useState(false)
  const [invites, setInvites] = useState<LiveInviteRow[]>([])
  const [inviteeNames, setInviteeNames] = useState<Map<string, string>>(new Map())
  const [inviteError, setInviteError] = useState('')

  async function refresh() {
    setAngles(await loadAngles(liveStreamId))
    try {
      const { data } = await supabase
        .from('live_streams')
        .select('host_feed_status')
        .eq('id', liveStreamId)
        .maybeSingle()
      const s = (data as { host_feed_status?: string } | null)?.host_feed_status
      setHostFeedStatus(s === 'stopped' ? 'stopped' : 'live')
    } catch { /* best-effort */ }
    const rows = await loadStreamInvites(liveStreamId)
    setInvites(rows)
    const ids = Array.from(new Set(rows.map((r) => r.invitee_id)))
    if (ids.length > 0) {
      try {
        const { data } = await supabase.from('profiles').select('id, username').in('id', ids)
        setInviteeNames(new Map((data ?? []).map((p: any) => [p.id, p.username])))
      } catch { /* best-effort names */ }
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStreamId])

  // Debounced people search on the query.
  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits([]); return }
    let cancelled = false
    setSearching(true)
    const t = window.setTimeout(async () => {
      const rows = await searchPeople(q)
      if (!cancelled) { setHits(rows); setSearching(false) }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [query])

  // Debounced people search for the INVITE box.
  useEffect(() => {
    const q = inviteQuery.trim()
    if (!q) { setInviteHits([]); return }
    let cancelled = false
    setInviteSearching(true)
    const t = window.setTimeout(async () => {
      const rows = await searchPeople(q)
      if (!cancelled) { setInviteHits(rows); setInviteSearching(false) }
    }, 250)
    return () => { cancelled = true; window.clearTimeout(t) }
  }, [inviteQuery])

  async function invite(person: PersonHit) {
    setInviteError('')
    setBusyId(`invite-${person.id}`)
    const res = await inviteToCoStream(liveStreamId, person.id)
    setBusyId(null)
    if (!res.ok) {
      setInviteError(
        res.reason === 'role-too-high'
          ? `You can only invite players at your role (${myTierName}) or lower.`
          : res.error || `Couldn't invite @${person.username ?? 'player'}.`,
      )
      return
    }
    setInviteQuery('')
    setInviteHits([])
    await refresh()
  }

  async function addPlayer(person: PersonHit) {
    setError('')
    setBusyId(person.id)
    const res = await addAngle({ liveStreamId, userId: person.id, label: person.username ?? undefined })
    setBusyId(null)
    if (!res.ok) {
      setError(res.error || `Couldn't add @${person.username ?? 'player'}. They may not have a stream link.`)
      return
    }
    setQuery('')
    setHits([])
    await refresh()
    onChanged?.()
  }

  async function addPasted() {
    setError('')
    const url = pasteUrl.trim()
    if (!url) return
    setBusyId('paste')
    const res = await addAngle({ liveStreamId, youtubeUrl: url, label: pasteLabel.trim() || 'Added angle' })
    setBusyId(null)
    if (!res.ok) { setError(res.error || 'Could not add that link.'); return }
    setPasteUrl('')
    setPasteLabel('')
    setShowPaste(false)
    await refresh()
    onChanged?.()
  }

  async function drop(angleId: string) {
    setBusyId(angleId)
    const ok = await removeAngle(angleId)
    setBusyId(null)
    if (ok) { await refresh(); onChanged?.() }
  }

  // Stop a participant's feed but KEEP the slot (re-startable), then restart it.
  async function stopOne(angleId: string) {
    setBusyId(angleId)
    const res = await stopAngle(angleId)
    setBusyId(null)
    if (res.ok) { await refresh(); onChanged?.() }
    else setError(res.error || 'Could not stop that feed.')
  }
  async function restartOne(angleId: string) {
    setBusyId(angleId)
    const res = await restartAngle(angleId)
    setBusyId(null)
    if (res.ok) { await refresh(); onChanged?.() }
    else setError(res.error || 'Could not restart that feed.')
  }

  async function refreshAllFeeds() {
    setError('')
    setBusyId('feeds-refresh')
    const res = await refreshLiveAngles(liveStreamId)
    setBusyId(null)
    if (!res.ok) {
      setError(res.error || 'Could not refresh camera feeds.')
      return
    }
    setAngles(res.angles)
    setTeamNote(res.waiting > 0
      ? `${res.updated} feed${res.updated === 1 ? '' : 's'} ready; ${res.waiting} still waiting to go live.`
      : `All ${res.updated} camera feed${res.updated === 1 ? '' : 's'} ready.`)
    onChanged?.()
  }

  // Stop / start the host's OWN feed (angle 1) without ending the session.
  async function toggleHostFeed() {
    const action = hostFeedStatus === 'live' ? 'stop' : 'start'
    setBusyId('host-feed')
    const res = await setHostFeed(liveStreamId, action)
    setBusyId(null)
    if (res.ok) { await refresh(); onChanged?.() }
    else setError(res.error || 'Could not update your feed.')
  }

  // Re-resolve the host's concrete active broadcast without stopping the show.
  async function refreshHostFeed() {
    setBusyId('host-refresh')
    const res = await setHostFeed(liveStreamId, 'start')
    setBusyId(null)
    if (res.ok) { await refresh(); onChanged?.() }
    else setError(res.error || 'Could not refresh your live feed.')
  }

  // TOP TIER: auto-detect live teammates and add them all as angles at once.
  async function assemble() {
    setTeamNote('')
    setBusyId('assemble')
    const res = await assembleTeam(liveStreamId)
    setBusyId(null)
    if (res.ok) {
      setTeamNote(res.added > 0 ? `Added ${res.added} live teammate${res.added === 1 ? '' : 's'}.` : 'No teammates are live right now.')
      await refresh()
      onChanged?.()
    } else {
      setTeamNote(res.error || 'Could not assemble your team.')
    }
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card overflow-hidden">
      <div className="px-3 py-2 border-b border-dark-border flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-400">
        <PlusIcon className="w-4 h-4 text-accent" />
        <span>Add camera angles</span>
      </div>

      <div className="p-3 space-y-3">
        <p className="text-xs text-gray-500">
          Your stream is angle 1. Search a player and add their stream — TKO pulls their live link automatically.
        </p>

        {/* Search a player by name */}
        <div className="relative">
          <SearchIcon className="w-4 h-4 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a player by name…"
            className="w-full pl-8 pr-3 py-2 rounded-lg bg-dark border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
          />
        </div>

        {searching && <p className="text-xs text-gray-500">Searching…</p>}

        {hits.length > 0 && (
          <ul className="space-y-1.5">
            {hits.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <Avatar src={p.avatar_url} name={p.username ?? 'player'} seed={p.id} size={24} />
                  <span className="truncate text-sm text-white">@{p.username ?? 'player'}</span>
                </span>
                <button
                  type="button"
                  onClick={() => addPlayer(p)}
                  disabled={busyId === p.id}
                  className="shrink-0 inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-dark hover:shadow-glow disabled:opacity-50"
                >
                  <PlusIcon className="w-3.5 h-3.5" />
                  {busyId === p.id ? 'Adding…' : 'Add'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <p className="text-xs text-kunai">{error}</p>}

        {/* Paste-a-link fallback */}
        {showPaste ? (
          <div className="space-y-2 rounded-lg border border-dark-border bg-dark p-2.5">
            <input
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=…"
              className="w-full px-2.5 py-1.5 rounded-md bg-dark-card border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
            />
            <input
              value={pasteLabel}
              onChange={(e) => setPasteLabel(e.target.value)}
              placeholder="Angle name (optional)"
              className="w-full px-2.5 py-1.5 rounded-md bg-dark-card border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={addPasted}
                disabled={busyId === 'paste' || !pasteUrl.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-dark hover:shadow-glow disabled:opacity-50"
              >
                <PlusIcon className="w-3.5 h-3.5" /> Add link
              </button>
              <button
                type="button"
                onClick={() => { setShowPaste(false); setPasteUrl(''); setPasteLabel('') }}
                className="rounded-md border border-dark-border px-3 py-1.5 text-xs text-gray-400 hover:text-white"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPaste(true)}
            className="text-xs text-accent hover:underline"
          >
            Or paste a stream link ▾
          </button>
        )}

        {/* Current angles + their live/stopped/reconnecting state. The host's own
            feed (angle 1) can be stopped/started here WITHOUT ending the show. */}
        {(angles.length > 0 || hostFeedStatus === 'stopped') && (
          <div className="pt-1">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-[11px] uppercase tracking-wider text-gray-500">
                Angles on this show ({angles.length + 1})
              </p>
              {angles.length > 0 && (
                <button
                  type="button"
                  onClick={refreshAllFeeds}
                  disabled={busyId === 'feeds-refresh'}
                  className="rounded-md border border-dark-border px-2 py-1 text-[11px] font-semibold text-accent hover:border-accent disabled:opacity-50"
                >
                  {busyId === 'feeds-refresh' ? 'Checking...' : 'Refresh feeds'}
                </button>
              )}
            </div>
            <ul className="space-y-1.5">
              <li className="flex items-center justify-between gap-2 text-sm text-gray-300">
                <span className="min-w-0 flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${hostFeedStatus === 'stopped' ? 'bg-gray-600' : 'bg-kunai animate-pulse'}`} />
                  <span className="truncate">You (angle 1)</span>
                  {hostFeedStatus === 'stopped' && <span className="text-[10px] uppercase tracking-wider text-gray-500">stopped</span>}
                </span>
                <span className="shrink-0 inline-flex items-center gap-1">
                  {hostFeedStatus === 'live' && (
                    <button
                      type="button"
                      onClick={refreshHostFeed}
                      disabled={busyId === 'host-refresh'}
                      title="Find my current broadcast again"
                      className="rounded-md border border-dark-border px-2 py-1 text-[11px] font-semibold text-accent hover:border-accent disabled:opacity-50"
                    >
                      Refresh live
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleHostFeed}
                    disabled={busyId === 'host-feed'}
                    title={hostFeedStatus === 'live' ? 'Stop my feed (keeps the show live)' : 'Restart my feed'}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-50 border-dark-border text-gray-300 hover:border-accent/60 hover:text-white"
                  >
                    {hostFeedStatus === 'live'
                      ? <><StopIcon className="w-3 h-3" /> Stop</>
                      : <><PlayIcon className="w-3 h-3" /> Restart</>}
                  </button>
                </span>
              </li>
              {angles.map((a, i) => {
                const embeddable = !!extractYouTubeId(a.youtube_url ?? '')
                const status = a.status ?? 'live'
                const dotClass =
                  status === 'reconnecting' || !embeddable ? 'bg-yellow-400 animate-pulse'
                    : status === 'stopped' ? 'bg-gray-600'
                    : 'bg-leaf'
                return (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 flex items-center gap-2 text-sm text-gray-300">
                      <span className={`inline-block w-2 h-2 rounded-full ${dotClass}`} />
                      <span className="text-gray-500">{i + 2}.</span>
                      <span className="truncate">{a.label || 'Added angle'}</span>
                      {status === 'reconnecting' && <span className="text-[10px] uppercase tracking-wider text-yellow-400">reconnecting…</span>}
                      {status === 'stopped' && <span className="text-[10px] uppercase tracking-wider text-gray-500">stopped</span>}
                      {!embeddable && status !== 'stopped' && <span className="text-[10px] text-yellow-400">finding live feed...</span>}
                    </span>
                    <span className="shrink-0 flex items-center gap-1.5">
                      {status === 'live' && embeddable ? (
                        <button
                          type="button"
                          onClick={() => stopOne(a.id)}
                          disabled={busyId === a.id}
                          title="Stop this feed (keeps the slot)"
                          className="text-gray-500 hover:text-white disabled:opacity-50"
                        >
                          <StopIcon className="w-4 h-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => restartOne(a.id)}
                          disabled={busyId === a.id}
                          title="Restart this feed"
                          className="text-gray-500 hover:text-accent disabled:opacity-50"
                        >
                          <PlayIcon className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => drop(a.id)}
                        disabled={busyId === a.id}
                        title="Remove this angle"
                        className="text-gray-500 hover:text-kunai disabled:opacity-50"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* TOP TIER: auto-assemble live teammates into the show in one tap. */}
        {isTopTier && (
          <div className="pt-1">
            <button
              type="button"
              onClick={assemble}
              disabled={busyId === 'assemble'}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/50 px-3 py-1.5 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
            >
              <UsersIcon className="w-3.5 h-3.5" />
              {busyId === 'assemble' ? 'Assembling…' : 'Assemble live teammates'}
            </button>
            {teamNote && <p className="mt-1 text-[11px] text-gray-400">{teamNote}</p>}
          </div>
        )}

        {/* ── Invite to co-stream (role-based) ─────────────────────────────── */}
        <div className="pt-3 mt-1 border-t border-dark-border">
          <div className="flex items-center gap-1.5 text-xs uppercase tracking-wider text-gray-400 mb-1.5">
            <UserPlusIcon className="w-4 h-4 text-accent" />
            <span>Invite to co-stream</span>
          </div>
          <p className="text-xs text-gray-500 mb-2">
            Invite a player and they add their OWN stream — you don't paste their link. You can
            invite players at your role (<span className="text-accent">{myTierName}</span>) or lower.
          </p>

          <div className="relative">
            <SearchIcon className="w-4 h-4 text-gray-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={inviteQuery}
              onChange={(e) => setInviteQuery(e.target.value)}
              placeholder="Search a player to invite…"
              className="w-full pl-8 pr-3 py-2 rounded-lg bg-dark border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
            />
          </div>
          {inviteSearching && <p className="mt-1 text-xs text-gray-500">Searching…</p>}
          {inviteHits.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {inviteHits.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    <Avatar src={p.avatar_url} name={p.username ?? 'player'} seed={p.id} size={24} />
                    <span className="truncate text-sm text-white">@{p.username ?? 'player'}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => invite(p)}
                    disabled={busyId === `invite-${p.id}`}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-accent/50 px-2.5 py-1 text-xs font-semibold text-accent hover:bg-accent/10 disabled:opacity-50"
                  >
                    <UserPlusIcon className="w-3.5 h-3.5" />
                    {busyId === `invite-${p.id}` ? 'Inviting…' : 'Invite'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {inviteError && <p className="mt-1 text-xs text-kunai">{inviteError}</p>}

          {invites.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {invites.map((iv) => (
                <li key={iv.id} className="flex items-center justify-between gap-2 text-sm text-gray-300">
                  <span className="min-w-0 truncate">@{inviteeNames.get(iv.invitee_id) ?? 'player'}</span>
                  <span
                    className={`shrink-0 text-[11px] uppercase tracking-wider ${
                      iv.status === 'accepted' ? 'text-leaf'
                        : iv.status === 'declined' ? 'text-gray-500'
                        : 'text-accent'
                    }`}
                  >
                    {iv.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

export default HostAnglePanel
