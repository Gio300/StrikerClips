import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Badge,
  BadgePercent,
  Check,
  Coins,
  CreditCard,
  Image as ImageIcon,
  PackageOpen,
  Shirt,
  ShoppingBag,
  Smile,
  Store,
  UserRound,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useWallet } from '@/hooks/useWallet'
import { AssetUploadForm } from '@/components/AssetUploadForm'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import {
  listAssets,
  getOwned,
  buyAsset,
  ownsAsset,
  subscribeAssets,
  loadAssetState,
  kindLabel,
  type AssetKind,
  type DigitalAsset,
  type SellerType,
} from '@/lib/assets'
import { applyWalletSnapshot } from '@/lib/wallet'
import { formatUsd, paidSweepsCreatorSplit } from '@/lib/creatorCommerce'
import {
  buyCreatorItemWithPaidSweeps,
  startCreatorCashCheckout,
} from '@/lib/creatorCommerceApi'

type Storefront = 'official' | 'creator' | 'clan' | 'locker'

const STOREFRONTS: { id: Storefront; label: string; Icon: LucideIcon }[] = [
  { id: 'official', label: 'TKO', Icon: Store },
  { id: 'creator', label: 'Creators', Icon: UserRound },
  { id: 'clan', label: 'Clans', Icon: UsersRound },
  { id: 'locker', label: 'My locker', Icon: ShoppingBag },
]

const KIND_ICONS: Record<AssetKind, LucideIcon> = {
  jersey: Shirt,
  banner: ImageIcon,
  emote: Smile,
  badge_skin: Badge,
}

function assetSellerType(asset: DigitalAsset): SellerType {
  if (asset.sellerType) return asset.sellerType
  return asset.createdBy === 'seed' || asset.createdBy === 'oracle' || asset.createdBy === 'tko-king'
    ? 'official'
    : 'creator'
}

export function Shop() {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const {
    tokens,
    paid_sweeps_cents: paidSweepsCents,
    refresh: refreshWallet,
  } = useWallet()
  const [storefront, setStorefront] = useState<Storefront>('official')
  const [assets, setAssets] = useState<DigitalAsset[]>(() => listAssets())
  const [owned, setOwned] = useState<DigitalAsset[]>(() => getOwned(userId))
  const [flash, setFlash] = useState<string | null>(null)
  const [buying, setBuying] = useState<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(() => {
    setAssets(listAssets())
    setOwned(getOwned(userId))
  }, [userId])

  useEffect(() => {
    refresh()
    const unsubscribe = subscribeAssets(refresh)
    void loadAssetState(userId)
    return unsubscribe
  }, [refresh, userId])

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  const visible = useMemo(
    () => storefront === 'locker'
      ? owned
      : assets.filter((asset) => assetSellerType(asset) === storefront),
    [assets, owned, storefront],
  )

  function showFlash(message: string) {
    setFlash(message)
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setFlash(null), 3500)
  }

  async function handleBuy(asset: DigitalAsset) {
    setBuying(asset.id)
    try {
      const result = await buyAsset(userId, asset.id)
      if (result.ok) {
        showFlash(`${result.asset.name} is now in your locker.`)
      } else if (result.reason === 'insufficient') {
        showFlash('You need more Tokens for that item.')
      } else if (result.reason === 'already-owned') {
        showFlash('You already own that item.')
      } else if (result.reason === 'not-for-sale') {
        showFlash('That artifact has to be earned.')
      } else {
        showFlash('The purchase could not be completed. Nothing was charged.')
      }
      refresh()
    } finally {
      setBuying(null)
    }
  }

  async function handleCashBuy(asset: DigitalAsset) {
    setBuying(`${asset.id}:cash`)
    try {
      const result = await startCreatorCashCheckout({
        asset_id: asset.id,
        idempotency_key: crypto.randomUUID(),
      })
      if (result.ok && result.data?.url) {
        window.location.href = result.data.url
        return
      }
      showFlash(
        result.status === 409
          ? 'This seller must finish Stripe payout setup before cash sales can start.'
          : (result.error || 'Cash checkout could not be started.'),
      )
    } finally {
      setBuying(null)
    }
  }

  async function handlePaidSweepsBuy(asset: DigitalAsset) {
    setBuying(`${asset.id}:paid-sweeps`)
    try {
      const result = await buyCreatorItemWithPaidSweeps({
        asset_id: asset.id,
        idempotency_key: crypto.randomUUID(),
      })
      if (result.ok && result.data?.wallet) {
        applyWalletSnapshot(userId, result.data.wallet)
        await loadAssetState(userId)
        refresh()
        showFlash(`${asset.name} is now in your locker.`)
        return
      }
      if (result.status === 402) {
        showFlash('You need more paid Sweeps Credits. Free Give Points cannot buy creator items.')
      } else if (result.status === 409) {
        showFlash('This seller must finish Stripe payout setup before paid-credit sales can start.')
      } else {
        showFlash(result.error || 'The paid-credit purchase could not be completed.')
      }
      void refreshWallet()
    } finally {
      setBuying(null)
    }
  }

  if (!user) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <ShoppingBag size={32} className="mx-auto mb-3 text-accent" />
        <h1 className="text-2xl font-bold">TKO Marketplace</h1>
        <p className="mb-4 mt-2 text-gray-400">Sign in to shop creator and clan items.</p>
        <Link to="/login" className="rounded-lg bg-accent px-4 py-2 font-semibold text-dark">Sign in</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-accent">
            <ShoppingBag size={15} />
            Marketplace
          </div>
          <h1 className="text-2xl font-bold text-white">Official, creator, and clan items</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-400">
            Official gear can use Tokens. Creator and clan items support direct cash or paid
            Sweeps Credits, with seller payouts handled through Stripe Connect.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <div>
            <div className="flex items-center gap-2 text-lg font-bold text-accent">
              <Coins size={18} />
              {tokens.toLocaleString()}
            </div>
            <div className="text-[11px] uppercase text-gray-500">Your Tokens</div>
          </div>
          <div>
            <div className="flex items-center gap-2 text-lg font-bold text-trust">
              <WalletCards size={18} />
              {formatUsd(paidSweepsCents)}
            </div>
            <div className="text-[11px] uppercase text-gray-500">Paid Sweeps Credits</div>
          </div>
          <Link
            to="/store"
            className="rounded-lg border border-dark-border px-3 py-2 text-sm font-semibold text-white hover:border-accent"
          >
            Get Tokens
          </Link>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-4 gap-1 rounded-lg border border-dark-border bg-dark-card p-1">
        {STOREFRONTS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setStorefront(id)}
            className={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors sm:text-sm ${
              storefront === id ? 'bg-dark-elevated text-white' : 'text-gray-500 hover:text-gray-200'
            }`}
          >
            <Icon size={16} className="shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {flash && (
        <div className="mb-6 rounded-lg border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {flash}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="py-14 text-center">
          <PackageOpen size={34} className="mx-auto mb-3 text-gray-600" />
          <h2 className="font-semibold text-white">
            {storefront === 'locker' ? 'Your locker is empty' : `No ${storefront} items yet`}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {storefront === 'locker'
              ? 'Pick up an item from one of the storefronts.'
              : 'The first verified listing will appear here.'}
          </p>
        </div>
      ) : (
        <div className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {visible.map((asset) => (
            <MarketplaceCard
              key={asset.id}
              asset={asset}
              owned={storefront === 'locker' || ownsAsset(userId, asset.id)}
              affordable={tokens >= asset.priceTokens}
              paidSweepsBalance={paidSweepsCents}
              buying={buying}
              onBuy={() => void handleBuy(asset)}
              onCashBuy={() => void handleCashBuy(asset)}
              onPaidSweepsBuy={() => void handlePaidSweepsBuy(asset)}
            />
          ))}
        </div>
      )}

      <CollapsibleSection id="marketplace-listing" label="Sell an item" hint="Creator or clan storefront">
        <AssetUploadForm
          userId={userId}
          onListed={(name) => {
            showFlash(`Listed “${name}” in the marketplace.`)
            setStorefront('creator')
          }}
        />
      </CollapsibleSection>

      <p className="mt-8 text-center text-xs text-gray-500">
        Free Give Points cannot purchase creator items and never convert to seller cash.
        Paid Sweeps Credits are a separate purchased balance. Marketplace purchases are not wagers.
      </p>
    </div>
  )
}

function MarketplaceCard({
  asset,
  owned,
  affordable,
  paidSweepsBalance,
  buying,
  onBuy,
  onCashBuy,
  onPaidSweepsBuy,
}: {
  asset: DigitalAsset
  owned: boolean
  affordable: boolean
  paidSweepsBalance: number
  buying: string | null
  onBuy: () => void
  onCashBuy: () => void
  onPaidSweepsBuy: () => void
}) {
  const KindIcon = KIND_ICONS[asset.kind] ?? ShoppingBag
  const sellerType = assetSellerType(asset)
  const sellerLabel = sellerType === 'official' ? 'TKO official' : sellerType === 'clan' ? 'Clan shop' : 'Creator shop'
  const creatorListing = sellerType !== 'official' && Number(asset.priceCents ?? 0) > 0
  const paidSplit = creatorListing
    ? paidSweepsCreatorSplit(Number(asset.priceCents ?? 0))
    : null

  return (
    <article className="overflow-hidden rounded-lg border border-dark-border bg-dark-card transition-colors hover:border-accent/60">
      <div className="relative aspect-square overflow-hidden bg-dark-elevated">
        {asset.imageUrl ? (
          <img
            src={asset.imageUrl}
            alt={asset.name}
            className="h-full w-full object-cover"
            onError={(event) => {
              event.currentTarget.hidden = true
              event.currentTarget.nextElementSibling?.classList.remove('hidden')
            }}
          />
        ) : null}
        <div className={`${asset.imageUrl ? 'hidden' : ''} absolute inset-0 flex items-center justify-center`}>
          <KindIcon size={44} className="text-gray-600" />
        </div>
        <span className="absolute left-2 top-2 rounded-full bg-black/80 px-2 py-1 text-[10px] font-semibold text-gray-200">
          {sellerLabel}
        </span>
      </div>

      <div className="p-3">
        <div className="flex items-center gap-1 text-[10px] uppercase text-gray-500">
          <KindIcon size={12} />
          {asset.teamName || sellerLabel} · {kindLabel(asset.kind)}
        </div>
        <h3 className="mt-1 line-clamp-2 min-h-10 text-sm font-semibold leading-5 text-white">{asset.name}</h3>

        <div className="mt-3">
          {owned ? (
            <span className="flex items-center gap-1 rounded-lg border border-leaf/40 bg-leaf/10 px-2 py-1.5 text-xs font-semibold text-leaf">
              <Check size={13} />
              Owned
            </span>
          ) : creatorListing ? (
            <div className="space-y-2">
              {asset.cashEnabled && (
                <button
                  type="button"
                  onClick={onCashBuy}
                  disabled={buying != null}
                  className="flex min-h-10 w-full items-center justify-between rounded-lg bg-accent px-3 text-xs font-semibold text-dark disabled:opacity-50"
                >
                  <span className="flex items-center gap-1.5"><CreditCard size={14} />Pay cash</span>
                  <span>{formatUsd(Number(asset.priceCents))}</span>
                </button>
              )}
              {asset.paidSweepsEnabled && paidSplit && (
                <button
                  type="button"
                  onClick={onPaidSweepsBuy}
                  disabled={buying != null || paidSweepsBalance < paidSplit.buyerChargeCents}
                  className="flex min-h-10 w-full items-center justify-between rounded-lg border border-trust/50 bg-trust/10 px-3 text-xs font-semibold text-trust disabled:opacity-45"
                >
                  <span className="flex items-center gap-1.5"><BadgePercent size={14} />Sweeps Credits</span>
                  <span>{formatUsd(paidSplit.buyerChargeCents)}</span>
                </button>
              )}
              <p className="text-[10px] leading-4 text-gray-500">
                Paid-credit price includes 30% off. Free Give Points are not accepted.
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1 text-sm font-bold text-accent">
                <Coins size={14} />
                {asset.priceTokens.toLocaleString()}
              </span>
              <button
              type="button"
              onClick={onBuy}
              disabled={!affordable || buying != null}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                affordable
                  ? 'bg-accent text-dark hover:brightness-110'
                  : 'border border-dark-border text-gray-600'
              }`}
            >
              {buying ? 'Buying…' : affordable ? 'Buy' : 'Need more'}
            </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
