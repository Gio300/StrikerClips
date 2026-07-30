import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { defaultChannelsForKind, spaceKindLabel } from '@/lib/chat'
import { isValidName, nameQualityError } from '@/lib/nameQuality'
import type { ChatSpace as ChatSpaceRow } from '@/types/database'
import { TKO_SPACE_ID, ensureTkoSpace } from './ChatSpace'

/**
 * Chat — the spaces index (docs §4). Shows the viewer's own spaces (owned open
 * spaces + the clan spaces of clans they belong to), the official "TKO chats"
 * section, a browse list of public open spaces, and a "Make a chat" control
 * that creates a new open SPACE seeded with a default #general channel.
 */

type SpaceCard = ChatSpaceRow

function SpaceRow({ space }: { space: SpaceCard }) {
  return (
    <Link
      to={`/chat/${space.id}`}
      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-dark-border bg-dark-card hover:bg-dark-elevated transition-colors"
    >
      <div className="w-10 h-10 rounded-lg bg-gradient-kunai text-dark flex items-center justify-center font-bold shrink-0">
        {(space.name?.[0] ?? '#').toUpperCase()}
      </div>
      <div className="min-w-0">
        <p className="font-semibold text-white truncate">{space.name}</p>
        <p className="text-[11px] uppercase tracking-wider text-gray-500">{spaceKindLabel(space.kind)}</p>
      </div>
      <span className="ml-auto text-gray-600" aria-hidden>
        ›
      </span>
    </Link>
  )
}

export function Chat() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [mine, setMine] = useState<SpaceCard[]>([])
  const [tko, setTko] = useState<SpaceCard[]>([])
  const [publicSpaces, setPublicSpaces] = useState<SpaceCard[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [nameErr, setNameErr] = useState('')

  const nameOk = isValidName(newName, { label: 'space name' })

  const load = useCallback(async () => {
    // Official TKO space(s). Seed/find-or-create it (client-side) so it resolves
    // on the mock backend too — tapping "TKO chats" always opens a real space.
    let tkoRows: SpaceCard[] = []
    try {
      const seeded = await ensureTkoSpace()
      if (seeded) tkoRows = [seeded as SpaceCard]
    } catch {
      /* fall back to whatever the query returns */
    }
    if (tkoRows.length === 0) {
      const { data } = await supabase.from('chat_spaces').select('*').eq('kind', 'tko')
      tkoRows = (data as SpaceCard[]) ?? []
    }
    setTko(tkoRows)

    // The viewer's spaces: owned open spaces + clan spaces of clans they're in.
    const own: SpaceCard[] = []
    if (user) {
      const { data: owned } = await supabase
        .from('chat_spaces')
        .select('*')
        .eq('owner_id', user.id)
      own.push(...((owned as SpaceCard[]) ?? []))

      const { data: memberships } = await supabase
        .from('clan_members')
        .select('server_id')
        .eq('user_id', user.id)
      const serverIds = Array.from(
        new Set(((memberships ?? []) as { server_id: string }[]).map((m) => m.server_id)),
      )
      if (serverIds.length > 0) {
        const { data: clanSpaces } = await supabase
          .from('chat_spaces')
          .select('*')
          .in('clan_id', serverIds)
        for (const s of (clanSpaces as SpaceCard[]) ?? []) {
          if (!own.some((o) => o.id === s.id)) own.push(s)
        }
      }
    }
    setMine(own)

    // Browse: public open spaces (excluding the viewer's own to avoid dupes).
    const { data: opens } = await supabase
      .from('chat_spaces')
      .select('*')
      .eq('kind', 'open')
      .order('created_at', { ascending: false })
      .limit(30)
    setPublicSpaces(
      ((opens as SpaceCard[]) ?? []).filter((s) => !own.some((o) => o.id === s.id)),
    )

    setLoading(false)
  }, [user])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  async function makeChat(e: React.FormEvent) {
    e.preventDefault()
    if (!user || creating) return
    const err = nameQualityError(newName, { label: 'space name' })
    if (err) {
      setNameErr(err)
      return
    }
    setNameErr('')
    setCreating(true)
    const { data: created } = await supabase
      .from('chat_spaces')
      .insert({ kind: 'open', name: newName.trim().slice(0, 60), owner_id: user.id, clan_id: null })
      .select()
      .single()
    const space = created as ChatSpaceRow | null
    if (space) {
      // Seed the default #general channel so the space is usable immediately.
      const drafts = defaultChannelsForKind('open')
      await supabase.from('chat_channels').insert(
        drafts.map((d) => ({
          space_id: space.id,
          name: d.name,
          category: d.category,
          position: d.position,
          is_announcement: d.is_announcement,
        })),
      )
      setNewName('')
      setCreating(false)
      navigate(`/chat/${space.id}`)
      return
    }
    setCreating(false)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">Chat</h1>
        <p className="text-sm text-gray-400 mt-1">
          Spaces hold many channels — like a Discord server. Make one, or jump into an official TKO
          space.
        </p>
      </header>

      {/* Make a chat */}
      <section className="rounded-2xl border border-dark-border bg-dark-card p-4">
        <h2 className="font-semibold text-white mb-2">Make a chat</h2>
        {user ? (
          <form onSubmit={makeChat} className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); if (nameErr) setNameErr('') }}
              maxLength={60}
              placeholder="Space name (e.g. Striker Legends)"
              className="flex-1 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={!nameOk || creating}
              className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold text-sm disabled:opacity-50"
            >
              Create
            </button>
          </form>
        ) : (
          <p className="text-sm text-gray-500">
            <Link to="/login" className="text-accent hover:underline">
              Log in
            </Link>{' '}
            to make a chat.
          </p>
        )}
        {nameErr && <p className="text-kunai text-xs mt-2">{nameErr}</p>}
        <p className="text-[11px] text-gray-600 mt-2">
          At least 2 letters or numbers — emoji or symbols alone won’t do. Creates a public open space
          with a <code className="text-gray-400">#general</code> channel. Add more channels once you’re inside.
        </p>
      </section>

      {loading ? (
        <div className="py-10 text-center text-accent animate-pulse">Loading…</div>
      ) : (
        <>
          {/* Your spaces */}
          {mine.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Your spaces
              </h2>
              {mine.map((s) => (
                <SpaceRow key={s.id} space={s} />
              ))}
            </section>
          )}

          {/* TKO chats */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">TKO chats</h2>
            {tko.length > 0 ? (
              tko.map((s) => <SpaceRow key={s.id} space={s} />)
            ) : (
              <Link
                to={`/chat/${TKO_SPACE_ID}`}
                className="block px-4 py-3 rounded-xl border border-dark-border bg-dark-card text-gray-400 hover:text-white"
              >
                TKO Official
              </Link>
            )}
          </section>

          {/* Browse public spaces */}
          {publicSpaces.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-gray-500">
                Public spaces
              </h2>
              {publicSpaces.map((s) => (
                <SpaceRow key={s.id} space={s} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}

export default Chat
