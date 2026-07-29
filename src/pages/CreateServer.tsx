import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AvailabilityHint } from '@/components/ui'
import { useIdentityAvailability } from '@/hooks/useIdentityAvailability'
import { CLAN_TAG_MAX } from '@/lib/identity'

/**
 * CreateServer — "Create a clan".
 *
 * A clan claims TWO platform-unique identities at once: its NAME and its short
 * `[AI]`-style TAG. Both are checked case-insensitively against the backend as
 * the user types (see useIdentityAvailability), with free alternatives offered
 * on a collision so nobody hits a dead end. Submit stays disabled until both
 * are valid and free; the DB's unique indexes are the final gate on a race.
 */
export function CreateServer() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const nameCheck = useIdentityAvailability('clanName', name)
  // The tag is optional at creation — a clan can add one later in Settings.
  const tagCheck = useIdentityAvailability('clanTag', tag, { required: false })

  const canSubmit = !loading && !nameCheck.blocked && !tagCheck.blocked && name.trim() !== ''

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (nameCheck.blocked) {
      setError(nameCheck.message || 'Pick an available clan name.')
      return
    }
    if (tagCheck.blocked) {
      setError(tagCheck.message || 'Pick an available clan tag.')
      return
    }
    setLoading(true)
    const { data: server, error: serverErr } = await supabase
      .from('servers')
      .insert({
        name: nameCheck.value,
        // Stored uppercase and canonical, or null when left blank.
        clan_tag: tagCheck.value || null,
        owner_id: user?.id,
        kind: 'clan',
        max_members: 100,
        is_recruiting: true,
      })
      .select('id')
      .single()
    if (serverErr || !server) {
      // A unique-index violation lands here when two people claim the same name
      // in the same instant — surface it as a name conflict, not a crash.
      const msg = String(serverErr?.message ?? '')
      setError(
        /duplicate|unique/i.test(msg)
          ? 'Someone just claimed that name or tag — try another.'
          : msg || 'Failed to create clan',
      )
      setLoading(false)
      return
    }
    await supabase.from('channels').insert({ server_id: server.id, name: 'general', type: 'text' })
    // Register the creator as an owner member so host-clan dropdowns and
    // invites (which read server_members) can see this clan.
    await supabase
      .from('server_members')
      .insert({ server_id: server.id, user_id: user?.id, role: 'owner' })
    // Seed the clan roster: the creator is the single Leader (clan_members drives
    // the rank/permission matrix + the 100-member cap).
    await supabase
      .from('clan_members')
      .insert({ server_id: server.id, user_id: user?.id, role: 'leader' })
    navigate(`/boards/${server.id}`)
    setLoading(false)
  }

  const inputCls =
    'w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent'

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create a clan</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Clan name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
            placeholder="My Community"
          />
          <AvailabilityHint
            state={nameCheck}
            onPick={setName}
            hint="At least 2 letters or numbers — emoji or symbols alone won't do."
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Clan tag <span className="text-gray-600">(optional)</span>
          </label>
          <input
            type="text"
            value={tag}
            onChange={(e) => setTag(e.target.value.toUpperCase())}
            maxLength={CLAN_TAG_MAX}
            className={`${inputCls} uppercase tracking-widest font-semibold`}
            placeholder="AI"
            aria-describedby="clan-tag-hint"
          />
          <div id="clan-tag-hint">
            <AvailabilityHint
              state={tagCheck}
              onPick={setTag}
              hint={`2–${CLAN_TAG_MAX} letters or numbers. Shows as [${tag || 'AI'}] next to your clan name everywhere.`}
            />
          </div>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create'}
        </button>
      </form>
    </div>
  )
}
