/**
 * ArtifactTagsPanel — the "Me" home for ARTIFACT TAGS.
 *
 *   • See / take off the tag you currently show off.
 *   • Clan LEADERS create a new artifact tag for their clan (text, price, rarity).
 *   • Any member BUYS an available tag (debits Tokens; a clear "not enough"
 *     message on insufficient funds) and EQUIPS / UNEQUIPS tags they own.
 *
 * Reuses the shared `callFn` wrappers (lib/artifactTags), the wallet hook, and
 * <TagBadge/>. Every mutation is optimistic with rollback on failure. Tailwind
 * core utilities + inline SVG only.
 */

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { supabase } from '@/lib/supabase'
import { TagBadge } from '@/components/TagBadge'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { formatTag } from '@/lib/identity'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'
import {
  RARITY_ORDER,
  rarityLabel,
  createArtifactTag,
  buyArtifactTag,
  equipArtifactTag,
  unequipArtifactTag,
  listClanArtifactTags,
  listOwnedArtifactTagIds,
  type ArtifactTag,
  type ArtifactRarity,
} from '@/lib/artifactTags'

interface ClanLite {
  id: string
  name: string
  clan_tag: string | null
  isLeader: boolean
}

export function ArtifactTagsPanel() {
  const { user, profile, refreshUser } = useAuth()
  const { tokens, refresh: refreshWallet } = useWallet()

  const [clans, setClans] = useState<ClanLite[]>([])
  const [tags, setTags] = useState<ArtifactTag[]>([])
  const [owned, setOwned] = useState<Set<string>>(new Set())
  const [loaded, setLoaded] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Equipped state is seeded from the profile and updated optimistically.
  const [equippedId, setEquippedId] = useState<string | null>(profile?.equipped_tag_id ?? null)
  const [equippedText, setEquippedText] = useState<string | null>(profile?.equipped_tag_text ?? null)
  const [equippedRarity, setEquippedRarity] = useState<ArtifactRarity | null>(
    profile?.equipped_tag_rarity ?? null,
  )

  useEffect(() => {
    setEquippedId(profile?.equipped_tag_id ?? null)
    setEquippedText(profile?.equipped_tag_text ?? null)
    setEquippedRarity(profile?.equipped_tag_rarity ?? null)
  }, [profile?.equipped_tag_id, profile?.equipped_tag_text, profile?.equipped_tag_rarity])

  const load = useCallback(async () => {
    if (!user) return
    // The clans the viewer belongs to + whether they lead each one.
    const { data: mems } = await supabase
      .from('clan_members')
      .select('server_id, role')
      .eq('user_id', user.id)
    const memRows = (mems ?? []) as { server_id: string; role: string | null }[]
    const serverIds = Array.from(new Set(memRows.map((m) => m.server_id)))
    let clanList: ClanLite[] = []
    if (serverIds.length > 0) {
      const { data: servers } = await supabase
        .from('servers')
        .select('id, name, clan_tag, owner_id')
        .in('id', serverIds)
      const roleById = new Map(memRows.map((m) => [m.server_id, m.role]))
      clanList = ((servers ?? []) as { id: string; name: string; clan_tag: string | null; owner_id: string | null }[]).map(
        (s) => ({
          id: s.id,
          name: s.name,
          clan_tag: s.clan_tag,
          isLeader: roleById.get(s.id) === 'leader' || s.owner_id === user.id,
        }),
      )
    }
    setClans(clanList)

    // Every artifact tag offered by those clans, plus which ones the viewer owns.
    const tagLists = await Promise.all(clanList.map((c) => listClanArtifactTags(c.id)))
    setTags(tagLists.flat())
    setOwned(await listOwnedArtifactTagIds(user.id))
    setLoaded(true)
  }, [user])

  useEffect(() => {
    load()
  }, [load])

  function flash(msg: string) {
    setNotice(msg)
    window.setTimeout(() => setNotice((n) => (n === msg ? null : n)), 3500)
  }

  if (!user) return null

  const clanName = (clanId: string | null) => clans.find((c) => c.id === clanId)?.name ?? 'Clan'
  const visibleTags = IS_MOBILE_STORE_BUILD
    ? tags.filter((tag) => owned.has(tag.id))
    : tags

  return (
    <div className="mt-8">
      <CollapsibleSection id="artifact-tags" label="Artifact tags" count={visibleTags.length}>
        <p className="text-xs text-gray-500 mb-4">
          {IS_MOBILE_STORE_BUILD
            ? 'Equip an artifact tag you already own to show it next to your name in chat, profiles, search, and leaderboards.'
            : 'The pill you show off next to your name — in chat, on your profile, in search and on the leaderboards. Buy one from your clan and equip it. Rarer tags stand out more.'}
        </p>

        {/* Currently equipped */}
        <div className="flex items-center gap-3 rounded-xl border border-dark-border bg-dark-card p-3 mb-4">
          <span className="text-sm text-gray-400">Equipped:</span>
          {equippedText ? (
            <TagBadge artifactText={equippedText} rarity={equippedRarity} />
          ) : (
            <span className="text-sm text-gray-500">None</span>
          )}
          {equippedText && (
            <button
              type="button"
              onClick={handleUnequip}
              className="ml-auto text-xs text-gray-400 hover:text-red-400"
            >
              Take off
            </button>
          )}
        </div>

        {notice && (
          <p className="mb-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
            {notice}
          </p>
        )}

        {/* Leader create forms */}
        {!IS_MOBILE_STORE_BUILD && clans.filter((c) => c.isLeader).map((c) => (
          <CreateTagForm key={c.id} clan={c} onCreated={(t) => setTags((prev) => [t, ...prev])} onError={flash} />
        ))}

        {/* Available / owned tags */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-white">
              {IS_MOBILE_STORE_BUILD ? 'Owned tags' : 'Available tags'}
            </h3>
            {!IS_MOBILE_STORE_BUILD && (
              <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                <CoinIcon />
                <span className="font-semibold text-accent">{tokens.toLocaleString()}</span> Tokens
              </span>
            )}
          </div>
          {!loaded ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : visibleTags.length === 0 ? (
            <p className="text-sm text-gray-500">
              {IS_MOBILE_STORE_BUILD
                ? 'You do not own any artifact tags yet.'
                : clans.length === 0
                  ? 'Join a clan to buy its artifact tags.'
                  : 'No artifact tags yet. A clan leader can create one above.'}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleTags.map((t) => (
                <TagRow
                  key={t.id}
                  tag={t}
                  clanName={clanName(t.clan_id)}
                  owned={owned.has(t.id)}
                  equipped={equippedId === t.id}
                  tokens={tokens}
                  purchasesEnabled={!IS_MOBILE_STORE_BUILD}
                  onBought={() => {
                    setOwned((prev) => new Set(prev).add(t.id))
                    refreshWallet()
                  }}
                  onEquipped={() => {
                    setEquippedId(t.id)
                    setEquippedText(t.tag_text)
                    setEquippedRarity(t.rarity)
                    refreshUser()
                  }}
                  onError={flash}
                />
              ))}
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  )

  async function handleUnequip() {
    // Optimistic clear with rollback.
    const prev = { id: equippedId, text: equippedText, rarity: equippedRarity }
    setEquippedId(null)
    setEquippedText(null)
    setEquippedRarity(null)
    const res = await unequipArtifactTag()
    if (!res?.ok) {
      setEquippedId(prev.id)
      setEquippedText(prev.text)
      setEquippedRarity(prev.rarity)
      flash('Could not take off your tag. Try again.')
      return
    }
    refreshUser()
  }
}

// ── Create (clan leader) ────────────────────────────────────────────────────

function CreateTagForm({
  clan,
  onCreated,
  onError,
}: {
  clan: ClanLite
  onCreated: (tag: ArtifactTag) => void
  onError: (msg: string) => void
}) {
  const [text, setText] = useState('')
  const [price, setPrice] = useState('100')
  const [rarity, setRarity] = useState<ArtifactRarity>('common')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const tagText = text.trim()
    if (!tagText || busy) return
    setBusy(true)
    const res = await createArtifactTag({
      clanId: clan.id,
      tagText,
      price: Math.max(0, Number(price) || 0),
      rarity,
    })
    setBusy(false)
    if (!res?.ok || !res.tag) {
      onError('Could not create that tag. Try a different name.')
      return
    }
    onCreated(res.tag)
    setText('')
    setPrice('100')
    setRarity('common')
    setOpen(false)
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-3 mb-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-300">
          Create a tag for <span className="text-accent font-semibold">{formatTag(clan.clan_tag) || clan.name}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-xs text-accent hover:underline"
        >
          {open ? 'Close' : '+ New tag'}
        </button>
      </div>
      {open && (
        <form onSubmit={submit} className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={16}
              placeholder="Tag text (e.g. MVP)"
              className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
            />
            <TagBadge artifactText={text || 'PREVIEW'} rarity={rarity} />
          </div>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className="block text-[11px] text-gray-500 mb-1">Price (Tokens)</span>
              <input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
              />
            </label>
            <label className="flex-1">
              <span className="block text-[11px] text-gray-500 mb-1">Rarity</span>
              <select
                value={rarity}
                onChange={(e) => setRarity(e.target.value as ArtifactRarity)}
                className="w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
              >
                {RARITY_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {rarityLabel(r)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="submit"
            disabled={!text.trim() || busy}
            className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Creating…' : 'Create tag'}
          </button>
        </form>
      )}
    </div>
  )
}

// ── One available tag row (buy / equip) ─────────────────────────────────────

function TagRow({
  tag,
  clanName,
  owned,
  equipped,
  tokens,
  purchasesEnabled,
  onBought,
  onEquipped,
  onError,
}: {
  tag: ArtifactTag
  clanName: string
  owned: boolean
  equipped: boolean
  tokens: number
  purchasesEnabled: boolean
  onBought: () => void
  onEquipped: () => void
  onError: (msg: string) => void
}) {
  const [busy, setBusy] = useState(false)

  async function buy() {
    if (busy || !purchasesEnabled) return
    if (tokens < tag.price) {
      onError(`Not enough Tokens — ${tag.tag_text} costs ${tag.price.toLocaleString()}.`)
      return
    }
    setBusy(true)
    const res = await buyArtifactTag(tag.id)
    setBusy(false)
    if (!res?.ok) {
      onError(
        res?.reason === 'insufficient'
          ? `Not enough Tokens to buy ${tag.tag_text}.`
          : `Couldn't buy ${tag.tag_text}. Try again.`,
      )
      return
    }
    onBought()
  }

  async function equip() {
    if (busy) return
    setBusy(true)
    const res = await equipArtifactTag(tag.id)
    setBusy(false)
    if (!res?.ok) {
      onError(res?.reason === 'not-owned' ? 'You need to buy this tag first.' : 'Could not equip. Try again.')
      return
    }
    onEquipped()
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-dark-border bg-dark-card p-3">
      <TagBadge artifactText={tag.tag_text} rarity={tag.rarity} />
      <div className="min-w-0">
        <p className="text-xs text-gray-500 truncate">
          {clanName} · {tag.rarity}
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {!owned && purchasesEnabled && (
          <span className="inline-flex items-center gap-1 text-xs text-gray-400">
            <CoinIcon />
            {tag.price.toLocaleString()}
          </span>
        )}
        {owned ? (
          equipped ? (
            <span className="text-xs font-semibold text-leaf">Equipped</span>
          ) : (
            <button
              type="button"
              onClick={equip}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg border border-accent text-accent text-xs font-semibold hover:bg-accent/10 disabled:opacity-50"
            >
              {busy ? '…' : 'Equip'}
            </button>
          )
        ) : purchasesEnabled ? (
          <button
            type="button"
            onClick={buy}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-accent text-dark text-xs font-semibold disabled:opacity-50"
          >
            {busy ? '…' : 'Buy'}
          </button>
        ) : (
          <span className="text-xs text-gray-500">Unavailable in this version</span>
        )}
      </div>
    </div>
  )
}

function CoinIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-accent" fill="currentColor" aria-hidden>
      <circle cx="12" cy="12" r="9" opacity="0.25" />
      <path d="M12 6a6 6 0 100 12 6 6 0 000-12zm.9 9.3v.9h-1.8v-.85c-.9-.15-1.6-.6-1.9-1.35l1.15-.5c.2.5.65.8 1.35.8.6 0 .95-.25.95-.6 0-.4-.35-.55-1.2-.8-.95-.28-1.9-.65-1.9-1.75 0-.8.6-1.4 1.55-1.55V8.6h1.8v.85c.75.15 1.3.6 1.55 1.25l-1.1.5c-.2-.4-.55-.65-1.1-.65-.5 0-.85.2-.85.55 0 .38.4.5 1.2.75.95.3 1.9.65 1.9 1.8 0 .85-.6 1.5-1.6 1.65z" />
    </svg>
  )
}

export default ArtifactTagsPanel
