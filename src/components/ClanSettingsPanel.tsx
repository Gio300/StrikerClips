import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { AvailabilityHint, Avatar } from '@/components/ui'
import { PlayerMetaLine } from '@/components/PlayerMetaLine'
import { useIdentityAvailability } from '@/hooks/useIdentityAvailability'
import { CLAN_TAG_MAX, formatTag } from '@/lib/identity'
import {
  can,
  canManageMember,
  canAssignRank,
  capUsageLabel,
  rankLevel,
  MAX_CLAN_MEMBERS,
  type ClanRole,
} from '@/lib/clans'
import type { ArtifactRarity, Server } from '@/types/database'
import { ClanOrganizerPanel } from '@/components/ClanOrganizerPanel'

/**
 * ClanSettingsPanel — leader/officer clan management, gated by the permission
 * matrix in `@/lib/clans`. Tucked under CollapsibleSection so it never clutters
 * the chat. Renders nothing for a plain member (they have no management caps).
 *
 * - Identity (Leader only): clan NAME + `[AI]`-style TAG. Both are unique
 *   platform-wide (case-insensitively), so each is availability-checked against
 *   the backend as it's typed, with free alternatives offered on a collision.
 * - Settings (Leader only): rules, join fee, dues, recruiting toggle.
 * - Danger zone (Leader only): delete the clan. This is a HARD delete — the row
 *   goes away, which is exactly what RELEASES the clan's name and tag back to
 *   the pool (uniqueness is enforced by the row existing). See `deleteClan`.
 * - Members (Leader/Officer): roster with roles + the "47 / 100" cap usage, and
 *   per-member promote/demote/kick actions — each individually gated by
 *   canManageMember / canAssignRank so the UI can't offer an illegal action.
 *
 * Writes go to `servers` (settings) and `clan_members` (roster) via the same
 * supabase client the rest of the app uses (mock + real).
 */

type MemberRow = {
  id: string
  user_id: string
  role: ClanRole
  username: string
  avatarUrl: string | null
  powerLevel: number | null
  title: string | null
  titleRarity: ArtifactRarity | null
}

const ROLE_LABEL: Record<ClanRole, string> = {
  leader: 'Leader',
  officer: 'Officer',
  recruiter: 'Recruiter',
  member: 'Member',
}

export function ClanSettingsPanel({
  server,
  viewerId,
  onChanged,
  standalone = false,
}: {
  server: Server
  viewerId: string
  onChanged?: () => void
  standalone?: boolean
}) {
  const serverId = server.id
  const navigate = useNavigate()
  const [viewerRole, setViewerRole] = useState<ClanRole | null>(null)
  const [roleLoaded, setRoleLoaded] = useState(false)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [flash, setFlash] = useState<string | null>(null)

  // Editable identity state (the two platform-unique fields).
  const [clanName, setClanName] = useState(server.name ?? '')
  const [clanTag, setClanTag] = useState(server.clan_tag ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // `excludeId` is this clan's own row — otherwise re-saving the current name
  // would report the clan as colliding with itself.
  const nameCheck = useIdentityAvailability('clanName', clanName, { excludeId: serverId })
  const tagCheck = useIdentityAvailability('clanTag', clanTag, {
    excludeId: serverId,
    required: false,
  })

  // Editable settings state (seeded from the server row).
  const [rules, setRules] = useState(server.rules ?? '')
  const [joinFee, setJoinFee] = useState(String(server.join_fee_tokens ?? 0))
  const [dues, setDues] = useState(String(server.dues_tokens ?? 0))
  const [duesPeriod, setDuesPeriod] = useState(server.dues_period ?? 'none')
  const [isRecruiting, setIsRecruiting] = useState(!!server.is_recruiting)
  const [saving, setSaving] = useState(false)

  const showFlash = useCallback((m: string) => {
    setFlash(m)
    setTimeout(() => setFlash((f) => (f === m ? null : f)), 3000)
  }, [])

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.from('clan_members').select('*').eq('server_id', serverId)
    const rows = (data ?? []) as { id: string; user_id: string; role: string }[]
    let named: MemberRow[] = rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      role: (r.role as ClanRole) ?? 'member',
      username: r.user_id.slice(0, 8),
      avatarUrl: null,
      powerLevel: null,
      title: null,
      titleRarity: null,
    }))
    // Best-effort username + picture hydration (works on mock + real; join
    // strings aren't reliable on the mock client, so we resolve profiles
    // separately).
    const ids = named.map((m) => m.user_id)
    if (ids.length) {
      const enrichedProfiles = await supabase
        .from('profiles')
        .select('id, username, avatar_url, power_level, equipped_tag_text, equipped_tag_rarity')
        .in('id', ids)
      const basicProfiles = enrichedProfiles.error
        ? await supabase.from('profiles').select('id, username, avatar_url, power_level').in('id', ids)
        : null
      const profs = enrichedProfiles.error ? basicProfiles?.data ?? [] : enrichedProfiles.data ?? []
      const byId = new Map(
        profs.map((p) => [
          p.id as string,
          {
            username: p.username as string,
            avatarUrl: (p.avatar_url as string | null) ?? null,
            powerLevel: typeof p.power_level === 'number' ? p.power_level : null,
            title: 'equipped_tag_text' in p ? (p.equipped_tag_text as string | null) ?? null : null,
            titleRarity: 'equipped_tag_rarity' in p
              ? (p.equipped_tag_rarity as ArtifactRarity | null) ?? null
              : null,
          },
        ]),
      )
      named = named.map((m) => ({
        ...m,
        username: byId.get(m.user_id)?.username ?? m.username,
        avatarUrl: byId.get(m.user_id)?.avatarUrl ?? null,
        powerLevel: byId.get(m.user_id)?.powerLevel ?? null,
        title: byId.get(m.user_id)?.title ?? null,
        titleRarity: byId.get(m.user_id)?.titleRarity ?? null,
      }))
    }
    // Sort strongest rank first for a readable roster.
    named.sort((a, b) => rankLevel(b.role) - rankLevel(a.role))
    setMembers(named)
    setViewerRole(
      named.find((m) => m.user_id === viewerId)?.role
        ?? (viewerId === server.owner_id ? 'leader' : null),
    )
    setRoleLoaded(true)
  }, [server.owner_id, serverId, viewerId])

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  // A member (or non-member) with no management caps sees nothing.
  const canEdit = viewerRole ? can(viewerRole, 'edit_settings') : false
  const canModerate =
    viewerRole ? can(viewerRole, 'kick') || can(viewerRole, 'promote') : false
  if (!roleLoaded) {
    return standalone ? <p className="text-sm text-gray-500">Loading clan permissions...</p> : null
  }
  if (!viewerRole || (!canEdit && !canModerate && !can(viewerRole, 'toggle_recruiting'))) {
    return standalone
      ? <p className="border border-dark-border p-4 text-sm text-gray-400">Only a clan leader or officer can open these management controls.</p>
      : null
  }

  async function saveSettings() {
    if (!viewerRole || !can(viewerRole, 'edit_settings')) return
    // Identity fields are unique platform-wide — refuse to write a taken or
    // malformed name/tag. (The DB unique indexes are the final gate.)
    if (nameCheck.blocked || tagCheck.blocked) {
      showFlash(nameCheck.blocked ? nameCheck.message : tagCheck.message)
      return
    }
    setSaving(true)
    const patch: Record<string, unknown> = {
      name: nameCheck.value,
      // Clearing the field releases the tag back to the pool.
      clan_tag: tagCheck.value || null,
      rules: rules.trim() || null,
      join_fee_tokens: Math.max(0, Math.round(Number(joinFee) || 0)),
      dues_tokens: Math.max(0, Math.round(Number(dues) || 0)),
      dues_period: duesPeriod,
      is_recruiting: isRecruiting,
    }
    await supabase.from('servers').update(patch).eq('id', serverId)
    setSaving(false)
    showFlash('Clan settings saved.')
    onChanged?.()
  }

  async function toggleRecruitingQuick() {
    if (!viewerRole || !can(viewerRole, 'toggle_recruiting')) return
    const next = !isRecruiting
    setIsRecruiting(next)
    await supabase.from('servers').update({ is_recruiting: next }).eq('id', serverId)
    showFlash(next ? 'Recruiting is ON — clan shows in Discovery.' : 'Recruiting is OFF.')
    onChanged?.()
  }

  async function setMemberRole(m: MemberRow, newRole: ClanRole) {
    if (!viewerRole || !canAssignRank(viewerRole, m.role, newRole)) return
    await supabase.from('clan_members').update({ role: newRole }).eq('id', m.id)
    showFlash(`${m.username} is now ${ROLE_LABEL[newRole]}.`)
    await loadMembers()
    onChanged?.()
  }

  async function kickMember(m: MemberRow) {
    if (!viewerRole || !canManageMember(viewerRole, 'kick', m.role)) return
    await supabase.from('clan_members').delete().eq('id', m.id)
    // Keep server_members (chat) in sync when present.
    await supabase.from('server_members').delete().eq('server_id', serverId).eq('user_id', m.user_id)
    showFlash(`${m.username} was removed.`)
    await loadMembers()
    onChanged?.()
  }

  /**
   * Delete the clan — and RELEASE its name + tag.
   *
   * This is a HARD delete on purpose. Uniqueness is enforced by the row
   * existing (case-insensitive unique indexes on `lower(name)` / `lower(clan_tag)`
   * in db/schema.sql), so removing the row is precisely what frees the identity
   * for the next person. A soft delete would keep the name reserved forever
   * unless the unique fields were also nulled out — do NOT convert this to a
   * status flag without adding `where deleted_at is null` to those indexes.
   *
   * Children are deleted explicitly rather than relying on ON DELETE CASCADE:
   * hosted Postgres cascades, but the mock backend has no FK engine, so without
   * this the mock would leave orphaned members/channels behind.
   */
  async function deleteClan() {
    if (!viewerRole || !can(viewerRole, 'edit_settings')) return
    setDeleting(true)
    try {
      await supabase.from('clan_members').delete().eq('server_id', serverId)
      await supabase.from('server_members').delete().eq('server_id', serverId)
      await supabase.from('channels').delete().eq('server_id', serverId)
      // The clan's chat space (chat_spaces.clan_id) goes with it.
      await supabase.from('chat_spaces').delete().eq('clan_id', serverId)
      // Finally the row that holds the unique name + tag.
      await supabase.from('servers').delete().eq('id', serverId)
      onChanged?.()
      navigate('/boards')
    } finally {
      setDeleting(false)
    }
  }

  const cap = server.max_members ?? MAX_CLAN_MEMBERS
  const assignable: ClanRole[] = ['officer', 'recruiter', 'member']

  return (
    <div className="space-y-3">
      {flash && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-xs text-accent">
          {flash}
        </div>
      )}

      <ClanOrganizerPanel serverId={serverId} viewerId={viewerId} viewerRole={viewerRole} />

      {/* Recruiting quick-toggle (Leader/Officer/Recruiter). */}
      {can(viewerRole, 'toggle_recruiting') && (
        <button
          type="button"
          onClick={toggleRecruitingQuick}
          className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-sm transition-colors ${
            isRecruiting
              ? 'border-leaf/40 bg-leaf/10 text-leaf'
              : 'border-dark-border bg-dark-card text-gray-300 hover:bg-dark-elevated'
          }`}
        >
          <span className="font-semibold">Recruiting</span>
          <span>{isRecruiting ? 'ON · listed in Discovery' : 'OFF'}</span>
        </button>
      )}

      {/* Settings — Leader only. */}
      {canEdit && (
        <CollapsibleSection id={`clan-settings-${serverId}`} label="Settings" hint="Rules · fees · dues">
          <div className="space-y-4">
            {/* Identity — the two platform-unique fields. */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Clan name</label>
              <input
                type="text"
                value={clanName}
                onChange={(e) => setClanName(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
              />
              <AvailabilityHint state={nameCheck} onPick={setClanName} />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Clan tag <span className="text-gray-600">(optional)</span>
              </label>
              <input
                type="text"
                value={clanTag}
                onChange={(e) => setClanTag(e.target.value.toUpperCase())}
                maxLength={CLAN_TAG_MAX}
                placeholder="AI"
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm uppercase tracking-widest font-semibold focus:outline-none focus:border-accent"
              />
              <AvailabilityHint
                state={tagCheck}
                onPick={setClanTag}
                hint={`2–${CLAN_TAG_MAX} letters or numbers — shows as ${formatTag(clanTag) || '[AI]'} next to your clan name. Clear it to release the tag.`}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">Clan rules</label>
              <textarea
                value={rules}
                onChange={(e) => setRules(e.target.value)}
                rows={3}
                placeholder="What members agree to when they join…"
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm placeholder-gray-500 focus:outline-none focus:border-accent"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Join fee (Tokens)</label>
                <input
                  type="number"
                  min={0}
                  value={joinFee}
                  onChange={(e) => setJoinFee(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Dues (Tokens)</label>
                <input
                  type="number"
                  min={0}
                  value={dues}
                  onChange={(e) => setDues(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Dues period</label>
                <select
                  value={duesPeriod}
                  onChange={(e) => setDuesPeriod(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm focus:outline-none focus:border-accent"
                >
                  <option value="none">One-time / none</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-300 py-2">
                <input
                  type="checkbox"
                  checked={isRecruiting}
                  onChange={(e) => setIsRecruiting(e.target.checked)}
                  className="accent-accent h-4 w-4"
                />
                Recruiting
              </label>
            </div>
            <p className="text-[11px] text-gray-500">
              Join fees split 80% to your clan treasury, 20% platform fee.
            </p>
            <button
              type="button"
              onClick={saveSettings}
              disabled={saving || nameCheck.blocked || tagCheck.blocked}
              className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold text-sm disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save settings'}
            </button>

            {/* Danger zone — deleting the clan releases its name + tag. */}
            <div className="pt-4 mt-2 border-t border-dark-border space-y-2">
              <p className="text-xs font-semibold text-red-400">Danger zone</p>
              <p className="text-[11px] text-gray-500">
                Deleting this clan removes it for everyone and frees its name
                {server.clan_tag ? ` and ${formatTag(server.clan_tag)} tag` : ''} for someone else to
                claim. This can't be undone.
              </p>
              {confirmDelete ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void deleteClan()}
                    disabled={deleting}
                    className="px-3 py-1.5 rounded-lg bg-red-500/90 text-white font-semibold text-xs disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : `Yes, delete ${server.name}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="px-3 py-1.5 rounded-lg border border-dark-border text-gray-400 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-400 text-xs hover:bg-red-500/10"
                >
                  Delete clan
                </button>
              )}
            </div>
          </div>
        </CollapsibleSection>
      )}

      {/* Members — Leader/Officer roster management. */}
      <CollapsibleSection
        id={`clan-members-${serverId}`}
        label="Members"
        count={members.length}
        hint={capUsageLabel(members.length, cap)}
      >
        <div className="space-y-2">
          {members.length === 0 && (
            <p className="text-xs text-gray-500">No members yet.</p>
          )}
          {members.map((m) => {
            const isSelf = m.user_id === viewerId
            const canKick = !isSelf && canManageMember(viewerRole, 'kick', m.role)
            const roleOptions = assignable.filter(
              (r) => r !== m.role && canAssignRank(viewerRole, m.role, r),
            )
            return (
              <div
                key={m.id}
                className="flex items-center gap-2 rounded-lg border border-dark-border bg-dark-card px-3 py-2"
              >
                <Avatar src={m.avatarUrl} name={m.username} seed={m.user_id} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white">
                    {/* Members wear the clan tag, the way they do in-game. */}
                    {server.clan_tag && (
                      <span className="text-accent mr-1">{formatTag(server.clan_tag)}</span>
                    )}
                    <Link to={`/profile/${m.user_id}`} className="hover:text-accent hover:underline">
                      {m.username}
                    </Link>
                    {isSelf && ' (you)'}
                  </p>
                  <PlayerMetaLine
                    prefix={ROLE_LABEL[m.role]}
                    title={m.title}
                    titleRarity={m.titleRarity}
                    powerLevel={m.powerLevel}
                    className="mt-0.5 max-w-full"
                  />
                </div>
                {roleOptions.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => {
                      const r = e.target.value as ClanRole
                      if (r) void setMemberRole(m, r)
                    }}
                    className="text-xs rounded-md bg-dark border border-dark-border text-gray-300 px-1.5 py-1 focus:outline-none focus:border-accent"
                    aria-label={`Set role for ${m.username}`}
                  >
                    <option value="">Set role…</option>
                    {roleOptions.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABEL[r]}
                      </option>
                    ))}
                  </select>
                )}
                {canKick && (
                  <button
                    type="button"
                    onClick={() => void kickMember(m)}
                    className="text-xs px-2 py-1 rounded-md border border-red-500/40 text-red-400 hover:bg-red-500/10"
                  >
                    Kick
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </CollapsibleSection>
    </div>
  )
}

export default ClanSettingsPanel
