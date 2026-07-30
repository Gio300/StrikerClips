import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LayoutGrid,
  Mic2,
  Plus,
  Radio,
  RadioTower,
  ShieldCheck,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Users,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { OBSPanel } from '@/components/OBSPanel'
import { StatCheckQueue } from '@/components/StatCheckQueue'
import { InviteMenu } from '@/components/InviteMenu'
import { StreamChat } from '@/components/StreamChat'
import { ShareButton } from '@/components/ShareButton'
import { CroppedFrame, TkoWatermark } from '@/components/CroppedFrame'
import { extractYouTubeId, CLEAN_EMBED_PARAMS } from '@/lib/youtubeApi'
import type { LiveGroup } from '@/types/database'

type LiveTab = 'streams' | 'broadcast' | 'stat-check'

const LIVE_TABS = [
  { key: 'streams', label: 'Watch live', Icon: Radio },
  { key: 'broadcast', label: 'Broadcast', Icon: RadioTower },
  { key: 'stat-check', label: 'Stat checks', Icon: ShieldCheck },
] as const

// Build a YouTube embed src with an explicit mute state. Autoplay requires
// mute=1 (browser policy); the single unmuted feed only gets sound after a
// user gesture, which is exactly the click that toggles it — so callers change
// the iframe `key` alongside the src to force a reload when mute flips.
function ytEmbedSrc(videoId: string, unmuted: boolean): string {
  return `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=${unmuted ? 0 : 1}&${CLEAN_EMBED_PARAMS}`
}

type GroupWithMembers = LiveGroup & {
  members: { id: string; user_id: string; accepted: boolean; stream_id: string | null; profile?: { username: string } }[]
}

export function Live() {
  return (
    <div className="page-shell">
      <header className="mb-5 border-b border-dark-border pb-5">
        <div className="flex items-center gap-2 text-kunai">
          <Radio size={16} />
          <span className="text-xs font-semibold uppercase">Live control room</span>
        </div>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Watch, direct, and broadcast.</h1>
        <p className="mt-2 max-w-2xl text-sm text-gray-400">
          Bring in YouTube or Twitch feeds, run a squad multi-view, and send a clean program view to OBS.
        </p>
      </header>
      <LiveTabs />
    </div>
  )
}

function LiveTabs() {
  const [params, setParams] = useSearchParams()
  const initial: LiveTab = (() => {
    const t = params.get('tab')
    return t === 'broadcast' || t === 'stat-check' ? t : 'streams'
  })()
  const [tab, setTab] = useState<LiveTab>(initial)

  const switchTab = (t: LiveTab) => {
    setTab(t)
    const next = new URLSearchParams(params)
    if (t === 'streams') next.delete('tab')
    else next.set('tab', t)
    setParams(next, { replace: true })
  }

  return (
    <>
      <div className="mb-6 flex gap-1 overflow-x-auto rounded-lg border border-dark-border bg-dark-card p-1">
        {LIVE_TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => switchTab(key)}
            className={`inline-flex min-h-9 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors ${
              tab === key
                ? 'bg-white text-dark'
                : 'text-gray-400 hover:bg-dark-elevated hover:text-white'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'broadcast' && <OBSPanel />}
      {tab === 'stat-check' && <StatCheckQueue />}
      {tab === 'streams' && <StreamsTab />}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  StreamsTab — preserves the original /live page (streams + live groups)
// ─────────────────────────────────────────────────────────────────────────

function StreamsTab() {
  const { user } = useAuth()
  const [streams, setStreams] = useState<{ id: string; youtube_url: string; title: string | null; is_live?: boolean | null }[]>([])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [multiView, setMultiView] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [directorNote, setDirectorNote] = useState('')
  const streamCountRef = useRef(0)
  // Advanced host controls stay collapsed so casual viewers get a simple UI.
  const [hostToolsOpen, setHostToolsOpen] = useState(false)
  const [showAddLive, setShowAddLive] = useState(false)
  // Which single feed carries audio (prevents echo across the multi-view grid).
  //  undefined → default: the focused feed plays; null → mute all; id → that feed.
  const [audioStreamId, setAudioStreamId] = useState<string | null | undefined>(undefined)

  // Voice / text director: the global VoiceButton dispatches `kc:director`.
  // "all screens" → 4-up, "single" → single, "focus screen N" → focus that cam.
  useEffect(() => {
    function onDirector(e: Event) {
      const detail = (e as CustomEvent).detail as { action?: string; screen?: number } | undefined
      if (!detail?.action) return
      const flash = (msg: string) => { setDirectorNote(msg); window.setTimeout(() => setDirectorNote(''), 2500) }
      switch (detail.action) {
        case 'all': setMultiView(true); flash('Director: all screens'); break
        case 'single': setMultiView(false); flash('Director: single screen'); break
        case 'focus': {
          const n = detail.screen ?? 1
          const idx = Math.max(0, Math.min(n - 1, Math.max(0, streamCountRef.current - 1)))
          setMultiView(true); setFocusedIndex(idx); flash(`Director: focus screen ${idx + 1}`)
          break
        }
        case 'stats': flash('Director: stats (open the Stat Check tab)'); break
        default: flash(`Director: ${detail.action}`); break
      }
    }
    window.addEventListener('kc:director', onDirector as EventListener)
    return () => window.removeEventListener('kc:director', onDirector as EventListener)
  }, [])

  const [groups, setGroups] = useState<GroupWithMembers[]>([])
  const [groupName, setGroupName] = useState('')
  const [pendingInvites, setPendingInvites] = useState<{ id: string; group_id: string; group?: { name: string } }[]>([])
  const [viewingGroupId, setViewingGroupId] = useState<string | null>(null)
  const [myStreams, setMyStreams] = useState<{ id: string; title: string | null; is_live?: boolean | null }[]>([])

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase
        .from('live_streams')
        .select('id, youtube_url, title, is_live')
        .order('created_at', { ascending: false })
      // Only feeds that are actually live. A stream ends by setting is_live
      // false (see handleEndStream); rows created before the flag existed have
      // is_live undefined and are treated as live, matching ProgramView.
      setStreams((data ?? []).filter((r) => r.is_live !== false))
      setLoading(false)
    }
    fetch()
  }, [])

  useEffect(() => {
    if (!user) return
    supabase
      .from('live_streams')
      .select('id, title, is_live')
      .eq('user_id', user.id)
      .then(({ data }) => setMyStreams((data ?? []).filter((r) => r.is_live !== false)))
  }, [user, streams])

  useEffect(() => {
    if (!user) return
    async function fetchGroups() {
      const { data: members } = await supabase
        .from('live_group_members')
        .select('group_id')
        .eq('user_id', user!.id)
      const groupIds = [...new Set((members ?? []).map((m) => m.group_id))]
      if (groupIds.length === 0) {
        setGroups([])
        return
      }
      const { data: groupsData } = await supabase
        .from('live_groups')
        .select('*')
        .in('id', groupIds)
      const { data: membersData } = await supabase
        .from('live_group_members')
        .select('id, group_id, user_id, accepted, stream_id')
        .in('group_id', groupIds)
      const { data: profiles } = await supabase.from('profiles').select('id, username')
      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
      const groupsWithMembers: GroupWithMembers[] = (groupsData ?? []).map((g) => ({
        ...g,
        members: (membersData ?? [])
          .filter((m) => m.group_id === g.id)
          .map((m) => ({ ...m, profile: profileMap.get(m.user_id) }))
      }))
      setGroups(groupsWithMembers)
    }
    fetchGroups()
  }, [user])

  useEffect(() => {
    if (!user) return
    async function fetchPending() {
      const { data: rows } = await supabase
        .from('live_group_members')
        .select('id, group_id')
        .eq('user_id', user!.id)
        .eq('accepted', false)
      if (!rows?.length) {
        setPendingInvites([])
        return
      }
      const { data: groupRows } = await supabase
        .from('live_groups')
        .select('id, name')
        .in('id', rows.map((r) => r.group_id))
      const nameMap = new Map((groupRows ?? []).map((g) => [g.id, g.name]))
      setPendingInvites(
        rows.map((r) => ({ id: r.id, group_id: r.group_id, group: { name: nameMap.get(r.group_id) ?? 'Group' } }))
      )
    }
    fetchPending()
  }, [user])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const videoId = extractYouTubeId(youtubeUrl)
    if (!videoId) {
      setError('Invalid YouTube URL')
      return
    }
    if (!user) return
    setAdding(true)
    const { error: err } = await supabase.from('live_streams').insert({
      user_id: user.id,
      youtube_url: youtubeUrl.trim(),
      title: title.trim() || null,
      is_live: true,
      placement: 'profile',
    })
    setAdding(false)
    if (err) {
      setError(err.message)
      return
    }
    setYoutubeUrl('')
    setTitle('')
    const { data } = await supabase
      .from('live_streams')
      .select('id, youtube_url, title, is_live')
      .order('created_at', { ascending: false })
    setStreams((data ?? []).filter((r) => r.is_live !== false))
  }

  // End one of my own live feeds: flip is_live to false (owner-writable per
  // TABLE_POLICY) so it drops off every viewer's Live page immediately. We keep
  // the row (not a hard delete) so its clips/records and share links survive.
  async function handleEndStream(streamId: string) {
    if (!user) return
    const { error: err } = await supabase
      .from('live_streams')
      .update({ is_live: false })
      .eq('id', streamId)
      .eq('user_id', user.id)
    if (err) {
      setError(err.message)
      return
    }
    setMyStreams((prev) => prev.filter((s) => s.id !== streamId))
    setStreams((prev) => prev.filter((s) => s.id !== streamId))
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !groupName.trim()) return
    const { data: g, error: err } = await supabase
      .from('live_groups')
      .insert({ name: groupName.trim(), creator_id: user.id })
      .select()
      .single()
    if (err) {
      setError(err.message)
      return
    }
    await supabase.from('live_group_members').insert({ group_id: g.id, user_id: user.id, accepted: true })
    setGroupName('')
    const { data: members } = await supabase
      .from('live_group_members')
      .select('id, group_id, user_id, accepted, stream_id')
      .eq('group_id', g.id)
    const { data: profiles } = await supabase.from('profiles').select('id, username')
    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]))
    setGroups((prev) => [
      ...prev,
      {
        ...g,
        members: (members ?? []).map((m) => ({ ...m, profile: profileMap.get(m.user_id) })),
      },
    ])
  }

  async function handleAccept(memberId: string) {
    if (!user) return
    const { error: err } = await supabase
      .from('live_group_members')
      .update({ accepted: true })
      .eq('id', memberId)
      .eq('user_id', user.id)
    if (!err) setPendingInvites((prev) => prev.filter((p) => p.id !== memberId))
  }

  async function handleDecline(memberId: string) {
    if (!user) return
    await supabase
      .from('live_group_members')
      .delete()
      .eq('id', memberId)
      .eq('user_id', user.id)
    setPendingInvites((prev) => prev.filter((p) => p.id !== memberId))
  }

  const groupStreams = viewingGroupId
    ? (() => {
        const grp = groups.find((g) => g.id === viewingGroupId)
        const streamIds = (grp?.members ?? []).filter((m) => m.stream_id).map((m) => m.stream_id!)
        return streams.filter((s) => streamIds.includes(s.id))
      })()
    : streams

  const displayStreams = viewingGroupId ? groupStreams : streams
  streamCountRef.current = displayStreams.length

  // The one feed with sound: default to the focused feed, unless the host
  // muted everything (null) or picked a specific feed's speaker (id).
  const activeAudioId =
    audioStreamId === undefined ? displayStreams[focusedIndex]?.id ?? null : audioStreamId

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-pulse text-accent">Loading…</div>
      </div>
    )
  }

  return (
    <>
      {user && (
        <div className="mb-6 overflow-hidden rounded-lg border border-dark-border bg-dark-card">
          <button
            type="button"
            onClick={() => setHostToolsOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-dark-elevated"
          >
            <span className="flex items-center gap-2 font-semibold">
              <SlidersHorizontal size={17} className="text-accent" />
              Host tools
            </span>
            {hostToolsOpen
              ? <ChevronUp size={17} className="text-gray-500" />
              : <ChevronDown size={17} className="text-gray-500" />}
          </button>

          {hostToolsOpen && (
            <div className="space-y-6 border-t border-dark-border p-4 sm:p-5">
              {/* Add a live — reveal an input, reuse the existing insert path. */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">Feeds</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddLive((v) => !v)}
                    className="btn-ghost min-h-9 px-3 py-1.5 text-sm"
                  >
                    {showAddLive ? 'Close' : <><Plus size={15} /> Add feed</>}
                  </button>
                </div>
                {showAddLive && (
                  <form onSubmit={handleAdd} className="space-y-3">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">YouTube / stream link</label>
                      <input
                        type="url"
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        className="field"
                        placeholder="https://youtube.com/watch?v=..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">Title (optional)</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="field"
                        placeholder="My stream"
                      />
                    </div>
                    {error && <p className="text-kunai text-sm">{error}</p>}
                    <button
                      type="submit"
                      disabled={adding}
                      className="btn-primary"
                    >
                      {adding ? 'Adding...' : <><Plus size={16} /> Add feed</>}
                    </button>
                    <p className="text-xs text-gray-500">Keep pasting links to stack more feeds into the grid.</p>
                  </form>
                )}

                {/* My live feeds — lets a host take a feed offline so it stops
                    showing on everyone's Live page. Without this a stream stays
                    "live" forever. */}
                {myStreams.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <h4 className="text-sm font-medium text-gray-400">My live feeds</h4>
                    {myStreams.map((s) => (
                      <div key={s.id} className="flex items-center justify-between rounded-lg border border-dark-border bg-dark px-3 py-2">
                        <span className="text-sm truncate mr-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-kunai mr-2 align-middle animate-pulse" />
                          {s.title || 'Untitled feed'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleEndStream(s.id)}
                          className="shrink-0 rounded-md border border-kunai/60 px-3 py-1 text-xs font-semibold text-kunai hover:bg-kunai/10"
                        >
                          End live
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Layout & audio */}
              <div>
                <h3 className="mb-2 flex items-center gap-2 font-medium">
                  <LayoutGrid size={16} className="text-gray-500" />
                  Layout and audio
                </h3>
                <div className="flex flex-wrap gap-2">
                  {displayStreams.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => setMultiView(!multiView)}
                      className="btn-ghost text-sm"
                    >
                      {multiView ? 'Single view' : 'Multi-view (4-up)'}
                    </button>
                  )}
                  {multiView && (
                    <button
                      type="button"
                      onClick={() => setAudioStreamId(null)}
                      className="btn-ghost text-sm"
                    >
                      <VolumeX size={16} />
                      Mute all
                    </button>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  In multi-view, tap the speaker on a feed to hear only that one — the rest stay muted so there's no echo.
                </p>
              </div>

              {/* Program view — clean broadcast output for capture / OBS. */}
              <div>
                <h3 className="mb-2 flex items-center gap-2 font-medium">
                  <RadioTower size={16} className="text-gray-500" />
                  Program view
                </h3>
                <a
                  href="/program"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-ghost text-sm"
                >
                  Open program view
                  <ExternalLink size={15} />
                </a>
                <p className="text-xs text-gray-500 mt-2">
                  A full-bleed, chrome-free composite of the live feeds — screen-record it or point OBS at it while you run
                  this dashboard.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {!user && (
        <p className="text-gray-400 mb-8">
          <Link to="/login" className="text-accent hover:underline">Sign in</Link> to add streams.
        </p>
      )}

      {user && (
        <section className="mb-6 border-y border-dark-border py-5">
          <h2 className="mb-2 flex items-center gap-2 font-semibold">
            <Users size={17} className="text-accent" />
            Live groups
          </h2>
          <p className="mb-4 text-sm text-gray-400">
            Create a group, invite others. When all are live, watch together in multi-view.
          </p>
          <form onSubmit={handleCreateGroup} className="flex gap-2 mb-4">
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="field flex-1"
              placeholder="Group name"
            />
            <button type="submit" className="btn-primary">
              Create group
            </button>
          </form>

          {pendingInvites.length > 0 && (
            <div className="mb-4">
              <h3 className="text-sm font-medium text-gray-400 mb-2">Pending invites</h3>
              <div className="space-y-2">
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between rounded-lg bg-dark p-2">
                    <span>{inv.group?.name ?? 'Group'}</span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleAccept(inv.id)}
                        className="px-2 py-1 rounded bg-accent text-dark text-sm font-medium"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecline(inv.id)}
                        className="px-2 py-1 rounded border border-dark-border text-gray-400 text-sm hover:border-kunai/50 hover:text-kunai"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {groups.length > 0 && (
            <div className="space-y-3">
              {groups.map((grp) => (
                <div key={grp.id} className="rounded-lg border border-dark-border p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-medium">{grp.name}</h3>
                    <button
                      type="button"
                      onClick={() => setViewingGroupId(viewingGroupId === grp.id ? null : grp.id)}
                      className="px-3 py-1 rounded border border-accent text-accent text-sm hover:bg-accent/10"
                    >
                      {viewingGroupId === grp.id ? 'Exit group view' : 'View group streams'}
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    {grp.members.map((m) => (
                      <span
                        key={m.user_id}
                        className="inline-flex items-center gap-1 text-sm text-gray-400"
                      >
                        <Link
                          to={`/profile/${m.user_id}`}
                          className="hover:text-accent"
                        >
                          @{m.profile?.username ?? '…'}
                        </Link>
                        {m.accepted ? <span className="text-leaf">✓</span> : <span className="text-gray-500">(pending)</span>}
                        {m.stream_id && <span className="text-[10px] text-accent">[stream]</span>}
                        {m.user_id !== user.id && m.profile?.username && (
                          <InviteMenu
                            targetUserId={m.user_id}
                            targetUsername={m.profile.username}
                            context={{ liveGroupId: grp.id }}
                            compact
                            className="ml-0.5"
                          />
                        )}
                      </span>
                    ))}
                  </div>
                  {grp.members.some((m) => m.user_id === user.id) && myStreams.length > 0 && (
                    <div className="mb-2">
                      <label className="text-sm text-gray-400 mr-2">Link my stream:</label>
                      <select
                        value={grp.members.find((m) => m.user_id === user.id)?.stream_id ?? ''}
                        onChange={async (e) => {
                          const streamId = e.target.value || null
                          const myMember = grp.members.find((m) => m.user_id === user.id)
                          if (!myMember?.id) return
                          await supabase
                            .from('live_group_members')
                            .update({ stream_id: streamId })
                            .eq('id', myMember.id)
                            .eq('user_id', user.id)
                          setGroups((prev) =>
                            prev.map((g) =>
                              g.id === grp.id
                                ? {
                                    ...g,
                                    members: g.members.map((m) =>
                                      m.user_id === user.id ? { ...m, stream_id: streamId } : m
                                    ),
                                  }
                                : g
                            )
                          )
                        }}
                        className="px-2 py-1 rounded bg-dark border border-dark-border text-sm"
                      >
                        <option value="">None</option>
                        {myStreams.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.title ?? 'Stream'}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {user.id === grp.creator_id && (
                    <div className="text-xs text-gray-500 mt-2">
                      Tip: open a member's profile and use the invite menu, or pass the group link directly.
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {directorNote && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-4 py-2 text-sm text-accent">
          <Mic2 size={15} />
          {directorNote}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <h2 className="section-heading">{viewingGroupId ? 'Group streams' : 'Live now'}</h2>
        {displayStreams.length >= 2 && !multiView && (
          <button
            type="button"
            onClick={() => { setHostToolsOpen(true); setMultiView(true) }}
            className="btn-ghost text-sm"
          >
            <LayoutGrid size={16} />
            Multi-view (4-up)
          </button>
        )}
        {multiView && (
          <button
            type="button"
            onClick={() => setMultiView(false)}
            className="btn-ghost text-sm"
          >
            Single view
          </button>
        )}
      </div>

      {displayStreams.length === 0 ? (
        <div className="flex min-h-52 flex-col items-center justify-center rounded-lg border border-dashed border-dark-border bg-dark-card/60 p-6 text-center">
          <Radio size={30} className="mb-3 text-gray-600" />
          <p className="text-sm text-gray-400">
            {viewingGroupId ? 'No streams are linked to this group yet.' : 'Nobody is live right now.'}
          </p>
          {user && !viewingGroupId && (
            <button
              type="button"
              onClick={() => {
                setHostToolsOpen(true)
                setShowAddLive(true)
              }}
              className="btn-primary mt-4"
            >
              <Plus size={16} />
              Add a live feed
            </button>
          )}
        </div>
      ) : multiView && displayStreams.length >= 2 ? (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4">
            <div className="overflow-hidden rounded-lg border border-accent">
              {(() => {
                const focused = displayStreams[focusedIndex]
                const videoId = focused && extractYouTubeId(focused.youtube_url)
                const focusedUnmuted = !!focused && activeAudioId === focused.id
                return (
                  <>
                    <div className="relative aspect-video">
                      {videoId && (
                        <CroppedFrame>
                          <iframe
                            key={`focus-${focused.id}-${focusedUnmuted ? 'on' : 'off'}`}
                            src={ytEmbedSrc(videoId, focusedUnmuted)}
                            title={focused?.title ?? 'Stream'}
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowFullScreen
                            className="w-full h-full"
                          />
                        </CroppedFrame>
                      )}
                      <TkoWatermark />
                    </div>
                    <div className="p-2 bg-dark-card flex items-center justify-between gap-2">
                      <h3 className="font-medium truncate">{focused?.title ?? 'Stream'}</h3>
                      {focused && (
                        <button
                          type="button"
                          onClick={() => setAudioStreamId(focusedUnmuted ? null : focused.id)}
                          title={focusedUnmuted ? 'Mute this feed' : 'Unmute this feed (mutes the others)'}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                            focusedUnmuted
                              ? 'border-accent text-accent'
                              : 'border-dark-border text-gray-400 hover:text-accent hover:border-accent/50'
                          }`}
                        >
                          {focusedUnmuted ? <Volume2 size={15} /> : <VolumeX size={15} />}
                        </button>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
            {displayStreams[focusedIndex] && (
              <StreamChat
                streamId={displayStreams[focusedIndex].id}
                title={displayStreams[focusedIndex].title}
              />
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {displayStreams.slice(0, 4).map((stream, i) => {
              const videoId = extractYouTubeId(stream.youtube_url)
              const isFocused = i === focusedIndex
              // The focused feed's audio is carried by the big focus iframe, so
              // its thumbnail must ALWAYS be muted — otherwise both play the same
              // audio and cause echo/feedback.
              const unmuted = !isFocused && activeAudioId === stream.id
              return (
                <div
                  key={stream.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFocusedIndex(i)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setFocusedIndex(i) }}
                  className={`rounded-lg border overflow-hidden text-left transition-all cursor-pointer ${
                    isFocused ? 'border-accent ring-2 ring-accent' : 'border-dark-border hover:border-accent/50'
                  }`}
                >
                  <div className="aspect-video relative">
                    {videoId && (
                      <CroppedFrame>
                        <iframe
                          key={`thumb-${stream.id}-${unmuted ? 'on' : 'off'}`}
                          src={ytEmbedSrc(videoId, unmuted)}
                          title={stream.title ?? 'Stream'}
                          allow="autoplay; encrypted-media; picture-in-picture"
                          className="w-full h-full"
                        />
                      </CroppedFrame>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setAudioStreamId(unmuted ? null : stream.id) }}
                      title={unmuted ? 'Mute this feed' : 'Unmute this feed (mutes the others)'}
                      className={`absolute bottom-1 right-1 flex h-7 w-7 items-center justify-center rounded bg-black/70 ${
                        unmuted ? 'text-accent' : 'text-white'
                      }`}
                    >
                      {unmuted ? <Volume2 size={14} /> : <VolumeX size={14} />}
                    </button>
                  </div>
                  <div className="p-1 bg-dark-card">
                    <span className="text-xs truncate block">{stream.title ?? 'Stream'}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="grid gap-6">
          {displayStreams.map((stream) => {
            const videoId = extractYouTubeId(stream.youtube_url)
            return (
              <div
                key={stream.id}
                className="overflow-hidden rounded-lg border border-dark-border bg-dark-card"
              >
                <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
                  <div>
                    <div className="aspect-video">
                      {videoId && (
                        <iframe
                          src={`https://www.youtube.com/embed/${videoId}`}
                          title={stream.title ?? 'Stream'}
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                          className="w-full h-full"
                        />
                      )}
                    </div>
                    <div className="p-4 flex items-center justify-between gap-2">
                      <h3 className="font-medium truncate">{stream.title ?? 'Stream'}</h3>
                      <ShareButton
                        url={`https://tko.cam/watch/${stream.id}?u=${encodeURIComponent(stream.youtube_url)}${stream.title ? `&t=${encodeURIComponent(stream.title)}` : ''}`}
                        title={stream.title ?? 'Live on TKO'}
                        text="Watch this live on TKO"
                      />
                    </div>
                  </div>
                  <div className="border-t lg:border-t-0 lg:border-l border-dark-border">
                    <StreamChat streamId={stream.id} title={stream.title} />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
