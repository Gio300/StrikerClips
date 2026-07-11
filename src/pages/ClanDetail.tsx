import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AdSlot } from '@/components/AdSlot'
import ClanEmblem from '@/components/ClanEmblem'
import {
  getClanByIdOrTag,
  getMembers,
  listClanMatches,
  listClans,
  joinClan,
  leaveClan,
  createClanMatch,
  type ClanMemberWithProfile,
} from '@/lib/clans'
import type { Clan, ClanMatch, ClanMessage, ClanRole, ClanJoinMode } from '@/types/database'

export default function ClanDetail() {
  const { clanId } = useParams()
  const { user } = useAuth()

  const [clan, setClan] = useState<Clan | null>(null)
  const [members, setMembers] = useState<ClanMemberWithProfile[]>([])
  const [matches, setMatches] = useState<ClanMatch[]>([])
  const [allClans, setAllClans] = useState<Clan[]>([])
  const [rank, setRank] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!clanId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setNotFound(false)
      try {
        const found = await getClanByIdOrTag(clanId as string)
        if (!found) {
          if (!cancelled) setNotFound(true)
          return
        }
        const [mems, mtchs, everyClan, rankRes] = await Promise.all([
          getMembers(found.id),
          listClanMatches(found.id),
          listClans(),
          supabase
            .from('clans')
            .select('id', { count: 'exact', head: true })
            .gt('points', found.points),
        ])
        if (cancelled) return
        setClan(found)
        setMembers(mems)
        setMatches(mtchs)
        setAllClans(everyClan)
        setRank((rankRes.count ?? 0) + 1)
      } catch (err) {
        if (!cancelled) setActionError(err instanceof Error ? err.message : 'Failed to load clan.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [clanId])

  async function refreshRoster(id: string) {
    const mems = await getMembers(id)
    setMembers(mems)
  }

  async function refreshMatches(id: string) {
    const mtchs = await listClanMatches(id)
    setMatches(mtchs)
  }

  const myMembership = user ? members.find((m) => m.user_id === user.id) : undefined
  const isJoined = Boolean(myMembership)
  const canManage = myMembership?.role === 'owner' || myMembership?.role === 'officer'

  async function handleJoin() {
    if (!user || !clan) return
    setBusy(true)
    setActionError('')
    try {
      await joinClan(clan.id, user.id)
      await refreshRoster(clan.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not join clan.')
    } finally {
      setBusy(false)
    }
  }

  async function handleLeave() {
    if (!user || !clan) return
    setBusy(true)
    setActionError('')
    try {
      await leaveClan(clan.id, user.id)
      await refreshRoster(clan.id)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not leave clan.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading clan…</div>
      </div>
    )
  }

  if (notFound || !clan) {
    return (
      <div className="p-8 text-center text-gray-400">
        <p className="mb-4">Clan not found.</p>
        <Link to="/clans" className="text-accent hover:underline">
          Back to clans
        </Link>
      </div>
    )
  }

  const clanMap = new Map<string, Clan>(allClans.map((c) => [c.id, c]))
  clanMap.set(clan.id, clan)

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto">
      <Link to="/clans" className="text-sm text-gray-400 hover:text-white">
        ← All clans
      </Link>

      {/* Banner + header */}
      <div className="card overflow-hidden mt-3">
        <div
          className="h-28 sm:h-36 w-full"
          style={
            clan.banner_url
              ? undefined
              : { background: `linear-gradient(135deg, ${clan.emblem_bg}, #13111d)` }
          }
        >
          {clan.banner_url && (
            <img src={clan.banner_url} alt="" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="p-5 sm:p-6 flex flex-col sm:flex-row gap-4 sm:items-start">
          <div className="-mt-16 sm:-mt-20 shrink-0 rounded-2xl ring-4 ring-dark-card w-fit">
            <ClanEmblem clan={clan} size={88} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">
              <span className="text-chakra font-mono mr-2">[{clan.tag}]</span>
              {clan.name}
            </h1>
            {clan.description && <p className="text-gray-400 mt-1.5">{clan.description}</p>}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm mt-3">
              <span>
                <b className="text-accent tabular-nums">{clan.points.toLocaleString()}</b>{' '}
                <span className="text-gray-500">points</span>
              </span>
              {rank != null && (
                <span>
                  <b className="tabular-nums">#{rank}</b> <span className="text-gray-500">rank</span>
                </span>
              )}
              <span className="tabular-nums">
                <span className="text-leaf">{clan.wins}W</span>
                <span className="text-gray-600 mx-1">/</span>
                <span className="text-kunai">{clan.losses}L</span>
              </span>
              <span className="text-gray-400">
                {clan.member_count} {clan.member_count === 1 ? 'member' : 'members'}
              </span>
            </div>
          </div>
          <div className="shrink-0">
            <JoinControl
              user={Boolean(user)}
              isJoined={isJoined}
              role={myMembership?.role}
              joinMode={clan.join_mode}
              busy={busy}
              onJoin={handleJoin}
              onLeave={handleLeave}
            />
          </div>
        </div>
      </div>

      {actionError && <p className="text-kunai text-sm mt-3">{actionError}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-6">
        {/* Main column: roster + matches */}
        <div className="lg:col-span-2 space-y-6">
          {/* Roster */}
          <section>
            <h2 className="text-lg font-bold mb-3">Roster</h2>
            <div className="card divide-y divide-dark-border">
              {members.length === 0 ? (
                <p className="p-4 text-sm text-gray-500">No members yet.</p>
              ) : (
                members.map((m) => (
                  <div key={m.id} className="flex items-center gap-3 p-3">
                    {m.profiles?.avatar_url ? (
                      <img src={m.profiles.avatar_url} alt="" className="w-9 h-9 rounded-full" />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-accent/20 flex items-center justify-center text-accent text-sm font-semibold">
                        {m.profiles?.username?.[0]?.toUpperCase() ?? '?'}
                      </div>
                    )}
                    <Link
                      to={`/profile/${m.user_id}`}
                      className="flex-1 min-w-0 font-medium hover:underline truncate"
                    >
                      {m.profiles?.username ?? 'unknown'}
                    </Link>
                    <RoleBadge role={m.role} />
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Matches */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold">Clan vs clan</h2>
            </div>

            {canManage && (
              <ScheduleMatch
                clan={clan}
                opponents={allClans.filter((c) => c.id !== clan.id)}
                userId={user?.id ?? ''}
                onScheduled={() => refreshMatches(clan.id)}
              />
            )}

            <div className="space-y-2.5">
              {matches.length === 0 ? (
                <p className="text-sm text-gray-500">No matches scheduled yet.</p>
              ) : (
                matches.map((match) => {
                  const a = clanMap.get(match.clan_a)
                  const b = clanMap.get(match.clan_b)
                  return (
                    <div key={match.id} className="card p-3 flex items-center gap-3">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <ClanSide clan={a} fallback={match.clan_a} />
                        <span className="text-gray-500 text-xs shrink-0">vs</span>
                        <ClanSide clan={b} fallback={match.clan_b} />
                      </div>
                      {match.status !== 'scheduled' && (
                        <div className="tabular-nums font-bold text-sm shrink-0">
                          {match.score_a} <span className="text-gray-600">–</span> {match.score_b}
                        </div>
                      )}
                      <MatchStatus status={match.status} />
                      {match.scheduled_at && (
                        <div className="hidden sm:block text-xs text-gray-500 shrink-0">
                          {new Date(match.scheduled_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>
        </div>

        {/* Right rail: chat + ad */}
        <div className="space-y-6">
          <section>
            <h2 className="text-lg font-bold mb-3">Clan chat</h2>
            <ClanChat clanId={clan.id} canPost={isJoined} />
          </section>
          <AdSlot slotId="reel-bottom" shape="square" />
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------------- */
/* Join / leave control                                                       */
/* ------------------------------------------------------------------------- */

function JoinControl({
  user,
  isJoined,
  role,
  joinMode,
  busy,
  onJoin,
  onLeave,
}: {
  user: boolean
  isJoined: boolean
  role?: ClanRole
  joinMode: ClanJoinMode
  busy: boolean
  onJoin: () => void
  onLeave: () => void
}) {
  if (!user) {
    return (
      <Link to="/login" className="btn-primary">
        Log in to join
      </Link>
    )
  }
  if (isJoined) {
    if (role === 'owner') {
      return <span className="pill-chakra">Owner</span>
    }
    return (
      <button onClick={onLeave} disabled={busy} className="btn-ghost">
        {busy ? '…' : 'Leave clan'}
      </button>
    )
  }
  if (joinMode === 'open') {
    return (
      <button onClick={onJoin} disabled={busy} className="btn-primary">
        {busy ? '…' : 'Join clan'}
      </button>
    )
  }
  return (
    <div className="text-right">
      <button disabled className="btn-ghost opacity-60 cursor-not-allowed">
        {joinMode === 'request' ? 'Request to join' : 'Invite only'}
      </button>
      <p className="text-[11px] text-gray-500 mt-1 max-w-[10rem]">
        {joinMode === 'request'
          ? 'This clan approves members manually.'
          : 'Ask an officer for an invite.'}
      </p>
    </div>
  )
}

function RoleBadge({ role }: { role: ClanRole }) {
  if (role === 'owner') return <span className="pill-chakra">Owner</span>
  if (role === 'officer') return <span className="pill-accent">Officer</span>
  return <span className="pill">Member</span>
}

/* ------------------------------------------------------------------------- */
/* Matches                                                                    */
/* ------------------------------------------------------------------------- */

function ClanSide({ clan, fallback }: { clan?: Clan; fallback: string }) {
  if (!clan) {
    return <span className="font-mono text-xs text-gray-400 truncate">{fallback.slice(0, 8)}</span>
  }
  return (
    <Link to={`/clans/${clan.id}`} className="flex items-center gap-1.5 min-w-0 hover:underline">
      <ClanEmblem clan={clan} size={24} />
      <span className="font-mono text-sm text-chakra truncate">[{clan.tag}]</span>
    </Link>
  )
}

function MatchStatus({ status }: { status: ClanMatch['status'] }) {
  if (status === 'live') return <span className="pill-kunai live-dot shrink-0">Live</span>
  if (status === 'final') return <span className="pill-accent shrink-0">Final</span>
  if (status === 'cancelled') return <span className="pill text-gray-500 shrink-0">Cancelled</span>
  return <span className="pill shrink-0">Scheduled</span>
}

function ScheduleMatch({
  clan,
  opponents,
  userId,
  onScheduled,
}: {
  clan: Clan
  opponents: Clan[]
  userId: string
  onScheduled: () => void
}) {
  const [opponentId, setOpponentId] = useState('')
  const [when, setWhen] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!opponentId) {
      setError('Pick an opponent clan.')
      return
    }
    if (!userId) return
    setSaving(true)
    try {
      await createClanMatch({
        clan_a: clan.id,
        clan_b: opponentId,
        scheduled_at: when ? new Date(when).toISOString() : null,
        created_by: userId,
      })
      setOpponentId('')
      setWhen('')
      onScheduled()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not schedule match.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-3 mb-3 flex flex-col sm:flex-row gap-2 sm:items-end">
      <div className="flex-1">
        <label className="block text-xs text-gray-400 mb-1">Opponent</label>
        <select
          value={opponentId}
          onChange={(e) => setOpponentId(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
        >
          <option value="">Select a clan…</option>
          {opponents.map((c) => (
            <option key={c.id} value={c.id}>
              [{c.tag}] {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs text-gray-400 mb-1">When</label>
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
        />
      </div>
      <button type="submit" disabled={saving} className="btn-primary">
        {saving ? '…' : 'Schedule'}
      </button>
      {error && <p className="text-kunai text-xs sm:ml-2">{error}</p>}
    </form>
  )
}

/* ------------------------------------------------------------------------- */
/* Clan chat — realtime, modeled on StreamChat but keyed by clan_id           */
/* ------------------------------------------------------------------------- */

type EnrichedClanMessage = ClanMessage & { username?: string }

function ClanChat({ clanId, canPost }: { clanId: string; canPost: boolean }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<EnrichedClanMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | null = null

    async function init() {
      const { data, error: err } = await supabase
        .from('clan_messages')
        .select('id, clan_id, user_id, content, created_at')
        .eq('clan_id', clanId)
        .order('created_at', { ascending: true })
        .limit(100)
      if (cancelled) return
      if (err) {
        setError(err.message)
        return
      }
      const rows = (data ?? []) as ClanMessage[]
      const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]))
      let nameMap = new Map<string, string>()
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username')
          .in('id', userIds)
        nameMap = new Map((profiles ?? []).map((p) => [p.id, p.username]))
      }
      if (cancelled) return
      setMessages(rows.map((r) => ({ ...r, username: r.user_id ? nameMap.get(r.user_id) : undefined })))

      channel = supabase
        .channel(`clan-chat:${clanId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'clan_messages', filter: `clan_id=eq.${clanId}` },
          async (payload) => {
            const row = payload.new as ClanMessage
            let username: string | undefined
            if (row.user_id) {
              const { data: prof } = await supabase
                .from('profiles')
                .select('username')
                .eq('id', row.user_id)
                .maybeSingle()
              username = prof?.username
            }
            setMessages((prev) => [...prev, { ...row, username }])
          },
        )
        .subscribe()
    }

    init()
    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [clanId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !draft.trim() || sending) return
    setSending(true)
    setError(null)
    const content = draft.trim().slice(0, 500)
    const { error: err } = await supabase
      .from('clan_messages')
      .insert({ clan_id: clanId, user_id: user.id, content })
    setSending(false)
    if (err) {
      setError(err.message)
      return
    }
    setDraft('')
  }

  return (
    <div className="flex flex-col rounded-xl border border-dark-border bg-dark-card overflow-hidden h-[480px]">
      <div className="px-3 py-2 border-b border-dark-border text-xs uppercase tracking-wider text-gray-400">
        Clan chat
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 text-sm">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-xs text-center py-6">No messages yet.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="leading-snug">
              {m.user_id ? (
                <Link
                  to={`/profile/${m.user_id}`}
                  className="text-accent font-semibold mr-1.5 hover:underline"
                >
                  {m.username ?? 'someone'}
                </Link>
              ) : (
                <span className="text-gray-500 font-semibold mr-1.5">deleted</span>
              )}
              <span className="text-gray-200 break-words">{m.content}</span>
            </div>
          ))
        )}
      </div>
      {error && <p className="px-3 py-1 text-xs text-kunai border-t border-dark-border">{error}</p>}
      {canPost ? (
        <form onSubmit={handleSend} className="border-t border-dark-border p-2 flex gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder="Message your clan…"
            className="flex-1 px-3 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
          >
            Send
          </button>
        </form>
      ) : (
        <div className="border-t border-dark-border p-2 text-xs text-gray-500 text-center">
          Join this clan to chat.
        </div>
      )}
    </div>
  )
}
