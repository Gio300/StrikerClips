import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  CircleDollarSign,
  Coins,
  Crown,
  Hammer,
  Lock,
  MapPinned,
  Shield,
  Shirt,
  Store,
  Swords,
  Ticket,
  UserRound,
  UsersRound,
  Zap,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { supabase } from '@/lib/supabase'
import UnlockReveal from '@/components/UnlockReveal'
import UpgradeNudge from '@/components/UpgradeNudge'
import { addAsset, type SellerType } from '@/lib/assets'
import {
  RARITY,
  CAPABILITY_LABEL,
  type Rarity,
  type Capability,
} from '@/lib/artifacts'
import { callFn } from '@/lib/backend'
import {
  CONQUEST_ARTIFACT_RECIPES,
  CONQUEST_TIER_LABEL,
  conquestTierAllows,
  type ConquestArtifactRecipe,
} from '@/lib/conquestArtifacts'
import {
  FORGE_MAX_POWERS,
  FORGE_PRICE_MAX_CENTS,
  canForge,
  forgeTierName,
  sanitizeForgePowers,
  sanitizeForgePriceCents,
} from '@/lib/forgeTiers'
import {
  FORGE_POWER_GROUPS,
  FORGE_POWER_OPTIONS,
  forgePowerByCode,
  forgePowersFromCodes,
} from '@/lib/forgePowers'
import { fetchPhysicalProducts, type PhysicalProduct } from '@/lib/physicalMerchApi'
import { normalizeOwnedArtifacts, type OwnedArtifact } from '@/lib/ownedArtifacts'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']
const CAPS: Capability[] = ['none', 'gift_starter', 'profile_flair', 'clan_tag', 'event_badge']

/**
 * THE UNIFIED FORGE — ONE TAB.
 *
 * Operator, verbatim: "a person forging an artifact should be able to install
 * powers in it and make it a tshirt all on the same tab — just make drop down
 * menus." So this is one screen, top to bottom, with no parts hidden behind
 * anything you have to open first:
 *
 *   art + name + rarity + perk   (or a Conquest recipe)   — everyone
 *   POWERS   — up to 4, each a DROPDOWN off the allowed
 *              list in src/lib/forgePowers.ts             — Pro+
 *   PRICE    — a cash sale price                          — Elite+
 *   SHIRT    — a DROPDOWN of the member's own designed
 *              t-shirts, with a link to design one        — Legend
 *   marketplace listing + forge                           — everyone
 *
 * It used to be five collapsible sections, and the two the operator called out
 * — powers and the shirt — were the two that were collapsed by default and
 * asked for eight free-text fields between them.
 *
 * TIER LOCKS ARE UNCHANGED. A locked control still RENDERS, disabled, with the
 * "Unlock — upgrade your account" CTA beside it, so you can see what the tier
 * buys before you buy it. The mapping lives in src/lib/forgeTiers.ts and is
 * enforced again server-side by /api/fn/forge-artifact-save — these locks are
 * honest UI, never the gate.
 *
 * Cosmetic items keep the existing marketplace path. Conquest items use a
 * separate trusted server path: the client selects a recipe code and the
 * server derives every effect, cap, price, tier, and slot cost.
 */
export function Forge() {
  const { user, profile } = useAuth()
  const { display } = useLeagueTheme()
  const ent = useEntitlements()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [search] = useSearchParams()
  const requestedEditId = search.get('edit') || ''

  const [purpose, setPurpose] = useState<'collectible' | 'conquest'>('collectible')
  const [rarity, setRarity] = useState<Rarity>('rare')
  const [capability, setCapability] = useState<Capability>('none')
  const [recipeCode, setRecipeCode] = useState('scout-mark')
  const [name, setName] = useState('')
  const [priceTokens, setPriceTokens] = useState('100')
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [listForSale, setListForSale] = useState(true)
  const [sellerType, setSellerType] = useState<Exclude<SellerType, 'official'>>('creator')
  const [managedClans, setManagedClans] = useState<{ id: string; name: string }[]>([])
  const [clanId, setClanId] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [forgedArtifactId, setForgedArtifactId] = useState<string | null>(null)
  /** A collectible landed this session — surface the link to the collection. */
  const [savedCollectible, setSavedCollectible] = useState(false)

  // Paid extras (tier-gated; see src/lib/forgeTiers.ts for the one mapping).
  // Powers are FORGE_MAX_POWERS dropdown slots — '' means "no power in this
  // slot", so the cap is structural rather than something to check for.
  const [powerCodes, setPowerCodes] = useState<string[]>(
    () => Array.from({ length: FORGE_MAX_POWERS }, () => ''),
  )
  const [priceUsd, setPriceUsd] = useState('')
  const [shirtProducts, setShirtProducts] = useState<PhysicalProduct[]>([])
  const [shirtProductId, setShirtProductId] = useState('')
  const [editingArtifact, setEditingArtifact] = useState<OwnedArtifact | null>(null)
  const [editLoading, setEditLoading] = useState(false)
  const [editImageChanged, setEditImageChanged] = useState(false)
  const [editPowersChanged, setEditPowersChanged] = useState(false)
  const [editPriceChanged, setEditPriceChanged] = useState(false)
  const [editShirtChanged, setEditShirtChanged] = useState(false)

  const canPowers = canForge('powers', ent.tier)
  const canPrice = !IS_MOBILE_STORE_BUILD && canForge('price', ent.tier)
  const canShirt = canForge('shirt', ent.tier)

  const selectedRecipe = CONQUEST_ARTIFACT_RECIPES.find((recipe) => recipe.code === recipeCode)
    ?? CONQUEST_ARTIFACT_RECIPES[0]
  const effectiveRarity = purpose === 'conquest' ? selectedRecipe.rarity : rarity
  const accent = RARITY[effectiveRarity].accent

  useEffect(() => {
    if (!user) return
    let alive = true
    async function loadManagedClans() {
      const [serversResult, membersResult] = await Promise.all([
        supabase.from('servers').select('id,name,owner_id'),
        supabase.from('clan_members').select('server_id,user_id,role').eq('user_id', user!.id),
      ])
      if (!alive) return
      const managedIds = new Set(
        (membersResult.data ?? [])
          .filter((row) => row.role === 'leader' || row.role === 'officer')
          .map((row) => String(row.server_id)),
      )
      const clans = (serversResult.data ?? [])
        .filter((row) => String(row.owner_id || '') === user!.id || managedIds.has(String(row.id)))
        .map((row) => ({ id: String(row.id), name: String(row.name || 'Clan') }))
      setManagedClans(clans)
      setClanId((current) => current || clans[0]?.id || '')
    }
    void loadManagedClans()
    return () => { alive = false }
  }, [user])

  // The member's OWN designed shirts (the t-shirts part), for the Legend bundle.
  useEffect(() => {
    if (!user || !canShirt) return
    let alive = true
    void (async () => {
      const result = await fetchPhysicalProducts(true)
      if (alive && result.ok && result.data) setShirtProducts(result.data.products)
    })()
    return () => { alive = false }
  }, [user, canShirt])

  useEffect(() => {
    if (!user || !requestedEditId) {
      setEditingArtifact(null)
      return
    }
    let alive = true
    setEditLoading(true)
    setNote(null)
    void (async () => {
      try {
        const result = await callFn<{ ok?: boolean; artifacts?: unknown }>('forge-artifact-list', {})
        const artifact = normalizeOwnedArtifacts(result?.artifacts).find((item) => item.id === requestedEditId) || null
        if (!alive) return
        if (!artifact) {
          setNote('That artifact was not found in your collection.')
          return
        }
        if (artifact.conquest) {
          setNote('Conquest artifact powers come from their recipe and cannot be edited.')
          return
        }
        setEditingArtifact(artifact)
        setPurpose('collectible')
        setListForSale(false)
        setName(artifact.name)
        setRarity(artifact.rarity)
        setCapability(
          Object.prototype.hasOwnProperty.call(CAPABILITY_LABEL, artifact.capability)
            ? artifact.capability as Capability
            : 'none',
        )
        setImgSrc(artifact.image_url)
        const codes = artifact.powers.map((power) =>
          FORGE_POWER_OPTIONS.find((option) =>
            option.name === power.name && option.description === power.description,
          )?.code || '',
        )
        setPowerCodes(Array.from({ length: FORGE_MAX_POWERS }, (_, index) => codes[index] || ''))
        setPriceUsd(artifact.price_cents == null ? '' : String(artifact.price_cents / 100))
        setShirtProductId(artifact.shirt?.id || '')
        setEditImageChanged(false)
        setEditPowersChanged(false)
        setEditPriceChanged(false)
        setEditShirtChanged(false)
      } catch {
        if (alive) setNote('Your artifact could not be loaded for editing.')
      } finally {
        if (alive) setEditLoading(false)
      }
    })()
    return () => { alive = false }
  }, [requestedEditId, user?.id])

  useEffect(() => {
    if (imgSrc) renderArtifact(imgSrc)
    // renderArtifact reads the current visual recipe and rarity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgSrc, purpose, recipeCode, rarity, display.productName])

  function choosePurpose(nextPurpose: 'collectible' | 'conquest') {
    setPurpose(nextPurpose)
    setListForSale(nextPurpose === 'collectible')
    setForgedArtifactId(null)
    setNote(null)
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImgSrc(String(reader.result))
      setEditImageChanged(true)
    }
    reader.readAsDataURL(file)
  }

  function renderArtifact(src: string) {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const size = 512
    canvas.width = size
    canvas.height = size
    const recipeAccent = RARITY[effectiveRarity].accent
    const img = new Image()
    img.onload = () => {
      ctx.fillStyle = '#05080f'
      ctx.fillRect(0, 0, size, size)
      const pad = 34
      const width = size - pad * 2
      const scale = Math.max(width / img.width, width / img.height)
      const drawWidth = img.width * scale
      const drawHeight = img.height * scale
      ctx.save()
      ctx.beginPath()
      ctx.rect(pad, pad, width, width)
      ctx.clip()
      ctx.drawImage(
        img,
        pad + (width - drawWidth) / 2,
        pad + (width - drawHeight) / 2,
        drawWidth,
        drawHeight,
      )
      const shine = ctx.createLinearGradient(pad, pad, pad + width, pad + width)
      shine.addColorStop(0, 'rgba(255,255,255,0)')
      shine.addColorStop(0.45, 'rgba(255,255,255,0.05)')
      shine.addColorStop(0.5, `${recipeAccent}55`)
      shine.addColorStop(0.55, 'rgba(255,255,255,0.05)')
      shine.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.fillStyle = shine
      ctx.fillRect(pad, pad, width, width)
      ctx.restore()
      ctx.strokeStyle = recipeAccent
      ctx.lineWidth = 8
      ctx.shadowColor = recipeAccent
      ctx.shadowBlur = 26
      ctx.strokeRect(pad - 4, pad - 4, width + 8, width + 8)
      ctx.shadowBlur = 0
      ctx.font = 'bold 30px system-ui, sans-serif'
      ctx.fillStyle = recipeAccent
      ctx.textAlign = 'center'
      ctx.fillText(display.productName, size / 2, size - 12)
    }
    img.src = src
  }

  /** One power dropdown changed. Codes are unique across slots by construction. */
  function setPowerSlot(index: number, code: string) {
    setEditPowersChanged(true)
    setPowerCodes((current) =>
      current.map((existing, i) => {
        if (i === index) return code
        // Picking a power that is already installed elsewhere MOVES it here
        // rather than duplicating it — the other slot's option is disabled, so
        // this only fires if a keyboard user gets there first.
        return code && existing === code ? '' : existing
      }),
    )
  }

  async function forge() {
    if (!user) return
    if (purpose === 'conquest' && !clanId) {
      setNote('Choose a clan you lead or manage.')
      return
    }
    if (purpose === 'collectible' && listForSale && sellerType === 'clan' && !clanId) {
      setNote('Choose a clan storefront first.')
      return
    }
    setBusy(true)
    setNote(null)
    setForgedArtifactId(null)
    setSavedCollectible(false)
    try {
      const needsRenderedImage = purpose === 'conquest' || !editingArtifact || editImageChanged
      const dataUrl = needsRenderedImage ? canvasRef.current?.toDataURL('image/png') : null
      if (needsRenderedImage && !dataUrl) throw new Error('Upload art before forging.')

      if (purpose === 'conquest') {
        const result = await callFn<{
          ok: boolean
          reason?: string
          artifact?: { id: string }
        }>('conquest-artifact-forge', {
          clanId,
          recipeCode: selectedRecipe.code,
          imageUrl: dataUrl,
        })
        if (!result?.ok || !result.artifact?.id) {
          const detail = result?.reason === 'membership-upgrade-required'
            ? `${CONQUEST_TIER_LABEL[selectedRecipe.minimumTier]} membership required.`
            : result?.reason || 'The server refused this recipe.'
          throw new Error(detail)
        }
        setForgedArtifactId(result.artifact.id)
        setNote('Conquest artifact forged. Activate it when your clan is ready.')
        setReveal(true)
        return
      }

      // COLLECTIBLE — one trusted server call carries the basic artifact plus
      // whatever paid extras this tier has unlocked. Validate locally first for
      // instant feedback; the server runs the same sanitizers and is the law.
      const body: Record<string, unknown> = {
        name,
        rarity,
        capability,
      }
      if (editingArtifact) body.artifactId = editingArtifact.id
      if (dataUrl) body.imageUrl = dataUrl
      if (canPowers) {
        // The dropdowns emit codes; the save contract takes the same
        // { name, description } pairs it always did.
        const chosen = forgePowersFromCodes(powerCodes)
        if (chosen.length || (editingArtifact && editPowersChanged)) {
          const check = sanitizeForgePowers(chosen)
          if (!check.ok) throw new Error(check.error)
          body.powers = check.value
        }
      }
      if (canPrice && (!editingArtifact ? priceUsd.trim() !== '' : editPriceChanged)) {
        const check = sanitizeForgePriceCents(
          priceUsd.trim() === '' ? null : Math.round(Number(priceUsd) * 100),
        )
        if (!check.ok) throw new Error(check.error)
        body.priceCents = check.value
      }
      if (canShirt && (!editingArtifact ? Boolean(shirtProductId) : editShirtChanged)) {
        body.shirtProductId = shirtProductId
      }

      const result = await callFn<{
        ok: boolean
        reason?: string
        error?: string
        artifact?: { id: string }
      }>('forge-artifact-save', body)
      if (!result?.ok || !result.artifact?.id) {
        if (result?.reason === 'membership-upgrade-required') {
          throw new Error('That option needs a higher membership tier — upgrade to unlock it.')
        }
        throw new Error(result?.error || 'The artifact could not be saved. Check your connection and try again.')
      }

      const tokenPrice = Math.max(0, Math.floor(Number(priceTokens) || 0))
      if (!editingArtifact && listForSale && dataUrl) {
        const clan = managedClans.find((item) => item.id === clanId)
        await addAsset({
          // The marketplace row and Forge collectible deliberately share one
          // stable id. The trusted Forge edit/delete handlers use that link to
          // keep the public listing in sync with the owner's collection.
          id: result.artifact.id,
          name: name || 'Forged Artifact',
          teamName: sellerType === 'clan'
            ? (clan?.name || 'Clan')
            : (profile?.username || 'Creator'),
          imageUrl: dataUrl,
          priceTokens: tokenPrice,
          kind: 'badge_skin',
          sellerType,
          clanId: sellerType === 'clan' ? clanId : null,
          createdBy: user.id,
        })
      }
      setNote(editingArtifact
        ? 'Artifact changes saved.'
        : listForSale
          ? 'Collectible forged and listed in the marketplace.'
          : 'Collectible forged and added to your collection.')
      setSavedCollectible(true)
      if (!editingArtifact) setReveal(true)
    } catch (error) {
      setNote(error instanceof Error
        ? error.message
        : 'The artifact could not be saved. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function activateConquestArtifact() {
    if (!forgedArtifactId) return
    setBusy(true)
    setNote(null)
    try {
      const result = await callFn<{
        ok: boolean
        reason?: string
        claimed_territory_ids?: string[]
        pass_count?: number
      }>('conquest-artifact-activate', { artifactId: forgedArtifactId })
      if (!result?.ok) throw new Error(result?.reason || 'Activation failed.')
      setForgedArtifactId(null)
      setNote(
        `Power activated. ${result.claimed_territory_ids?.length || 0} land claimed; ` +
        `${result.pass_count || 0} clan passes issued.`,
      )
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'The artifact could not be activated.')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <div className="p-6 max-w-md mx-auto text-center">
        <h1 className="text-2xl font-bold mb-2">Forge an artifact</h1>
        <p className="text-gray-400 mb-4">Sign in to forge.</p>
        <Link to="/login" className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
          Sign in
        </Link>
      </div>
    )
  }

  const chosenPowerCodes = powerCodes.filter(Boolean)
  const selectedShirt = shirtProducts.find((p) => p.id === shirtProductId)

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">{requestedEditId ? 'Edit artifact' : 'Forge an artifact'}</h1>
      <p className="mt-1 text-sm text-gray-400">
        {requestedEditId
          ? 'Change the artifact you own, then save it back to your collection.'
          : IS_MOBILE_STORE_BUILD
            ? 'One tab, top to bottom: name it, install its powers, and pair it with one of your t-shirts.'
            : 'One tab, top to bottom: name it, install its powers, set a price, and pair it with one of your t-shirts.'}
      </p>

      {requestedEditId ? (
        <div className="mt-5 flex min-h-11 items-center justify-between gap-3 rounded-lg border border-dark-border bg-dark px-3">
          <span className="text-sm text-gray-300">
            {editLoading ? 'Loading artifact...' : editingArtifact?.name || 'Artifact unavailable'}
          </span>
          <Link to="/rewards" className="text-xs font-semibold text-accent hover:underline">Back to artifacts</Link>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-3 gap-2 rounded-lg border border-dark-border bg-dark p-1">
        <button
          type="button"
          onClick={() => choosePurpose('collectible')}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-semibold ${
            purpose === 'collectible' ? 'bg-white/10 text-white' : 'text-gray-400'
          }`}
        >
          <Store size={17} />
          Collectible
        </button>
        <button
          type="button"
          onClick={() => choosePurpose('conquest')}
          className={`flex min-h-11 items-center justify-center gap-2 rounded-md text-sm font-semibold ${
            purpose === 'conquest' ? 'bg-accent/15 text-accent' : 'text-gray-400'
          }`}
        >
          <MapPinned size={17} />
          Conquest power
        </button>
        <Link
          to="/forge/physical"
          className="flex min-h-11 items-center justify-center gap-2 rounded-md px-2 text-center text-sm font-semibold text-gray-400 transition-colors hover:bg-kunai/10 hover:text-kunai"
        >
          <Shirt size={17} />
          Physical shirt
        </Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <div className="flex flex-col items-center">
          <div
            className="rounded-lg border border-dark-border bg-dark p-3"
            style={{ boxShadow: `0 0 26px ${accent}33` }}
          >
            <canvas ref={canvasRef} className="h-72 w-72 rounded-lg bg-[#05080f]" />
          </div>
          <label className="mt-4 cursor-pointer rounded-lg border border-accent/50 px-4 py-2 text-sm font-semibold text-accent">
            {imgSrc ? 'Choose different art' : 'Upload your art'}
            <input type="file" accept="image/*" className="hidden" onChange={onFile} />
          </label>
          {!imgSrc && <p className="mt-2 text-xs text-gray-500">Upload art to enable forging.</p>}
        </div>

        <div className="space-y-5">
          {/* ── (a) THE ARTIFACT — the basic forge, open to everyone ───────── */}
          <FieldGroup label="Artifact" icon={<Hammer size={14} />}>
            {purpose === 'collectible' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-wide text-gray-500">Name</label>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Name your artifact"
                    className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-gray-500">Rarity</label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {RARITIES.map((item) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setRarity(item)}
                        className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                        style={{
                          background: rarity === item ? RARITY[item].accent : 'transparent',
                          color: rarity === item ? '#05080f' : RARITY[item].accent,
                          border: `1px solid ${RARITY[item].accent}`,
                        }}
                      >
                        {RARITY[item].label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-gray-500">Collectible perk</label>
                  <select
                    value={capability}
                    onChange={(event) => setCapability(event.target.value as Capability)}
                    className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none"
                  >
                    {CAPS.map((item) => (
                      <option key={item} value={item}>{CAPABILITY_LABEL[item]}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="text-xs uppercase tracking-wide text-gray-500">
                    Clan power recipe
                  </label>
                  <div className="mt-2 space-y-2">
                    {CONQUEST_ARTIFACT_RECIPES.map((recipe) => (
                      <RecipeButton
                        key={recipe.code}
                        recipe={recipe}
                        active={recipe.code === selectedRecipe.code}
                        unlocked={conquestTierAllows(ent.tier, recipe)}
                        onClick={() => {
                          setRecipeCode(recipe.code)
                          setForgedArtifactId(null)
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-gray-500">
                    Clan receiving the power
                  </label>
                  {managedClans.length > 0 ? (
                    <select
                      value={clanId}
                      onChange={(event) => {
                        setClanId(event.target.value)
                        setForgedArtifactId(null)
                      }}
                      className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none"
                    >
                      {managedClans.map((clan) => (
                        <option key={clan.id} value={clan.id}>{clan.name}</option>
                      ))}
                    </select>
                  ) : (
                    <p className="mt-1 rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-200">
                      Lead or manage a clan before forging Conquest powers.
                    </p>
                  )}
                </div>

                <div className="rounded-lg border border-dark-border bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">{selectedRecipe.name}</span>
                    <span className="text-sm font-bold text-accent">
                      ${(selectedRecipe.listPriceCents / 100).toFixed(2)} value
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-gray-400">
                    {selectedRecipe.description}
                  </p>
                  <p className="mt-2 text-[11px] uppercase text-gray-500">
                    Uses {selectedRecipe.slotCost} active {selectedRecipe.slotCost === 1 ? 'slot' : 'slots'}
                    {' / '}
                    {CONQUEST_TIER_LABEL[selectedRecipe.minimumTier]}+
                  </p>
                  <p className="mt-2 text-[11px] text-gray-500">
                    Conquest recipes carry their own powers and value, so the Powers, Price and
                    Shirt fields below apply to collectibles only.
                  </p>
                </div>
              </div>
            )}
          </FieldGroup>

          {purpose === 'collectible' && (
            <>
              {/* ── (b) POWERS — Pro+. Dropdowns off the allowed list. ─────── */}
              <GatedGroup
                label="Powers"
                icon={<Zap size={14} />}
                unlocked={canPowers}
                capability="powers"
                lockedMessage={`Install up to ${FORGE_MAX_POWERS} powers in every artifact you forge.`}
              >
                <p className="text-xs text-gray-500">
                  Install up to {FORGE_MAX_POWERS} powers. They show on the artifact wherever it
                  appears.
                </p>
                <div className="mt-3 space-y-2">
                  {powerCodes.map((code, index) => {
                    const chosen = forgePowerByCode(code)
                    return (
                      <div key={index}>
                        <label
                          className="text-[11px] uppercase tracking-wide text-gray-500"
                          htmlFor={`forge-power-${index}`}
                        >
                          Power {index + 1}
                        </label>
                        <select
                          id={`forge-power-${index}`}
                          value={code}
                          disabled={!canPowers}
                          onChange={(event) => setPowerSlot(index, event.target.value)}
                          className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="">No power</option>
                          {FORGE_POWER_GROUPS.map((group) => (
                            <optgroup key={group} label={group}>
                              {FORGE_POWER_OPTIONS.filter((option) => option.group === group).map(
                                (option) => (
                                  <option
                                    key={option.code}
                                    value={option.code}
                                    // Already installed in another slot — an
                                    // artifact holds each power once.
                                    disabled={option.code !== code && powerCodes.includes(option.code)}
                                  >
                                    {option.name}
                                  </option>
                                ),
                              )}
                            </optgroup>
                          ))}
                        </select>
                        {chosen && (
                          <p className="mt-1 text-[11px] leading-snug text-gray-500">
                            {chosen.description}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </GatedGroup>

              {/* ── (c) PRICE — Elite+ ────────────────────────────────────── */}
              {!IS_MOBILE_STORE_BUILD && <GatedGroup
                label="Price"
                icon={<CircleDollarSign size={14} />}
                unlocked={canPrice}
                capability="price"
                lockedMessage="Sell your artifact for cash — set the price when you forge it."
              >
                <label
                  className="text-[11px] uppercase tracking-wide text-gray-500"
                  htmlFor="forge-price-usd"
                >
                  Sale price (USD)
                </label>
                <input
                  id="forge-price-usd"
                  type="number"
                  min={0}
                  max={FORGE_PRICE_MAX_CENTS / 100}
                  step={0.5}
                  value={priceUsd}
                  disabled={!canPrice}
                  onChange={(event) => {
                    setPriceUsd(event.target.value)
                    setEditPriceChanged(true)
                  }}
                  placeholder="e.g. 4.99"
                  className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  $0 – ${FORGE_PRICE_MAX_CENTS / 100}. Stored on the artifact and shown on its
                  listing; leave empty for no cash price.
                </p>
              </GatedGroup>}

              {/* ── (d) SHIRT — Legend. A dropdown of the member's own. ────── */}
              <GatedGroup
                label="Shirt"
                icon={<Shirt size={14} />}
                unlocked={canShirt}
                capability="shirt"
                lockedMessage="Bundle your artifact with a real t-shirt you design in the Physical Forge."
              >
                <label
                  className="text-[11px] uppercase tracking-wide text-gray-500"
                  htmlFor="forge-shirt"
                >
                  Pair with one of your shirts
                </label>
                <select
                  id="forge-shirt"
                  value={shirtProductId}
                  disabled={!canShirt || shirtProducts.length === 0}
                  onChange={(event) => {
                    setShirtProductId(event.target.value)
                    setEditShirtChanged(true)
                  }}
                  className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">No shirt — artifact only</option>
                  {shirtProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.title} — ${(product.sale_price_cents / 100).toFixed(2)}
                    </option>
                  ))}
                </select>
                {canShirt && shirtProducts.length === 0 && (
                  <p className="mt-1 text-[11px] text-gray-500">
                    You haven&apos;t designed a shirt yet — design one and it appears here.
                  </p>
                )}
                {selectedShirt && (
                  <div className="mt-2 flex items-center gap-3 rounded-lg border border-kunai/40 bg-kunai/5 p-2">
                    {selectedShirt.artwork_url ? (
                      <img
                        src={selectedShirt.artwork_url}
                        alt=""
                        className="h-10 w-10 shrink-0 rounded-md bg-black/40 object-cover"
                      />
                    ) : (
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white/5 text-gray-300">
                        <Shirt size={18} />
                      </span>
                    )}
                    <span className="min-w-0 text-[11px] uppercase text-gray-400">
                      {selectedShirt.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                )}
                <Link
                  to="/forge/physical"
                  className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-kunai/50 text-sm font-semibold text-kunai hover:bg-kunai/10"
                >
                  <Shirt size={16} />
                  Design a shirt in the Physical Forge
                </Link>
              </GatedGroup>

              {/* ── Marketplace listing (Utility Tokens) — free, unchanged ── */}
              {!requestedEditId && <FieldGroup label="Marketplace" icon={<Store size={14} />}>
                <div className="space-y-3">
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-dark-border px-3 py-3">
                    <span className="flex items-center gap-2 text-sm font-semibold text-white">
                      <Store size={17} />
                      List in marketplace
                    </span>
                    <input
                      type="checkbox"
                      checked={listForSale}
                      onChange={(event) => setListForSale(event.target.checked)}
                      className="h-4 w-4 accent-accent"
                    />
                  </label>

                  {listForSale && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setSellerType('creator')}
                          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border text-sm ${
                            sellerType === 'creator'
                              ? 'border-accent bg-accent/10 text-white'
                              : 'border-dark-border text-gray-400'
                          }`}
                        >
                          <UserRound size={17} />
                          My shop
                        </button>
                        <button
                          type="button"
                          onClick={() => managedClans.length > 0 && setSellerType('clan')}
                          disabled={managedClans.length === 0}
                          className={`flex min-h-11 items-center justify-center gap-2 rounded-lg border text-sm ${
                            sellerType === 'clan'
                              ? 'border-trust bg-trust/10 text-white'
                              : 'border-dark-border text-gray-400 disabled:opacity-40'
                          }`}
                        >
                          <UsersRound size={17} />
                          Clan shop
                        </button>
                      </div>

                      {sellerType === 'clan' && (
                        <select
                          value={clanId}
                          onChange={(event) => setClanId(event.target.value)}
                          className="w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none"
                        >
                          {managedClans.map((clan) => (
                            <option key={clan.id} value={clan.id}>{clan.name}</option>
                          ))}
                        </select>
                      )}

                      <div>
                        <label className="flex items-center gap-1.5 text-xs uppercase text-gray-500">
                          <Coins size={14} />
                          Utility Token price
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={10}
                          value={priceTokens}
                          onChange={(event) => setPriceTokens(event.target.value)}
                          className="mt-1 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-white focus:border-accent focus:outline-none"
                        />
                        {!IS_MOBILE_STORE_BUILD && (
                          <p className="mt-1 text-[11px] text-gray-500">
                            Cash creator listings use the separate fixed-price seller flow.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </FieldGroup>}
            </>
          )}

          {/* ── (e) PUBLISH ───────────────────────────────────────────────── */}
          <div className="space-y-3 pt-1">
            <div className="flex items-center gap-2 text-xs uppercase text-gray-500">
              <Hammer size={14} />
              Ready to forge
            </div>

            {/* One tab means everything is above this line — say what is going
                in, so nobody forges wondering whether a pick actually stuck. */}
            {purpose === 'collectible' && (
              <p className="text-[11px] text-gray-500">
                {chosenPowerCodes.length > 0
                  ? `${chosenPowerCodes.length} power${chosenPowerCodes.length === 1 ? '' : 's'} installed`
                  : 'No powers installed'}
                {!IS_MOBILE_STORE_BUILD && (
                  <> {' · '}{canPrice && priceUsd.trim() ? `$${priceUsd}` : 'no cash price'}</>
                )}
                {' · '}
                {selectedShirt ? `paired with ${selectedShirt.title}` : 'no shirt'}
              </p>
            )}

            <button
              type="button"
              onClick={forge}
              disabled={busy || editLoading || Boolean(requestedEditId && !editingArtifact) || (!editingArtifact && !imgSrc) || (purpose === 'conquest' && !clanId)}
              className="w-full rounded-lg py-3 font-bold text-dark disabled:opacity-50"
              style={{ background: accent, boxShadow: `0 0 22px ${accent}` }}
            >
              {busy
                ? 'Forging...'
                : editingArtifact
                  ? 'Save artifact changes'
                  : purpose === 'conquest'
                  ? `Forge ${selectedRecipe.name}`
                  : listForSale ? 'Forge & list item' : 'Forge artifact'}
            </button>

            {purpose === 'conquest' && forgedArtifactId && (
              <button
                type="button"
                onClick={activateConquestArtifact}
                disabled={busy}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-trust bg-trust/10 px-4 font-bold text-trust disabled:opacity-50"
              >
                <Swords size={18} />
                Activate for clan
              </button>
            )}

            {note && <p className="text-sm text-orange-300">{note}</p>}

            {/* The forge is no longer write-only: every artifact a member
                forges (with its powers, price and paired shirt) is listed on
                the Artifacts page. Point them at it once something exists. */}
            {savedCollectible && purpose === 'collectible' && (
              <Link
                to="/rewards"
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-dark-border px-4 text-sm font-semibold text-white"
              >
                View it in your collection
              </Link>
            )}
          </div>
        </div>
      </div>

      <UnlockReveal
        open={reveal}
        emoji="TKO"
        accent={accent}
        title="ARTIFACT FORGED"
        subtitle={purpose === 'conquest'
          ? `${selectedRecipe.name} is ready to activate.`
          : listForSale
            ? 'Your item is live in the marketplace.'
            : name ? `${name} is yours.` : 'Your artifact is ready.'}
        onClose={() => setReveal(false)}
      />
    </div>
  )
}

/**
 * One labelled block on the single forge tab. Nothing here collapses — the
 * whole forge is meant to be readable in one scroll.
 */
function FieldGroup({
  label,
  icon,
  lock,
  children,
}: {
  label: string
  icon?: React.ReactNode
  /** Right-aligned "<tier> perk" chip, shown when the block is locked. */
  lock?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-dark-border bg-dark-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400">
          {icon}
          {label}
        </span>
        {lock}
      </div>
      {children}
    </section>
  )
}

/**
 * A forge block that may be tier-locked.
 *
 * LOCKED DOES NOT MEAN HIDDEN. The controls still render — the dropdowns, the
 * price box, all of it — just `disabled`, with the tier chip in the header and
 * an "Unlock — upgrade your account" CTA underneath. A member can see exactly
 * what the tier buys before deciding to buy it, which is the whole point of
 * showing a locked control instead of an empty space.
 *
 * The real gate is server-side (/api/fn/forge-artifact-save, checking the same
 * src/lib/forgeTiers.ts mapping); this is honest UI, never the enforcement.
 */
function GatedGroup({
  label,
  icon,
  unlocked,
  capability,
  lockedMessage,
  children,
}: {
  label: string
  icon?: React.ReactNode
  unlocked: boolean
  capability: Parameters<typeof forgeTierName>[0]
  lockedMessage: string
  children: React.ReactNode
}) {
  const tierName = forgeTierName(capability)
  return (
    <FieldGroup
      label={label}
      icon={icon}
      lock={
        unlocked ? null : (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
            <Lock size={13} />
            {tierName} perk
          </span>
        )
      }
    >
      <div className={unlocked ? '' : 'opacity-60'}>{children}</div>
      {!unlocked && (
        <UpgradeNudge
          className="mt-3"
          hideForPaid={false}
          title={`${label} unlocks with ${tierName}`}
          message={lockedMessage}
          cta="Unlock — upgrade your account"
        />
      )}
    </FieldGroup>
  )
}

function RecipeButton({
  recipe,
  active,
  unlocked,
  onClick,
}: {
  recipe: ConquestArtifactRecipe
  active: boolean
  unlocked: boolean
  onClick: () => void
}) {
  const Icon = recipe.effects.some((effect) => effect.kind === 'territory_tiles')
    ? MapPinned
    : recipe.effects.some((effect) => effect.kind === 'base_shield_hours')
      ? Shield
      : recipe.effects.some((effect) => effect.kind === 'basic_clan_passes')
        ? Ticket
        : recipe.effects.some((effect) => effect.kind === 'rivalry_resets')
          ? Crown
          : Swords
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition ${
        active
          ? 'border-accent bg-accent/10'
          : 'border-dark-border bg-black/10 hover:border-white/30'
      }`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${
        active ? 'bg-accent text-dark' : 'bg-white/5 text-gray-300'
      }`}>
        <Icon size={19} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-semibold text-white">{recipe.name}</span>
          <span className="shrink-0 text-xs font-bold text-gray-300">
            ${(recipe.listPriceCents / 100).toFixed(2)}
          </span>
        </span>
        <span className="mt-0.5 block text-[11px] text-gray-500">
          {CONQUEST_TIER_LABEL[recipe.minimumTier]} / {recipe.slotCost}{' '}
          {recipe.slotCost === 1 ? 'slot' : 'slots'}
          {!unlocked ? ' / upgrade required' : ''}
        </span>
      </span>
    </button>
  )
}
