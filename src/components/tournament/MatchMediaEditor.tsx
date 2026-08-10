import { useState } from 'react'
import { LoaderCircle, Plus, Radio, X } from 'lucide-react'
import { callFn } from '@/lib/backend'
import {
  MAX_BATTLE_CLIPS,
  readSideMedia,
  type BattleSide,
} from '@/lib/battleMedia'
import { youtubeLinkError } from '@/lib/youtubeApi'
import type { TournamentBattle } from '@/types/database'

type MediaFnResponse = {
  ok?: boolean
  error?: string
  battle?: TournamentBattle
}

/**
 * The editor for ONE side of a battle: the fighter's live URL plus their
 * YouTube clip links. Used by the participant dashboard (their own side) and
 * the host match board (either side). Saves through the trusted
 * /api/fn/tournament-battle-media handler, which re-validates everything and
 * enforces entrant-owns-side / host authorization server-side.
 */
export function MatchMediaEditor({
  battle,
  side,
  title,
  suggestedLive,
  onSaved,
}: {
  battle: TournamentBattle
  side: BattleSide
  title: string
  /** The editing user's CURRENT live watch URL (from their active live
   *  session), offered as a one-tap fill. */
  suggestedLive?: string | null
  onSaved: (battle: TournamentBattle) => void
}) {
  const stored = readSideMedia(battle.media, side)
  const [liveUrl, setLiveUrl] = useState(stored.live_url ?? '')
  const [clips, setClips] = useState<string[]>(stored.clip_urls)
  const [clipInput, setClipInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState(false)

  const clipInputError = youtubeLinkError(clipInput)
  const canAddClip = Boolean(clipInput.trim()) && !clipInputError && clips.length < MAX_BATTLE_CLIPS

  const addClip = () => {
    if (!canAddClip) return
    const next = clipInput.trim()
    setClips((prev) => (prev.includes(next) ? prev : [...prev, next]))
    setClipInput('')
    setSaved(false)
  }

  const save = async () => {
    if (saving) return
    setSaving(true)
    setMessage('')
    const result = await callFn<MediaFnResponse>('tournament-battle-media', {
      battleId: battle.id,
      side,
      liveUrl: liveUrl.trim() || null,
      clipUrls: clips,
    })
    if (!result?.ok || !result.battle) {
      setMessage(result?.error || 'TKO could not save those links. Try again.')
      setSaved(false)
    } else {
      setMessage('')
      setSaved(true)
      onSaved(result.battle)
    }
    setSaving(false)
  }

  return (
    <div className="space-y-3 rounded-md border border-dark-border bg-dark p-3">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{title}</p>

      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-gray-500">
          Live stream link (https)
        </span>
        <div className="flex gap-2">
          <input
            type="url"
            value={liveUrl}
            onChange={(event) => {
              setLiveUrl(event.target.value)
              setSaved(false)
            }}
            placeholder="https://www.youtube.com/live/…"
            className="min-h-10 w-full rounded-md border border-dark-border bg-dark-card px-3 py-2 text-sm text-white placeholder:text-gray-600"
          />
          {suggestedLive && suggestedLive !== liveUrl && (
            <button
              type="button"
              onClick={() => {
                setLiveUrl(suggestedLive)
                setSaved(false)
              }}
              className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-kunai/40 px-2.5 text-xs font-semibold text-kunai hover:border-kunai"
              title="Use the live stream you have on air right now"
            >
              <Radio className="h-3.5 w-3.5" />
              My live
            </button>
          )}
        </div>
      </label>

      <div>
        <span className="mb-1 block text-[11px] font-medium text-gray-500">
          YouTube clips ({clips.length}/{MAX_BATTLE_CLIPS})
        </span>
        {clips.length > 0 && (
          <ul className="mb-2 space-y-1">
            {clips.map((clip) => (
              <li
                key={clip}
                className="flex items-center gap-2 rounded-md border border-dark-border bg-dark-card px-2 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-xs text-gray-300">{clip}</span>
                <button
                  type="button"
                  onClick={() => {
                    setClips((prev) => prev.filter((entry) => entry !== clip))
                    setSaved(false)
                  }}
                  className="text-gray-500 hover:text-kunai"
                  aria-label="Remove clip"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {clips.length < MAX_BATTLE_CLIPS && (
          <div className="flex gap-2">
            <input
              type="url"
              value={clipInput}
              onChange={(event) => setClipInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addClip()
                }
              }}
              placeholder="Paste a youtube.com / youtu.be clip link"
              className="min-h-10 w-full rounded-md border border-dark-border bg-dark-card px-3 py-2 text-sm text-white placeholder:text-gray-600"
            />
            <button
              type="button"
              onClick={addClip}
              disabled={!canAddClip}
              className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md border border-accent/40 px-2.5 text-xs font-semibold text-accent hover:border-accent disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        )}
        {clipInputError && <p className="mt-1 text-xs text-kunai">{clipInputError}</p>}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
          Save links
        </button>
        {saved && !message && (
          <span className="text-xs text-leaf">Saved — viewers see these on the bracket.</span>
        )}
        {message && <span className="text-xs text-kunai">{message}</span>}
      </div>
    </div>
  )
}
