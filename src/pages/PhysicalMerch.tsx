import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from '@stripe/react-stripe-js'
import { loadStripe } from '@stripe/stripe-js'
import { Link } from 'react-router-dom'
import {
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  ExternalLink,
  Factory,
  Hammer,
  History,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Shirt,
  ShoppingBag,
  Sparkles,
  Truck,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import {
  assistPhysicalDesign,
  createPhysicalProduct,
  fetchPhysicalConfig,
  fetchPhysicalOrders,
  fetchPhysicalProducts,
  fetchPhysicalReviewQueue,
  releasePhysicalPayouts,
  reviewPhysicalProduct,
  simulatePhysicalPayment,
  simulatePhysicalRefund,
  simulatePhysicalShipment,
  startPhysicalCheckout,
  type DesignSuggestion,
  type PhysicalMerchConfig,
  type PhysicalOrder,
  type PhysicalProduct,
} from '@/lib/physicalMerchApi'

type ArtifactOption = { id: string; name: string; image_url?: string | null }
type CheckoutState = { orderId: string; clientSecret: string | null; simulated: boolean } | null
type PhysicalView = 'shop' | 'create' | 'orders' | 'host'

const stripeKey = String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '')
const money = (cents: number) => `$${(Number(cents || 0) / 100).toFixed(2)}`

const STATUS_STEPS = [
  'checkout_pending',
  'paid',
  'shopify_pending',
  'fulfillment_held',
  'shipped',
  'delivered',
]

export function PhysicalMerch() {
  const { user } = useAuth()
  const host = user?.user_metadata?.tko_host === true
  const [config, setConfig] = useState<PhysicalMerchConfig | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactOption[]>([])
  const [catalog, setCatalog] = useState<PhysicalProduct[]>([])
  const [mine, setMine] = useState<PhysicalProduct[]>([])
  const [reviewQueue, setReviewQueue] = useState<PhysicalProduct[]>([])
  const [orders, setOrders] = useState<PhysicalOrder[]>([])
  const [checkout, setCheckout] = useState<CheckoutState>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [view, setView] = useState<PhysicalView>('shop')

  const refresh = useCallback(async () => {
    const calls = await Promise.all([
      fetchPhysicalConfig(),
      fetchPhysicalProducts(false),
      fetchPhysicalProducts(true),
      fetchPhysicalOrders(),
      host ? fetchPhysicalReviewQueue() : Promise.resolve(null),
    ])
    if (calls[0].ok && calls[0].data) setConfig(calls[0].data)
    if (calls[1].ok && calls[1].data) setCatalog(calls[1].data.products)
    if (calls[2].ok && calls[2].data) setMine(calls[2].data.products)
    if (calls[3].ok && calls[3].data) setOrders(calls[3].data.orders)
    if (calls[4]?.ok && calls[4].data) setReviewQueue(calls[4].data.products)
  }, [host])

  useEffect(() => {
    let active = true
    void (async () => {
      if (!user) return
      const result = await (supabase as any)
        .from('artifacts')
        .select('id,name,image_url')
        .eq('owner_id', user.id)
      if (active) setArtifacts((result.data || []) as ArtifactOption[])
      if (active) await refresh()
    })()
    return () => { active = false }
  }, [refresh, user])

  async function run(label: string, action: () => Promise<string | null>) {
    setBusy(label)
    setNotice(null)
    try {
      const message = await action()
      if (message) setNotice(message)
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div data-testid="physical-page" className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <header className="relative overflow-hidden rounded-2xl border border-white/10 bg-dark-card p-5 sm:p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-kunai/15 via-transparent to-accent/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-kunai">
              <Shirt size={16} />
              Physical Forge
            </div>
            <h1 className="text-2xl font-bold text-white sm:text-3xl">Wear what you forged.</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
              Shop creator designs or turn your own artifact into a shirt.
            </p>
          </div>
          <ModeBadge config={config} />
        </div>
      </header>

      {notice && (
        <div role="status" className="mt-4 rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-accent">
          {notice}
        </div>
      )}

      <nav
        aria-label="Physical Forge sections"
        className="mt-5 grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-dark-card p-1 sm:flex"
      >
        <ViewButton active={view === 'shop'} onClick={() => setView('shop')} Icon={ShoppingBag}>
          Shop
        </ViewButton>
        <ViewButton
          testId="physical-create-tab"
          active={view === 'create'}
          onClick={() => setView('create')}
          Icon={Hammer}
        >
          Create
        </ViewButton>
        <ViewButton active={view === 'orders'} onClick={() => setView('orders')} Icon={History}>
          Orders
        </ViewButton>
        {host && (
          <ViewButton
            testId="physical-host-tab"
            active={view === 'host'}
            onClick={() => setView('host')}
            Icon={Settings2}
          >
            Host
          </ViewButton>
        )}
      </nav>

      <details className="mt-3 rounded-xl border border-white/5 bg-dark-card/60 text-sm text-gray-400">
        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-medium text-gray-400 hover:text-white">
          How orders and creator payouts work
        </summary>
        <div className="grid gap-2 border-t border-white/5 p-3 text-xs sm:grid-cols-4">
          <Safety label="Secure checkout" ok={config?.stripe_checkout_ready} Icon={CircleDollarSign} />
          <Safety label="Order recorded" ok={config?.shopify_bridge_ready} Icon={RefreshCw} />
          <Safety label="Made on demand" ok={config?.print_provider_ready} Icon={Factory} />
          <Safety label="Creator paid" ok={config?.creator_transfers_enabled || config?.simulated} Icon={Truck} />
        </div>
      </details>

      <div className="mt-5">
        {view === 'shop' && (
          <Catalog
            products={catalog}
            config={config}
            busy={busy}
            onCheckout={(next) => setCheckout(next)}
            onRun={run}
          />
        )}
        {view === 'create' && (
          <CreatorBuilder
            artifacts={artifacts}
            products={mine}
            config={config}
            busy={busy}
            onRun={run}
          />
        )}
        {view === 'orders' && <Orders orders={orders} />}
        {view === 'host' && host && (
          <HostControls
            queue={reviewQueue}
            orders={orders}
            busy={busy}
            onRun={run}
          />
        )}
      </div>

      {checkout && (
        <CheckoutPanel
          checkout={checkout}
          onClose={() => setCheckout(null)}
          onRun={run}
        />
      )}
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  Icon,
  testId,
  children,
}: {
  active: boolean
  onClick: () => void
  Icon: typeof Shirt
  testId?: string
  children: React.ReactNode
}) {
  return (
    <button
      data-testid={testId}
      type="button"
      onClick={onClick}
      className={`flex min-w-0 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
        active ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:bg-white/5 hover:text-gray-200'
      }`}
    >
      <Icon size={16} />
      {children}
    </button>
  )
}

function ModeBadge({ config }: { config: PhysicalMerchConfig | null }) {
  const simulated = config?.simulated !== false
  return (
    <div
      data-testid="mode-badge"
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
        simulated
          ? 'border-chakra/40 bg-chakra/10 text-chakra'
          : 'border-leaf/40 bg-leaf/10 text-leaf'
      }`}
    >
      {simulated ? 'SAFE PREVIEW' : `${config?.mode?.toUpperCase() || 'TEST'} COMMERCE`}
    </div>
  )
}

function Safety({
  label,
  ok,
  Icon,
}: {
  label: string
  ok?: boolean
  Icon: typeof ShieldCheck
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-gray-300">
      <Icon size={15} className={ok ? 'text-leaf' : 'text-gray-600'} />
      {label}
      <span className={`ml-auto ${ok ? 'text-leaf' : 'text-gray-600'}`}>{ok ? 'ready' : 'held'}</span>
    </div>
  )
}

function CreatorBuilder({
  artifacts,
  products,
  config,
  busy,
  onRun,
}: {
  artifacts: ArtifactOption[]
  products: PhysicalProduct[]
  config: PhysicalMerchConfig | null
  busy: string | null
  onRun: (label: string, action: () => Promise<string | null>) => Promise<void>
}) {
  const [artifactId, setArtifactId] = useState('')
  const selected = artifacts.find((item) => item.id === artifactId)
  const [prompt, setPrompt] = useState('Bold shinobi tournament shirt with a clean centered emblem')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [artworkUrl, setArtworkUrl] = useState('')
  const [price, setPrice] = useState('39.99')
  const [color, setColor] = useState('Black')
  const [placement, setPlacement] = useState('front-center')
  const [width, setWidth] = useState(4500)
  const [height, setHeight] = useState(5400)
  const [attested, setAttested] = useState(false)
  const [suggestion, setSuggestion] = useState<DesignSuggestion | null>(null)

  useEffect(() => {
    if (!artifactId && artifacts[0]) setArtifactId(artifacts[0].id)
  }, [artifactId, artifacts])

  useEffect(() => {
    if (!selected) return
    setTitle((current) => current || `${selected.name} Forge Tee`)
    setArtworkUrl((current) => current || String(selected.image_url || ''))
  }, [selected])

  async function assist() {
    await onRun('assist', async () => {
      const result = await assistPhysicalDesign(prompt, selected?.name || 'Forged Artifact')
      if (!result.ok || !result.data) return result.error || 'Design assist failed.'
      const next = result.data.generated
      setSuggestion(next)
      setTitle(next.title)
      setDescription(next.description)
      setColor(next.color)
      setPlacement(next.placement)
      setWidth(next.print_width_px)
      setHeight(next.print_height_px)
      return `Design guidance ready from ${result.data.provider}.`
    })
  }

  async function submit() {
    await onRun('submit', async () => {
      const cents = Math.round(Number(price) * 100)
      const result = await createPhysicalProduct({
        artifact_id: artifactId,
        title,
        description,
        artwork_url: artworkUrl,
        sale_price_cents: cents,
        print_width_px: width,
        print_height_px: height,
        placement,
        transparent_background: true,
        colors: [color],
        ip_attested: attested,
        ai_brief: suggestion as unknown as Record<string, unknown>,
      })
      if (!result.ok) return result.error || 'Product submission failed.'
      setAttested(false)
      return 'Shirt submitted for TKO review. Shopify stays unpublished until approval.'
    })
  }

  if (!artifacts.length) {
    return (
      <section className="rounded-xl border border-dark-border bg-dark-card p-5">
        <div className="flex items-center gap-2">
          <Sparkles size={19} className="text-kunai" />
          <h2 className="text-lg font-semibold text-white">Create a shirt</h2>
        </div>
        <div className="mt-5 rounded-xl border border-dashed border-dark-border px-5 py-10 text-center">
          <Hammer size={30} className="mx-auto text-gray-600" />
          <h3 className="mt-3 font-semibold text-white">Start with an artifact</h3>
          <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">
            Forge your first digital item, then TKO can help turn it into a physical design.
          </p>
          <Link
            to="/forge"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-kunai px-4 py-2.5 text-sm font-semibold text-white"
          >
            Forge an artifact <ChevronRight size={16} />
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-dark-border bg-dark-card p-5">
      <div className="flex items-center gap-2">
        <Sparkles size={19} className="text-kunai" />
        <h2 className="text-lg font-semibold text-white">Create a shirt</h2>
      </div>
      <p className="mt-1 text-sm text-gray-400">
        Choose an artifact. TKO will prepare the product while you keep creative control.
      </p>

      <label className="mt-5 block text-xs font-semibold uppercase text-gray-500">
        Forged artifact
        <select
          data-testid="artifact-select"
          value={artifactId}
          onChange={(event) => setArtifactId(event.target.value)}
          className="mt-1.5 w-full rounded-lg border border-dark-border bg-dark px-3 py-2.5 text-sm normal-case text-white"
        >
          {!artifacts.length && <option value="">Forge an artifact first</option>}
          {artifacts.map((artifact) => <option key={artifact.id} value={artifact.id}>{artifact.name}</option>)}
        </select>
      </label>

      <div className="mt-4 rounded-lg border border-trust/25 bg-trust/5 p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-trust">
          <Bot size={16} /> Describe the look
        </div>
        <textarea
          data-testid="design-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="mt-2 min-h-20 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm text-white"
        />
        <button
          data-testid="assist-design"
          type="button"
          onClick={assist}
          disabled={!artifactId || busy != null}
          className="mt-2 rounded-lg border border-trust/40 bg-trust/10 px-3 py-2 text-xs font-semibold text-trust disabled:opacity-40"
        >
          {busy === 'assist' ? 'Designing…' : 'Build my shirt'}
        </button>
      </div>

      <details data-testid="product-details" className="mt-4 rounded-lg border border-dark-border bg-dark">
        <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-medium text-gray-300">
          Edit product details
        </summary>
        <div className="grid gap-3 border-t border-dark-border p-3">
          <TextField testId="merch-title" label="Product title" value={title} onChange={setTitle} />
          <TextField testId="artwork-url" label="Artwork link" value={artworkUrl} onChange={setArtworkUrl} />
          <label className="text-xs font-semibold uppercase text-gray-500">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1.5 min-h-16 w-full rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm normal-case text-white"
            />
          </label>
        </div>
      </details>

      <div className="mt-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs font-semibold uppercase text-gray-500">
            Color
            <select value={color} onChange={(event) => setColor(event.target.value)} className="mt-1.5 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm normal-case text-white">
              {(config?.colors || ['Black', 'White']).map((item) => <option key={item}>{item}</option>)}
            </select>
          </label>
          <label className="text-xs font-semibold uppercase text-gray-500">
            Price
            <input
              data-testid="merch-price"
              type="number"
              min="25"
              max="150"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              className="mt-1.5 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm normal-case text-white"
            />
          </label>
        </div>
      </div>

      <label className="mt-4 flex items-start gap-2 rounded-lg border border-dark-border bg-dark p-3 text-xs leading-5 text-gray-300">
        <input
          data-testid="rights-attestation"
          type="checkbox"
          checked={attested}
          onChange={(event) => setAttested(event.target.checked)}
          className="mt-1"
        />
        I own or have permission to sell this design.
      </label>
      <button
        data-testid="submit-product"
        type="button"
        onClick={submit}
        disabled={!artifactId || !title || !artworkUrl || !attested || busy != null}
        className="mt-4 w-full rounded-lg bg-kunai px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
      >
        {busy === 'submit' ? 'Submitting…' : 'Send for approval'}
      </button>

      <div className="mt-5 space-y-2" data-testid="my-products">
        {products.map((product) => (
          <div key={product.id} className="flex items-center gap-3 rounded-lg border border-dark-border bg-dark p-3">
            <img src={product.artwork_url} alt="" className="h-10 w-10 rounded object-cover" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{product.title}</div>
              <div className="text-xs text-gray-500">{product.status.replace(/_/g, ' ')}</div>
            </div>
            <span className="text-xs text-accent">{money(product.sale_price_cents)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function TextField({
  testId,
  label,
  value,
  onChange,
}: {
  testId: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="text-xs font-semibold uppercase text-gray-500">
      {label}
      <input
        data-testid={testId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-lg border border-dark-border bg-dark px-3 py-2 text-sm normal-case text-white"
      />
    </label>
  )
}

function Catalog({
  products,
  config,
  busy,
  onCheckout,
  onRun,
}: {
  products: PhysicalProduct[]
  config: PhysicalMerchConfig | null
  busy: string | null
  onCheckout: (checkout: NonNullable<CheckoutState>) => void
  onRun: (label: string, action: () => Promise<string | null>) => Promise<void>
}) {
  const [selections, setSelections] = useState<Record<string, string>>({})

  async function buy(product: PhysicalProduct) {
    const variantId = selections[product.id] || product.variants[0]?.id
    if (!variantId) return
    await onRun(`buy:${product.id}`, async () => {
      const result = await startPhysicalCheckout({
        product_id: product.id,
        variant_id: variantId,
        quantity: 1,
        idempotency_key: crypto.randomUUID(),
      })
      if (!result.ok || !result.data) return result.error || 'Checkout failed.'
      onCheckout({
        orderId: result.data.orderId,
        clientSecret: result.data.clientSecret,
        simulated: result.data.simulated,
      })
      return result.data.simulated
        ? 'Safe checkout created. Complete the dry-run below.'
        : 'Secure TKO checkout is ready.'
    })
  }

  return (
    <section className="rounded-xl border border-dark-border bg-dark-card p-5">
      <div className="flex items-center gap-2">
        <Shirt size={19} className="text-accent" />
        <h2 className="text-lg font-semibold text-white">Shop shirts</h2>
      </div>
      <p className="mt-1 text-sm text-gray-400">Choose a design and size. Checkout stays inside TKO.</p>

      {!products.length ? (
        <div className="mt-5 rounded-xl border border-dashed border-dark-border p-10 text-center text-sm text-gray-500">
          Approved shirts will appear here after host review.
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {products.filter((product) => product.status === 'approved' || product.status === 'active').map((product) => {
            const selectedVariant = product.variants.find(
              (variant) => variant.id === (selections[product.id] || product.variants[0]?.id),
            )
            const checkoutAvailable = config?.simulated === true || (
              config?.checkout_ready === true
              && Boolean(selectedVariant?.provider_variant_id)
            )
            const unavailableCopy = !config
              ? 'Checking checkout readiness…'
              : !config.checkout_ready
                ? 'Checkout is paused while TKO finishes connecting manufacturing and automatic fulfillment. No order or charge will be created.'
                : !selectedVariant?.provider_variant_id
                  ? 'This size and color is not connected to manufacturing yet. Choose another option or check back soon.'
                  : null
            return (
            <article
              data-testid="product-card"
              key={product.id}
              className="overflow-hidden rounded-xl border border-dark-border bg-dark"
            >
              <div className="aspect-[4/3] bg-gradient-to-br from-dark-elevated to-black p-5">
                <img src={product.artwork_url} alt={product.title} className="h-full w-full object-contain" />
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-white">{product.title}</h3>
                    <p className="mt-1 line-clamp-2 text-xs text-gray-500">{product.description}</p>
                  </div>
                  <span className="font-bold text-accent">{money(product.sale_price_cents)}</span>
                </div>
                <select
                  data-testid={`variant-select-${product.id}`}
                  value={selections[product.id] || product.variants[0]?.id || ''}
                  onChange={(event) => setSelections((current) => ({ ...current, [product.id]: event.target.value }))}
                  className="mt-4 w-full rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-sm text-white"
                >
                  {product.variants.map((variant) => (
                    <option key={variant.id} value={variant.id}>{variant.color} · {variant.size}</option>
                  ))}
                </select>
                <button
                  data-testid="buy-product"
                  type="button"
                  onClick={() => buy(product)}
                  disabled={busy != null || !checkoutAvailable}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-dark disabled:opacity-40"
                >
                  Buy inside TKO <ChevronRight size={16} />
                </button>
                {unavailableCopy && (
                  <p data-testid="checkout-unavailable" className="mt-2 text-xs leading-5 text-kunai">
                    {unavailableCopy}
                  </p>
                )}
              </div>
            </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CheckoutPanel({
  checkout,
  onClose,
  onRun,
}: {
  checkout: NonNullable<CheckoutState>
  onClose: () => void
  onRun: (label: string, action: () => Promise<string | null>) => Promise<void>
}) {
  // Do not load Stripe.js just because someone visits the Physical Forge.
  // In simulate mode there must be zero provider network traffic; in live mode
  // Stripe loads only when the buyer actually opens an embedded checkout.
  const stripePromise = useMemo(
    () => (!checkout.simulated && stripeKey ? loadStripe(stripeKey) : null),
    [checkout.simulated],
  )
  return (
    <section
      className="fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-black/75 p-4 pt-[8vh] backdrop-blur-sm"
      data-testid="checkout-panel"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-accent/30 bg-dark-card p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">TKO secure checkout</h2>
          <p className="mt-1 text-xs text-gray-400">
            {checkout.simulated ? 'No card, charge, provider order, or shipment will be created.' : 'Powered by Stripe inside TKO.'}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-gray-500 hover:text-white">Close</button>
      </div>
      {checkout.simulated ? (
        <button
          data-testid="simulate-paid"
          type="button"
          onClick={() => onRun('simulate-paid', async () => {
            const result = await simulatePhysicalPayment(checkout.orderId)
            if (!result.ok) return result.error || 'Dry-run payment failed.'
            onClose()
            return 'Dry-run paid: Shopify mirror and provider draft were created exactly once.'
          })}
          className="mt-4 rounded-lg bg-leaf px-4 py-3 text-sm font-semibold text-dark"
        >
          Complete safe dry-run payment
        </button>
      ) : checkout.clientSecret && stripePromise ? (
        <div className="mt-4 overflow-hidden rounded-lg bg-white p-3">
          <EmbeddedCheckoutProvider stripe={stripePromise} options={{ clientSecret: checkout.clientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-kunai/30 bg-kunai/10 p-3 text-sm text-kunai">
          Stripe is enabled but the publishable key or Checkout client secret is missing.
        </div>
      )}
      </div>
    </section>
  )
}

function HostControls({
  queue,
  orders,
  busy,
  onRun,
}: {
  queue: PhysicalProduct[]
  orders: PhysicalOrder[]
  busy: string | null
  onRun: (label: string, action: () => Promise<string | null>) => Promise<void>
}) {
  const shippable = orders.filter((order) => ['provider_draft', 'fulfillment_held', 'submitted', 'in_production'].includes(order.status))
  return (
    <section className="rounded-xl border border-chakra/25 bg-dark-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-white">
            <ShieldCheck size={18} className="text-chakra" /> Host operations
          </h2>
          <p className="mt-1 text-xs text-gray-400">Review rights, print quality, draft fulfillment, and payout holds.</p>
        </div>
        <button
          data-testid="release-payouts"
          type="button"
          onClick={() => onRun('payouts', async () => {
            const result = await releasePhysicalPayouts()
            if (!result.ok || !result.data) return result.error || 'Payout release failed.'
            return `${result.data.transferred} creator payout${result.data.transferred === 1 ? '' : 's'} released.`
          })}
          disabled={busy != null}
          className="rounded-lg border border-leaf/40 bg-leaf/10 px-3 py-2 text-xs font-semibold text-leaf disabled:opacity-40"
        >
          Release eligible payouts
        </button>
      </div>

      <div data-testid="review-queue" className="mt-4 grid gap-3 md:grid-cols-2">
        {queue.map((product) => (
          <div key={product.id} className="flex gap-3 rounded-lg border border-dark-border bg-dark p-3">
            <img src={product.artwork_url} alt="" className="h-16 w-16 rounded object-contain" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-white">{product.title}</div>
              <div className="text-xs text-gray-500">{product.seller_username || 'Creator'} · {money(product.sale_price_cents)}</div>
              <div className="mt-2 flex gap-2">
                <button
                  data-testid="approve-product"
                  type="button"
                  onClick={() => onRun(`approve:${product.id}`, async () => {
                    const result = await reviewPhysicalProduct(product.id, 'approve')
                    return result.ok ? 'Approved and mirrored as an unpublished Shopify draft.' : result.error
                  })}
                  disabled={busy != null}
                  className="rounded bg-leaf/15 px-2.5 py-1.5 text-xs font-semibold text-leaf"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => onRun(`reject:${product.id}`, async () => {
                    const result = await reviewPhysicalProduct(product.id, 'reject')
                    return result.ok ? 'Submission rejected.' : result.error
                  })}
                  disabled={busy != null}
                  className="rounded bg-kunai/10 px-2.5 py-1.5 text-xs text-kunai"
                >
                  Reject
                </button>
              </div>
            </div>
          </div>
        ))}
        {!queue.length && <p className="text-sm text-gray-500">No shirts waiting for review.</p>}
      </div>

      {shippable.map((order) => (
        <div
          data-testid="host-order"
          key={order.id}
          className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-dark-border bg-dark p-3"
        >
          <PackageCheck size={18} className="text-chakra" />
          <span className="min-w-0 flex-1 truncate text-sm text-white">{order.product_title} · draft held</span>
          <button
            data-testid="simulate-shipped"
            type="button"
            onClick={() => onRun(`ship:${order.id}`, async () => {
              const result = await simulatePhysicalShipment(order.id)
              return result.ok ? 'Dry-run shipment recorded. Payout is now eligible after the hold.' : result.error
            })}
            className="rounded bg-chakra/15 px-3 py-1.5 text-xs font-semibold text-chakra"
          >
            Simulate shipment
          </button>
          <button
            data-testid="simulate-refund"
            type="button"
            onClick={() => onRun(`refund:${order.id}`, async () => {
              const result = await simulatePhysicalRefund(order.id)
              return result.ok ? 'Dry-run refund recorded and unpaid earnings reversed.' : result.error
            })}
            className="rounded bg-kunai/10 px-3 py-1.5 text-xs text-kunai"
          >
            Simulate refund
          </button>
        </div>
      ))}
    </section>
  )
}

function Orders({ orders }: { orders: PhysicalOrder[] }) {
  const unique = useMemo(() => {
    const map = new Map<string, PhysicalOrder>()
    for (const order of orders) map.set(order.id, order)
    return Array.from(map.values())
  }, [orders])
  return (
    <section className="rounded-xl border border-dark-border bg-dark-card p-5">
      <h2 className="flex items-center gap-2 font-semibold text-white">
        <Truck size={18} className="text-accent" /> Order timeline
      </h2>
      <div className="mt-4 space-y-3">
        {unique.map((order) => {
          const index = Math.max(0, STATUS_STEPS.indexOf(order.status))
          return (
            <article data-testid="order-card" key={order.id} className="rounded-lg border border-dark-border bg-dark p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold text-white">{order.product_title || 'TKO Forge shirt'}</div>
                  <div className="mt-1 text-xs text-gray-500">{order.color} · {order.size} · order {order.id.slice(0, 8)}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-bold text-accent">{money(order.total_cents)}</div>
                  <div className="text-xs text-gray-500">{order.status.replace(/_/g, ' ')}</div>
                </div>
              </div>
              <div className="mt-4 flex gap-1">
                {STATUS_STEPS.map((step, stepIndex) => (
                  <div key={step} title={step} className={`h-1.5 flex-1 rounded ${stepIndex <= index ? 'bg-accent' : 'bg-dark-border'}`} />
                ))}
              </div>
              {order.tracking_url && (
                <a href={order.tracking_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-trust">
                  Track package <ExternalLink size={12} />
                </a>
              )}
              {order.stripe_transfer_id && (
                <div className="mt-3 flex items-center gap-1 text-xs text-leaf"><Check size={13} /> Creator payout released</div>
              )}
            </article>
          )
        })}
        {!unique.length && <p className="text-sm text-gray-500">No physical orders yet.</p>}
      </div>
    </section>
  )
}
