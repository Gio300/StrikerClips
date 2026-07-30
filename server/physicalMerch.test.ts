import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import { createPhysicalMerchService } from './physicalMerch'
import { makeDb } from './testHarness'

type User = { id: string; token: string }

async function signUp(app: any, email: string, username: string): Promise<User> {
  const response = await request(app).post('/api/auth/signup').send({
    email,
    username,
    password: 'safe-test-password',
    age_consent_13_plus: true,
  })
  expect(response.status).toBe(200)
  return { id: response.body.user.id, token: response.body.token }
}

const authorized = (token: string) => ({ Authorization: `Bearer ${token}` })

describe('Stripe-first physical merchandise', () => {
  let pool: any
  let app: any
  let creator: User
  let host: User
  let buyer: User
  let artifactId = ''

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.MERCH_MODE = 'simulate'
    process.env.MERCH_PAYOUT_HOLD_DAYS = '0'
    delete process.env.MERCH_ALLOW_STRIPE_CHECKOUT
    delete process.env.MERCH_ALLOW_SHOPIFY_WRITES
    delete process.env.MERCH_ALLOW_PRINTFUL_DRAFTS
    delete process.env.MERCH_ALLOW_STRIPE_TRANSFERS
    delete process.env.MERCH_ALLOW_FULFILLMENT_CONFIRM
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.SHOPIFY_BRIDGE_URL
    delete process.env.TKO_SHOPIFY_BRIDGE_SECRET
    delete process.env.PRINTFUL_ACCESS_TOKEN
    delete process.env.PRINTFUL_STORE_ID
    delete process.env.PRINTFUL_WEBHOOK_SECRET

    pool = makeDb()
    app = createApp(pool)
    creator = await signUp(app, 'forge-creator@example.test', 'forge_creator')
    host = await signUp(app, 'forge-host@example.test', 'forge_host')
    buyer = await signUp(app, 'forge-buyer@example.test', 'forge_buyer')

    const creatorMeta = {
      username: 'forge_creator',
      reelone_tier: 'creator',
      reelone_tier_expires: null,
    }
    const hostMeta = { username: 'forge_host', tko_host: true }
    await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(creatorMeta), creator.id])
    await pool.query('update users set user_metadata=$1 where id=$2', [JSON.stringify(hostMeta), host.id])
    const artifact = await pool.query(
      `insert into artifacts (owner_id,slug,name,rarity,capability,image_url)
       values ($1,'ember-mark','Ember Mark','legendary','forge','https://assets.example.test/ember.png')
       returning id`,
      [creator.id],
    )
    artifactId = String(artifact.rows[0].id)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function createApprovedProduct(): Promise<any> {
    const created = await request(app)
      .post('/api/physical/products')
      .set(authorized(creator.token))
      .send({
        artifact_id: artifactId,
        title: 'Ember Mark Forge Tee',
        description: 'Creator-forged shirt',
        artwork_url: 'https://assets.example.test/ember-print.png',
        sale_price_cents: 3999,
        print_width_px: 4500,
        print_height_px: 5400,
        placement: 'front-center',
        colors: ['Black', 'White'],
        ip_attested: true,
      })
    expect(created.status, JSON.stringify(created.body)).toBe(201)
    expect(created.body.product.status).toBe('pending_review')
    expect(created.body.product.variants).toHaveLength(10)

    const approved = await request(app)
      .post(`/api/physical/products/${created.body.product.id}/review`)
      .set(authorized(host.token))
      .send({ decision: 'approve' })
    expect(approved.status).toBe(200)
    expect(approved.body.product.status).toBe('approved')
    expect(approved.body.product.shopify_product_gid).toMatch(/^gid:\/\/shopify\/Product\//)
    expect(approved.body.shopify.simulated).toBe(true)
    return approved.body.product
  }

  it('keeps every external provider off in the default dry-run mode', async () => {
    const config = await request(app).get('/api/physical/config')
    expect(config.status).toBe(200)
    expect(config.body).toMatchObject({
      mode: 'simulate',
      simulated: true,
      checkout_ready: true,
      stripe_checkout_ready: true,
      shopify_bridge_ready: true,
      print_provider_ready: true,
      fulfillment_confirmation_enabled: false,
      creator_transfers_enabled: false,
    })
  })

  it('runs review, checkout, mirrored order, provider draft, shipping and payout exactly once', async () => {
    const product = await createApprovedProduct()
    const variant = product.variants.find((item: any) => item.size === 'L' && item.color === 'Black')
    expect(variant).toBeTruthy()

    const body = {
      product_id: product.id,
      variant_id: variant.id,
      quantity: 2,
      idempotency_key: 'checkout-buyer-one-ember-l',
    }
    const checkout = await request(app)
      .post('/api/physical/checkout')
      .set(authorized(buyer.token))
      .send(body)
    expect(checkout.status).toBe(201)
    expect(checkout.body).toMatchObject({ simulated: true, totalCents: 8497 })

    const duplicate = await request(app)
      .post('/api/physical/checkout')
      .set(authorized(buyer.token))
      .send(body)
    expect(duplicate.status).toBe(201)
    expect(duplicate.body).toMatchObject({ reused: true, orderId: checkout.body.orderId })

    const paid = await request(app)
      .post(`/api/physical/orders/${checkout.body.orderId}/simulate-paid`)
      .set(authorized(buyer.token))
      .send({ shipping_name: 'Dry Run Buyer' })
    expect(paid.status).toBe(200)
    expect(paid.body.order.status).toBe('fulfillment_held')
    expect(paid.body.order.shopify_order_gid).toMatch(/^gid:\/\/shopify\/Order\//)
    expect(paid.body.order.provider_order_id).toMatch(/^pf_sim_draft_/)

    const replay = await request(app)
      .post(`/api/physical/orders/${checkout.body.orderId}/simulate-paid`)
      .set(authorized(buyer.token))
      .send({ shipping_name: 'Dry Run Buyer' })
    expect(replay.status).toBe(200)

    const operations = await pool.query(
      `select provider,topic,count(*)::int count from physical_merch_events
        group by provider,topic order by provider,topic`,
    )
    expect(operations.rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: 'printful', topic: 'provider_draft', count: 1 }),
      expect.objectContaining({ provider: 'shopify', topic: 'paid_order_mirror', count: 1 }),
      expect.objectContaining({ provider: 'shopify', topic: 'product_draft', count: 1 }),
    ]))

    const shipped = await request(app)
      .post(`/api/physical/orders/${checkout.body.orderId}/simulate-shipped`)
      .set(authorized(host.token))
      .send({})
    expect(shipped.status).toBe(200)
    expect(shipped.body.order.status).toBe('shipped')

    const payout = await request(app)
      .post('/api/physical/payouts/release')
      .set(authorized(host.token))
      .send({})
    expect(payout.status).toBe(200)
    expect(payout.body).toMatchObject({ eligible: 1, transferred: 1 })

    const payoutReplay = await request(app)
      .post('/api/physical/payouts/release')
      .set(authorized(host.token))
      .send({})
    expect(payoutReplay.body).toMatchObject({ eligible: 0, transferred: 0 })

    const refund = await request(app)
      .post(`/api/physical/orders/${checkout.body.orderId}/simulate-refund`)
      .set(authorized(host.token))
      .send({})
    expect(refund.status).toBe(200)
    expect(refund.body.order.status).toBe('refunded')
    const reversed = await pool.query(
      `select status from physical_merch_earnings
        where order_item_id in (
          select id from physical_merch_order_items where order_id=$1
        )`,
      [checkout.body.orderId],
    )
    expect(reversed.rows).toEqual([expect.objectContaining({ status: 'reversed' })])
  })

  it('does not expose buyer shipping details to the creator', async () => {
    const product = await createApprovedProduct()
    const checkout = await request(app)
      .post('/api/physical/checkout')
      .set(authorized(buyer.token))
      .send({
        product_id: product.id,
        variant_id: product.variants[0].id,
        quantity: 1,
        idempotency_key: 'checkout-private-address',
      })
    await request(app)
      .post(`/api/physical/orders/${checkout.body.orderId}/simulate-paid`)
      .set(authorized(buyer.token))
      .send({ shipping_name: 'Private Buyer', line1: '123 Private Lane' })

    const sellerView = await request(app)
      .get(`/api/physical/orders/${checkout.body.orderId}`)
      .set(authorized(creator.token))
    expect(sellerView.status).toBe(200)
    expect(sellerView.body.order.shipping_name).toBeUndefined()
    expect(sellerView.body.order.shipping_address).toBeUndefined()

    const stranger = await signUp(app, 'forge-stranger@example.test', 'forge_stranger')
    const hidden = await request(app)
      .get(`/api/physical/orders/${checkout.body.orderId}`)
      .set(authorized(stranger.token))
    expect(hidden.status).toBe(404)
  })

  it('creates no order and makes no Stripe call when real fulfillment is unavailable', async () => {
    const product = await createApprovedProduct()
    const externalFetch = vi.fn()
    vi.stubGlobal('fetch', externalFetch)
    process.env.MERCH_MODE = 'test'
    process.env.STRIPE_SECRET_KEY = 'sk_test_not_used'
    process.env.MERCH_ALLOW_STRIPE_CHECKOUT = '1'

    const checkout = await request(app)
      .post('/api/physical/checkout')
      .set(authorized(buyer.token))
      .send({
        product_id: product.id,
        variant_id: product.variants[0].id,
        quantity: 1,
        idempotency_key: 'real-checkout-must-be-ready',
      })

    expect(checkout.status).toBe(503)
    expect(checkout.body.error).toBe('physical_checkout_not_ready')
    expect(externalFetch).not.toHaveBeenCalled()
    const orders = await pool.query(
      'select id from physical_merch_orders where idempotency_key=$1',
      ['real-checkout-must-be-ready'],
    )
    expect(orders.rows).toHaveLength(0)
  })

  it('confirms a Printful draft once and reuses the processed confirmation', async () => {
    process.env.MERCH_MODE = 'test'
    process.env.MERCH_ALLOW_PRINTFUL_DRAFTS = '1'
    process.env.MERCH_ALLOW_FULFILLMENT_CONFIRM = '1'
    process.env.PRINTFUL_ACCESS_TOKEN = 'printful-test-token'
    const events = new Map<string, { payload: any; status: string }>()
    const db = {
      query: vi.fn(async (sql: string, params: any[] = []) => {
        if (sql.includes('select payload from physical_merch_events')) {
          const event = events.get(String(params[1]))
          return { rows: event?.status === 'processed' ? [{ payload: event.payload }] : [] }
        }
        if (sql.includes('insert into physical_merch_events')) {
          events.set(String(params[2]), {
            payload: JSON.parse(String(params[4])),
            status: String(params[5]),
          })
          return { rows: [] }
        }
        if (sql.includes('update physical_merch_orders')) return { rows: [] }
        throw new Error(`Unexpected SQL in confirmation test: ${sql}`)
      }),
    }
    const confirmationFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { id: 8741, status: 'pending' } }),
    }))
    vi.stubGlobal('fetch', confirmationFetch)
    const service = createPhysicalMerchService({
      pool: db,
      auth: ((_req: any, _res: any, next: any) => next()),
      uid: () => 'buyer-id',
      withTransaction: async (fn: any) => fn(db),
      stripeFetch: async () => ({ ok: false, status: 500, json: {} }),
      stripeConfigured: () => false,
      ensureCustomer: async () => '',
      appUrl: () => 'https://tko.cam',
    } as any)
    const order = { id: 'order-confirm-once', provider_order_id: '8741' }

    await (service as any).confirmProviderOrder(order)
    await (service as any).confirmProviderOrder(order)

    expect(confirmationFetch).toHaveBeenCalledTimes(1)
    expect(confirmationFetch.mock.calls[0]?.[0]).toBe('https://api.printful.com/orders/8741/confirm')
    expect(events.get('printful-confirm:order-confirm-once')).toMatchObject({
      status: 'processed',
      payload: { id: '8741', status: 'pending' },
    })
  })

  it('recursively removes buyer PII from stored provider events', async () => {
    process.env.PRINTFUL_WEBHOOK_SECRET = 'webhook-test-secret'
    const response = await request(app)
      .post('/api/physical/webhooks/printful')
      .set(authorized('webhook-test-secret'))
      .send({
        id: 'evt-private-payload',
        type: 'order_updated',
        data: {
          state: 'draft',
          details: {
            recipient: { name: 'Private Buyer', email: 'private@example.test' },
            shipping_address: { line1: '123 Private Lane' },
            nested: {
              customerDetails: { name: 'Private Buyer', email: 'private@example.test' },
              billingAddress: { line1: '456 Billing Road' },
              email: 'still-private@example.test',
              public_status: 'ready',
            },
          },
        },
      })

    expect(response.status).toBe(200)
    const stored = await pool.query(
      `select payload from physical_merch_events
        where provider='printful' and provider_event_id=$1`,
      ['evt-private-payload'],
    )
    const payload = stored.rows[0]?.payload
    expect(payload.data.state).toBe('draft')
    expect(payload.data.details.nested.public_status).toBe('ready')
    expect(JSON.stringify(payload)).not.toContain('Private Buyer')
    expect(JSON.stringify(payload)).not.toContain('private@example.test')
    expect(JSON.stringify(payload)).not.toContain('Private Lane')
    expect(JSON.stringify(payload)).not.toContain('Billing Road')
  })
})
