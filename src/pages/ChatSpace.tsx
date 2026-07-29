import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { isFounder } from '@/lib/founder'
import { Drawer } from '@/components/ui/Drawer'
import { Avatar } from '@/components/ui'
import { TagBadge } from '@/components/TagBadge'
import { ChatComposer, ChatMessageContent } from '@/components/social/ChatPoll'
import type { ArtifactRarity } from '@/types/database'
import {
  groupChannels,
  canPost,
  canManageChannels,
  normalizeCategory,
  normalizeChannelName,
  spaceKindLabel,
  defaultChannelsForKind,
  type ChatPermCtx,
} from '@/lib/chat'
import type { ChatSpace as ChatSpaceRow, ChatChannel, ChatMessage, ChatSpaceKind } from '@/types/database'
import type { ClanRole } from '@/lib/clans'

/** Fixed id of the seeded TKO-official space (db/schema.sql). */
export const TKO_SPACE_ID = '00000000-0000-0000-0000-0000000c4a70'

/**
 * Find-or-create the official "TKO chats" space + its default channels. On a
 * real backend the schema seeds this row (so we just find it); on the in-memory
 * mock backend nothing is seeded, so we create it client-side — exactly like
 * ClanChatRedirect scaffolds a clan space. This is what stops "TKO chats" from
 * dead-ending on "This chat space isn't available." Safe to call repeatedly:
 * it inserts only when the row / channels are missing.
 */
export async function ensureTkoSpace(): Promise<ChatSpaceRow | null> {
  // Prefer the canonical fixed-id row; fall back to any tko-kind space.
  const { data: byId } = await supabase
    .from('chat_spaces')
    .select('*')
    .eq('id', TKO_SPACE_ID)
    .maybeSingle()
  let space = (byId as ChatSpaceRow) ?? null
  if (!space) {
    const { data: byKind } = await supabase
      .from('chat_spaces')
      .select('*')
      .eq('kind', 'tko')
      .limit(1)
    space = ((byKind as ChatSpaceRow[]) ?? [])[0] ?? null
  }
  if (!space) {
    const { data: created } = await supabase
      .from('chat_spaces')
      .insert({ id: TKO_SPACE_ID, kind: 'tko', name: 'TKO Official', owner_id: null, clan_id: null })
      .select()
      .single()
    space = (created as ChatSpaceRow) ?? null
  }
  if (!space) return null

  // Seed the default channel set if this space has none yet.
  const { data: existingChans } = await supabase
    .from('chat_channels')
    .select('id')
    .eq('space_id', space.id)
    .limit(1)
  if (((existingChans as unknown[]) ?? []).length === 0) {
    const drafts = defaultChannelsForKind('tko')
    await supabase.from('chat_channels').insert(
      drafts.map((d) => ({
        space_id: space!.id,
        name: d.name,
        category: d.category,
        position: d.position,
        is_announcement: d.is_announcement,
      })),
    )
  }
  return space
}

type EnrichedMessage = ChatMessage & {
  username?: string
  avatarUrl?: string | null
  equippedTagText?: string | null
  equippedTagRarity?: ArtifactRarity | null
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * ChatSpace — a real multi-channel Space view (docs §4).
 *
 * Left: channel list grouped into collapsible categories. On phones it's a
 * slide-in Drawer (toggled by a button); at sm+ it's an always-on column beside
 * the messages — the responsive-sibling pattern (two renders of one list, only
 * one visible at a time, no overlap). Main: the selected channel's messages +
 * a composer with a visible Send button, permission-gated per space kind + rank.
 */
export function ChatSpace() {
  const { spaceId } = useParams()
  const { user, profile } = useAuth()

  const [space, setSpace] = useState<ChatSpaceRow | null>(null)
  const [channels, setChannels] = useState<ChatChannel[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [clanRole, setClanRole] = useState<ClanRole | null>(null)
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ── Load the space + its channels + the viewer's clan rank (clan spaces). ──
  const loadSpace = useCallback(async () => {
    if (!spaceId) return
    const { data: fetched } = await supabase.from('chat_spaces').select('*').eq('id', spaceId).single()
    let sp: ChatSpaceRow | null = (fetched as ChatSpaceRow | null) ?? null
    // The official TKO space may not be seeded on the mock backend — find or
    // create it (with its default channels) so it never dead-ends.
    if (!sp && spaceId === TKO_SPACE_ID) {
      sp = await ensureTkoSpace()
    }
    setSpace(sp ?? null)

    const channelSpaceId = sp?.id ?? spaceId
    const { data: chans } = await supabase
      .from('chat_channels')
      .select('*')
      .eq('space_id', channelSpaceId)
      .order('position', { ascending: true })
    const list = (chans ?? []) as ChatChannel[]
    setChannels(list)
    setActiveId((prev) => (prev && list.some((c) => c.id === prev) ? prev : list[0]?.id ?? null))

    // Resolve the viewer's clan rank when this is a clan space.
    if (sp && (sp as ChatSpaceRow).kind === 'clan' && (sp as ChatSpaceRow).clan_id && user) {
      const clanId = (sp as ChatSpaceRow).clan_id!
      const { data: mem } = await supabase
        .from('clan_members')
        .select('role')
        .eq('server_id', clanId)
        .eq('user_id', user.id)
        .maybeSingle()
      let role = ((mem?.role as ClanRole) ?? null) || null
      // Creator fallback: if we have no membership row but the viewer OWNS the
      // clan (or this space), treat them as the leader so they can run + post in
      // the chat they made. Non-exploitable — only the owner gets this.
      if (!role) {
        try {
          const { data: srv } = await supabase.from('servers').select('owner_id').eq('id', clanId).maybeSingle()
          const ownsClan = (srv as { owner_id?: string } | null)?.owner_id === user.id
          if (ownsClan || (sp as ChatSpaceRow).owner_id === user.id) role = 'leader'
        } catch { /* no servers table / not readable — leave as null */ }
      }
      setClanRole(role)
    } else {
      setClanRole(null)
    }
    setLoading(false)
  }, [spaceId, user])

  useEffect(() => {
    setLoading(true)
    loadSpace()
  }, [loadSpace])

  const activeChannel = useMemo(
    () => channels.find((c) => c.id === activeId) ?? null,
    [channels, activeId],
  )

  const groups = useMemo(() => groupChannels(channels), [channels])

  // Permission context for the viewer against a given channel.
  const permCtx = useCallback(
    (isAnnouncement: boolean): ChatPermCtx => ({
      kind: (space?.kind ?? 'open') as ChatSpaceKind,
      isAnnouncement,
      signedIn: !!user,
      isStaff: isFounder(),
      isOwner: !!user && !!space && space.owner_id === user.id,
      clanRole,
    }),
    [space, user, clanRole],
  )

  const mayManage = space ? canManageChannels(permCtx(false)) : false

  if (!loading && !space) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-gray-300">This chat space isn't available.</p>
        <Link to="/chat" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
          Back to chats
        </Link>
      </div>
    )
  }
  if (loading || !space) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading…</div>
      </div>
    )
  }

  const channelList = (
    <ChannelList
      groups={groups}
      activeId={activeId}
      onPick={(id) => {
        setActiveId(id)
        setDrawerOpen(false)
      }}
      canManage={mayManage}
      onCreate={async (draft) => {
        const nextPos = channels.reduce((m, c) => Math.max(m, c.position ?? 0), -1) + 1
        await supabase.from('chat_channels').insert({
          space_id: space.id,
          name: draft.name,
          category: draft.category,
          position: nextPos,
          is_announcement: draft.isAnnouncement,
        })
        await loadSpace()
      }}
      existingCategories={groups.map((g) => g.category).filter((c): c is string => !!c)}
    />
  )

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] sm:h-[calc(100vh-0px)]">
      {/* Space header + phone-only channel drawer toggle. */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-border bg-dark-card">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="sm:hidden shrink-0 rounded-lg border border-dark-border px-2.5 py-1.5 text-sm text-gray-300 hover:text-white"
          aria-label="Open channels"
        >
          ☰ Channels
        </button>
        <div className="min-w-0">
          <h1 className="font-semibold truncate leading-tight">{space.name}</h1>
          <span className="text-[11px] uppercase tracking-wider text-gray-500">
            {spaceKindLabel(space.kind)} space
          </span>
        </div>
        <Link to="/chat" className="ml-auto text-xs text-gray-500 hover:text-accent shrink-0">
          All chats
        </Link>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Wide screens: always-on channel column (sibling of the drawer). */}
        <div className="hidden sm:flex w-56 shrink-0 border-r border-dark-border bg-dark-card flex-col overflow-y-auto">
          {channelList}
        </div>

        {/* Phones: the same list inside a slide-in Drawer. */}
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} side="left" title={space.name}>
          {channelList}
        </Drawer>

        {/* Main: selected channel's messages + composer. */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeChannel ? (
            <ChannelView
              key={activeChannel.id}
              channel={activeChannel}
              canPostHere={canPost(permCtx(activeChannel.is_announcement))}
              selfName={
                profile?.username ??
                ((user?.user_metadata as Record<string, unknown> | undefined)?.username as string | undefined) ??
                'you'
              }
              selfAvatar={profile?.avatar_url ?? null}
              selfTagText={profile?.equipped_tag_text ?? null}
              selfTagRarity={profile?.equipped_tag_rarity ?? null}
              userId={user?.id ?? null}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400 text-center px-6">
              <p>No channels yet.</p>
              {mayManage && <p className="text-xs text-gray-500">Use “+ Channel” to add one.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Channel list (grouped, collapsible categories) + create-channel control
// ───────────────────────────────────────────────────────────────────────────

type NewChannelDraft = { name: string; category: string | null; isAnnouncement: boolean }

function ChannelList({
  groups,
  activeId,
  onPick,
  canManage,
  onCreate,
  existingCategories,
}: {
  groups: ReturnType<typeof groupChannels<ChatChannel>>
  activeId: string | null
  onPick: (id: string) => void
  canManage: boolean
  onCreate: (draft: NewChannelDraft) => Promise<void>
  existingCategories: string[]
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [announcement, setAnnouncement] = useState(false)
  const [busy, setBusy] = useState(false)

  function toggle(cat: string) {
    setCollapsed((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const clean = normalizeChannelName(name)
    if (!clean || busy) return
    setBusy(true)
    await onCreate({ name: clean, category: normalizeCategory(category), isAnnouncement: announcement })
    setBusy(false)
    setName('')
    setCategory('')
    setAnnouncement(false)
    setShowForm(false)
  }

  return (
    <div className="flex flex-col p-2 gap-2">
      {groups.map((g) => {
        const key = g.category ?? '__ungrouped__'
        const isCollapsed = !!collapsed[key]
        return (
          <div key={key}>
            {g.category && (
              <button
                type="button"
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-300"
                aria-expanded={!isCollapsed}
              >
                <span className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`}>▾</span>
                {g.category}
              </button>
            )}
            {!isCollapsed &&
              g.channels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => onPick(ch.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                    activeId === ch.id
                      ? 'bg-accent/10 text-accent'
                      : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
                  }`}
                >
                  <span className="text-gray-600">{ch.is_announcement ? '📣' : '#'}</span>
                  <span className="truncate">{ch.name}</span>
                </button>
              ))}
          </div>
        )
      })}

      {canManage && (
        <div className="mt-1 border-t border-dark-border pt-2">
          {showForm ? (
            <form onSubmit={submit} className="space-y-2">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="channel-name"
                className="w-full px-2.5 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
                autoFocus
              />
              <input
                type="text"
                list="chat-categories"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Category (optional — new or existing)"
                className="w-full px-2.5 py-1.5 rounded-lg bg-dark border border-dark-border text-white text-sm"
              />
              <datalist id="chat-categories">
                {existingCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input
                  type="checkbox"
                  checked={announcement}
                  onChange={(e) => setAnnouncement(e.target.checked)}
                />
                Announcement (post-restricted)
              </label>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={!normalizeChannelName(name) || busy}
                  className="flex-1 px-3 py-1.5 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1.5 rounded-lg border border-dark-border text-sm text-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-400 hover:text-white hover:bg-dark-border/50"
            >
              + Channel / Category
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────
//  Channel view — messages + composer
// ───────────────────────────────────────────────────────────────────────────

function ChannelView({
  channel,
  canPostHere,
  selfName,
  selfAvatar,
  selfTagText,
  selfTagRarity,
  userId,
}: {
  channel: ChatChannel
  canPostHere: boolean
  selfName: string
  selfAvatar: string | null
  selfTagText: string | null
  selfTagRarity: ArtifactRarity | null
  userId: string | null
}) {
  const [messages, setMessages] = useState<EnrichedMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let sub: ReturnType<typeof supabase.channel> | null = null

    async function fetchMessages() {
      const { data } = await supabase
        .from('chat_messages')
        .select('*')
        .eq('channel_id', channel.id)
        .order('created_at', { ascending: true })
        .limit(200)
      if (cancelled) return
      const rows = (data ?? []) as ChatMessage[]
      const ids = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]))
      type ProfMeta = {
        username: string
        avatar_url: string | null
        equipped_tag_text: string | null
        equipped_tag_rarity: ArtifactRarity | null
      }
      let names = new Map<string, ProfMeta>()
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, username, avatar_url, equipped_tag_text, equipped_tag_rarity')
          .in('id', ids)
        names = new Map(
          (profs ?? []).map((p) => [
            p.id,
            {
              username: p.username,
              avatar_url: p.avatar_url ?? null,
              equipped_tag_text: p.equipped_tag_text ?? null,
              equipped_tag_rarity: (p.equipped_tag_rarity ?? null) as ArtifactRarity | null,
            },
          ]),
        )
      }
      if (cancelled) return
      setMessages(
        rows.map((r) => ({
          ...r,
          username: r.user_id ? names.get(r.user_id)?.username : undefined,
          avatarUrl: r.user_id ? names.get(r.user_id)?.avatar_url ?? null : null,
          equippedTagText: r.user_id ? names.get(r.user_id)?.equipped_tag_text ?? null : null,
          equippedTagRarity: r.user_id ? names.get(r.user_id)?.equipped_tag_rarity ?? null : null,
        })),
      )
    }

    fetchMessages()
    sub = supabase
      .channel(`chat:${channel.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `channel_id=eq.${channel.id}` },
        fetchMessages,
      )
      .subscribe()

    return () => {
      cancelled = true
      if (sub) supabase.removeChannel(sub)
    }
  }, [channel.id])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    if (nearBottom) el.scrollTop = el.scrollHeight
  }, [messages])

  async function sendMessage(body: string): Promise<void> {
    if (!userId) throw new Error('Log in to chat.')
    const { data: inserted, error: err } = await supabase
      .from('chat_messages')
      .insert({ channel_id: channel.id, user_id: userId, body })
      .select()
      .single()
    if (err) {
      throw new Error(err.message || 'Could not send the message.')
    }
    // Optimistic append — the standalone/mock backend has no realtime echo.
    const row =
      (inserted as ChatMessage | null) ?? {
        id: `local-${Date.now()}`,
        channel_id: channel.id,
        user_id: userId,
        body,
        created_at: new Date().toISOString(),
      }
    setMessages((prev) =>
      prev.some((m) => m.id === row.id)
        ? prev
        : [
            ...prev,
            {
              ...row,
              username: selfName,
              avatarUrl: selfAvatar,
              equippedTagText: selfTagText,
              equippedTagRarity: selfTagRarity,
            },
          ],
    )
  }

  return (
    <>
      <div className="p-4 border-b border-dark-border flex items-center gap-2">
        <h2 className="font-medium">
          {channel.is_announcement ? '📣 ' : '# '}
          {channel.name}
        </h2>
        {channel.is_announcement && (
          <span className="text-[10px] uppercase tracking-wide rounded-full border border-dark-border px-2 py-0.5 text-gray-500">
            Announcements
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">Be the first to say something.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex gap-3">
              <Avatar src={m.avatarUrl} name={m.username} seed={m.user_id} size={32} />
              <div className="min-w-0">
                <span className="text-accent text-sm font-medium inline-flex items-center gap-1.5">
                  {m.user_id ? (
                    <Link to={`/profile/${m.user_id}`} className="hover:underline">
                      {m.username ?? 'someone'}
                    </Link>
                  ) : (
                    <span className="text-gray-500">deleted</span>
                  )}
                  <TagBadge artifactText={m.equippedTagText} rarity={m.equippedTagRarity} />
                </span>
                <span className="text-gray-500 text-xs ml-2">{fmtTime(m.created_at)}</span>
                <ChatMessageContent body={m.body} userId={userId} />
              </div>
            </div>
          ))
        )}
      </div>

      {canPostHere && userId ? (
        <ChatComposer
          userId={userId}
          placeholder={`Message #${channel.name}`}
          onSend={sendMessage}
          className="border-t border-dark-border"
        />
      ) : (
        <div className="p-4 border-t border-dark-border text-xs text-gray-500 text-center">
          {userId
            ? channel.is_announcement
              ? 'Only officers / staff can post in this announcement channel.'
              : 'You don’t have permission to post here.'
            : 'Log in to chat.'}
        </div>
      )}
    </>
  )
}

export default ChatSpace

// ───────────────────────────────────────────────────────────────────────────
//  Clan wiring — find-or-create a clan's dedicated chat space, then open it.
// ───────────────────────────────────────────────────────────────────────────

/**
 * ClanChatRedirect — entry point for a clan's Discord-style chat space. Given a
 * clan `serverId`, it finds the clan's `chat_spaces` row (kind='clan',
 * clan_id=serverId) or creates it (seeded with a default #general channel) and
 * redirects to `/chat/:spaceId`. This is how a clan "gets" a chat space without
 * disturbing the legacy BoardDetail board (which stays on servers/channels/
 * messages). Permissions inside then resolve from the viewer's clan rank.
 */
export function ClanChatRedirect() {
  const { serverId } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function go() {
      if (!serverId) return
      // Existing clan space?
      const { data: existing } = await supabase
        .from('chat_spaces')
        .select('*')
        .eq('clan_id', serverId)
        .eq('kind', 'clan')
        .maybeSingle()
      if (cancelled) return
      if (existing) {
        navigate(`/chat/${(existing as ChatSpaceRow).id}`, { replace: true })
        return
      }
      // Create it, named after the clan.
      const { data: server } = await supabase.from('servers').select('name').eq('id', serverId).maybeSingle()
      const name = ((server?.name as string | undefined) ?? 'Clan') + ' Chat'
      const { data: created } = await supabase
        .from('chat_spaces')
        // Stamp the creator as owner so they can run + post in the chat they made.
        .insert({ kind: 'clan', name, clan_id: serverId, owner_id: user?.id ?? null })
        .select()
        .single()
      const space = created as ChatSpaceRow | null
      if (cancelled) return
      if (!space) {
        setFailed(true)
        return
      }
      await supabase.from('chat_channels').insert({
        space_id: space.id,
        name: 'general',
        category: null,
        position: 0,
        is_announcement: false,
      })
      if (!cancelled) navigate(`/chat/${space.id}`, { replace: true })
    }
    go()
    return () => {
      cancelled = true
    }
  }, [serverId, navigate])

  if (failed) {
    return (
      <div className="p-8 flex flex-col items-center justify-center gap-3 py-20 text-center">
        <p className="text-gray-300">Couldn’t open this clan’s chat space.</p>
        <Link to="/chat" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
          Back to chats
        </Link>
      </div>
    )
  }
  return (
    <div className="p-8 flex items-center justify-center">
      <div className="animate-pulse text-accent">Opening clan chat…</div>
    </div>
  )
}
