/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The league-OWNER purchase path, end to end against the real createApp
 * handlers and a real (in-memory) SQL engine.
 *
 * Covers the five things that decide whether this can take real money safely:
 *   1. checkout session creation (and that the SERVER picks the price)
 *   2. webhook grant + REPLAY idempotency
 *   3. the lead-capture fallback when no Stripe price is configured
 *   4. entitlement gating — a paid plan changes what the product serves
 *   5. that a league owner cannot write their own plan through /api/db
 *
 * Stripe is stubbed at `fetch` exactly as server/app.test.ts does it, so no
 * network call leaves the test and no key is ever needed.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createHmac } from 'node:crypto'
import { makeDb } from './testHarness'
import { createApp } from './app'

const WEBHOOK_SECRET = 'whsec_league_test_secret'
const ADULT_DOB = '1990-01-01'

type Who = { token: string; id: string; email: string }
type StripeCall = { path: string; params: URLSearchParams }

let stripeCalls: StripeCall[] = []
let realFetch: typeof globalThis.fetch
let pool: any
let app: any

function stripeStub(path: string): any {
  if (path === '/customers') return { id: 'cus_league_1' }
  if (path === '/checkout/sessions') {
    return { id: 'cs_league_1', url: 'https://checkout.stripe.com/c/pay/cs_league_1' }
  }
  return {}
}

function installStripeStub() {
  realFetch = globalThis.fetch
  globalThis.fetch = (async (url: any, init: any) => {
    const path = String(url).replace('https://api.stripe.com/v1', '')
    stripeCalls.push({ path, params: new URLSearchParams(String(init?.body ?? '')) })
    return { ok: true, status: 200, json: async () => stripeStub(path) } as any
  }) as typeof globalThis.fetch
}

/** The Stripe-Signature header, built the way Stripe builds it. */
function signWebhook(payload: string, secret = WEBHOOK_SECRET): string {
  const t = Math.floor(Date.now() / 1000)
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex')
  return `t=${t},v1=${v1}`
}

/**
 * POST a correctly-signed event. The payload goes as a STRING: superagent
 * re-serializes a Buffer under application/json, which changes the bytes and
 * breaks the HMAC (the signature covers the exact raw body).
 */
function sendEvent(event: any) {
  const payload = JSON.stringify(event)
  return request(app).post('/api/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signWebhook(payload))
    .send(payload)
}

async function signUp(email: string, username: string): Promise<Who> {
  const r = await request(app).post('/api/auth/signup')
    .send({ email, password: 'password123', username, date_of_birth: ADULT_DOB })
  expect(r.status).toBe(200)
  return { token: r.body.token, id: r.body.user.id, email }
}

const auth = (r: request.Test, who: Who) => r.set('Authorization', `Bearer ${who.token}`)

async function leagueRow(slug: string): Promise<any> {
  const r = await pool.query('select * from leagues where slug=$1', [slug])
  return r.rows[0] || null
}

/** A completed league-plan checkout session, as Stripe delivers it. */
function checkoutEvent(over: {
  id?: string
  userId: string
  leagueId: string
  slug: string
  plan: string
  paid?: boolean
}) {
  return {
    id: over.id ?? 'evt_league_1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_league_1',
        mode: 'subscription',
        payment_status: over.paid === false ? 'unpaid' : 'paid',
        customer: 'cus_league_1',
        subscription: 'sub_league_1',
        amount_total: 14900,
        currency: 'usd',
        client_reference_id: over.userId,
        metadata: {
          kind: 'league_plan',
          user_id: over.userId,
          league_plan: over.plan,
          league_id: over.leagueId,
          league_slug: over.slug,
        },
      },
    },
  }
}

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_league_stub'
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET
  process.env.STRIPE_PRICE_LEAGUE_STARTER = 'price_league_starter'
  process.env.STRIPE_PRICE_LEAGUE_PRO = 'price_league_pro'
  // DYNASTY IS DELIBERATELY LEFT UNCONFIGURED — it exercises the lead fallback,
  // which is the state the operator's account is actually in today.
  delete process.env.STRIPE_PRICE_LEAGUE_DYNASTY
  installStripeStub()
})

afterAll(() => {
  globalThis.fetch = realFetch
  delete process.env.STRIPE_SECRET_KEY
  delete process.env.STRIPE_WEBHOOK_SECRET
  delete process.env.STRIPE_PRICE_LEAGUE_STARTER
  delete process.env.STRIPE_PRICE_LEAGUE_PRO
})

beforeEach(() => {
  pool = makeDb()
  app = createApp(pool)
  stripeCalls = []
})

// ───────────────────────────────────────────────────────────────────────────
//  1. Plan config + checkout session creation
// ───────────────────────────────────────────────────────────────────────────

describe('league plans — what the UI is told', () => {
  it('reports which plans can be charged, without leaking a price id', async () => {
    const r = await request(app).get('/api/league/plans')
    expect(r.status).toBe(200)
    expect(r.body.configured).toBe(true)
    expect(r.body.purchasable).toEqual({
      starter: true,
      pro: true,
      dynasty: false,     // no STRIPE_PRICE_LEAGUE_DYNASTY set
      enterprise: false,  // never purchasable by design
    })
    expect(JSON.stringify(r.body)).not.toContain('price_league_pro')
  })
})

describe('POST /api/league/checkout', () => {
  it('requires authentication — a league needs an owner', async () => {
    const r = await request(app).post('/api/league/checkout')
      .send({ plan: 'pro', leagueName: 'Anon', leagueSlug: 'anon' })
    expect(r.status).toBe(401)
  })

  it('opens a session, reserves the league, and lets the SERVER pick the price', async () => {
    const owner = await signUp('owner@kc.gg', 'leagueowner')
    const r = await auth(request(app).post('/api/league/checkout'), owner)
      .send({ plan: 'pro', leagueName: 'Shinobi Striker', leagueSlug: 'shinobi' })
    expect(r.status).toBe(200)
    expect(r.body.url).toContain('checkout.stripe.com')

    const session = stripeCalls.find((c) => c.path === '/checkout/sessions')!
    expect(session.params.get('mode')).toBe('subscription')
    // The price comes from STRIPE_PRICE_LEAGUE_PRO, never from the request.
    expect(session.params.get('line_items[0][price]')).toBe('price_league_pro')
    // THE NAMESPACE THAT KEEPS THE LADDERS APART.
    expect(session.params.get('metadata[kind]')).toBe('league_plan')
    expect(session.params.get('metadata[league_plan]')).toBe('pro')
    expect(session.params.get('subscription_data[metadata][kind]')).toBe('league_plan')
    // A league checkout must NEVER set metadata[tier]: 'pro' is also a MEMBER
    // tier key, and the member webhook branch would grant a free subscription.
    expect(session.params.get('metadata[tier]')).toBeNull()
    expect(session.params.get('subscription_data[metadata][tier]')).toBeNull()

    // The league is reserved but NOT yet entitled.
    const row = await leagueRow('shinobi')
    expect(row.owner_id).toBe(owner.id)
    expect(row.tier).toBe('pro')
    expect(row.plan_status).toBe('none')

    const purchase = await pool.query('select * from league_plan_purchases where league_slug=$1', ['shinobi'])
    expect(purchase.rows[0].status).toBe('pending')
    expect(purchase.rows[0].plan).toBe('pro')
  })

  it('refuses a slug that belongs to somebody else, before taking a card', async () => {
    const a = await signUp('a@kc.gg', 'ownera')
    const b = await signUp('b@kc.gg', 'ownerb')
    await auth(request(app).post('/api/league/checkout'), a)
      .send({ plan: 'pro', leagueName: 'Mine', leagueSlug: 'contested' })
    stripeCalls = []
    const r = await auth(request(app).post('/api/league/checkout'), b)
      .send({ plan: 'pro', leagueName: 'Also mine', leagueSlug: 'contested' })
    expect(r.status).toBe(409)
    expect(r.body.error).toBe('slug_taken')
    expect(stripeCalls.some((c) => c.path === '/checkout/sessions')).toBe(false)
  })

  it('rejects an unknown plan and a member tier key', async () => {
    const owner = await signUp('c@kc.gg', 'ownerc')
    for (const plan of ['supporter', 'creator', 'nonsense', '']) {
      const r = await auth(request(app).post('/api/league/checkout'), owner)
        .send({ plan, leagueName: 'X', leagueSlug: 'xleague' })
      expect(r.status, plan).toBe(400)
    }
  })

  it('refuses to open a checkout for enterprise', async () => {
    const owner = await signUp('d@kc.gg', 'ownerd')
    const r = await auth(request(app).post('/api/league/checkout'), owner)
      .send({ plan: 'enterprise', leagueName: 'Big', leagueSlug: 'bigleague' })
    expect(r.status).toBe(400)
    expect(r.body.error).toBe('not_purchasable')
  })

  it('rejects a malformed slug', async () => {
    const owner = await signUp('e@kc.gg', 'ownere')
    for (const slug of ['-nope', 'Has Caps', 'sym$bols', '']) {
      const r = await auth(request(app).post('/api/league/checkout'), owner)
        .send({ plan: 'pro', leagueName: 'X', leagueSlug: slug })
      expect(r.status, slug).toBe(400)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  2. Lead capture — the degrade path
// ───────────────────────────────────────────────────────────────────────────

describe('lead capture when there is no Stripe price', () => {
  it('captures instead of failing when the plan has no price configured', async () => {
    const owner = await signUp('f@kc.gg', 'ownerf')
    const r = await auth(request(app).post('/api/league/checkout'), owner)
      .send({ plan: 'dynasty', leagueName: 'Dynasty FC', leagueSlug: 'dynastyfc' })
    // NOT an error: the prospect is kept.
    expect(r.status).toBe(200)
    expect(r.body.lead).toBe(true)
    expect(r.body.reason).toBe('no_price')
    expect(stripeCalls.some((c) => c.path === '/checkout/sessions')).toBe(false)

    const lead = await pool.query('select * from league_leads where plan=$1', ['dynasty'])
    expect(lead.rows[0].email).toBe('f@kc.gg')
    expect(lead.rows[0].league_name).toBe('Dynasty FC')
    expect(lead.rows[0].source).toBe('no_price')
    // Nothing was granted.
    expect(await leagueRow('dynastyfc')).toBeNull()
  })

  it('takes an enterprise lead from a SIGNED-OUT visitor', async () => {
    const r = await request(app).post('/api/league/lead')
      .send({ email: 'boss@bigleague.com', plan: 'enterprise', leagueName: 'Big League' })
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    const lead = await pool.query('select * from league_leads where plan=$1', ['enterprise'])
    expect(lead.rows[0].email).toBe('boss@bigleague.com')
    expect(lead.rows[0].source).toBe('enterprise')
    expect(lead.rows[0].user_id).toBeNull()
  })

  it('deduplicates a prospect who mashes the button', async () => {
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/api/league/lead')
        .send({ email: 'Repeat@Example.com', plan: 'enterprise', leagueName: `Try ${i}` })
      expect(r.status).toBe(200)
    }
    const leads = await pool.query('select * from league_leads')
    expect(leads.rows.length).toBe(1)
    // The newest league name wins rather than the write erroring.
    expect(leads.rows[0].league_name).toBe('Try 2')
  })

  it('rejects a junk email or an unknown plan', async () => {
    const bad = await request(app).post('/api/league/lead')
      .send({ email: 'not-an-email', plan: 'enterprise' })
    expect(bad.status).toBe(400)
    const badPlan = await request(app).post('/api/league/lead')
      .send({ email: 'ok@example.com', plan: 'supporter' })
    expect(badPlan.status).toBe(400)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  3. The webhook — grant, and survive a replay
// ───────────────────────────────────────────────────────────────────────────

describe('league plan webhook fulfilment', () => {
  async function reserve(who: Who, plan: string, slug: string) {
    await auth(request(app).post('/api/league/checkout'), who)
      .send({ plan, leagueName: 'Reserved', leagueSlug: slug })
    return leagueRow(slug)
  }

  it('turns the plan on for a paid session and makes the buyer the owner', async () => {
    const owner = await signUp('g@kc.gg', 'ownerg')
    const league = await reserve(owner, 'pro', 'granted')

    const r = await sendEvent(checkoutEvent({
      userId: owner.id, leagueId: league.id, slug: 'granted', plan: 'pro',
    }))
    expect(r.status).toBe(200)

    const row = await leagueRow('granted')
    expect(row.plan_status).toBe('active')
    expect(row.tier).toBe('pro')
    // Derived from the PLAN, not from anything the client sent.
    expect(row.video_ownership).toBe('league')
    expect(row.stripe_subscription_id).toBe('sub_league_1')

    const member = await pool.query(
      'select role from league_members where league_id=$1 and user_id=$2', [league.id, owner.id],
    )
    expect(member.rows[0].role).toBe('owner')

    const purchase = await pool.query('select * from league_plan_purchases where league_slug=$1', ['granted'])
    expect(purchase.rows[0].status).toBe('paid')
  })

  /**
   * Stripe delivers AT LEAST ONCE and retries every non-2xx for three days, so
   * "grant this plan" will eventually arrive twice. Replaying must converge on
   * the same row — never a second membership, never a second receipt.
   */
  it('is idempotent across a replay of the SAME event', async () => {
    const owner = await signUp('h@kc.gg', 'ownerh')
    const league = await reserve(owner, 'pro', 'replay')
    const event = checkoutEvent({
      userId: owner.id, leagueId: league.id, slug: 'replay', plan: 'pro',
    })

    const first = await sendEvent(event)
    expect(first.body.duplicate).toBeUndefined()
    const second = await sendEvent(event)
    expect(second.status).toBe(200)
    expect(second.body.duplicate).toBe(true)

    const row = await leagueRow('replay')
    expect(row.plan_status).toBe('active')
    const members = await pool.query('select * from league_members where league_id=$1', [league.id])
    expect(members.rows.length).toBe(1)
    const purchases = await pool.query('select * from league_plan_purchases where league_slug=$1', ['replay'])
    expect(purchases.rows.length).toBe(1)
  })

  /**
   * The event-id claim is a fast path, not the safety net. A redelivery under a
   * NEW event id (Stripe does this across endpoint reconfigurations) must still
   * converge, because every statement in the grant is an absolute SET.
   */
  it('converges when the same purchase arrives under a different event id', async () => {
    const owner = await signUp('i@kc.gg', 'owneri')
    const league = await reserve(owner, 'pro', 'reconverge')
    await sendEvent(checkoutEvent({
      id: 'evt_a', userId: owner.id, leagueId: league.id, slug: 'reconverge', plan: 'pro',
    }))
    await sendEvent(checkoutEvent({
      id: 'evt_b', userId: owner.id, leagueId: league.id, slug: 'reconverge', plan: 'pro',
    }))
    const row = await leagueRow('reconverge')
    expect(row.plan_status).toBe('active')
    const members = await pool.query('select * from league_members where league_id=$1', [league.id])
    expect(members.rows.length).toBe(1)
  })

  it('grants NOTHING when the session was not actually paid', async () => {
    const owner = await signUp('j@kc.gg', 'ownerj')
    const league = await reserve(owner, 'pro', 'unpaidleague')
    await sendEvent(checkoutEvent({
      userId: owner.id, leagueId: league.id, slug: 'unpaidleague', plan: 'pro', paid: false,
    }))
    const row = await leagueRow('unpaidleague')
    expect(row.plan_status).toBe('none')
  })

  /**
   * The single most dangerous confusion in this feature: a LEAGUE plan called
   * 'pro' must never be mistaken for the MEMBER tier 'pro' and hand the buyer a
   * free $4.99 personal subscription.
   */
  it('never grants a MEMBER subscription from a league purchase', async () => {
    const owner = await signUp('k@kc.gg', 'ownerk')
    const league = await reserve(owner, 'pro', 'noleak')
    await sendEvent(checkoutEvent({
      userId: owner.id, leagueId: league.id, slug: 'noleak', plan: 'pro',
    }))
    const me = await auth(request(app).get('/api/auth/me') as any, owner)
    expect(String(me.body.user?.user_metadata?.reelone_tier ?? '')).toBe('')
  })

  it('refuses to re-point a league owned by somebody else', async () => {
    const owner = await signUp('l@kc.gg', 'ownerl')
    const attacker = await signUp('m@kc.gg', 'attacker')
    const league = await reserve(owner, 'pro', 'notyours')
    // A forged event naming the attacker as the buyer of someone else's league.
    await sendEvent(checkoutEvent({
      userId: attacker.id, leagueId: league.id, slug: 'notyours', plan: 'pro',
    }))
    const row = await leagueRow('notyours')
    expect(row.owner_id).toBe(owner.id)
    expect(row.plan_status).toBe('none')
  })

  it('lapses the plan when the subscription is cancelled', async () => {
    const owner = await signUp('n@kc.gg', 'ownern')
    const league = await reserve(owner, 'pro', 'lapsing')
    await sendEvent(checkoutEvent({
      userId: owner.id, leagueId: league.id, slug: 'lapsing', plan: 'pro',
    }))
    expect((await leagueRow('lapsing')).plan_status).toBe('active')

    await sendEvent({
      id: 'evt_cancel',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_league_1', status: 'canceled', metadata: { kind: 'league_plan', league_id: league.id } } },
    })
    const row = await leagueRow('lapsing')
    expect(row.plan_status).toBe('canceled')
    // The claim to own the videos stops the moment the money stops.
    expect(row.video_ownership).toBe('tko')
    // `tier` is kept so the receipt and the win-back know which plan they had.
    expect(row.tier).toBe('pro')
  })

  it('lapses to past_due when a renewal invoice fails, then restores on payment', async () => {
    const owner = await signUp('o@kc.gg', 'ownero')
    const league = await reserve(owner, 'pro', 'dunning')
    await sendEvent(checkoutEvent({
      userId: owner.id, leagueId: league.id, slug: 'dunning', plan: 'pro',
    }))

    await sendEvent({
      id: 'evt_fail',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_1', subscription: 'sub_league_1', customer: 'cus_league_1', amount_due: 14900 } },
    })
    expect((await leagueRow('dunning')).plan_status).toBe('past_due')

    await sendEvent({
      id: 'evt_paid',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_2', subscription: 'sub_league_1', customer: 'cus_league_1',
          lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 2592000 } }] },
        },
      },
    })
    const row = await leagueRow('dunning')
    expect(row.plan_status).toBe('active')
    expect(row.video_ownership).toBe('league')
  })

  it('does not strip the owner\'s MEMBER tier when their LEAGUE renewal fails', async () => {
    const owner = await signUp('p@kc.gg', 'ownerp')
    const league = await reserve(owner, 'pro', 'twohats')
    await sendEvent(checkoutEvent({
      userId: owner.id, leagueId: league.id, slug: 'twohats', plan: 'pro',
    }))
    // The same human also pays for a personal Legend membership.
    await pool.query(
      `update users set user_metadata=$1 where id=$2`,
      [JSON.stringify({ reelone_tier: 'creator', reelone_tier_expires: new Date(Date.now() + 1e9).toISOString() }), owner.id],
    )
    await sendEvent({
      id: 'evt_league_fail',
      type: 'invoice.payment_failed',
      data: { object: { id: 'in_3', subscription: 'sub_league_1', customer: 'cus_league_1', amount_due: 14900 } },
    })
    const me = await auth(request(app).get('/api/auth/me') as any, owner)
    expect(String(me.body.user?.user_metadata?.reelone_tier ?? '')).toBe('creator')
    expect((await leagueRow('twohats')).plan_status).toBe('past_due')
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  4. Entitlement — paying changes what the product SERVES
// ───────────────────────────────────────────────────────────────────────────

describe('entitlement gating on GET /api/league/:slug/config', () => {
  async function seed(slug: string, tier: string, planStatus: string, ownership = 'league') {
    await pool.query(
      `insert into leagues (slug, name, tier, plan_status, video_ownership)
       values ($1,$2,$3,$4,$5)`,
      [slug, slug.toUpperCase(), tier, planStatus, ownership],
    )
  }

  it('serves an unpaid league as tko-owned with TKO branding, whatever its row says', async () => {
    // The row CLAIMS dynasty + league ownership; none of it was paid for.
    await seed('freeloader', 'dynasty', 'none', 'league')
    const r = await request(app).get('/api/league/freeloader/config')
    expect(r.status).toBe(200)
    expect(r.body.video_ownership).toBe('tko')
    expect(r.body.clean_brand).toBe(false)
    expect(r.body.plan_status).toBe('none')
    expect(r.body.entitlements.league_video_ownership).toBe(false)
    expect(r.body.entitlements.custom_domain).toBe(false)
  })

  it('serves a paid Pro league as league-owned but still TKO-branded', async () => {
    await seed('paidpro', 'pro', 'active')
    const r = await request(app).get('/api/league/paidpro/config')
    expect(r.body.video_ownership).toBe('league')
    expect(r.body.clean_brand).toBe(false)
    expect(r.body.entitlements.league_posting).toBe(true)
    expect(r.body.entitlements.custom_domain).toBe(true)
  })

  /**
   * The white-label switch the render factory actually reads: with clean_brand
   * true, Loras/common/tko_vertical.py stops compositing the TKO watermark and
   * tko_factory.py stops appending the TKO pitch line, site and hashtags.
   */
  it('serves clean_brand for a paid Dynasty league', async () => {
    await seed('paiddynasty', 'dynasty', 'active')
    const r = await request(app).get('/api/league/paiddynasty/config')
    expect(r.body.clean_brand).toBe(true)
    expect(r.body.entitlements.clean_brand).toBe(true)
  })

  it('withdraws white-label the moment the plan lapses', async () => {
    await seed('lapsed', 'dynasty', 'past_due')
    const r = await request(app).get('/api/league/lapsed/config')
    expect(r.body.clean_brand).toBe(false)
    expect(r.body.video_ownership).toBe('tko')
  })

  it('keeps a comped house league fully entitled', async () => {
    await seed('housebrand', 'pro', 'comped')
    const r = await request(app).get('/api/league/housebrand/config')
    expect(r.body.video_ownership).toBe('league')
    expect(r.body.entitlements.custom_domain).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
//  5. The bypass this feature had to close
// ───────────────────────────────────────────────────────────────────────────

describe('a league owner cannot write their own plan', () => {
  /**
   * `leagues` is insert:'owner' / write:'ownerOrElevated', so before these
   * columns became PRIVILEGE_COLS a league owner could simply POST their own
   * row with tier='dynasty' and take white-label, their own domain and video
   * ownership without ever opening a checkout.
   */
  it('scrubs tier / plan_status / video_ownership from a client INSERT', async () => {
    const owner = await signUp('q@kc.gg', 'ownerq')
    const r = await auth(request(app).post('/api/db'), owner).send({
      action: 'insert',
      table: 'leagues',
      values: {
        slug: 'selfserve', name: 'Self Serve',
        tier: 'dynasty', plan_status: 'active', video_ownership: 'league',
      },
    })
    expect(r.status).toBe(200)
    const row = await leagueRow('selfserve')
    expect(row.tier).toBe('starter')       // the column default, not 'dynasty'
    expect(row.plan_status).toBe('none')
    expect(row.video_ownership).toBe('tko')

    // And the served config gives them nothing.
    const cfg = await request(app).get('/api/league/selfserve/config')
    expect(cfg.body.clean_brand).toBe(false)
    expect(cfg.body.entitlements.league_video_ownership).toBe(false)
  })

  it('scrubs the same columns from a client UPDATE of a league they own', async () => {
    const owner = await signUp('r@kc.gg', 'ownerr')
    await auth(request(app).post('/api/db'), owner).send({
      action: 'insert', table: 'leagues', values: { slug: 'upgrade-me', name: 'Upgrade Me' },
    })
    const before = await leagueRow('upgrade-me')
    const r = await auth(request(app).post('/api/db'), owner).send({
      action: 'update',
      table: 'leagues',
      match: { id: before.id },
      values: { name: 'Renamed', tier: 'dynasty', plan_status: 'active' },
    })
    expect(r.status).toBe(200)
    const row = await leagueRow('upgrade-me')
    expect(row.name).toBe('Renamed')   // the legitimate edit still lands
    expect(row.tier).toBe('starter')   // the privilege escalation does not
    expect(row.plan_status).toBe('none')
  })
})
