import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Coins,
  Crown,
  Hammer,
  MapPinned,
  Shield,
  Shirt,
  Store,
  Swords,
  Ticket,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { supabase } from '@/lib/supabase'
import UnlockReveal from '@/components/UnlockReveal'
import { addAsset, type SellerType } from '@/lib/assets'
import {
  RARITY,
  CAPABILITY_LABEL,
  makeGiftCode,
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
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']
const CAPS: Capability[] = ['none', 'gift_starter', 'profile_flair', 'clan_tag', 'event_badge']

/**
 * Cosmetic items keep the existing marketplace path. Conquest items use a
 * separate trusted server path: the client selects a recipe code and the
 * server derives every effect, cap, price, tier, and slot cost.
 */
export function Forge() {
  const { user, profile } = useAuth()
  const ent = useEntitlements()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const guidedEntry = searchParams.get('create') === '1'

  const [purpose, setPurpose] = useState<'collectible' | 'conquest'>('collectible')
  const [guideStep, setGuideStep] = useState<'target' | 'configure'>(
    guidedEntry ? 'target' : 'configure',
  )
  const [rarity, setRarity] = useState<Rarity>('rare')
  const [capability, setCapability] = useState<Capability>('none')
  const [recipeCode, setRecipeCode] = useState('scout-mark')
  const [name, setName] = useState('')
  const [priceTokens, setPriceTokens] = useState('100')
  const [imgSrc, setImgSrc] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState(false)
  const [listForSale, setListForSale] = useState(!IS_MOBILE_STORE_BUILD)
  const [sellerType, setSellerType] = useState<Exclude<SellerType, 'official'>>('creator')
  const [managedClans, setManagedClans] = useState<{ id: string; name: string }[]>([])
  const [clanId, setClanId] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [forgedArtifactId, setForgedArtifactId] = useState<string | null>(null)

  const selectedRecipe = CONQUEST_ARTIFACT_RECIPES.find((recipe) => recipe.code === recipeCode)
    ?? CONQUEST_ARTIFACT_RECIPES[0]
  const effectiveRarity = purpose === 'conquest' ? selectedRecipe.rarity : rarity
  const accent = RARITY[effectiveRarity].accent
  const marketplaceListing =
    !IS_MOBILE_STORE_BUILD && purpose === 'collectible' && listForSale

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

  useEffect(() => {
    if (imgSrc) renderArtifact(imgSrc)
    // renderArtifact reads the current visual recipe and rarity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imgSrc, purpose, recipeCode, rarity])

  useEffect(() => {
    if (guidedEntry) setGuideStep('target')
  }, [guidedEntry])

  function choosePurpose(nextPurpose: 'collectible' | 'conquest') {
    setPurpose(nextPurpose)
    setListForSale(!IS_MOBILE_STORE_BUILD && nextPurpose === 'collectible')
    setForgedArtifactId(null)
    setGuideStep('configure')
    if (guidedEntry) {
      const next = new URLSearchParams(searchParams)
      next.delete('create')
      setSearchParams(next, { replace: true })
    }
  }

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setImgSrc(String(reader.result))
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
      ctx.fillText('TKO', size / 2, size - 12)
    }
    img.src = src
  }

  async function forge() {
    if (!user) return
    if (purpose === 'conquest' && !clanId) {
      setNote('Choose a clan you lead or manage.')
      return
    }
    if (marketplaceListing && sellerType === 'clan' && !clanId) {
      setNote('Choose a clan storefront first.')
      return
    }
    setBusy(true)
    setNote(null)
    setForgedArtifactId(null)
    try {
      const dataUrl = canvasRef.current?.toDataURL('image/png')
      if (!dataUrl) throw new Error('Upload art before forging.')

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

      const tokenPrice = Math.max(0, Math.floor(Number(priceTokens) || 0))
      const code = capability === 'gift_starter'
        ? makeGiftCode(`${user.id}-${Date.now()}`)
        : null
      await (supabase as unknown as {
        from: (table: string) => { insert: (value: unknown) => PromiseLike<unknown> }
      }).from('artifacts').insert({
        owner_id: user.id,
        slug: 'forged',
        name: name || 'Forged Artifact',
        rarity,
        capability,
        code,
        price_cents: null,
        image_url: dataUrl,
      })
      if (marketplaceListing) {
        const clan = managedClans.find((item) => item.id === clanId)
        await addAsset({
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
      setNote(marketplaceListing
        ? 'Collectible forged and listed in the marketplace.'
        : 'Collectible forged and added to your collection.')
      setReveal(true)
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

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold">Forge an artifact</h1>
      <p className="mt-1 text-sm text-gray-400">
        {IS_MOBILE_STORE_BUILD
          ? 'Make a collectible for your collection, forge a physical shirt, or bind your art to a protected Conquest recipe.'
          : 'Make a collectible for the marketplace, or bind your art to a protected Conquest recipe.'}
        {' '}Higher memberships unlock stronger clan powers.
      </p>

      {guideStep === 'target' && (
        <section className="mt-5 rounded-lg border border-dark-border bg-dark-card p-4">
          <div aria-label="Step 1 of 2: Choose artifact type">
            <div className="flex gap-1.5">
              <span className="h-1.5 flex-1 rounded-full bg-kunai" />
              <span className="h-1.5 flex-1 rounded-full bg-dark-elevated" />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-white">Step 1 of 2</span>
              <span className="text-gray-500">Choose a purpose</span>
            </div>
          </div>

          <h2 className="mt-5 text-lg font-semibold text-white">What do you want to forge?</h2>
          <p className="mt-1 text-sm text-gray-400">
            Pick one. The next screen only shows the controls needed for it.
          </p>

          <div className="mt-4 grid gap-2">
            <button
              type="button"
              onClick={() => choosePurpose('collectible')}
              className="flex min-h-20 items-center gap-4 rounded-lg border border-dark-border px-4 py-3 text-left transition-colors hover:border-accent/60 hover:bg-dark-elevated"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <Store size={22} />
              </span>
              <span>
                <span className="block font-semibold text-white">
                  {IS_MOBILE_STORE_BUILD ? 'Collectible artifact' : 'Collectible or shop item'}
                </span>
                <span className="mt-0.5 block text-sm text-gray-400">
                  {IS_MOBILE_STORE_BUILD
                    ? 'Upload art, add a perk, and keep it in your collection.'
                    : 'Upload art, add a perk, and keep it or list it for sale.'}
                </span>
              </span>
            </button>

            <button
              type="button"
              onClick={() => choosePurpose('conquest')}
              className="flex min-h-20 items-center gap-4 rounded-lg border border-dark-border px-4 py-3 text-left transition-colors hover:border-trust/60 hover:bg-dark-elevated"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-trust/10 text-trust">
                <MapPinned size={22} />
              </span>
              <span>
                <span className="block font-semibold text-white">Shinobi Conquest power</span>
                <span className="mt-0.5 block text-sm text-gray-400">
                  Choose a protected recipe and bind its power to your clan.
                </span>
              </span>
            </button>

            <Link
              to="/forge/physical"
              className="flex min-h-20 items-center gap-4 rounded-lg border border-dark-border px-4 py-3 text-left transition-colors hover:border-kunai/60 hover:bg-dark-elevated"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-kunai/10 text-kunai">
                <Shirt size={22} />
              </span>
              <span>
                <span className="block font-semibold text-white">Physical shirt</span>
                <span className="mt-0.5 block text-sm text-gray-400">
                  Shop creator shirts or put one of your artifacts on a shirt.
                </span>
              </span>
            </Link>
          </div>
        </section>
      )}

      {guideStep === 'configure' && (
        <>
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

          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="font-semibold text-white">Step 2 of 2</span>
            <button
              type="button"
              onClick={() => setGuideStep('target')}
              className="text-accent hover:underline"
            >
              Change purpose
            </button>
          </div>

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
        </div>

        <div className="space-y-4">
          {purpose === 'collectible' ? (
            <>
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

              {!IS_MOBILE_STORE_BUILD && (
                <>
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
                        <p className="mt-1 text-[11px] text-gray-500">
                          Cash creator listings use the separate fixed-price seller flow.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <>
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
                  {!IS_MOBILE_STORE_BUILD && (
                    <span className="text-sm font-bold text-accent">
                      ${(selectedRecipe.listPriceCents / 100).toFixed(2)} value
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs leading-5 text-gray-400">
                  {selectedRecipe.description}
                </p>
                <p className="mt-2 text-[11px] uppercase text-gray-500">
                  Uses {selectedRecipe.slotCost} active {selectedRecipe.slotCost === 1 ? 'slot' : 'slots'}
                  {' / '}
                  {CONQUEST_TIER_LABEL[selectedRecipe.minimumTier]}+
                </p>
              </div>
            </>
          )}

          <div className="flex items-center gap-2 text-xs uppercase text-gray-500">
            <Hammer size={14} />
            Ready to forge
          </div>

          <button
            type="button"
            onClick={forge}
            disabled={busy || !imgSrc || (purpose === 'conquest' && !clanId)}
            className="w-full rounded-lg py-3 font-bold text-dark disabled:opacity-50"
            style={{ background: accent, boxShadow: `0 0 22px ${accent}` }}
          >
            {busy
              ? 'Forging...'
              : purpose === 'conquest'
                ? `Forge ${selectedRecipe.name}`
                : marketplaceListing ? 'Forge & list item' : 'Forge artifact'}
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
          {!imgSrc && <p className="text-xs text-gray-500">Upload art to enable forging.</p>}
        </div>
          </div>
        </>
      )}

      <UnlockReveal
        open={reveal}
        emoji="TKO"
        accent={accent}
        title="ARTIFACT FORGED"
        subtitle={purpose === 'conquest'
          ? `${selectedRecipe.name} is ready to activate.`
          : marketplaceListing
            ? 'Your item is live in the marketplace.'
            : name ? `${name} is yours.` : 'Your artifact is ready.'}
        onClose={() => setReveal(false)}
      />
    </div>
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
          {!IS_MOBILE_STORE_BUILD && (
            <span className="shrink-0 text-xs font-bold text-gray-300">
              ${(recipe.listPriceCents / 100).toFixed(2)}
            </span>
          )}
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
