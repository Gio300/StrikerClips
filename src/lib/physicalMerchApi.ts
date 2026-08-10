import { creatorApi } from './creatorCommerceApi'

export type PhysicalMerchConfig = {
  mode: 'simulate' | 'test' | 'live'
  simulated: boolean
  stripe_checkout_ready: boolean
  shopify_bridge_ready: boolean
  print_provider_ready: boolean
  fulfillment_confirmation_enabled: boolean
  creator_transfers_enabled: boolean
  sizes: string[]
  colors: string[]
  price_range_cents: [number, number]
}

export type PhysicalVariant = {
  id: string
  physical_product_id: string
  size: string
  color: string
  sku: string
  active: boolean
}

export type PhysicalProduct = {
  id: string
  artifact_id: string
  seller_user_id: string
  seller_username?: string
  title: string
  description: string
  artwork_url: string
  status: 'pending_review' | 'approved' | 'active' | 'rejected' | 'error'
  sale_price_cents: number
  creator_share_percent?: number
  shopify_product_gid?: string | null
  variants: PhysicalVariant[]
  last_error?: string | null
}

export type PhysicalOrder = {
  id: string
  buyer_id: string
  seller_user_id: string
  product_title: string
  artwork_url: string
  size: string
  color: string
  quantity: number
  total_cents: number
  status: string
  dry_run: boolean
  shopify_order_gid?: string | null
  provider_order_id?: string | null
  tracking_number?: string | null
  tracking_url?: string | null
  earning_status?: string | null
  available_at?: string | null
  stripe_transfer_id?: string | null
}

export type DesignSuggestion = {
  title: string
  description: string
  color: string
  placement: string
  print_width_px: number
  print_height_px: number
  transparent_background: boolean
  recommendations: string[]
}

export function fetchPhysicalConfig() {
  return creatorApi<PhysicalMerchConfig>('/physical/config', { auth: false })
}

export function assistPhysicalDesign(prompt: string, artifactName: string) {
  return creatorApi<{ provider: string; generated: DesignSuggestion }>('/physical/design-assist', {
    method: 'POST',
    body: { prompt, artifact_name: artifactName },
  })
}

export function fetchPhysicalProducts(mine = false) {
  return creatorApi<{ products: PhysicalProduct[] }>(`/physical/products${mine ? '?mine=1' : ''}`)
}

export function fetchPhysicalReviewQueue() {
  return creatorApi<{ products: PhysicalProduct[] }>('/physical/review-queue')
}

export function createPhysicalProduct(input: {
  artifact_id: string
  title: string
  description: string
  artwork_url: string
  sale_price_cents: number
  print_width_px: number
  print_height_px: number
  placement: string
  transparent_background: boolean
  colors: string[]
  ip_attested: boolean
  ai_brief?: Record<string, unknown>
}) {
  return creatorApi<{ product: PhysicalProduct }>('/physical/products', {
    method: 'POST',
    body: input,
  })
}

export function reviewPhysicalProduct(productId: string, decision: 'approve' | 'reject') {
  return creatorApi<{ product: PhysicalProduct; shopify: Record<string, unknown> }>(
    `/physical/products/${encodeURIComponent(productId)}/review`,
    { method: 'POST', body: { decision } },
  )
}

export function startPhysicalCheckout(input: {
  product_id: string
  variant_id: string
  quantity: number
  idempotency_key: string
}) {
  return creatorApi<{
    orderId: string
    sessionId: string
    clientSecret: string | null
    simulated: boolean
    totalCents: number
    reused?: boolean
  }>('/physical/checkout', { method: 'POST', body: input })
}

export function simulatePhysicalPayment(orderId: string) {
  return creatorApi<{ order: PhysicalOrder; simulated: true }>(
    `/physical/orders/${encodeURIComponent(orderId)}/simulate-paid`,
    { method: 'POST', body: {} },
  )
}

export function simulatePhysicalShipment(orderId: string) {
  return creatorApi<{ order: PhysicalOrder; payout_available_at: string }>(
    `/physical/orders/${encodeURIComponent(orderId)}/simulate-shipped`,
    { method: 'POST', body: {} },
  )
}

export function simulatePhysicalRefund(orderId: string) {
  return creatorApi<{ order: PhysicalOrder }>(
    `/physical/orders/${encodeURIComponent(orderId)}/simulate-refund`,
    { method: 'POST', body: {} },
  )
}

export function fetchPhysicalOrders() {
  return creatorApi<{ orders: PhysicalOrder[] }>('/physical/orders')
}

export function releasePhysicalPayouts() {
  return creatorApi<{
    ok: true
    eligible: number
    transferred: number
    results: Array<Record<string, unknown>>
  }>('/physical/payouts/release', { method: 'POST', body: {} })
}
