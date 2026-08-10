import { createHash, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express'
import { physicalMerchSplit, TSHIRT_SIZES } from '../src/lib/physicalMerch'

type QueryResult = { rows: any[]; rowCount?: number | null }
export type MerchDb = {
  query: (sql: string, params?: any[]) => Promise<QueryResult>
}

type StripeResult = { ok: boolean; status: number; json: any }
type StripeFetch = (
  path: string,
  params?: URLSearchParams,
  method?: 'GET' | 'POST',
  connectedAccountId?: string,
) => Promise<StripeResult>

type MerchDeps = {
  pool: MerchDb
  auth: RequestHandler
  uid: (req: Request) => string
  withTransaction: <T>(fn: (db: MerchDb) => Promise<T>) => Promise<T>
  stripeFetch: StripeFetch
  stripeConfigured: () => boolean
  ensureCustomer: (userId: string, email: string) => Promise<string>
  appUrl: () => string
  designAssistant?: (prompt: string, artifactName: string) => Promise<Record<string, unknown>>
}

export type MerchMode = 'simulate' | 'test' | 'live'
type ExternalProvider = 'stripe' | 'shopify' | 'printful' | 'transfers' | 'fulfillment'

const PRODUCT_MIN_CENTS = 2_500
const PRODUCT_MAX_CENTS = 15_000
const DEFAULT_MANUFACTURING_CENTS = 1_200
const DEFAULT_PROVIDER_SHIPPING_CENTS = 499
const DEFAULT_PAYMENT_FEE_CENTS = 150
const DEFAULT_REFUND_RESERVE_CENTS = 200
const DEFAULT_BUYER_SHIPPING_CENTS = 499
const MAX_QUANTITY = 5
const COLORS = ['Black', 'White'] as const

const providerFlag: Record<ExternalProvider, string> = {
  stripe: 'MERCH_ALLOW_STRIPE_CHECKOUT',
  shopify: 'MERCH_ALLOW_SHOPIFY_WRITES',
  printful: 'MERCH_ALLOW_PRINTFUL_DRAFTS',
  transfers: 'MERCH_ALLOW_STRIPE_TRANSFERS',
  fulfillment: 'MERCH_ALLOW_FULFILLMENT_CONFIRM',
}

export function physicalMerchMode(): MerchMode {
  const value = String(process.env.MERCH_MODE || 'simulate').toLowerCase()
  return value === 'test' || value === 'live' ? value : 'simulate'
}

export function physicalMerchExternalWriteAllowed(provider: ExternalProvider): boolean {
  if (physicalMerchMode() === 'simulate') return false
  return process.env[providerFlag[provider]] === '1'
}

const safeJson = (value: unknown): any => {
  if (value == null) return {}
  if (typeof value === 'string') {
    try { return JSON.parse(value) } catch { return {} }
  }
  return value
}

const cleanText = (value: unknown, max = 160): string =>
  String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max)

const safeInt = (value: unknown, fallback = 0): number => {
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : fallback
}

const hashId = (prefix: string, value: string): string =>
  `${prefix}_${createHash('sha256').update(value).digest('hex').slice(0, 24)}`

const bearerMatches = (req: Request, secret: string): boolean => {
  if (!secret) return false
  const received = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!received) return false
  const a = Buffer.from(received)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

const activeTier = (meta: any): string => {
  const tier = String(meta?.reelone_tier || '').toLowerCase()
  const expires = meta?.reelone_tier_expires ? Date.parse(String(meta.reelone_tier_expires)) : Infinity
  return Number.isFinite(expires) && expires <= Date.now() ? '' : tier
}

const creatorPercentForTier = (tier: string): number => {
  if (tier === 'creator' || tier === 'founder') return 80
  if (tier === 'supporter') return 65
  return 50
}

const allowedArtworkUrl = (url: string): boolean => {
  if (/^https:\/\//i.test(url)) return true
  if (physicalMerchMode() !== 'simulate') return false
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url)
}

const eventPayload = (value: Record<string, unknown>): Record<string, unknown> => {
  // Provider-event storage intentionally excludes customer address/email.
  const copy = { ...value }
  delete copy.shipping_address
  delete copy.shippingAddress
  delete copy.email
  return copy
}

export class PhysicalMerchService {
  private readonly deps: MerchDeps

  constructor(deps: MerchDeps) {
    this.deps = deps
  }

  register(api: Router): void {
    const { auth } = this.deps

    api.get('/physical/config', (_req, res) => {
      const mode = physicalMerchMode()
      res.json({
        mode,
        simulated: mode === 'simulate',
        stripe_checkout_ready: mode === 'simulate'
          || (this.deps.stripeConfigured() && physicalMerchExternalWriteAllowed('stripe')),
        shopify_bridge_ready: mode === 'simulate'
          || (
            physicalMerchExternalWriteAllowed('shopify')
            && !!process.env.SHOPIFY_BRIDGE_URL
            && !!process.env.TKO_SHOPIFY_BRIDGE_SECRET
          ),
        print_provider_ready: mode === 'simulate'
          || (
            physicalMerchExternalWriteAllowed('printful')
            && !!process.env.PRINTFUL_ACCESS_TOKEN
          ),
        fulfillment_confirmation_enabled: physicalMerchExternalWriteAllowed('fulfillment'),
        creator_transfers_enabled: physicalMerchExternalWriteAllowed('transfers'),
        sizes: TSHIRT_SIZES,
        colors: COLORS,
        price_range_cents: [PRODUCT_MIN_CENTS, PRODUCT_MAX_CENTS],
      })
    })

    api.post('/physical/design-assist', auth, async (req, res) => {
      const prompt = cleanText(req.body?.prompt, 500)
      const artifactName = cleanText(req.body?.artifact_name, 80) || 'Forged Artifact'
      if (prompt.length < 8) return res.status(400).json({ error: 'describe_the_design' })
      const lower = `${prompt} ${artifactName}`.toLowerCase()
      const fallback = {
        title: cleanText(
          `${artifactName} ${lower.includes('limited') ? 'Limited ' : ''}Forge Tee`,
          80,
        ),
        description: `A creator-forged TKO shirt built from ${artifactName}.`,
        color: lower.includes('light') || lower.includes('white') ? 'White' : 'Black',
        placement: lower.includes('back') ? 'back-center' : 'front-center',
        print_width_px: 4500,
        print_height_px: 5400,
        transparent_background: true,
        recommendations: [
          'Keep important marks inside the center 80% safe area.',
          'Use an original or licensed design only.',
          'Review the provider mockup before publishing.',
        ],
      }
      if (
        physicalMerchMode() !== 'simulate'
        && process.env.MERCH_ALLOW_AI_DESIGN === '1'
        && this.deps.designAssistant
      ) {
        try {
          const generated = await this.deps.designAssistant(prompt, artifactName)
          return res.json({
            provider: 'vertex-merch-design-v1',
            generated: {
              ...fallback,
              title: cleanText(generated.title || fallback.title, 80),
              description: cleanText(generated.description || fallback.description, 400),
              color: generated.color === 'White' ? 'White' : 'Black',
              placement: generated.placement === 'back-center' ? 'back-center' : 'front-center',
              recommendations: Array.isArray(generated.recommendations)
                ? generated.recommendations.slice(0, 5).map((item) => cleanText(item, 180))
                : fallback.recommendations,
            },
          })
        } catch {
          // Design advice can safely degrade; commerce and rights review cannot.
        }
      }
      return res.json({ provider: 'tko-merch-design-simulated-v1', generated: fallback })
    })

    api.get('/physical/products', auth, async (req, res) => {
      const userId = this.deps.uid(req)
      const host = await this.isHost(userId)
      const mine = String(req.query.mine || '') === '1'
      const rows = mine
        ? await this.deps.pool.query(
            `select p.*
               from physical_merch_products p
              where p.seller_user_id=$1
              order by p.created_at desc`,
            [userId],
          )
        : await this.deps.pool.query(
            `select p.*
               from physical_merch_products p
              where p.status in ('approved','active') ${host ? "or p.status='pending_review'" : ''}
              order by p.created_at desc`,
          )
      const products = await this.attachVariants(rows.rows)
      res.json({ products: products.map((row) => this.publicProduct(row, userId, host)) })
    })

    api.get('/physical/review-queue', auth, async (req, res) => {
      if (!(await this.isHost(this.deps.uid(req)))) return res.status(403).json({ error: 'host_required' })
      const rows = await this.deps.pool.query(
        `select p.*, pr.username seller_username
           from physical_merch_products p
           join profiles pr on pr.id=p.seller_user_id
          where p.status='pending_review'
          order by p.created_at`,
      )
      res.json({ products: await this.attachVariants(rows.rows) })
    })

    api.post('/physical/products', auth, async (req, res) => {
      try {
        const product = await this.createProduct(req)
        return res.status(201).json({ product })
      } catch (error: any) {
        const status = safeInt(error?.status, 400)
        return res.status(status).json({ error: error?.code || 'product_create_failed', detail: error?.message })
      }
    })

    api.post('/physical/products/:id/review', auth, async (req, res) => {
      const reviewerId = this.deps.uid(req)
      if (!(await this.isHost(reviewerId))) return res.status(403).json({ error: 'host_required' })
      const decision = String(req.body?.decision || '')
      if (decision !== 'approve' && decision !== 'reject') {
        return res.status(400).json({ error: 'decision_must_be_approve_or_reject' })
      }
      const id = String(req.params.id)
      const row = await this.deps.pool.query(
        `update physical_merch_products
            set status=$2, approved_by=$3,
                approved_at=case when $2='approved' then now() else approved_at end,
                last_error=null, updated_at=now()
          where id=$1 and status in ('pending_review','error')
          returning *`,
        [id, decision === 'approve' ? 'approved' : 'rejected', reviewerId],
      )
      if (!row.rows[0]) return res.status(404).json({ error: 'reviewable_product_not_found' })
      let sync: any = null
      if (decision === 'approve') sync = await this.syncProductDraft(row.rows[0])
      const refreshed = await this.productById(id)
      return res.json({ product: refreshed, shopify: sync })
    })

    api.post('/physical/products/:id/sync', auth, async (req, res) => {
      const actorId = this.deps.uid(req)
      if (!(await this.isHost(actorId))) return res.status(403).json({ error: 'host_required' })
      const product = await this.productById(String(req.params.id))
      if (!product || !['approved', 'active', 'error'].includes(String(product.status))) {
        return res.status(404).json({ error: 'approved_product_not_found' })
      }
      const sync = await this.syncProductDraft(product)
      res.json({ product: await this.productById(String(req.params.id)), shopify: sync })
    })

    api.post('/physical/checkout', auth, async (req, res) => {
      try {
        const result = await this.createCheckout(req)
        return res.status(201).json(result)
      } catch (error: any) {
        return res.status(safeInt(error?.status, 400)).json({
          error: error?.code || 'checkout_failed',
          detail: error?.message,
        })
      }
    })

    api.post('/physical/orders/:id/simulate-paid', auth, async (req, res) => {
      if (physicalMerchMode() !== 'simulate') return res.status(404).json({ error: 'not_found' })
      const userId = this.deps.uid(req)
      const order = await this.orderById(String(req.params.id))
      if (!order || String(order.buyer_id) !== userId) return res.status(404).json({ error: 'order_not_found' })
      const settled = await this.settlePaidOrder(order, {
        sessionId: String(order.stripe_checkout_session_id || hashId('cs_sim', String(order.id))),
        paymentIntentId: hashId('pi_sim', String(order.id)),
        chargeId: hashId('ch_sim', String(order.id)),
        amountTotal: Number(order.total_cents),
        taxCents: 0,
        shipping: {
          name: cleanText(req.body?.shipping_name, 100) || 'TKO Test Buyer',
          email: cleanText(req.body?.shipping_email, 120) || 'buyer@example.test',
          address: {
            line1: cleanText(req.body?.line1, 120) || '100 Test Arena',
            city: cleanText(req.body?.city, 80) || 'Phoenix',
            state: cleanText(req.body?.state, 40) || 'AZ',
            postal_code: cleanText(req.body?.postal_code, 24) || '85001',
            country: cleanText(req.body?.country, 2).toUpperCase() || 'US',
          },
        },
      })
      res.json({ order: settled, simulated: true })
    })

    api.post('/physical/orders/:id/simulate-shipped', auth, async (req, res) => {
      if (physicalMerchMode() !== 'simulate') return res.status(404).json({ error: 'not_found' })
      if (!(await this.isHost(this.deps.uid(req)))) return res.status(403).json({ error: 'host_required' })
      const holdDays = Math.max(0, Math.min(90, safeInt(process.env.MERCH_PAYOUT_HOLD_DAYS, 14)))
      const availableAt = new Date(Date.now() + holdDays * 86_400_000).toISOString()
      const order = await this.deps.withTransaction(async (db) => {
        const updated = await db.query(
          `update physical_merch_orders
              set status='shipped', provider_status='shipped', shipped_at=now(),
                  tracking_company='TKO Simulated Carrier',
                  tracking_number=$2, tracking_url=$3, updated_at=now()
            where id=$1 and status in ('provider_draft','fulfillment_held','submitted','in_production')
            returning *`,
          [
            String(req.params.id),
            hashId('TRACK', String(req.params.id)).slice(0, 24).toUpperCase(),
            `https://tracking.example.test/${encodeURIComponent(String(req.params.id))}`,
          ],
        )
        if (!updated.rows[0]) return null
        await db.query(
          `update physical_merch_earnings
              set status='held', available_at=$2, updated_at=now()
            where order_item_id in (
              select id from physical_merch_order_items where order_id=$1
            ) and status='held'`,
          [String(req.params.id), availableAt],
        )
        return updated.rows[0]
      })
      if (!order) return res.status(409).json({ error: 'order_not_shippable' })
      res.json({ order, payout_available_at: availableAt })
    })

    api.post('/physical/orders/:id/simulate-refund', auth, async (req, res) => {
      if (physicalMerchMode() !== 'simulate') return res.status(404).json({ error: 'not_found' })
      if (!(await this.isHost(this.deps.uid(req)))) return res.status(403).json({ error: 'host_required' })
      const order = await this.refundOrder(String(req.params.id), `sim-refund:${req.params.id}`, undefined)
      if (!order) return res.status(404).json({ error: 'order_not_found' })
      res.json({ order })
    })

    api.get('/physical/orders', auth, async (req, res) => {
      const userId = this.deps.uid(req)
      const host = await this.isHost(userId)
      const rows = await this.deps.pool.query(
        `select o.*, i.seller_user_id, i.quantity, i.unit_price_cents,
                p.title product_title, p.artwork_url, v.size, v.color,
                e.status earning_status, e.available_at, e.stripe_transfer_id
           from physical_merch_orders o
           join physical_merch_order_items i on i.order_id=o.id
           join physical_merch_products p on p.id=i.physical_product_id
           join physical_merch_variants v on v.id=i.variant_id
           left join physical_merch_earnings e on e.order_item_id=i.id
          where o.buyer_id=$1 or i.seller_user_id=$1 ${host ? 'or true' : ''}
          order by o.created_at desc`,
        [userId],
      )
      res.json({ orders: rows.rows.map((row) => this.safeOrder(row, userId, host)) })
    })

    api.get('/physical/orders/:id', auth, async (req, res) => {
      const userId = this.deps.uid(req)
      const host = await this.isHost(userId)
      const row = await this.deps.pool.query(
        `select o.*, i.seller_user_id, i.quantity, i.unit_price_cents,
                p.title product_title, p.artwork_url, v.size, v.color,
                e.status earning_status, e.available_at, e.stripe_transfer_id
           from physical_merch_orders o
           join physical_merch_order_items i on i.order_id=o.id
           join physical_merch_products p on p.id=i.physical_product_id
           join physical_merch_variants v on v.id=i.variant_id
           left join physical_merch_earnings e on e.order_item_id=i.id
          where o.id=$1`,
        [String(req.params.id)],
      )
      const order = row.rows[0]
      if (!order || (!host && String(order.buyer_id) !== userId && String(order.seller_user_id) !== userId)) {
        return res.status(404).json({ error: 'order_not_found' })
      }
      res.json({ order: this.safeOrder(order, userId, host) })
    })

    api.post('/physical/payouts/release', auth, async (req, res) => {
      if (!(await this.isHost(this.deps.uid(req)))) return res.status(403).json({ error: 'host_required' })
      const result = await this.releasePayouts()
      res.json(result)
    })

    api.post('/physical/webhooks/shopify', async (req, res) => {
      const secret = String(process.env.TKO_SHOPIFY_BRIDGE_SECRET || '')
      if (!bearerMatches(req, secret)) return res.status(401).json({ error: 'invalid_bridge_secret' })
      const providerId = cleanText(req.body?.webhookId, 200)
      if (!providerId) return res.status(400).json({ error: 'webhook_id_required' })
      const duplicate = !(await this.claimProviderEvent(
        'shopify',
        providerId,
        cleanText(req.body?.topic, 120),
        null,
        eventPayload(req.body || {}),
      ))
      res.json({ received: true, duplicate })
    })

    api.post('/physical/webhooks/printful', async (req, res) => {
      const secret = String(process.env.PRINTFUL_WEBHOOK_SECRET || '')
      if (!bearerMatches(req, secret)) return res.status(401).json({ error: 'invalid_provider_secret' })
      const type = cleanText(req.body?.type, 120)
      const externalId = cleanText(
        req.body?.data?.order?.external_id || req.body?.data?.order?.id || req.body?.data?.shipment?.id,
        160,
      )
      const providerId = cleanText(req.body?.id, 200) || hashId('pf_evt', JSON.stringify(req.body || {}))
      const orderId = externalId.replace(/^tko_/, '')
      const duplicate = !(await this.claimProviderEvent(
        'printful',
        providerId,
        type,
        orderId || null,
        eventPayload(req.body || {}),
      ))
      if (!duplicate && orderId && (type === 'package_shipped' || type === 'shipment_sent')) {
        const tracking = req.body?.data?.shipment || req.body?.data || {}
        const holdDays = Math.max(0, Math.min(90, safeInt(process.env.MERCH_PAYOUT_HOLD_DAYS, 14)))
        await this.deps.withTransaction(async (db) => {
          await db.query(
            `update physical_merch_orders
                set status='shipped', provider_status=$2, shipped_at=now(),
                    tracking_company=$3, tracking_number=$4, tracking_url=$5, updated_at=now()
              where id=$1`,
            [
              orderId,
              type,
              cleanText(tracking.carrier, 80) || null,
              cleanText(tracking.tracking_number, 120) || null,
              cleanText(tracking.tracking_url, 500) || null,
            ],
          )
          await db.query(
            `update physical_merch_earnings set available_at=$2, updated_at=now()
              where order_item_id in (select id from physical_merch_order_items where order_id=$1)
                and status='held'`,
            [orderId, new Date(Date.now() + holdDays * 86_400_000).toISOString()],
          )
        })
      }
      res.json({ received: true, duplicate })
    })
  }

  async handleStripeCheckout(session: any): Promise<boolean> {
    const meta = session?.metadata || {}
    if (meta.kind !== 'physical_merch' || !meta.order_id) return false
    if (session.payment_status !== 'paid') return true
    const order = await this.orderById(String(meta.order_id))
    if (!order) return true
    await this.settlePaidOrder(order, {
      sessionId: session.id ? String(session.id) : null,
      paymentIntentId: session.payment_intent ? String(session.payment_intent) : null,
      chargeId: null,
      amountTotal: safeInt(session.amount_total),
      taxCents: safeInt(session.total_details?.amount_tax),
      shipping: {
        name: cleanText(session.shipping_details?.name || session.customer_details?.name, 100),
        email: cleanText(session.customer_details?.email, 120),
        address: safeJson(session.shipping_details?.address || session.customer_details?.address),
      },
    })
    return true
  }

  async handleStripeExpired(session: any): Promise<boolean> {
    const meta = session?.metadata || {}
    if (meta.kind !== 'physical_merch' || !meta.order_id) return false
    await this.deps.pool.query(
      `update physical_merch_orders
          set status='cancelled', cancelled_at=now(), updated_at=now()
        where id=$1 and status='checkout_pending'`,
      [String(meta.order_id)],
    )
    return true
  }

  async handleStripeRefund(charge: any, eventId: string): Promise<boolean> {
    const meta = charge?.metadata || {}
    if (meta.kind !== 'physical_merch' && !meta.order_id) {
      const linked = await this.deps.pool.query(
        `select id from physical_merch_orders
          where stripe_payment_intent_id=$1 or stripe_charge_id=$2 limit 1`,
        [String(charge?.payment_intent || ''), String(charge?.id || '')],
      )
      if (!linked.rows[0]) return false
    }
    const id = meta.order_id ? String(meta.order_id) : ''
    const order = id
      ? await this.orderById(id)
      : (await this.deps.pool.query(
          `select * from physical_merch_orders
            where stripe_payment_intent_id=$1 or stripe_charge_id=$2 limit 1`,
          [String(charge?.payment_intent || ''), String(charge?.id || '')],
        )).rows[0]
    if (!order) return true
    await this.refundOrder(String(order.id), eventId, safeInt(charge?.amount_refunded, Number(order.total_cents)))
    return true
  }

  private publicProduct(row: any, userId: string, host: boolean): any {
    const seller = String(row.seller_user_id) === userId
    const out = { ...row, ai_brief: safeJson(row.ai_brief), print_specs: safeJson(row.print_specs), variants: safeJson(row.variants) }
    if (!seller && !host) {
      delete out.last_error
      delete out.manufacturing_cents
      delete out.shipping_cents
      delete out.payment_fee_cents
      delete out.refund_reserve_cents
      delete out.creator_share_percent
    }
    return out
  }

  private safeOrder(row: any, userId: string, host: boolean): any {
    const buyer = String(row.buyer_id) === userId
    const out = { ...row, shipping_address: safeJson(row.shipping_address) }
    if (!buyer && !host) {
      delete out.shipping_address
      delete out.shipping_name
      delete out.shipping_email
      delete out.stripe_customer_id
      delete out.stripe_checkout_session_id
      delete out.stripe_payment_intent_id
      delete out.stripe_charge_id
    }
    if (!host) {
      delete out.provider_cost_cents
      delete out.last_error
    }
    return out
  }

  private async createProduct(req: Request): Promise<any> {
    const userId = this.deps.uid(req)
    const artifactId = cleanText(req.body?.artifact_id, 80)
    const title = cleanText(req.body?.title, 80)
    const description = cleanText(req.body?.description, 500)
    const artworkUrl = cleanText(req.body?.artwork_url, 2_000)
    const price = safeInt(req.body?.sale_price_cents)
    const ipAttested = req.body?.ip_attested === true
    const width = safeInt(req.body?.print_width_px, 4500)
    const height = safeInt(req.body?.print_height_px, 5400)
    const colors = Array.from(new Set(
      (Array.isArray(req.body?.colors) ? req.body.colors : ['Black'])
        .map((value: unknown) => cleanText(value, 20))
        .filter((value: string) => COLORS.includes(value as (typeof COLORS)[number])),
    )).slice(0, 2)

    const fail = (status: number, code: string, message = code): never => {
      const error: any = new Error(message)
      error.status = status
      error.code = code
      throw error
    }

    if (!artifactId || !title || !artworkUrl) fail(400, 'artifact_title_and_artwork_required')
    if (!allowedArtworkUrl(artworkUrl)) fail(400, 'public_https_artwork_required')
    if (price < PRODUCT_MIN_CENTS || price > PRODUCT_MAX_CENTS) fail(400, 'price_out_of_range')
    if (!ipAttested) fail(400, 'rights_attestation_required')
    if (width < 1_800 || height < 1_800) fail(400, 'print_resolution_too_small')
    if (!colors.length) fail(400, 'supported_color_required')

    const artifact = await this.deps.pool.query(
      'select * from artifacts where id=$1 and owner_id=$2',
      [artifactId, userId],
    )
    if (!artifact.rows[0]) fail(404, 'owned_artifact_not_found')
    const account = await this.deps.pool.query('select user_metadata from users where id=$1', [userId])
    const tier = activeTier(safeJson(account.rows[0]?.user_metadata))
    if (!['pro', 'supporter', 'creator', 'founder'].includes(tier)) {
      fail(403, 'seller_membership_required', 'Physical merchandise selling starts with Pro.')
    }
    const percent = creatorPercentForTier(tier)
    const printSpecs = {
      width_px: width,
      height_px: height,
      transparent_background: req.body?.transparent_background !== false,
      placement: cleanText(req.body?.placement, 40) || 'front-center',
    }
    const aiBrief = safeJson(req.body?.ai_brief)

    return this.deps.withTransaction(async (db) => {
      const inserted = await db.query(
        `insert into physical_merch_products
           (artifact_id,seller_user_id,seller_type,clan_id,title,description,artwork_url,
            ai_brief,print_specs,status,sale_price_cents,manufacturing_cents,
            shipping_cents,payment_fee_cents,refund_reserve_cents,
            creator_share_percent,ip_attested_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending_review',$10,$11,$12,$13,$14,$15,now())
         returning *`,
        [
          artifactId,
          userId,
          req.body?.seller_type === 'clan' ? 'clan' : 'creator',
          req.body?.seller_type === 'clan' ? cleanText(req.body?.clan_id, 80) || null : null,
          title,
          description,
          artworkUrl,
          JSON.stringify(aiBrief),
          JSON.stringify(printSpecs),
          price,
          DEFAULT_MANUFACTURING_CENTS,
          DEFAULT_PROVIDER_SHIPPING_CENTS,
          DEFAULT_PAYMENT_FEE_CENTS,
          DEFAULT_REFUND_RESERVE_CENTS,
          percent,
        ],
      )
      const product = inserted.rows[0]
      for (const color of colors) {
        for (const size of TSHIRT_SIZES) {
          const sku = `TKO-${String(product.id).replace(/-/g, '').slice(0, 8)}-${color.slice(0, 2).toUpperCase()}-${size}`
          const envVariantKey = `PRINTFUL_VARIANT_${color}_${size}`.toUpperCase().replace(/[^A-Z0-9]/g, '_')
          await db.query(
            `insert into physical_merch_variants
               (physical_product_id,size,color,sku,provider_variant_id)
             values ($1,$2,$3,$4,$5)`,
            [product.id, size, color, sku, process.env[envVariantKey] || null],
          )
        }
      }
      return this.productById(String(product.id), db)
    })
  }

  private async createCheckout(req: Request): Promise<any> {
    const userId = this.deps.uid(req)
    const productId = cleanText(req.body?.product_id, 80)
    const variantId = cleanText(req.body?.variant_id, 80)
    const quantity = safeInt(req.body?.quantity, 1)
    const idempotencyKey = cleanText(req.body?.idempotency_key, 200)
    if (!productId || !variantId || !idempotencyKey) {
      throw Object.assign(new Error('product, variant and idempotency key are required'), { status: 400, code: 'invalid_checkout' })
    }
    if (quantity < 1 || quantity > MAX_QUANTITY) {
      throw Object.assign(new Error(`quantity must be 1-${MAX_QUANTITY}`), { status: 400, code: 'invalid_quantity' })
    }
    const existing = await this.deps.pool.query(
      'select * from physical_merch_orders where idempotency_key=$1',
      [idempotencyKey],
    )
    if (existing.rows[0]) return this.checkoutResponse(existing.rows[0])

    const productRows = await this.deps.pool.query(
      `select p.*, v.id variant_id, v.size, v.color, v.sku, v.provider_variant_id
         from physical_merch_products p
         join physical_merch_variants v on v.physical_product_id=p.id
        where p.id=$1 and v.id=$2 and v.active=true and p.status in ('approved','active')`,
      [productId, variantId],
    )
    const product = productRows.rows[0]
    if (!product) throw Object.assign(new Error('approved product or variant not found'), { status: 404, code: 'product_not_available' })

    const itemSubtotal = Number(product.sale_price_cents) * quantity
    const shippingCharge = DEFAULT_BUYER_SHIPPING_CENTS
    const total = itemSubtotal + shippingCharge
    const split = physicalMerchSplit({
      salePriceCents: Number(product.sale_price_cents),
      manufacturingCents: Number(product.manufacturing_cents),
      shippingCents: Number(product.shipping_cents),
      paymentFeeCents: Number(product.payment_fee_cents),
      refundReserveCents: Number(product.refund_reserve_cents),
    }, Number(product.creator_share_percent))
    const mode = physicalMerchMode()
    const order = await this.deps.withTransaction(async (db) => {
      const inserted = await db.query(
        `insert into physical_merch_orders
           (buyer_id,status,item_subtotal_cents,shipping_charge_cents,total_cents,
            stripe_customer_id,idempotency_key,dry_run)
         values ($1,'checkout_pending',$2,$3,$4,null,$5,$6)
         returning *`,
        [userId, itemSubtotal, shippingCharge, total, idempotencyKey, mode === 'simulate'],
      )
      const row = inserted.rows[0]
      await db.query(
        `insert into physical_merch_order_items
           (order_id,physical_product_id,variant_id,seller_user_id,quantity,unit_price_cents,
            manufacturing_cents,provider_shipping_cents,payment_fee_cents,refund_reserve_cents,
            creator_share_percent,creator_share_cents,platform_share_cents)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          row.id,
          product.id,
          product.variant_id,
          product.seller_user_id,
          quantity,
          product.sale_price_cents,
          Number(product.manufacturing_cents) * quantity,
          Number(product.shipping_cents) * quantity,
          Number(product.payment_fee_cents) * quantity,
          Number(product.refund_reserve_cents) * quantity,
          product.creator_share_percent,
          split.creatorShareCents * quantity,
          split.platformShareCents * quantity,
        ],
      )
      return row
    })

    if (mode === 'simulate') {
      const sessionId = hashId('cs_sim', String(order.id))
      await this.deps.pool.query(
        'update physical_merch_orders set stripe_checkout_session_id=$2,updated_at=now() where id=$1',
        [order.id, sessionId],
      )
      return {
        orderId: order.id,
        sessionId,
        clientSecret: null,
        simulated: true,
        totalCents: total,
      }
    }
    if (!this.deps.stripeConfigured() || !physicalMerchExternalWriteAllowed('stripe')) {
      throw Object.assign(new Error('Stripe merchandise checkout is disabled until test-mode credentials and the explicit allow flag are set.'), {
        status: 503,
        code: 'external_checkout_disabled',
      })
    }
    const email = cleanText((req as any).user?.email, 120)
    const customer = await this.deps.ensureCustomer(userId, email)
    if (!customer) {
      throw Object.assign(new Error('Stripe customer creation failed.'), { status: 502, code: 'stripe_customer_failed' })
    }
    const params = new URLSearchParams()
    params.set('mode', 'payment')
    params.set('ui_mode', 'embedded')
    params.set('redirect_on_completion', 'if_required')
    params.set('return_url', `${this.deps.appUrl()}/forge/physical?checkout=return&session_id={CHECKOUT_SESSION_ID}`)
    params.set('client_reference_id', userId)
    params.set('customer', customer)
    params.set('line_items[0][price_data][currency]', 'usd')
    params.set('line_items[0][price_data][unit_amount]', String(product.sale_price_cents))
    params.set('line_items[0][price_data][product_data][name]', String(product.title))
    if (/^https:\/\//i.test(String(product.artwork_url))) {
      params.set('line_items[0][price_data][product_data][images][0]', String(product.artwork_url))
    }
    params.set('line_items[0][quantity]', String(quantity))
    params.set('shipping_address_collection[allowed_countries][0]', 'US')
    params.set('shipping_address_collection[allowed_countries][1]', 'CA')
    params.set('shipping_options[0][shipping_rate_data][type]', 'fixed_amount')
    params.set('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(shippingCharge))
    params.set('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'usd')
    params.set('shipping_options[0][shipping_rate_data][display_name]', 'TKO tracked shipping')
    params.set('automatic_tax[enabled]', 'true')
    params.set('metadata[kind]', 'physical_merch')
    params.set('metadata[order_id]', String(order.id))
    params.set('metadata[user_id]', userId)
    params.set('payment_intent_data[metadata][kind]', 'physical_merch')
    params.set('payment_intent_data[metadata][order_id]', String(order.id))
    params.set('payment_intent_data[metadata][user_id]', userId)
    const stripe = await this.deps.stripeFetch('/checkout/sessions', params)
    if (!stripe.ok || !stripe.json?.client_secret) {
      await this.deps.pool.query(
        `update physical_merch_orders set status='failed',last_error=$2,updated_at=now() where id=$1`,
        [order.id, cleanText(stripe.json?.error?.message || 'Stripe checkout failed', 500)],
      )
      throw Object.assign(new Error(stripe.json?.error?.message || 'Stripe checkout failed'), { status: 502, code: 'stripe_error' })
    }
    await this.deps.pool.query(
      `update physical_merch_orders
          set stripe_customer_id=$2,stripe_checkout_session_id=$3,updated_at=now()
        where id=$1`,
      [order.id, customer, String(stripe.json.id)],
    )
    return {
      orderId: order.id,
      sessionId: stripe.json.id,
      clientSecret: stripe.json.client_secret,
      simulated: false,
      totalCents: total,
    }
  }

  private checkoutResponse(order: any): any {
    return {
      orderId: order.id,
      sessionId: order.stripe_checkout_session_id,
      clientSecret: null,
      simulated: order.dry_run === true,
      reused: true,
      totalCents: order.total_cents,
      status: order.status,
    }
  }

  private async settlePaidOrder(
    input: any,
    payment: {
      sessionId: string | null
      paymentIntentId: string | null
      chargeId: string | null
      amountTotal: number
      taxCents: number
      shipping: { name: string; email: string; address: any }
    },
  ): Promise<any> {
    const taxCents = Math.max(0, safeInt(payment.taxCents))
    const expectedBeforeTax = Number(input.item_subtotal_cents) + Number(input.shipping_charge_cents)
    if (safeInt(payment.amountTotal) - taxCents !== expectedBeforeTax) {
      await this.deps.pool.query(
        `update physical_merch_orders set status='failed',last_error='paid total mismatch',updated_at=now() where id=$1`,
        [input.id],
      )
      throw new Error('physical merchandise paid total mismatch')
    }
    await this.deps.withTransaction(async (db) => {
      const claimed = await db.query(
        `update physical_merch_orders
            set status=case when status='checkout_pending' then 'paid' else status end,
                stripe_checkout_session_id=coalesce(stripe_checkout_session_id,$2),
                stripe_payment_intent_id=coalesce(stripe_payment_intent_id,$3),
                stripe_charge_id=coalesce(stripe_charge_id,$4),
                shipping_name=$5,shipping_email=$6,shipping_address=$7,
                tax_cents=$8,total_cents=$9,
                paid_at=coalesce(paid_at,now()),updated_at=now()
          where id=$1 and status in ('checkout_pending','paid','shopify_pending','provider_draft','fulfillment_held')
          returning *`,
        [
          input.id,
          payment.sessionId,
          payment.paymentIntentId,
          payment.chargeId,
          payment.shipping.name || null,
          payment.shipping.email || null,
          JSON.stringify(payment.shipping.address || {}),
          taxCents,
          payment.amountTotal,
        ],
      )
      if (!claimed.rows[0]) return
      await db.query(
        `insert into physical_merch_earnings (order_item_id,seller_user_id,amount_cents,status)
         select i.id,i.seller_user_id,i.creator_share_cents,'held'
           from physical_merch_order_items i where i.order_id=$1
         on conflict (order_item_id) do nothing`,
        [input.id],
      )
    })
    await this.resumePaidOrder(String(input.id))
    return this.orderById(String(input.id))
  }

  private async resumePaidOrder(orderId: string): Promise<void> {
    let order = await this.fullOrder(orderId)
    if (!order) return
    if (!order.shopify_order_gid) {
      await this.deps.pool.query(
        `update physical_merch_orders set status='shopify_pending',updated_at=now() where id=$1`,
        [orderId],
      )
      const mirrored = await this.mirrorPaidOrder(order)
      if (mirrored?.id) {
        await this.deps.pool.query(
          `update physical_merch_orders
              set shopify_order_gid=$2,shopify_order_name=$3,last_error=null,updated_at=now()
            where id=$1`,
          [orderId, String(mirrored.id), cleanText(mirrored.name, 80) || null],
        )
      }
    }
    order = await this.fullOrder(orderId)
    if (!order?.provider_order_id) {
      const draft = await this.createProviderDraft(order)
      if (draft?.id) {
        await this.deps.pool.query(
          `update physical_merch_orders
              set status='fulfillment_held',provider_order_id=$2,provider_status=$3,
                  provider_cost_cents=$4,hold_reason=$5,last_error=null,updated_at=now()
            where id=$1`,
          [
            orderId,
            String(draft.id),
            cleanText(draft.status, 80) || 'draft',
            safeInt(draft.cost_cents, 0),
            'Provider draft created. Automatic manufacturing confirmation is disabled.',
          ],
        )
      }
    }
  }

  private async syncProductDraft(product: any): Promise<any> {
    const full = await this.productById(String(product.id))
    const operationId = `shopify-product:${product.id}`
    const already = await this.deps.pool.query(
      `select payload from physical_merch_events
        where provider='shopify' and provider_event_id=$1 and status='processed'`,
      [operationId],
    )
    if (already.rows[0]) return safeJson(already.rows[0].payload)
    try {
      let result: any
      if (physicalMerchMode() === 'simulate') {
        result = {
          id: `gid://shopify/Product/${hashId('sim', String(product.id)).replace(/\D/g, '').slice(0, 12) || '1'}`,
          status: 'DRAFT',
          simulated: true,
        }
      } else if (!physicalMerchExternalWriteAllowed('shopify')) {
        result = { skipped: true, reason: 'shopify_writes_disabled' }
      } else {
        result = await this.shopifyBridge('sync_product_draft', {
          product: {
            external_id: String(product.id),
            title: String(product.title),
            description: String(product.description || ''),
            artwork_url: String(product.artwork_url),
            artifact_id: String(product.artifact_id),
            seller_user_id: String(product.seller_user_id),
            price_cents: Number(product.sale_price_cents),
            variants: (full?.variants || []).map((variant: any) => ({
              id: String(variant.id),
              sku: String(variant.sku),
              size: String(variant.size),
              color: String(variant.color),
              price_cents: Number(product.sale_price_cents),
            })),
          },
        })
      }
      await this.upsertOperationEvent('shopify', operationId, 'product_draft', null, result, 'processed')
      if (result?.id) {
        await this.deps.pool.query(
          `update physical_merch_products
              set shopify_product_gid=$2,shopify_shop_domain=$3,synced_at=now(),last_error=null,updated_at=now()
            where id=$1`,
          [product.id, String(result.id), cleanText(result.shop, 200) || 'simulated.myshopify.com'],
        )
        for (const variant of Array.isArray(result.variants) ? result.variants : []) {
          if (!variant?.local_id || !variant?.id) continue
          await this.deps.pool.query(
            `update physical_merch_variants
                set shopify_variant_gid=$2
              where id=$1 and physical_product_id=$3`,
            [String(variant.local_id), String(variant.id), String(product.id)],
          )
        }
      }
      return result
    } catch (error: any) {
      const detail = cleanText(error?.message || 'Shopify product sync failed', 500)
      await this.upsertOperationEvent('shopify', operationId, 'product_draft', null, { error: detail }, 'failed')
      await this.deps.pool.query(
        'update physical_merch_products set last_error=$2,updated_at=now() where id=$1',
        [product.id, detail],
      )
      return { ok: false, error: detail }
    }
  }

  private async mirrorPaidOrder(order: any): Promise<any> {
    const operationId = `shopify-order:${order.id}`
    const existing = await this.processedOperation('shopify', operationId)
    if (existing) return existing
    try {
      let result: any
      if (physicalMerchMode() === 'simulate') {
        result = {
          id: `gid://shopify/Order/${hashId('sim', String(order.id)).replace(/\D/g, '').slice(0, 12) || '2'}`,
          name: `#SIM-${String(order.id).slice(0, 8).toUpperCase()}`,
          simulated: true,
        }
      } else if (!physicalMerchExternalWriteAllowed('shopify')) {
        result = { skipped: true, reason: 'shopify_writes_disabled' }
      } else {
        result = await this.shopifyBridge('create_paid_order', {
          order: {
            external_id: String(order.id),
            email: String(order.shipping_email || ''),
            shipping_address: safeJson(order.shipping_address),
            currency: String(order.currency || 'usd').toUpperCase(),
            item_subtotal_cents: Number(order.item_subtotal_cents),
            shipping_charge_cents: Number(order.shipping_charge_cents),
            tax_cents: Number(order.tax_cents),
            total_cents: Number(order.total_cents),
            stripe_payment_intent_id: String(order.stripe_payment_intent_id || ''),
            line_items: [{
              shopify_variant_gid: order.shopify_variant_gid || null,
              title: String(order.product_title),
              sku: String(order.sku),
              quantity: Number(order.quantity),
              price_cents: Number(order.unit_price_cents),
              size: String(order.size),
              color: String(order.color),
            }],
          },
        })
      }
      await this.upsertOperationEvent('shopify', operationId, 'paid_order_mirror', order.id, result, 'processed')
      return result
    } catch (error: any) {
      const detail = cleanText(error?.message || 'Shopify order mirror failed', 500)
      await this.upsertOperationEvent('shopify', operationId, 'paid_order_mirror', order.id, { error: detail }, 'failed')
      await this.deps.pool.query(
        'update physical_merch_orders set last_error=$2,updated_at=now() where id=$1',
        [order.id, detail],
      )
      return null
    }
  }

  private async createProviderDraft(order: any): Promise<any> {
    const operationId = `printful-draft:${order.id}`
    const existing = await this.processedOperation('printful', operationId)
    if (existing) return existing
    try {
      let result: any
      if (physicalMerchMode() === 'simulate') {
        result = {
          id: hashId('pf_sim_draft', String(order.id)),
          status: 'draft',
          cost_cents: Number(order.manufacturing_cents) + Number(order.provider_shipping_cents),
          simulated: true,
        }
      } else if (!physicalMerchExternalWriteAllowed('printful')) {
        result = { skipped: true, reason: 'printful_drafts_disabled' }
      } else {
        if (!order.provider_variant_id) throw new Error('Printful variant mapping is not configured for this size/color.')
        const token = String(process.env.PRINTFUL_ACCESS_TOKEN || '')
        if (!token) throw new Error('Printful access token is not configured.')
        const recipient = safeJson(order.shipping_address)
        const response = await fetch('https://api.printful.com/orders', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(process.env.PRINTFUL_STORE_ID ? { 'X-PF-Store-Id': String(process.env.PRINTFUL_STORE_ID) } : {}),
          },
          body: JSON.stringify({
            external_id: `tko_${order.id}`,
            recipient: {
              name: order.shipping_name,
              email: order.shipping_email,
              address1: recipient.line1,
              address2: recipient.line2 || undefined,
              city: recipient.city,
              state_code: recipient.state,
              country_code: recipient.country,
              zip: recipient.postal_code,
            },
            items: [{
              external_id: String(order.order_item_id),
              variant_id: Number(order.provider_variant_id),
              quantity: Number(order.quantity),
              files: [{ type: 'default', url: String(order.artwork_url) }],
            }],
          }),
        })
        const body: any = await response.json().catch(() => ({}))
        if (!response.ok || !body?.result?.id) throw new Error(body?.error?.message || 'Printful draft failed')
        const costs = body.result.costs || {}
        result = {
          id: String(body.result.id),
          status: String(body.result.status || 'draft'),
          cost_cents: Math.round(
            (Number(costs.total || 0) || (Number(costs.subtotal || 0) + Number(costs.shipping || 0))) * 100,
          ),
        }
      }
      await this.upsertOperationEvent('printful', operationId, 'provider_draft', order.id, result, 'processed')
      return result
    } catch (error: any) {
      const detail = cleanText(error?.message || 'Print provider draft failed', 500)
      await this.upsertOperationEvent('printful', operationId, 'provider_draft', order.id, { error: detail }, 'failed')
      await this.deps.pool.query(
        `update physical_merch_orders
            set status='fulfillment_held',hold_reason='Provider draft needs attention',
                last_error=$2,updated_at=now() where id=$1`,
        [order.id, detail],
      )
      return null
    }
  }

  private async shopifyBridge(operation: string, payload: any): Promise<any> {
    const url = String(process.env.SHOPIFY_BRIDGE_URL || '')
    const secret = String(process.env.TKO_SHOPIFY_BRIDGE_SECRET || '')
    if (!url || !secret) throw new Error('Shopify bridge URL or secret is not configured.')
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `${operation}:${payload?.order?.external_id || payload?.product?.external_id || ''}`,
      },
      body: JSON.stringify({ operation, ...payload }),
    })
    const body: any = await response.json().catch(() => ({}))
    if (!response.ok || body?.ok === false) throw new Error(body?.error || `Shopify bridge returned ${response.status}`)
    return body.result || body
  }

  private async releasePayouts(): Promise<any> {
    const rows = await this.deps.pool.query(
      `select e.*, a.stripe_account_id, a.payouts_enabled, a.transfers_enabled,
              o.id order_id
         from physical_merch_earnings e
         join physical_merch_order_items i on i.id=e.order_item_id
         join physical_merch_orders o on o.id=i.order_id
         left join creator_stripe_accounts a on a.user_id=e.seller_user_id
        where e.status in ('held','available')
          and e.available_at is not null and e.available_at <= now()
          and o.status in ('shipped','delivered')
        order by e.available_at`,
    )
    const results: any[] = []
    for (const earning of rows.rows) {
      if (physicalMerchMode() === 'simulate') {
        const transferId = hashId('tr_sim', String(earning.id))
        await this.deps.pool.query(
          `update physical_merch_earnings
              set status='transferred',stripe_transfer_id=$2,transferred_at=now(),updated_at=now()
            where id=$1 and status in ('held','available')`,
          [earning.id, transferId],
        )
        results.push({ earning_id: earning.id, transferred: true, transfer_id: transferId, simulated: true })
        continue
      }
      if (!physicalMerchExternalWriteAllowed('transfers')) {
        await this.deps.pool.query(
          `update physical_merch_earnings set status='available',updated_at=now()
            where id=$1 and status='held'`,
          [earning.id],
        )
        results.push({ earning_id: earning.id, transferred: false, reason: 'transfers_disabled' })
        continue
      }
      if (!earning.stripe_account_id || earning.payouts_enabled !== true || earning.transfers_enabled !== true) {
        results.push({ earning_id: earning.id, transferred: false, reason: 'seller_connect_not_ready' })
        continue
      }
      const transfer = await this.deps.stripeFetch('/transfers', new URLSearchParams({
        amount: String(earning.amount_cents),
        currency: 'usd',
        destination: String(earning.stripe_account_id),
        transfer_group: `TKO_PHYSICAL_${String(earning.order_id)}`,
        'metadata[kind]': 'physical_merch',
        'metadata[order_id]': String(earning.order_id),
        'metadata[earning_id]': String(earning.id),
      }))
      if (!transfer.ok || !transfer.json?.id) {
        results.push({ earning_id: earning.id, transferred: false, reason: transfer.json?.error?.message || 'stripe_transfer_failed' })
        continue
      }
      await this.deps.pool.query(
        `update physical_merch_earnings
            set status='transferred',stripe_transfer_id=$2,transferred_at=now(),updated_at=now()
          where id=$1`,
        [earning.id, String(transfer.json.id)],
      )
      results.push({ earning_id: earning.id, transferred: true, transfer_id: String(transfer.json.id) })
    }
    return {
      ok: true,
      eligible: rows.rows.length,
      transferred: results.filter((item) => item.transferred).length,
      results,
    }
  }

  private async refundOrder(orderId: string, eventId: string, amount?: number): Promise<any | null> {
    const order = await this.orderById(orderId)
    if (!order) return null
    const refunded = Math.max(0, Math.min(Number(order.total_cents), amount ?? Number(order.total_cents)))
    const fullRefund = refunded >= Number(order.total_cents)
    const transferred = await this.deps.pool.query(
      `select e.*
         from physical_merch_earnings e
         join physical_merch_order_items i on i.id=e.order_item_id
        where i.order_id=$1 and e.status='transferred'`,
      [orderId],
    )
    let reversalReview = transferred.rows.length > 0 && !fullRefund
    if (transferred.rows.length && fullRefund && physicalMerchMode() !== 'simulate') {
      if (!physicalMerchExternalWriteAllowed('transfers')) {
        reversalReview = true
      } else {
        for (const earning of transferred.rows) {
          const transferId = String(earning.stripe_transfer_id || '')
          if (!transferId) {
            reversalReview = true
            continue
          }
          const reversal = await this.deps.stripeFetch(
            `/transfers/${encodeURIComponent(transferId)}/reversals`,
            new URLSearchParams({
              amount: String(earning.amount_cents),
              'metadata[kind]': 'physical_merch_refund',
              'metadata[order_id]': orderId,
              'metadata[earning_id]': String(earning.id),
            }),
          )
          if (!reversal.ok || !reversal.json?.id) reversalReview = true
        }
      }
    }
    const reverseTransferred = fullRefund && !reversalReview
    const orderStatus = reversalReview || !fullRefund ? 'refund_review' : 'refunded'
    await this.deps.withTransaction(async (db) => {
      await db.query(
        `update physical_merch_orders
            set status=$3,refunded_cents=$2,refunded_at=now(),
                hold_reason=case when $3='refund_review'
                  then 'Refund recorded; creator transfer reversal needs operator review'
                  else null end,
                updated_at=now()
          where id=$1`,
        [orderId, refunded, orderStatus],
      )
      await db.query(
        `update physical_merch_earnings
            set status='reversed',reversed_at=now(),updated_at=now()
          where order_item_id in (select id from physical_merch_order_items where order_id=$1)
            and status <> 'transferred'`,
        [orderId],
      )
      if (reverseTransferred) {
        await db.query(
          `update physical_merch_earnings
              set status='reversed',reversed_at=now(),updated_at=now()
            where order_item_id in (select id from physical_merch_order_items where order_id=$1)
              and status='transferred'`,
          [orderId],
        )
      }
    })
    await this.upsertOperationEvent(
      'stripe',
      eventId,
      'refund',
      orderId,
      { refunded_cents: refunded, full_refund: fullRefund, transfer_reversal_review: reversalReview },
      'processed',
    )
    return this.orderById(orderId)
  }

  private async isHost(userId: string): Promise<boolean> {
    const result = await this.deps.pool.query('select user_metadata from users where id=$1', [userId])
    return safeJson(result.rows[0]?.user_metadata).tko_host === true
  }

  private async productById(id: string, db: MerchDb = this.deps.pool): Promise<any | null> {
    const row = await db.query(
      `select p.* from physical_merch_products p where p.id=$1`,
      [id],
    )
    if (!row.rows[0]) return null
    const [product] = await this.attachVariants(row.rows, db)
    return product
  }

  private async attachVariants(rows: any[], db: MerchDb = this.deps.pool): Promise<any[]> {
    if (!rows.length) return []
    const params = rows.map((row) => row.id)
    const placeholders = params.map((_, index) => `$${index + 1}`).join(',')
    const variants = await db.query(
      `select * from physical_merch_variants
        where physical_product_id in (${placeholders})
        order by color,size`,
      params,
    )
    const grouped = new Map<string, any[]>()
    for (const variant of variants.rows) {
      const key = String(variant.physical_product_id)
      grouped.set(key, [...(grouped.get(key) || []), variant])
    }
    return rows.map((row) => ({
      ...row,
      ai_brief: safeJson(row.ai_brief),
      print_specs: safeJson(row.print_specs),
      variants: grouped.get(String(row.id)) || [],
    }))
  }

  private async orderById(id: string): Promise<any | null> {
    const result = await this.deps.pool.query('select * from physical_merch_orders where id=$1', [id])
    return result.rows[0] || null
  }

  private async fullOrder(id: string): Promise<any | null> {
    const result = await this.deps.pool.query(
      `select o.*, i.id order_item_id, i.seller_user_id, i.quantity, i.unit_price_cents,
              i.manufacturing_cents,i.provider_shipping_cents,i.payment_fee_cents,
              i.refund_reserve_cents,i.creator_share_cents,i.platform_share_cents,
              p.title product_title,p.description product_description,p.artwork_url,
              p.artifact_id,p.shopify_product_gid,
              v.size,v.color,v.sku,v.shopify_variant_gid,v.provider_variant_id
         from physical_merch_orders o
         join physical_merch_order_items i on i.order_id=o.id
         join physical_merch_products p on p.id=i.physical_product_id
         join physical_merch_variants v on v.id=i.variant_id
        where o.id=$1`,
      [id],
    )
    return result.rows[0] || null
  }

  private async processedOperation(provider: string, id: string): Promise<any | null> {
    const row = await this.deps.pool.query(
      `select payload from physical_merch_events
        where provider=$1 and provider_event_id=$2 and status='processed'`,
      [provider, id],
    )
    return row.rows[0] ? safeJson(row.rows[0].payload) : null
  }

  private async upsertOperationEvent(
    provider: string,
    providerEventId: string,
    topic: string,
    orderId: string | null,
    payload: Record<string, unknown>,
    status: 'processed' | 'failed',
  ): Promise<void> {
    await this.deps.pool.query(
      `insert into physical_merch_events
         (provider,topic,provider_event_id,order_id,payload,status,attempts,processed_at,error)
       values ($1,$2,$3,$4,$5,$6,1,case when $6='processed' then now() else null end,$7)
       on conflict (provider,provider_event_id) do update set
         topic=excluded.topic,order_id=coalesce(physical_merch_events.order_id,excluded.order_id),
         payload=excluded.payload,status=excluded.status,
         attempts=physical_merch_events.attempts+1,
         processed_at=case when excluded.status='processed' then now() else physical_merch_events.processed_at end,
         error=excluded.error`,
      [
        provider,
        topic,
        providerEventId,
        orderId,
        JSON.stringify(eventPayload(payload)),
        status,
        status === 'failed' ? cleanText((payload as any).error, 500) : null,
      ],
    )
  }

  private async claimProviderEvent(
    provider: string,
    providerEventId: string,
    topic: string,
    orderId: string | null,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await this.deps.pool.query(
        `insert into physical_merch_events
           (provider,topic,provider_event_id,order_id,payload,status,attempts,processed_at)
         values ($1,$2,$3,$4,$5,'processed',1,now())`,
        [provider, topic, providerEventId, orderId, JSON.stringify(payload)],
      )
      return true
    } catch {
      return false
    }
  }
}

export function createPhysicalMerchService(deps: MerchDeps): PhysicalMerchService {
  return new PhysicalMerchService(deps)
}
