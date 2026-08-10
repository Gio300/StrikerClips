import { apiUrl } from './apiBase'
import { backend } from './backend'
import type { AssetKind, SellerType } from './assets'
import type { CreatorSellerTier } from './creatorCommerce'

export type CreatorCommerceConfig = {
  configured: boolean
  price_cents: number[]
  minimum_seller_tier: 'pro'
  cash: {
    seller_percent_by_tier: Record<CreatorSellerTier, number>
    platform_percent_by_tier: Record<CreatorSellerTier, number>
  }
  paid_sweeps: {
    discount_percent: number
    seller_percent_of_discounted_price_by_tier: Record<CreatorSellerTier, number>
    free_give_points_eligible: false
  }
  seller_costs: {
    seller_percent: 100
    active_account_fee_cents: number
    categories: Array<'payment_processing' | 'payout_processing' | 'active_account' | 'tax_reporting'>
    excludes_income_tax: true
  }
  tax_consent_version: string
}

export type CreatorListingInput = {
  name: string
  team_name: string
  image_url: string
  kind: AssetKind
  seller_type: Exclude<SellerType, 'official'>
  clan_id?: string | null
  price_cents: number
  cash_enabled: boolean
  paid_sweeps_enabled: boolean
}

export type CreatorCheckoutItem = {
  asset_id?: string
  offer_id?: string
  recipient_id?: string
  idempotency_key: string
}

type ApiResult<T> = {
  ok: boolean
  data: T | null
  error: string | null
  status: number
}

/** Convert API/debug codes into a useful player-facing recovery message. */
export function creatorCommerceError(
  error: string | null | undefined,
  fallback = 'Payout services are unavailable right now. Try again later.',
): string {
  const value = String(error ?? '').trim()
  if (!value) return fallback
  if (value === 'stripe_not_configured') {
    return 'Creator payouts are not available yet. You can still use the rest of your account.'
  }
  if (/failed to fetch|network error|load failed/i.test(value)) {
    return 'We could not reach payout services. Check your connection and try again.'
  }
  if (/^(unauthorized|invalid_token|auth_required)$/i.test(value)) {
    return 'Sign in again to manage creator payouts.'
  }
  // Never put an internal snake_case code in front of a player.
  if (/^[a-z0-9_]+$/i.test(value)) return fallback
  return value
}

async function accessToken(): Promise<string | null> {
  const client = await backend()
  if (!client?.auth?.getSession) return null
  const result = await client.auth.getSession()
  return result?.data?.session?.access_token ?? null
}

export async function creatorApi<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: Record<string, unknown>; auth?: boolean } = {},
): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.auth !== false) {
    const token = await accessToken()
    if (!token) return { ok: false, data: null, error: 'Sign in to continue.', status: 401 }
    headers.Authorization = `Bearer ${token}`
  }
  try {
    const response = await fetch(apiUrl(path), {
      method: options.method ?? 'GET',
      headers,
      body: options.body == null ? undefined : JSON.stringify(options.body),
    })
    const text = await response.text()
    let data: unknown = null
    if (text) {
      try { data = JSON.parse(text) } catch { data = text }
    }
    if (!response.ok) {
      const payload = data as { error?: unknown; detail?: unknown } | null
      const error = String(payload?.detail || payload?.error || response.statusText || 'Request failed')
      return { ok: false, data: data as T, error, status: response.status }
    }
    return { ok: true, data: data as T, error: null, status: response.status }
  } catch (error) {
    return {
      ok: false,
      data: null,
      error: error instanceof Error ? error.message : 'Network error',
      status: 0,
    }
  }
}

export function fetchCreatorConfig(): Promise<ApiResult<CreatorCommerceConfig>> {
  return creatorApi('/creator/config', { auth: false })
}

export function createCreatorListing(input: CreatorListingInput) {
  return creatorApi<{ listing: Record<string, unknown> }>('/creator/listings', {
    method: 'POST',
    body: input,
  })
}

export function startCreatorCashCheckout(input: CreatorCheckoutItem) {
  return creatorApi<{ url: string; sessionId: string; orderId: string }>('/creator/checkout', {
    method: 'POST',
    body: input,
  })
}

export function buyCreatorItemWithPaidSweeps(input: CreatorCheckoutItem) {
  return creatorApi<{
    ok: boolean
    wallet: { tokens: number; sweeps: number; paid_sweeps_cents: number }
    order: Record<string, unknown>
  }>('/creator/buy-with-sweeps', {
    method: 'POST',
    body: input,
  })
}

export function startPaidSweepsCheckout(amountCents: number) {
  return creatorApi<{ url: string; sessionId: string }>('/creator/credits/checkout', {
    method: 'POST',
    body: {
      amount_cents: amountCents,
      idempotency_key: crypto.randomUUID(),
    },
  })
}

export function fetchConnectStatus() {
  return creatorApi<{
    connected: boolean
    ready: boolean
    seller_eligible?: boolean
    minimum_tier?: 'pro'
    seller_tier?: CreatorSellerTier
    seller_share_percent?: number
    charges_enabled?: boolean
    payouts_enabled?: boolean
    transfers_enabled?: boolean
    tax_certified?: boolean
    tax_form_type?: 'w9' | 'w8' | null
    electronic_1099_consent?: boolean
    tax_consent_version?: string
    platform_fee_debit_consent?: boolean
    platform_fee_debit_consent_version?: string
  }>('/connect/status')
}

export function startConnectOnboarding() {
  return creatorApi<{ url: string }>('/connect/onboard', { method: 'POST', body: {} })
}

export function certifyCreatorTaxProfile(taxFormType: 'w9' | 'w8') {
  return creatorApi<{
    ok: boolean
    tax_certified: true
    electronic_1099_consent: true
    tax_form_type: 'w9' | 'w8'
    tax_consent_version: string
    platform_fee_debit_consent: true
    platform_fee_debit_consent_version: string
  }>('/connect/tax-consent', {
    method: 'POST',
    body: {
      tax_certified: true,
      electronic_1099_consent: true,
      platform_fee_debit_consent: true,
      tax_form_type: taxFormType,
    },
  })
}

export function fetchCreatorEarnings() {
  return creatorApi<{ earnings: Array<Record<string, unknown>> }>('/creator/earnings')
}

export type CreatorPlatformFee = {
  id: string
  fee_type: 'active_account' | 'payment_processing' | 'payout_processing' | 'tax_reporting'
  period_key: string
  total_fee_cents: number
  seller_fee_cents: number
  platform_fee_cents: number
  status: 'pending' | 'collected' | 'failed' | 'sponsored'
  error?: string | null
  created_at: string
}

export function fetchCreatorFees() {
  return creatorApi<{ fees: CreatorPlatformFee[] }>('/creator/fees')
}

export function retryCreatorFees() {
  return creatorApi<{
    ok: boolean
    attempted: number
    collected: number
    fees: CreatorPlatformFee[]
  }>('/creator/fees/retry', { method: 'POST', body: {} })
}
