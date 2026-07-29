import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ImagePlus, Store, UserRound, UsersRound } from 'lucide-react'
import {
  ASSET_KINDS,
  kindLabel,
  countAssetsByUser,
  loadAssets,
  subscribeAssets,
  type AssetKind,
  type SellerType,
} from '@/lib/assets'
import { useEntitlements } from '@/hooks/useEntitlements'
import { artUploadLimit, canUploadArt, artUploadUpgradeNudge } from '@/lib/tiers'
import { supabase } from '@/lib/supabase'
import {
  CREATOR_PRICE_CENTS,
  formatUsd,
  isCreatorPriceCents,
  sellerSharePercent,
} from '@/lib/creatorCommerce'
import { createCreatorListing } from '@/lib/creatorCommerceApi'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

/**
 * AssetUploadForm — "Design & sell your team's gear."
 *
 * Lets a signed-in user list a new digital asset for their team: paste an image
 * URL (no file infra needed for the scaffold), name it, pick a kind, and set a
 * price in Tokens. Calls addAsset, which drops it into the shared local catalog.
 *
 * Gating (light, for now): any logged-in user can list. Clan-owner-only gating —
 * so only a team's owner can sell that team's gear — can layer on later once
 * teams/clans have real membership + roles.
 */

export function AssetUploadForm({
  userId,
  onListed,
}: {
  userId: string
  onListed?: (name: string) => void
}) {
  const [name, setName] = useState('')
  const [teamName, setTeamName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [priceCents, setPriceCents] = useState(999)
  const [cashEnabled, setCashEnabled] = useState(true)
  const [paidSweepsEnabled, setPaidSweepsEnabled] = useState(true)
  const [kind, setKind] = useState<AssetKind>('jersey')
  const [sellerType, setSellerType] = useState<Exclude<SellerType, 'official'>>('creator')
  const [managedClans, setManagedClans] = useState<{ id: string; name: string }[]>([])
  const [clanId, setClanId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    async function loadManagedClans() {
      const [serversResult, membersResult] = await Promise.all([
        supabase.from('servers').select('id,name,owner_id'),
        supabase.from('clan_members').select('server_id,user_id,role').eq('user_id', userId),
      ])
      if (!alive) return
      const managedIds = new Set(
        (membersResult.data ?? [])
          .filter((row) => row.role === 'leader' || row.role === 'officer')
          .map((row) => String(row.server_id)),
      )
      const clans = (serversResult.data ?? [])
        .filter((row) => String(row.owner_id || '') === userId || managedIds.has(String(row.id)))
        .map((row) => ({ id: String(row.id), name: String(row.name || 'Clan') }))
      setManagedClans(clans)
      setClanId((current) => current || clans[0]?.id || '')
    }
    void loadManagedClans()
    return () => { alive = false }
  }, [userId])

  // Tier-gated upload cap: count what this user has already listed and compare
  // against their tier's ART_UPLOAD_LIMIT. Recount live after any list/buy.
  const { tier } = useEntitlements()
  const [uploadCount, setUploadCount] = useState<number>(() => countAssetsByUser(userId))
  useEffect(() => {
    const recount = () => setUploadCount(countAssetsByUser(userId))
    recount()
    return subscribeAssets(recount)
  }, [userId])

  const cap = artUploadLimit(tier)
  const capIsFinite = Number.isFinite(cap)
  const atCap = !canUploadArt(uploadCount, tier)
  const sellerPercent = sellerSharePercent(tier)
  const canSell = sellerPercent > 0

  const canSubmit =
    canSell &&
    !atCap &&
    name.trim().length > 0 &&
    (sellerType === 'clan' || teamName.trim().length > 0) &&
    imageUrl.trim().length > 0 &&
    (sellerType === 'creator' || clanId.length > 0) &&
    isCreatorPriceCents(priceCents) &&
    (cashEnabled || paidSweepsEnabled)

  function handleImageFile(file: File | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.')
      return
    }
    if (file.size > 2_500_000) {
      setError('Keep marketplace images under 2.5 MB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => setImageUrl(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (atCap) {
      setError(artUploadUpgradeNudge(tier))
      return
    }
    if (!/^(https?:\/\/|data:image\/)/i.test(imageUrl.trim())) {
      setError('Upload an image or use an image URL that starts with http:// or https://.')
      return
    }
    if (!canSubmit) {
      setError('Fill in every field with a valid price.')
      return
    }
    // Inserts into the shared `assets` table — visible to every user, not just
    // this browser. `created_by` is forced to the caller server-side.
    setSaving(true)
    try {
      const selectedClan = managedClans.find((clan) => clan.id === clanId)
      const result = await createCreatorListing({
        name: name.trim(),
        team_name: sellerType === 'clan' ? (selectedClan?.name || teamName) : teamName.trim(),
        image_url: imageUrl.trim(),
        kind,
        seller_type: sellerType,
        clan_id: sellerType === 'clan' ? clanId : null,
        price_cents: priceCents,
        cash_enabled: cashEnabled,
        paid_sweeps_enabled: paidSweepsEnabled,
      })
      if (!result.ok) throw new Error(result.error || 'listing failed')
      await loadAssets()
      onListed?.(name.trim())
      setName('')
      setImageUrl('')
      setPriceCents(999)
      setKind('jersey')
    } catch {
      setError('The listing could not be saved. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-dark-border bg-dark-card p-5"
    >
      <div className="flex items-center gap-2">
        <Store size={19} className="text-accent" />
        <h2 className="text-lg font-semibold text-white">List a marketplace item</h2>
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Sell gear from your creator page or clan storefront. Pro sellers keep 50%, Elite
        sellers keep 65%, and Legend or Founder sellers keep 80%. Paid Sweeps Credits give
        the buyer 30% off before your tier share is calculated. Free Give Points never fund payouts.
      </p>

      {/* Upload allowance for this tier. */}
      <p className="mt-2 text-xs text-gray-500">
        {capIsFinite
          ? `Listings used: ${uploadCount} / ${cap}`
          : `Listings used: ${uploadCount} · unlimited on your tier`}
      </p>

      {atCap && (
        <div className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{IS_MOBILE_STORE_BUILD ? 'Your current listing limit has been reached.' : artUploadUpgradeNudge(tier)}</span>
          {!IS_MOBILE_STORE_BUILD && (
            <Link to="/upgrade" className="font-semibold underline hover:no-underline">Upgrade to add more</Link>
          )}
        </div>
      )}

      {!canSell && (
        <div className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>
            {IS_MOBILE_STORE_BUILD
              ? 'Marketplace selling is not available for this account in the mobile app.'
              : 'Marketplace selling starts with Pro. Buying and collecting remain available.'}
          </span>
          {!IS_MOBILE_STORE_BUILD && (
            <Link to="/upgrade" className="font-semibold underline hover:no-underline">See seller tiers</Link>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-kunai/40 bg-kunai/10 px-3 py-2 text-sm text-kunai">
          {error}
        </div>
      )}

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <fieldset className="sm:col-span-2">
          <legend className="text-xs uppercase text-gray-500">Sell as</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setSellerType('creator')}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm ${
                sellerType === 'creator'
                  ? 'border-accent bg-accent/10 text-white'
                  : 'border-dark-border text-gray-400'
              }`}
            >
              <UserRound size={17} />
              My storefront
            </button>
            <button
              type="button"
              onClick={() => managedClans.length > 0 && setSellerType('clan')}
              disabled={managedClans.length === 0}
              className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm ${
                sellerType === 'clan'
                  ? 'border-trust bg-trust/10 text-white'
                  : 'border-dark-border text-gray-400 disabled:opacity-40'
              }`}
            >
              <UsersRound size={17} />
              Clan storefront
            </button>
          </div>
        </fieldset>

        {sellerType === 'clan' && (
          <label className="block sm:col-span-2">
            <span className="text-xs uppercase text-gray-500">Clan</span>
            <select
              value={clanId}
              onChange={(e) => setClanId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-dark-border bg-dark-elevated px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
            >
              {managedClans.map((clan) => (
                <option key={clan.id} value={clan.id}>{clan.name}</option>
              ))}
            </select>
          </label>
        )}

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Asset name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Championship Home Jersey"
            className="mt-1 w-full rounded-lg border border-dark-border bg-dark-elevated px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
        </label>

        <label className="block">
          <span className="text-xs uppercase text-gray-500">Storefront name</span>
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            disabled={sellerType === 'clan'}
            placeholder={sellerType === 'clan' ? 'Uses the selected clan name' : 'e.g. Shinobi X Studio'}
            className="mt-1 w-full rounded-lg border border-dark-border bg-dark-elevated px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
        </label>

        <div className="sm:col-span-2">
          <span className="text-xs uppercase text-gray-500">Item image</span>
          <div className="mt-1 flex gap-2">
          <input
            value={imageUrl}
            onChange={(e) => setImageUrl(e.target.value)}
            placeholder="Paste an image URL or upload a file"
            className="min-w-0 flex-1 rounded-lg border border-dark-border bg-dark-elevated px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-accent focus:outline-none"
          />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-dark-border text-gray-300 hover:border-accent hover:text-accent"
              aria-label="Upload item image"
              title="Upload item image"
            >
              <ImagePlus size={18} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleImageFile(e.target.files?.[0])}
            />
          </div>
        </div>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">Kind</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AssetKind)}
            className="mt-1 w-full rounded-lg border border-dark-border bg-dark-elevated px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          >
            {ASSET_KINDS.map((k) => (
              <option key={k} value={k}>{kindLabel(k)}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="text-xs uppercase tracking-wide text-gray-500">List price</span>
          <select
            value={priceCents}
            onChange={(e) => setPriceCents(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-dark-border bg-dark-elevated px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
          >
            {CREATOR_PRICE_CENTS.map((cents) => (
              <option key={cents} value={cents}>{formatUsd(cents)}</option>
            ))}
          </select>
        </label>

        <fieldset className="sm:col-span-2 rounded-lg border border-dark-border bg-dark-elevated/40 p-3">
          <legend className="px-1 text-xs uppercase tracking-wide text-gray-500">Ways buyers can pay</legend>
          <label className="flex min-h-10 items-center gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={cashEnabled}
              onChange={(e) => setCashEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Direct cash through Stripe - your {sellerPercent || 50}% seller share applies
          </label>
          <label className="flex min-h-10 items-center gap-3 text-sm text-gray-200">
            <input
              type="checkbox"
              checked={paidSweepsEnabled}
              onChange={(e) => setPaidSweepsEnabled(e.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            Paid Sweeps Credits - buyer saves 30%, then your {sellerPercent || 50}% share applies
          </label>
        </fieldset>
      </div>

      {/* Live preview of the pasted image. */}
      {imageUrl.trim() && /^(https?:\/\/|data:image\/)/i.test(imageUrl.trim()) && (
        <div className="mt-4 flex items-center gap-3">
          <img
            src={imageUrl.trim()}
            alt="Design preview"
            className="w-16 h-16 rounded-lg object-cover border border-dark-border"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.opacity = '0.25' }}
          />
          <span className="text-xs text-gray-500">Preview — how the artwork will appear on the card.</span>
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-xs text-gray-500">
          Stripe Connect sends cash earnings to the verified creator or clan owner account.
        </p>
        <button
          type="submit"
          disabled={!canSubmit || saving}
          className={`shrink-0 px-4 py-2 rounded-lg text-sm font-semibold transition-shadow ${
            canSubmit
              ? 'bg-accent text-dark hover:shadow-glow'
              : 'border border-dark-border bg-dark-elevated text-gray-500 cursor-not-allowed'
          }`}
        >
          {saving ? 'Listing…' : atCap ? 'Upgrade to list more' : 'List for sale'}
        </button>
      </div>
    </form>
  )
}
