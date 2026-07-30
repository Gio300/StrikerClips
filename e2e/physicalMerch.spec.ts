import { expect, test, devices, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'

const BASE = process.env.E2E_BASE || 'http://localhost:8799'

function watch(context: BrowserContext, tag: string, errors: string[], providerCalls: string[]) {
  context.on('page', (page) => {
    page.on('pageerror', (error) => errors.push(`[${tag}] pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`[${tag}] console.error: ${message.text()}`)
    })
    page.on('request', (request) => {
      const url = request.url()
      // Loading Stripe.js elsewhere in the existing app is read-only SDK setup.
      // The dry run must never reach a payment/checkout API or either fulfillment provider.
      if (/api\.stripe\.com|checkout\.stripe\.com|shopify\.com|printful\.com/i.test(url)) {
        providerCalls.push(`[${tag}] ${url}`)
      }
    })
  })
}

async function signUp(context: BrowserContext, username: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('striker_fan').fill(username)
  await page.getByPlaceholder('you@example.com').fill(`${username}@kc.gg`)
  await page.getByPlaceholder('••••••••').first().fill('password123')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await expect(page.getByText(/available/i)).toBeVisible({ timeout: 10_000 })
  const submit = page.getByRole('button', { name: /create account/i })
  await expect(submit).toBeEnabled()
  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) => candidate.url().includes('/api/auth/signup') && candidate.request().method() === 'POST',
      { timeout: 5_000 },
    ).catch(() => null),
    submit.click(),
  ])
  if (!response) {
    const statuses = await page.getByRole('status').allInnerTexts()
    const visibleErrors = await page.locator('.text-kunai').allInnerTexts()
    throw new Error(`${username} did not submit signup: ${JSON.stringify({ statuses, visibleErrors, url: page.url() })}`)
  }
  if (!response.ok()) {
    throw new Error(`${username} signup failed (${response.status()}): ${await response.text()}`)
  }
  await expect(page).not.toHaveURL(/\/signup$/)
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('kc_token') || ''),
    { message: `${username} should have an authenticated browser token`, timeout: 20_000 },
  ).not.toBe('')
  return page
}

async function identity(page: Page, tag: string): Promise<{ id: string; token: string }> {
  const result = await page.evaluate(async () => {
    const token = localStorage.getItem('kc_token') || ''
    const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
    const body = await response.json()
    return { id: body?.user?.id ? String(body.user.id) : '', token, status: response.status, body }
  })
  if (!result.id || !result.token) {
    throw new Error(`${tag} has no authenticated identity: ${JSON.stringify(result)}`)
  }
  return { id: result.id, token: result.token }
}

async function signInAgain(page: Page, username: string) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('you@example.com').fill(`${username}@kc.gg`)
  await page.getByPlaceholder('••••••••').fill('password123')
  await page.getByRole('button', { name: /^sign in$/i }).click()
  await expect(page).not.toHaveURL(/\/login$/)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kc_token') || '')).not.toBe('')
}

async function e2ePost(page: Page, path: string, body: Record<string, unknown>) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }, { path, body })
}

test.describe('Physical Forge — real UI, shared backend, multiple bots', () => {
  let browser: Browser
  test.beforeAll(async () => { browser = await chromium.launch() })
  test.afterAll(async () => { await browser.close() })

  test('creator, host, buyer and adversary complete one safe dry run together', async () => {
    test.setTimeout(120_000)
    const errors: string[] = []
    const providerCalls: string[] = []
    const contexts = await Promise.all([
      browser.newContext({ ...devices['Desktop Chrome'] }),
      browser.newContext({ ...devices['Desktop Chrome'] }),
      browser.newContext({ ...devices['Pixel 5'] }),
      browser.newContext({ ...devices['iPhone 13'] }),
    ])
    const tags = ['creator', 'host', 'buyer', 'adversary']
    contexts.forEach((context, index) => watch(context, tags[index], errors, providerCalls))

    const stamp = String(Date.now()).slice(-8)
    const names = {
      creator: `fc_${stamp}`,
      host: `fh_${stamp}`,
      buyer: `fb_${stamp}`,
      adversary: `fa_${stamp}`,
    }
    const productTitle = `Ember Bot Mark ${stamp}`
    const [creatorPage, hostPage, buyerPage, adversaryPage] = await Promise.all([
      signUp(contexts[0], names.creator),
      signUp(contexts[1], names.host),
      signUp(contexts[2], names.buyer),
      signUp(contexts[3], names.adversary),
    ])
    const [creator, host, buyer, adversary] = await Promise.all([
      identity(creatorPage, 'creator'),
      identity(hostPage, 'host'),
      identity(buyerPage, 'buyer'),
      identity(adversaryPage, 'adversary'),
    ])
    await Promise.all([
      creatorPage.evaluate((id) => localStorage.setItem(`kc_onboarded_${id}`, '1'), creator.id),
      hostPage.evaluate((id) => localStorage.setItem(`kc_onboarded_${id}`, '1'), host.id),
      buyerPage.evaluate((id) => localStorage.setItem(`kc_onboarded_${id}`, '1'), buyer.id),
      adversaryPage.evaluate((id) => localStorage.setItem(`kc_onboarded_${id}`, '1'), adversary.id),
    ])

    await Promise.all([
      e2ePost(creatorPage, '/__e2e/mark-youtube-connected', { user_id: creator.id }),
      e2ePost(hostPage, '/__e2e/mark-youtube-connected', { user_id: host.id }),
      e2ePost(buyerPage, '/__e2e/mark-youtube-connected', { user_id: buyer.id }),
      e2ePost(adversaryPage, '/__e2e/mark-youtube-connected', { user_id: adversary.id }),
    ])
    expect((await e2ePost(creatorPage, '/__e2e/grant-creator', { user_id: creator.id })).status).toBe(200)
    expect((await e2ePost(hostPage, '/__e2e/grant-host', { user_id: host.id })).status).toBe(200)
    expect((await e2ePost(creatorPage, '/__e2e/seed-artifact', { user_id: creator.id })).status).toBe(200)
    await Promise.all([
      signInAgain(creatorPage, names.creator),
      signInAgain(hostPage, names.host),
      signInAgain(buyerPage, names.buyer),
      signInAgain(adversaryPage, names.adversary),
    ])

    await creatorPage.goto(`${BASE}/forge/physical`, { waitUntil: 'domcontentloaded' })
    await expect(creatorPage.getByTestId('physical-page')).toBeVisible()
    await expect(creatorPage.getByTestId('mode-badge')).toHaveText(/safe preview/i)
    await creatorPage.getByTestId('physical-create-tab').click()
    await expect(creatorPage.getByTestId('artifact-select').locator('option')).toHaveCount(1)
    await creatorPage.getByTestId('assist-design').click()
    await expect(creatorPage.getByRole('status')).toContainText(/design guidance ready/i)
    await creatorPage.getByTestId('product-details').click()
    await creatorPage.getByLabel('Product title').fill(productTitle)
    await creatorPage.getByTestId('artwork-url').fill(`${BASE}/features/forge.jpg`)
    await creatorPage.getByTestId('rights-attestation').check()
    await creatorPage.getByTestId('submit-product').click()
    await expect(creatorPage.getByRole('status')).toContainText(/submitted for tko review/i)
    await expect(creatorPage.getByTestId('my-products')).toContainText(/pending review/i)

    await hostPage.goto(`${BASE}/forge/physical`, { waitUntil: 'domcontentloaded' })
    await hostPage.getByTestId('physical-host-tab').click()
    await expect(hostPage.getByRole('heading', { name: /host operations/i })).toBeVisible()
    await expect(hostPage.getByTestId('review-queue')).toContainText(productTitle)
    await hostPage.getByTestId('approve-product').click()
    await expect(hostPage.getByRole('status')).toContainText(/approved and mirrored/i)

    await buyerPage.goto(`${BASE}/forge`, { waitUntil: 'domcontentloaded' })
    await expect(buyerPage.getByRole('link', { name: /physical shirt/i })).toBeVisible()
    await buyerPage.getByRole('link', { name: /physical shirt/i }).click()
    await expect(buyerPage).toHaveURL(/\/forge\/physical$/)
    const productCard = buyerPage.getByTestId('product-card').filter({ hasText: productTitle })
    await expect(productCard).toContainText(productTitle)
    await productCard.getByTestId('buy-product').click()
    await expect(buyerPage.getByTestId('checkout-panel')).toBeVisible()
    await buyerPage.getByTestId('simulate-paid').click()
    await expect(buyerPage.getByRole('status')).toContainText(/dry-run paid/i)
    await buyerPage.getByRole('button', { name: /^orders$/i }).click()
    await expect(buyerPage.getByTestId('order-card')).toContainText(/fulfillment held/i)

    await adversaryPage.goto(`${BASE}/forge/physical`, { waitUntil: 'domcontentloaded' })
    await expect(adversaryPage.getByRole('heading', { name: /host operations/i })).toHaveCount(0)
    const stateBefore = await adversaryPage.evaluate(async () => (await fetch('/__e2e/physical-state')).json())
    const createdProduct = stateBefore.products.find((product: any) => product.title === productTitle)
    expect(createdProduct).toBeTruthy()
    const denied = await fetch(`${BASE}/api/physical/products/${String(createdProduct.id)}/review`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adversary.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: 'reject' }),
    })
    expect(denied.status).toBe(403)

    await hostPage.reload({ waitUntil: 'domcontentloaded' })
    await hostPage.getByTestId('physical-host-tab').click()
    const hostOrder = hostPage.getByTestId('host-order').filter({ hasText: productTitle })
    await expect(hostOrder.getByTestId('simulate-shipped')).toBeVisible()
    await hostOrder.getByTestId('simulate-shipped').click()
    await expect(hostPage.getByRole('status')).toContainText(/shipment recorded/i)
    await hostPage.getByTestId('release-payouts').click()
    await expect(hostPage.getByRole('status')).toContainText(/1 creator payout released/i)

    const state = await hostPage.evaluate(async () => (await fetch('/__e2e/physical-state')).json())
    const product = state.products.find((item: any) => item.title === productTitle)
    expect(product).toMatchObject({ status: 'approved' })
    expect(String(product.shopify_product_gid)).toMatch(/^gid:\/\/shopify\/Product\//)
    const order = state.orders.find((item: any) => item.buyer_id === buyer.id)
    expect(order).toMatchObject({ status: 'shipped', dry_run: true })
    expect(String(order.shopify_order_gid)).toMatch(/^gid:\/\/shopify\/Order\//)
    expect(String(order.provider_order_id)).toMatch(/^pf_sim_draft_/)
    const earnings = state.earnings.filter((item: any) => item.order_id === order.id)
    expect(earnings).toHaveLength(1)
    expect(earnings[0]).toMatchObject({ status: 'transferred' })
    expect(state.events.filter((event: any) => event.order_id === order.id && event.topic === 'paid_order_mirror')).toHaveLength(1)
    expect(state.events.filter((event: any) => event.order_id === order.id && event.topic === 'provider_draft')).toHaveLength(1)
    expect(providerCalls, `unexpected provider browser calls:\n${providerCalls.join('\n')}`).toEqual([])
    expect(errors, `front-end errors:\n${errors.join('\n')}`).toEqual([])

    await Promise.all(contexts.map((context) => context.close()))
  })
})
