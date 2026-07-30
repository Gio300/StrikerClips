import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  canSeeMeetup,
  isMeetupReady,
  normalizeMeetup,
  EMPTY_MEETUP,
  MEETUP_PROMPT,
  type MeetupDetails,
} from '@/lib/tkoKing'
import type { BattleMeetup } from '@/types/database'

/**
 * PitMeetup — the PRIVATE per-battle info exchange between the two fighters.
 *
 * The pit is played in-game, so a scheduled battle is worthless until the two
 * Shinobi can actually find each other. Each fighter posts one card — in-game
 * name, platform, lobby/room, notes — and both see the other's. Nobody else
 * does; hosts can see it so they can adjudicate a no-show.
 *
 * Persisted per battle in `battle_meetups` (unique on battle_id + user_id), so
 * the details survive refreshes and are there when the battle goes live.
 */
export function PitMeetup({
  battleId,
  playerA,
  playerB,
  viewerId,
  isHost = false,
  nameOf,
}: {
  battleId: string
  playerA: string
  playerB?: string | null
  viewerId: string | null | undefined
  isHost?: boolean
  nameOf: (id: string | null | undefined) => string
}) {
  const [rows, setRows] = useState<BattleMeetup[]>([])
  const [form, setForm] = useState<MeetupDetails>(EMPTY_MEETUP)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const allowed = canSeeMeetup({ viewerId, playerA, playerB, isHost })
  const iAmFighter = !!viewerId && (viewerId === playerA || viewerId === playerB)

  const load = useCallback(async () => {
    const { data } = await supabase.from('battle_meetups').select('*').eq('battle_id', battleId)
    const list = (data ?? []) as BattleMeetup[]
    setRows(list)
    const mine = list.find((r) => r.user_id === viewerId)
    if (mine) {
      setForm({
        inGameName: mine.in_game_name ?? '',
        platform: mine.platform ?? '',
        lobby: mine.lobby ?? '',
        notes: mine.notes ?? '',
      })
    }
    setLoaded(true)
  }, [battleId, viewerId])

  useEffect(() => {
    if (!allowed) return
    load()
  }, [allowed, load])

  if (!allowed) return null

  async function save() {
    if (!viewerId || saving) return
    setSaving(true)
    const d = normalizeMeetup(form)
    const payload = {
      battle_id: battleId,
      user_id: viewerId,
      in_game_name: d.inGameName,
      platform: d.platform,
      lobby: d.lobby,
      notes: d.notes,
      updated_at: new Date().toISOString(),
    }
    const existing = rows.find((r) => r.user_id === viewerId)
    if (existing) {
      await supabase.from('battle_meetups').update(payload as never).eq('id', existing.id)
    } else {
      await supabase.from('battle_meetups').insert(payload as never)
    }
    setSaving(false)
    setSaved(true)
    await load()
  }

  const theirId = viewerId === playerA ? playerB ?? null : playerA
  const theirs = rows.find((r) => r.user_id === (iAmFighter ? theirId : null)) ?? null
  const otherCards = isHost && !iAmFighter ? rows : theirs ? [theirs] : []

  return (
    <div className="mt-3 rounded-xl border border-chakra/40 bg-chakra/5 p-3 sm:p-4">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-base">🤝</span>
        <h4 className="font-semibold text-sm text-white">Pit meet-up</h4>
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-dark-border text-gray-400 uppercase tracking-wider">
          Private
        </span>
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {MEETUP_PROMPT} Only you, your opponent and a host can see this.
      </p>

      {/* Your card */}
      {iAmFighter && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs text-gray-400 sm:col-span-2">
            Your in-game name
            <input
              value={form.inGameName}
              onChange={(e) => { setForm({ ...form, inGameName: e.target.value }); setSaved(false) }}
              placeholder="e.g. AwakenGio"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
            />
          </label>
          <label className="text-xs text-gray-400">
            Platform
            <input
              value={form.platform}
              onChange={(e) => { setForm({ ...form, platform: e.target.value }); setSaved(false) }}
              placeholder="PSN / Xbox / Steam"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
            />
          </label>
          <label className="text-xs text-gray-400">
            Lobby / room
            <input
              value={form.lobby}
              onChange={(e) => { setForm({ ...form, lobby: e.target.value }); setSaved(false) }}
              placeholder="Room code, if you use one"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
            />
          </label>
          <label className="text-xs text-gray-400 sm:col-span-2">
            Notes
            <textarea
              value={form.notes}
              onChange={(e) => { setForm({ ...form, notes: e.target.value }); setSaved(false) }}
              rows={2}
              placeholder="e.g. message me first, I'm on around 9pm ET"
              className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm resize-y"
            />
          </label>
          <div className="sm:col-span-2 flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving || !form.inGameName.trim()}
              className="px-4 py-2 rounded-lg bg-chakra text-dark font-semibold text-sm disabled:opacity-50"
            >
              {saving ? 'Sharing…' : saved ? 'Shared ✓' : 'Share my details'}
            </button>
            {!form.inGameName.trim() && (
              <span className="text-[11px] text-gray-500">Your in-game name is required.</span>
            )}
          </div>
        </div>
      )}

      {/* Their card(s) */}
      <div className="mt-3 space-y-2">
        {!loaded ? (
          <p className="text-xs text-gray-500">Loading…</p>
        ) : otherCards.length === 0 ? (
          <p className="text-xs text-gray-500">
            {iAmFighter
              ? `@${nameOf(theirId)} hasn't shared their details yet — we'll show them here the moment they do.`
              : 'Neither fighter has shared meet-up details yet.'}
          </p>
        ) : (
          otherCards.map((r) => (
            <div key={r.id} className="rounded-lg border border-dark-border bg-dark p-3 text-sm">
              <p className="font-semibold text-white">@{nameOf(r.user_id)}</p>
              <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                <dt className="text-gray-500">In-game</dt>
                <dd className={isMeetupReady({ inGameName: r.in_game_name ?? '' }) ? 'text-accent font-medium' : 'text-gray-500'}>
                  {r.in_game_name || 'not shared'}
                </dd>
                {r.platform && (<><dt className="text-gray-500">Platform</dt><dd className="text-gray-300">{r.platform}</dd></>)}
                {r.lobby && (<><dt className="text-gray-500">Lobby</dt><dd className="text-gray-300">{r.lobby}</dd></>)}
                {r.notes && (<><dt className="text-gray-500">Notes</dt><dd className="text-gray-300">{r.notes}</dd></>)}
              </dl>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default PitMeetup
