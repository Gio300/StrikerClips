import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { LogOut, Settings } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { LiveNowStrip } from '@/components/LiveNowStrip'
import { ClanSettingsPanel } from '@/components/ClanSettingsPanel'
import { topBadge, type BadgeMeta } from '@/lib/badges'
import { BadgeChip } from '@/components/BadgeChip'
import { effectiveDisplayName } from '@/lib/founder'
import { formatTag } from '@/lib/identity'
import { can, canLeaveClan, isClanManagerRole } from '@/lib/clans'
import type { Server, Channel, ClanMember, Message } from '@/types/database'

// Messages carry an optional `meta` bag of badge-bearing metadata. The profile
// join only returns username + power_level, so today only the signed-in user's
// own optimistic message carries badges; everyone else degrades to no badge.
type BoardMessage = Message & { profiles?: { username: string }; meta?: BadgeMeta }

export function boardRailStartsOpen(viewportWidth: number): boolean {
  return viewportWidth >= 640
}

export function BoardDetail() {
  const { serverId, channelId } = useParams()
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const [server, setServer] = useState<Server | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [messages, setMessages] = useState<BoardMessage[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  // Collapse the channel rail so the chat gets the whole screen on a phone.
  const [railOpen, setRailOpen] = useState(() => (
    typeof window === 'undefined' ? true : boardRailStartsOpen(window.innerWidth)
  ))
  const [newChannel, setNewChannel] = useState('')
  const [addingChannel, setAddingChannel] = useState(false)
  const [viewerMembership, setViewerMembership] = useState<Pick<ClanMember, 'id' | 'role'> | null>(null)
  const [clanNotice, setClanNotice] = useState<string | null>(null)
  const [leavingClan, setLeavingClan] = useState(false)

  async function addChannel(e: React.FormEvent) {
    e.preventDefault()
    const name = newChannel.trim().toLowerCase().replace(/^#+/, '').replace(/\s+/g, '-').replace(/[^a-z0-9\-_]/g, '').slice(0, 32)
    if (!name || !serverId) return
    setAddingChannel(true)
    setClanNotice(null)
    try {
      const { data, error } = await supabase
        .from('channels')
        .insert({ server_id: serverId, name })
        .select()
        .single()
      if (error) {
        setClanNotice(error.message || 'That channel could not be created.')
        return
      }
      if (data) {
        setChannels((prev) => [...prev, data as Channel].sort((a, b) => a.name.localeCompare(b.name)))
        setActiveChannel(data as Channel)
      }
      setNewChannel('')
    } finally {
      setAddingChannel(false)
    }
  }

  async function leaveClan() {
    if (!user || !serverId || !server || !viewerMembership || !canLeaveClan(viewerMembership.role)) return
    if (!window.confirm(`Leave ${server.name}? You will be removed from its clan roster and board.`)) return
    setLeavingClan(true)
    setClanNotice(null)
    const { error: membershipError } = await supabase
      .from('clan_members')
      .delete()
      .eq('id', viewerMembership.id)
      .eq('user_id', user.id)
    if (membershipError) {
      setClanNotice(membershipError.message || 'You could not leave this clan.')
      setLeavingClan(false)
      return
    }

    const { error: boardError } = await supabase
      .from('server_members')
      .delete()
      .eq('server_id', serverId)
      .eq('user_id', user.id)
    setLeavingClan(false)
    if (boardError) {
      setViewerMembership(null)
      setClanNotice('You left the clan, but its board access could not be cleaned up. Please contact support.')
      return
    }
    navigate('/boards')
  }

  useEffect(() => {
    if (!serverId) return
    async function fetch() {
      const { data: serverData } = await supabase.from('servers').select('*').eq('id', serverId!).single()
      setServer(serverData)
      if (user) {
        const { data: membership } = await supabase
          .from('clan_members')
          .select('id, role')
          .eq('server_id', serverId!)
          .eq('user_id', user.id)
          .maybeSingle()
        setViewerMembership(
          serverData?.owner_id === user.id
            ? { id: (membership?.id as string | undefined) ?? '', role: 'leader' }
            : membership
              ? { id: membership.id as string, role: membership.role as ClanMember['role'] }
              : null,
        )
      } else {
        setViewerMembership(null)
      }
      const { data: channelsData } = await supabase
        .from('channels')
        .select('*')
        .eq('server_id', serverId!)
        .order('name')
      setChannels(channelsData ?? [])
      const first = (channelsData ?? [])[0]
      setActiveChannel(channelId ? (channelsData ?? []).find((c) => c.id === channelId) ?? first : first)
      setLoading(false)
    }
    fetch()
  }, [serverId, channelId, user?.id])

  useEffect(() => {
    if (!activeChannel) return
    async function fetchMessages() {
      const { data } = await supabase
        .from('messages')
        .select('*, profiles(username, power_level)')
        .eq('channel_id', activeChannel!.id)
        .order('created_at', { ascending: true })
      setMessages((data ?? []) as unknown as BoardMessage[])
    }
    fetchMessages()

    const sub = supabase
      .channel(`messages:${activeChannel.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${activeChannel.id}` }, fetchMessages)
      .subscribe()

    return () => {
      sub.unsubscribe()
    }
  }, [activeChannel?.id])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !activeChannel || !newMessage.trim()) return
    const content = newMessage.trim()
    setClanNotice(null)
    const { data, error } = await supabase
      .from('messages')
      .insert({
        channel_id: activeChannel.id,
        user_id: user.id,
        content,
      })
      .select('*, profiles(username, power_level)')
      .single()
    if (error) {
      setClanNotice(error.message || 'Your message could not be sent. Try again.')
      return
    }
    setNewMessage('')
    if (data) {
      // Optimistically show the sent message. In standalone mode the realtime
      // channel is a stub, so nothing arrives otherwise. Guard against a
      // duplicate in case the realtime callback also delivers this row.
      const sent = (data.profiles
        ? { ...data, meta: user.user_metadata as BadgeMeta }
        : { ...data, profiles: { username: effectiveDisplayName(profile?.username) }, meta: user.user_metadata as BadgeMeta }) as BoardMessage
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]))
    }
  }

  if (!loading && !server) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-gray-300">This clan board isn't available.</p>
        <Link to="/boards" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Back to clans</Link>
      </div>
    )
  }
  if (loading || !server) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  const viewerRole = viewerMembership?.role ?? null
  const canManageChannels = viewerRole ? can(viewerRole, 'manage_channels') : false

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] sm:h-[calc(100vh-0px)]">
      {/* This clan's live streams */}
      <div className="px-4 pt-4">
        <LiveNowStrip placement="clan" clanId={serverId} />
      </div>
      {clanNotice && (
        <p role="alert" className="mx-4 mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {clanNotice}
        </p>
      )}
      <div className="flex flex-1 min-h-0">
      {railOpen && (
      <div className="w-40 sm:w-56 shrink-0 border-r border-dark-border bg-dark-card flex flex-col">
        <div className="p-4 border-b border-dark-border">
          <h1 className="font-semibold truncate">
            {server.clan_tag && (
              <span className="text-accent mr-1">{formatTag(server.clan_tag)}</span>
            )}
            {server.name}
          </h1>
          <Link
            to={`/clans/${serverId}/chat`}
            className="mt-1 inline-block text-xs text-accent hover:underline"
          >
            Open chat space →
          </Link>
          {user && isClanManagerRole(viewerRole) && (
            <Link
              to={`/clans/${serverId}/manage`}
              className="mt-2 flex items-center gap-1.5 text-xs text-gray-400 hover:text-white"
            >
              <Settings size={13} /> Clan tools
            </Link>
          )}
          {user && canLeaveClan(viewerRole) && (
            <button
              type="button"
              onClick={() => void leaveClan()}
              disabled={leavingClan}
              className="mt-2 flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
            >
              <LogOut size={13} /> {leavingClan ? 'Leaving clan...' : 'Leave clan'}
            </button>
          )}
        </div>
        <nav className="flex-1 p-2 overflow-auto">
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => {
                setActiveChannel(ch)
                if (typeof window !== 'undefined' && !boardRailStartsOpen(window.innerWidth)) {
                  setRailOpen(false)
                }
              }}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeChannel?.id === ch.id ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
              }`}
            >
              # {ch.name}
            </button>
          ))}
          {/* Add a channel — a plus row so you can spin up more rooms. */}
          {user && canManageChannels && (
            <form onSubmit={addChannel} className="mt-2 flex gap-1 border-t border-dark-border pt-2">
              <input
                type="text"
                value={newChannel}
                onChange={(e) => setNewChannel(e.target.value)}
                placeholder="+ new-channel"
                className="min-w-0 flex-1 px-2 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-xs"
              />
              <button
                type="submit"
                disabled={!newChannel.trim() || addingChannel}
                title="Add channel"
                className="shrink-0 px-2 py-1.5 rounded-lg bg-accent text-dark text-xs font-bold disabled:opacity-50"
              >
                +
              </button>
            </form>
          )}
        </nav>
      </div>
      )}
      <div className="flex-1 flex flex-col min-w-0">
        {activeChannel ? (
          <>
            <div className="p-4 border-b border-dark-border flex items-center gap-2">
              <button
                type="button"
                onClick={() => setRailOpen((v) => !v)}
                title={railOpen ? 'Hide channels' : 'Show channels'}
                className="shrink-0 rounded-lg border border-dark-border px-2 py-1 text-sm text-gray-300 hover:text-white"
                aria-label={railOpen ? 'Hide channels' : 'Show channels'}
              >
                {railOpen ? '⟨' : '☰'}
              </button>
              <h2 className="font-medium min-w-0 truncate"># {activeChannel.name}</h2>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Clan management — self-gated by the permission matrix; renders
                  nothing for a plain member / non-member. */}
              {user && server && (
                <ClanSettingsPanel server={server} viewerId={user.id} />
              )}
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <span className="text-accent text-sm font-medium">
                      {(msg.profiles as { username?: string })?.username?.[0] ?? '?'}
                    </span>
                  </div>
                  <div>
                    <span className="text-accent text-sm font-medium">
                      {topBadge(msg.meta) && <BadgeChip badge={topBadge(msg.meta)!} compact className="mr-1" />}
                      {(msg.profiles as { username?: string })?.username ?? 'Unknown'}
                      {(msg.profiles as { power_level?: number })?.power_level != null && (msg.profiles as { power_level?: number }).power_level! > 0 && (
                        <span className="text-gray-500 font-normal ml-1">· PL {(msg.profiles as { power_level?: number }).power_level}</span>
                      )}
                    </span>
                    <span className="text-gray-500 text-sm ml-2">
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </span>
                    <p data-user-content className="text-gray-300 mt-0.5">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
            {user && (
              <form onSubmit={sendMessage} className="p-3 sm:p-4 border-t border-dark-border flex gap-2 items-center">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={`Message # ${activeChannel.name}`}
                  className="flex-1 min-w-0 px-4 py-2 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="shrink-0 px-4 py-2 rounded-lg bg-accent text-dark font-semibold disabled:opacity-50"
                >
                  Send
                </button>
              </form>
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col">
            <div className="flex items-center gap-2 border-b border-dark-border p-4">
              <button
                type="button"
                onClick={() => setRailOpen((value) => !value)}
                className="shrink-0 rounded-lg border border-dark-border px-2 py-1 text-sm text-gray-300 hover:text-white"
                aria-label={railOpen ? 'Hide channels' : 'Show channels'}
              >
                {railOpen ? '⟨' : '☰'}
              </button>
              <h2 className="font-medium text-white">Clan board</h2>
            </div>
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="w-full max-w-sm text-center">
                <p className="font-semibold text-white">No channels yet</p>
                <p className="mt-1 text-sm text-gray-500">
                  {canManageChannels
                    ? 'Create #general so your clan has a place to talk.'
                    : 'A clan leader or officer needs to create the first channel.'}
                </p>
                {canManageChannels && (
                  <form onSubmit={addChannel} className="mt-4 flex gap-2">
                    <input
                      type="text"
                      value={newChannel}
                      onChange={(event) => setNewChannel(event.target.value)}
                      placeholder="general"
                      aria-label="Channel name"
                      className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!newChannel.trim() || addingChannel}
                      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-dark disabled:opacity-50"
                    >
                      {addingChannel ? 'Creating...' : 'Create'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}
