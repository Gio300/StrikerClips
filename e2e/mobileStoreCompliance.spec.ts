import { devices, expect, test, type Page } from '@playwright/test'

const BASE = process.env.E2E_BASE || 'http://localhost:8799'

const iPhone = devices['iPhone 13']
test.use({
  viewport: iPhone.viewport,
  deviceScaleFactor: iPhone.deviceScaleFactor,
  hasTouch: iPhone.hasTouch,
  isMobile: iPhone.isMobile,
  userAgent: iPhone.userAgent,
})

async function signUpStoreReviewer(page: Page): Promise<void> {
  const stamp = Date.now().toString(36)
  const username = `store_${stamp}`

  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('striker_fan').fill(username)
  await page.getByPlaceholder('you@example.com').fill(`${username}@kc.gg`)
  await page.getByPlaceholder('••••••••').first().fill('password123')
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  await expect(page.getByText(/available/i)).toBeVisible()

  const [response] = await Promise.all([
    page.waitForResponse(
      (candidate) =>
        candidate.url().includes('/api/auth/signup') &&
        candidate.request().method() === 'POST',
    ),
    page.getByRole('button', { name: /create account/i }).click(),
  ])
  expect(response.ok()).toBe(true)
  await expect(page).not.toHaveURL(/\/signup$/)

  const identity = await page.evaluate(async () => {
    const token = localStorage.getItem('kc_token') || ''
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
    const body = await response.json()
    return { id: String(body?.user?.id || ''), token }
  })
  expect(identity.id).not.toBe('')
  expect(identity.token).not.toBe('')

  const linked = await page.evaluate(async (userId) => {
    const response = await fetch('/__e2e/mark-youtube-connected', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    })
    return response.ok
  }, identity.id)
  expect(linked).toBe(true)
}

async function activeForbiddenHrefs(page: Page) {
  return page.locator('a[href]').evaluateAll((anchors) =>
    anchors
      .map((anchor) => {
        const element = anchor as HTMLAnchorElement
        let pathname = ''
        try {
          pathname = new URL(element.href, document.baseURI).pathname
        } catch {
          // An invalid href is not an active checkout or APK destination.
        }
        return {
          text: (element.textContent || '').trim().replace(/\s+/g, ' '),
          href: element.getAttribute('href') || '',
          pathname,
        }
      })
      .filter(
        ({ href, pathname }) =>
          /\/(?:store|shop|upgrade)\/?$/.test(pathname) ||
          /\.apk(?:$|[?#])/i.test(href),
      ),
  )
}

test('mobile-store surface hides digital commerce and APK links but keeps Physical Forge', async ({
  page,
}) => {
  await signUpStoreReviewer(page)

  // Fail fast if the E2E server was not built with VITE_MOBILE_STORE_BUILD=1.
  for (const route of ['/store', '/shop', '/upgrade']) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await expect(
      page.getByRole('heading', { name: /purchases unavailable in this version/i }),
    ).toBeVisible()
  }

  const keyPages = [
    '/',
    '/forge',
    '/profile?tab=about',
    '/clans/discover',
    '/host',
    '/creator',
    '/oracle',
    '/help',
    '/marketing',
  ]

  for (const route of keyPages) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('body')).toBeVisible()
    expect(
      await activeForbiddenHrefs(page),
      `${route} exposed a digital-commerce or APK href`,
    ).toEqual([])
  }

  // Exercise the mobile More sheet too; those links are not mounted until opened.
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'More' }).click()
  await expect(page.getByRole('dialog', { name: 'TKO menu' })).toBeVisible()
  expect(await activeForbiddenHrefs(page), 'mobile More menu exposed a forbidden href').toEqual([])

  await page.goto(`${BASE}/forge`, { waitUntil: 'domcontentloaded' })
  const physicalForgeLink = page.getByRole('link', { name: /physical shirt/i }).first()
  await expect(physicalForgeLink).toBeVisible()
  await expect(physicalForgeLink).toHaveAttribute('href', '/forge/physical')
  await physicalForgeLink.click()
  await expect(page).toHaveURL(/\/forge\/physical$/)
  await expect(page.getByTestId('physical-page')).toBeVisible()
})
