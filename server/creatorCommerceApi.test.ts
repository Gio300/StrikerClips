import { createHmac } from 'node:crypto'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { makeDb } from './testHarness'

type User = { id: string; token: string }
type StripeCall = {
  path: string
  method: string
  params: URLSearchParams
  connectedAccount: string
}

const WEBHOOK_SECRET = 'whsec_creator_commerce_test'
const realFetch = globalThis.fetch

const authorized = (token: string) => ({ Authorization: `Bearer ${token}` })

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

function signWebhook(payload: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', WEBHOOK_SECRET)
    .update(`${timestamp}.${payload}`, 'utf8')
    .digest('hex')
  return `t=${timestamp},v1=${signature}`
}

function sendEvent(app: any, event: any) {
  const payload = JSON.stringify(event)
  return request(app)
    .post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signWebhook(payload))
    .send(payload)
}

describe('creator commerce and Stripe Connect', () => {
  let pool: any
  let app: any
  let seller: User
  let buyer: User
  let freeOnlyBuyer: User
  let stripeCalls: StripeCall[]
  let checkoutCounter: number

  beforeEach(async () => {
    process.env.NODE_ENV = 'test'
    process.env.STRIPE_SECRET_KEY = 'sk_test_creator_stub'
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
    process.env.APP_URL = 'https://tko.cam'
    stripeCalls = []
    checkoutCounter = 0
    globalThis.fetch = (async (url: any, init: any = {}) => {
      const path = String(url).replace('https://api.stripe.com/v1', '')
      const params = new URLSearchParams(String(init?.body || ''))
      stripeCalls.push({
        path,
        method: String(init?.method || 'GET'),
        params,
        connectedAccount: String(init?.headers?.['Stripe-Account'] || ''),
      })

      let body: any = {}
      if (path === '/accounts') {
        body = {
          id: params.get('metadata[user_id]') === freeOnlyBuyer?.id
            ? 'acct_free_ready'
            : 'acct_creator_ready',
        }
      }
      else if (path === '/account_links') body = { url: 'https://connect.stripe.test/onboard' }
      else if (path === '/accounts/acct_creator_ready' || path === '/accounts/acct_free_ready') {
        body = {
          id: path.split('/').pop(),
          charges_enabled: true,
          payouts_enabled: true,
          capabilities: { transfers: 'active' },
        }
      } else if (path === '/customers') body = { id: 'cus_creator_buyer' }
      else if (path === '/checkout/sessions') {
        checkoutCounter += 1
        body = {
          id: `cs_creator_${checkoutCounter}`,
          url: `https://checkout.stripe.test/cs_creator_${checkoutCounter}`,
        }
      } else if (path.startsWith('/checkout/sessions/')) {
        const id = path.split('/').pop()
        body = { id, url: `https://checkout.stripe.test/${id}` }
      } else if (path.startsWith('/payment_intents/')) {
        body = {
          id: 'pi_creator_cash',
          latest_charge: {
            id: 'ch_creator_cash',
            balance_transaction: { id: 'txn_creator_cash', fee: 88 },
          },
        }
      } else if (path === '/charges') body = { id: `ch_seller_fee_${stripeCalls.length}` }
      else if (path === '/transfers') body = { id: `tr_creator_${stripeCalls.length}` }
      return { ok: true, status: 200, json: async () => body } as any
    }) as typeof globalThis.fetch

    pool = makeDb()
    app = createApp(pool)
    seller = await signUp(app, 'seller@creator.test', 'creator_seller')
    buyer = await signUp(app, 'buyer@creator.test', 'creator_buyer')
    freeOnlyBuyer = await signUp(app, 'free@creator.test', 'free_points_only')
    await pool.query(
      'update users set user_metadata=$1 where id=$2',
      [JSON.stringify({
        username: 'creator_seller',
        reelone_tier: 'creator',
        reelone_tier_expires: new Date(Date.now() + 86400000).toISOString(),
      }), seller.id],
    )
    await pool.query(
      `insert into wallets (user_id,tokens,sweeps,paid_sweeps_cents)
       values ($1,0,9999,5000),($2,0,9999,0)
       on conflict (user_id) do update set
         sweeps=excluded.sweeps,
         paid_sweeps_cents=excluded.paid_sweeps_cents`,
      [buyer.id, freeOnlyBuyer.id],
    )

    const onboard = await request(app)
      .post('/api/connect/onboard')
      .set(authorized(seller.token))
      .send({})
    expect(onboard.status).toBe(200)
    expect(onboard.body.url).toContain('connect.stripe.test')

    const consent = await request(app)
      .post('/api/connect/tax-consent')
      .set(authorized(seller.token))
      .send({
        tax_certified: true,
        electronic_1099_consent: true,
        platform_fee_debit_consent: true,
        tax_form_type: 'w9',
      })
    expect(consent.status).toBe(200)

    const status = await request(app)
      .get('/api/connect/status')
      .set(authorized(seller.token))
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      connected: true,
      ready: true,
      transfers_enabled: true,
      payouts_enabled: true,
      seller_share_percent: 80,
    })
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    delete process.env.STRIPE_SECRET_KEY
    delete process.env.STRIPE_WEBHOOK_SECRET
    delete process.env.APP_URL
  })

  it('lets every signed-in player prepare Stripe payouts without unlocking marketplace selling', async () => {
    const onboard = await request(app)
      .post('/api/connect/onboard')
      .set(authorized(freeOnlyBuyer.token))
      .send({})
    expect(onboard.status).toBe(200)
    expect(onboard.body.url).toContain('connect.stripe.test')

    const accountLink = stripeCalls.findLast((call) => call.path === '/account_links')
    expect(accountLink?.params.get('refresh_url')).toBe('https://tko.cam/settings#payouts')
    expect(accountLink?.params.get('return_url')).toBe('https://tko.cam/settings#payouts')

    const consent = await request(app)
      .post('/api/connect/tax-consent')
      .set(authorized(freeOnlyBuyer.token))
      .send({
        tax_certified: true,
        electronic_1099_consent: true,
        platform_fee_debit_consent: true,
        tax_form_type: 'w9',
      })
    expect(consent.status).toBe(200)

    const status = await request(app)
      .get('/api/connect/status')
      .set(authorized(freeOnlyBuyer.token))
    expect(status.status).toBe(200)
    expect(status.body).toMatchObject({
      connected: true,
      ready: true,
      seller_eligible: false,
      minimum_tier: 'pro',
      transfers_enabled: true,
      payouts_enabled: true,
    })
    expect(status.body.seller_share_percent).toBeUndefined()

    const listing = await request(app)
      .post('/api/creator/listings')
      .set(authorized(freeOnlyBuyer.token))
      .send({
        name: 'Free account listing',
        image_url: 'https://assets.example.test/free-listing.png',
        kind: 'badge_skin',
        price_cents: 299,
      })
    expect(listing.status).toBe(403)
    expect(listing.body.error).toBe('seller_membership_required')
  })

  async function createListing(name: string, priceCents: number): Promise<any> {
    const response = await request(app)
      .post('/api/creator/listings')
      .set(authorized(seller.token))
      .send({
        name,
        team_name: 'AI Clan',
        image_url: 'https://assets.example.test/tko-artifact.png',
        kind: 'badge_skin',
        price_cents: priceCents,
        cash_enabled: true,
        paid_sweeps_enabled: true,
      })
    expect(response.status, JSON.stringify(response.body)).toBe(201)
    return response.body.listing
  }

  it('creates a destination checkout, fulfils it once, and revokes it after a verified refund', async () => {
    const listing = await createListing('TKO Storm Crest', 999)
    stripeCalls = []
    const checkout = await request(app)
      .post('/api/creator/checkout')
      .set(authorized(buyer.token))
      .send({ asset_id: listing.id, idempotency_key: 'cash-storm-crest' })
    expect(checkout.status, JSON.stringify(checkout.body)).toBe(200)

    const session = stripeCalls.find((call) => call.path === '/checkout/sessions')
    expect(session?.params.get('mode')).toBe('payment')
    expect(session?.params.get('line_items[0][price_data][unit_amount]')).toBe('999')
    expect(session?.params.get('payment_intent_data[application_fee_amount]')).toBe('200')
    expect(session?.params.get('payment_intent_data[transfer_data][destination]')).toBe('acct_creator_ready')
    expect(session?.params.get('metadata[order_id]')).toBe(checkout.body.orderId)

    const paidEvent = {
      id: 'evt_creator_cash_paid',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: checkout.body.sessionId,
          mode: 'payment',
          payment_status: 'paid',
          amount_total: 999,
          currency: 'usd',
          payment_intent: 'pi_creator_cash',
          client_reference_id: buyer.id,
          metadata: {
            kind: 'creator_order',
            user_id: buyer.id,
            order_id: checkout.body.orderId,
          },
        },
      },
    }
    const fulfilled = await sendEvent(app, paidEvent)
    expect(fulfilled.status).toBe(200)
    const replay = await sendEvent(app, paidEvent)
    expect(replay.body).toMatchObject({ received: true, duplicate: true })

    const order = (await pool.query('select * from creator_orders where id=$1', [checkout.body.orderId])).rows[0]
    expect(order).toMatchObject({
      status: 'transferred',
      seller_share_cents: 799,
      platform_share_cents: 200,
    })
    expect((await pool.query('select count(*)::int count from asset_ownership where ref_id=$1', [checkout.body.orderId])).rows[0].count).toBe(1)
    expect((await pool.query('select status from creator_earnings where order_id=$1', [checkout.body.orderId])).rows[0].status).toBe('transferred')
    expect(stripeCalls.filter((call) => call.path === '/charges').length).toBeGreaterThanOrEqual(2)

    const refunded = await sendEvent(app, {
      id: 'evt_creator_cash_refunded',
      type: 'charge.refunded',
      data: {
        object: {
          id: 'ch_creator_cash',
          payment_intent: 'pi_creator_cash',
          metadata: { kind: 'creator_order', order_id: checkout.body.orderId },
        },
      },
    })
    expect(refunded.status).toBe(200)
    expect((await pool.query('select status from creator_orders where id=$1', [checkout.body.orderId])).rows[0].status).toBe('refunded')
    expect((await pool.query('select status from creator_earnings where order_id=$1', [checkout.body.orderId])).rows[0].status).toBe('reversed')
    expect((await pool.query('select count(*)::int count from asset_ownership where ref_id=$1', [checkout.body.orderId])).rows[0].count).toBe(0)
  })

  it('keeps free Give Points isolated and pays only from dollar-backed Sweeps Credits', async () => {
    const listing = await createListing('TKO Territory Seal', 1999)
    stripeCalls = []
    const purchased = await request(app)
      .post('/api/creator/buy-with-sweeps')
      .set(authorized(buyer.token))
      .send({ asset_id: listing.id, idempotency_key: 'sweeps-territory-seal' })
    expect(purchased.status, JSON.stringify(purchased.body)).toBe(200)
    expect(purchased.body).toMatchObject({ ok: true, payout: { transferred: true } })
    expect(purchased.body.order).toMatchObject({
      buyer_charge_cents: 1399,
      discount_cents: 600,
      seller_share_cents: 1119,
      platform_share_cents: 280,
    })
    expect(purchased.body.wallet).toMatchObject({ sweeps: 9999, paid_sweeps_cents: 3601 })
    const transfer = stripeCalls.find((call) => call.path === '/transfers')
    expect(transfer?.params.get('amount')).toBe('1119')
    expect(transfer?.params.get('destination')).toBe('acct_creator_ready')

    const duplicate = await request(app)
      .post('/api/creator/buy-with-sweeps')
      .set(authorized(buyer.token))
      .send({ asset_id: listing.id, idempotency_key: 'sweeps-territory-seal' })
    expect(duplicate.status).toBe(200)
    expect(duplicate.body.duplicate).toBe(true)
    const wallet = (await pool.query('select sweeps,paid_sweeps_cents from wallets where user_id=$1', [buyer.id])).rows[0]
    expect(wallet).toMatchObject({ sweeps: 9999, paid_sweeps_cents: 3601 })
    expect(stripeCalls.filter((call) => call.path === '/transfers')).toHaveLength(1)

    const rejected = await request(app)
      .post('/api/creator/buy-with-sweeps')
      .set(authorized(freeOnlyBuyer.token))
      .send({ asset_id: listing.id, idempotency_key: 'free-points-cannot-buy' })
    expect(rejected.status).toBe(402)
    expect(rejected.body.error).toBe('insufficient_paid_sweeps')
    expect(rejected.body.wallet).toMatchObject({ sweeps: 9999, paid_sweeps_cents: 0 })
  })

  it('routes recurring creator subscriptions to Connect with the server-owned split', async () => {
    const offer = await request(app)
      .post('/api/creator/offers')
      .set(authorized(seller.token))
      .send({
        offer_type: 'creator_subscription',
        name: 'TKO Creator Channel',
        description: 'Subscriber access',
        price_cents: 499,
        billing_interval: 'month',
      })
    expect(offer.status, JSON.stringify(offer.body)).toBe(201)

    stripeCalls = []
    const checkout = await request(app)
      .post('/api/creator/checkout')
      .set(authorized(buyer.token))
      .send({ offer_id: offer.body.offer.id, idempotency_key: 'monthly-channel' })
    expect(checkout.status).toBe(200)
    const session = stripeCalls.find((call) => call.path === '/checkout/sessions')
    expect(session?.params.get('mode')).toBe('subscription')
    expect(session?.params.get('subscription_data[application_fee_percent]')).toBe('20')
    expect(session?.params.get('subscription_data[transfer_data][destination]')).toBe('acct_creator_ready')
    expect(session?.params.get('line_items[0][price_data][recurring][interval]')).toBe('month')
  })

  it('keeps a purchased tournament pack active through that tournament instead of an arbitrary 30 days', async () => {
    const tournamentEnd = '2026-12-20T18:30:00.000Z'
    const tournament = (await pool.query(
      `insert into tournaments (name,created_by,status,start_at,end_at)
       values ('Winter Finals',$1,'open','2026-12-18T18:30:00.000Z',$2) returning id`,
      [seller.id, tournamentEnd],
    )).rows[0]
    const pack = await request(app)
      .post(`/api/organizer/tournaments/${tournament.id}/packs`)
      .set(authorized(seller.token))
      .send({
        name: 'Finals Flex Pack',
        description: 'One audited roster change during Winter Finals.',
        price_cents: 499,
        benefits: { roster_changes: 1, artifact_slots: 0 },
      })
    expect(pack.status, JSON.stringify(pack.body)).toBe(201)

    const bought = await request(app)
      .post('/api/creator/buy-with-sweeps')
      .set(authorized(buyer.token))
      .send({ offer_id: pack.body.pack.offer_id, idempotency_key: 'winter-finals-flex' })
    expect(bought.status, JSON.stringify(bought.body)).toBe(200)
    const entitlement = (await pool.query(
      'select status,expires_at from creator_entitlements where order_id=$1 and user_id=$2',
      [bought.body.order.id, buyer.id],
    )).rows[0]
    expect(entitlement.status).toBe('active')
    expect(new Date(entitlement.expires_at).toISOString()).toBe(tournamentEnd)
  })

  it('expires an abandoned creator checkout without granting the item', async () => {
    const listing = await createListing('TKO Expiring Crest', 299)
    const checkout = await request(app)
      .post('/api/creator/checkout')
      .set(authorized(buyer.token))
      .send({ asset_id: listing.id, idempotency_key: 'expired-creator-checkout' })
    expect(checkout.status).toBe(200)

    const expired = await sendEvent(app, {
      id: 'evt_creator_checkout_expired',
      type: 'checkout.session.expired',
      data: {
        object: {
          id: checkout.body.sessionId,
          metadata: { kind: 'creator_order', order_id: checkout.body.orderId },
        },
      },
    })
    expect(expired.status).toBe(200)
    expect((await pool.query('select status from creator_orders where id=$1', [checkout.body.orderId])).rows[0].status).toBe('expired')
    expect((await pool.query('select count(*)::int count from asset_ownership where ref_id=$1', [checkout.body.orderId])).rows[0].count).toBe(0)
  })
})
