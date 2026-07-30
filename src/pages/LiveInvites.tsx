import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/ui'
import {
  loadMyInvites,
  respondToInvite,
  addSelfAngle,
  type LiveInviteRow,
} from '@/lib/liveAngles'

/**
 * LiveInvites — the INVITED player's surface.
 *
 * A host (or an accepted co-host) invited you to co-stream on their live. Here
 * you accept, then ADD YOUR OWN stream link yourself — TKO pulls your linked
 * YouTube automatically, or you paste a link. That self-add is the whole point:
 * the host doesn't have to paste everyone's streams.
 *
 * Reads go through the owner-scoped live_stream_invites policy (you only ever see
 * invites addressed to you); accept/decline + the self-add are fn-only. Dark/
 * branded, Tailwind core, inline SVG — matches the notifications inbox.
 */

type Meta = { hostName?: string; hostAvatar?: string | null; title?: string | null }

export function LiveInvites() {
  const { user } = useAuth()
  const [invites, setInvites] = useState<LiveInviteRow[]>([])
  const [meta, setMeta] = useState<Map<string, Meta>>(new Map())
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pasteFor, setPasteFor] = useState<string | null>(null)
  const [pasteUrl, setPasteUrl] = useState('')
  const [addedFor, setAddedFor] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  async function refresh() {
    if (!user) return
    const rows = await loadMyInvites(user.id)
    setInvites(rows)
    // Resolve host name/avatar + stream title for each invite.
    const streamIds = Array.from(new Set(rows.map((r) => r.live_stream_id)))
    const inviterIds = Array.from(new Set(rows.map((r) => r.inviter_id)))
    const m = new Map<string, Meta>()
    try {
      const [{ data: streams }, { data: profiles }] = await Promise.all([
        supabase.from('live_streams').select('id, title, user_id').in('id', streamIds),
        supabase.from('profiles').select('id, username, avatar_url').in('id', inviterIds),
      ])
      const profById = new Map((profiles ?? []).map((p: any) => [p.id, p]))
      for (const r of rows) {
        const s = (streams ?? []).find((x: any) => x.id === r.live_stream_id)
        const p = profById.get(r.inviter_id)
        m.set(r.id, {
          hostName: p?.username ?? undefined,
          hostAvatar: p?.avatar_url ?? null,
          title: s?.title ?? null,
        })
      }
    } catch { /* best-effort meta */ }
    setMeta(m)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!user) { setLoading(false); return }
      await refresh()
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function respond(invite: LiveInviteRow, accept: boolean) {
    setError('')
    setBusyId(invite.id)
    const res = await respondToInvite(invite.id, accept)
    setBusyId(null)
    if (!res.ok) { setError(res.error || 'Could not respond.'); return }
    await refresh()
  }

  async function addMine(invite: LiveInviteRow, url?: string) {
    setError('')
    setBusyId(invite.id)
    const res = await addSelfAngle(invite.live_stream_id, url)
    setBusyId(null)
    if (!res.ok) { setError(res.error || 'Could not add your stream.'); return }
    setAddedFor((s) => new Set(s).add(invite.id))
    setPasteFor(null)
    setPasteUrl('')
  }

  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Co-stream invites</h1>
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <Link to="/login" className="text-accent hover:underline">Log in</Link>
          <span className="text-gray-400"> to see who invited you to co-stream.</span>
        </div>
      </div>
    )
  }

  const open = invites.filter((i) => i.status !== 'declined')

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Co-stream invites</h1>
        <p className="text-gray-400 text-sm">
          A host invited you onto their live. Accept, then add your own stream — your angle goes
          up right alongside theirs.
        </p>
      </div>

      {error && <p className="text-kunai text-sm mb-3">{error}</p>}

      {loading ? (
        <div className="animate-pulse text-gray-400">Loading…</div>
      ) : open.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
          No co-stream invites right now.
        </div>
      ) : (
        <ul className="space-y-3">
          {open.map((invite) => {
            const m = meta.get(invite.id) ?? {}
            const accepted = invite.status === 'accepted'
            const added = addedFor.has(invite.id)
            return (
              <li
                key={invite.id}
                className={`rounded-xl border p-4 ${
                  accepted ? 'border-accent/40 bg-accent/5' : 'border-dark-border bg-dark-card'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Avatar src={m.hostAvatar ?? null} name={m.hostName ?? 'host'} seed={invite.inviter_id} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-semibold">
                      You're invited to co-stream on {m.hostName ? `@${m.hostName}` : 'a host'}'s live
                    </p>
                    {m.title && <p className="text-xs text-gray-400 mt-0.5 truncate">{m.title}</p>}
                    <p className="text-[11px] uppercase tracking-wider text-gray-500 mt-1">{invite.status}</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {!accepted && (
                    <>
                      <button
                        type="button"
                        onClick={() => respond(invite, true)}
                        disabled={busyId === invite.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-dark hover:shadow-glow disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => respond(invite, false)}
                        disabled={busyId === invite.id}
                        className="rounded-lg border border-dark-border px-3 py-1.5 text-xs text-gray-400 hover:text-white disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </>
                  )}

                  {accepted && !added && pasteFor !== invite.id && (
                    <>
                      <button
                        type="button"
                        onClick={() => addMine(invite)}
                        disabled={busyId === invite.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-dark hover:shadow-glow disabled:opacity-50"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                        {busyId === invite.id ? 'Adding…' : 'Add my stream'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPasteFor(invite.id); setPasteUrl('') }}
                        className="rounded-lg border border-dark-border px-3 py-1.5 text-xs text-gray-400 hover:text-white"
                      >
                        Use a different link ▾
                      </button>
                    </>
                  )}

                  {added && <span className="text-xs text-leaf">✓ Your stream is on the show</span>}
                </div>

                {accepted && !added && pasteFor === invite.id && (
                  <div className="mt-3 space-y-2 rounded-lg border border-dark-border bg-dark p-2.5">
                    <input
                      value={pasteUrl}
                      onChange={(e) => setPasteUrl(e.target.value)}
                      placeholder="https://youtube.com/watch?v=…  or any https:// stream"
                      className="w-full px-2.5 py-1.5 rounded-md bg-dark-card border border-dark-border text-sm text-white focus:outline-none focus:border-accent"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => addMine(invite, pasteUrl)}
                        disabled={busyId === invite.id || !pasteUrl.trim()}
                        className="inline-flex items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-dark hover:shadow-glow disabled:opacity-50"
                      >
                        <PlusIcon className="w-3.5 h-3.5" /> Add link
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPasteFor(null); setPasteUrl('') }}
                        className="rounded-md border border-dark-border px-3 py-1.5 text-xs text-gray-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function PlusIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export default LiveInvites
