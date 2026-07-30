import { test, expect, devices, chromium, type Browser, type BrowserContext } from '@playwright/test'

// ===========================================================================
// FRONT-END, MULTIPLE CLIENTS AT ONCE (the "many emulators" test).
//
// Several device contexts (iPhone + Pixel profiles) drive the REAL built UI at
// the same time against one shared backend, so they genuinely coexist. We assert
// the UI actually renders and the happy path completes, AND we fail on any
// uncaught page error / console error — the front-end bugs an API test can't see.
// ===========================================================================

const BASE = process.env.E2E_BASE || 'http://localhost:8799'

// Attach error collectors to a context's pages so a render crash or a thrown
// exception anywhere becomes a hard failure with the message attached.
function watch(ctx: BrowserContext, tag: string, errors: string[]) {
  ctx.on('page', (page) => {
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${tag}] console.error: ${m.text()}`) })
  })
}

async function signUpThroughUI(ctx: BrowserContext, u: { username: string; email: string }) {
  const page = await ctx.newPage()
  await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' })
  await page.getByPlaceholder('striker_fan').fill(u.username)
  await page.getByPlaceholder('you@example.com').fill(u.email)
  await page.getByPlaceholder('••••••••').first().fill('password123')
  // The 13+ and Terms checkboxes gate the submit button.
  await page.getByRole('checkbox').nth(0).check()
  await page.getByRole('checkbox').nth(1).check()
  // Username availability check is async; wait for the submit button to enable.
  const submit = page.getByRole('button', { name: /create account/i })
  await expect(submit).toBeEnabled({ timeout: 15_000 })
  await submit.click()
  return page
}

test.describe('front end — concurrent multi-device clients', () => {
  let browser: Browser
  test.beforeAll(async () => { browser = await chromium.launch() })
  test.afterAll(async () => { await browser.close() })

  test('four devices sign up and land authenticated at the same time, no UI errors', async () => {
    const profiles = [
      { tag: 'iphone-a', device: devices['iPhone 13'] },
      { tag: 'iphone-b', device: devices['iPhone 13'] },
      { tag: 'pixel-a', device: devices['Pixel 5'] },
      { tag: 'pixel-b', device: devices['Pixel 5'] },
    ]
    const errors: string[] = []
    const contexts = await Promise.all(profiles.map((p) => browser.newContext({ ...p.device })))
    contexts.forEach((c, i) => watch(c, profiles[i].tag, errors))

    // All four sign up simultaneously.
    const uniq = Date.now()
    const pages = await Promise.all(
      contexts.map((c, i) => signUpThroughUI(c, { username: `dev${i}_${uniq}`, email: `dev${i}_${uniq}@kc.gg` })),
    )

    // Each must leave /signup for an authenticated view (the app navigates to
    // `from || '/'` on success) and must not be sitting on an error.
    for (let i = 0; i < pages.length; i++) {
      await expect(pages[i], `${profiles[i].tag} should leave /signup`).not.toHaveURL(/\/signup$/, { timeout: 20_000 })
    }

    // Drive a core authenticated page on each and confirm it renders.
    await Promise.all(pages.map(async (page) => {
      await page.goto(`${BASE}/live`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: /live/i }).first()).toBeVisible({ timeout: 15_000 })
    }))

    for (const c of contexts) await c.close()
    expect(errors, `front-end errors:\n${errors.join('\n')}`).toEqual([])
  })

  test('bad signup is stopped by the UI, not the server (friction handling)', async () => {
    const ctx = await browser.newContext({ ...devices['Pixel 5'] })
    const errs: string[] = []
    watch(ctx, 'adversary', errs)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' })
    // Underage DOB + no terms — the submit button must stay disabled and we must
    // No age attestation (even with Terms accepted) keeps the submit disabled.
    // This is the "guardrail keeps a confused user on
    // track instead of erroring" behavior.
    await page.getByPlaceholder('striker_fan').fill(`kid_${Date.now()}`)
    await page.getByPlaceholder('you@example.com').fill(`kid_${Date.now()}@kc.gg`)
    await page.getByPlaceholder('••••••••').first().fill('password123')
    await page.getByRole('checkbox').nth(1).check()
    const submit = page.getByRole('button', { name: /create account/i })
    await expect(submit).toBeDisabled()
    await expect(page).toHaveURL(/\/signup$/)
    await ctx.close()
    expect(errs, errs.join('\n')).toEqual([])
  })
})
