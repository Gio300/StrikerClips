import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { PRIVACY_VERSION, TERMS_VERSION } from '../src/lib/legalVersions'

const BASE = process.env.E2E_BASE || 'http://localhost:8799'
const VIDEO_URL = process.env.E2E_ONBOARDING_VIDEO || 'https://youtu.be/e2eplay01'
const PASSWORD = 'password123'

type SeededAccount = { id: string }

async function seedAccount(
  request: APIRequestContext,
  input: { email: string; username: string },
): Promise<SeededAccount> {
  const response = await request.post(`${BASE}/api/auth/signup`, {
    data: {
      ...input,
      password: PASSWORD,
      age_consent_13_plus: true,
      terms_accepted: true,
      terms_version: TERMS_VERSION,
      privacy_accepted: true,
      privacy_version: PRIVACY_VERSION,
    },
  })
  if (!response.ok()) throw new Error(`signup failed: ${await response.text()}`)
  const body = await response.json()
  return { id: String(body.user.id) }
}

async function bearer(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem('kc_token'))
  expect(token, 'the UI signup should persist its bearer token').toBeTruthy()
  return { Authorization: `Bearer ${token}` }
}

async function apiGet(page: Page, path: string) {
  const response = await page.context().request.get(`${BASE}/api${path}`, {
    headers: await bearer(page),
  })
  if (!response.ok()) throw new Error(`${path}: ${await response.text()}`)
  return response.json()
}

async function apiPost(page: Page, path: string, data: unknown) {
  const response = await page.context().request.post(`${BASE}/api${path}`, {
    headers: await bearer(page),
    data,
  })
  if (!response.ok()) throw new Error(`${path}: ${await response.text()}`)
  return response.json()
}

async function answer(page: Page, value: string) {
  const composer = page.getByLabel('Your answer to Ask SSL')
  await expect(composer).toBeVisible()
  await composer.fill(value)
  await page.getByRole('button', { name: 'Send answer' }).click()
}

test.describe('Ask SSL onboarding - real UI and domain data', () => {
  test('signup, defer/resume, confirm, and use the resulting profile, clan, roster, YouTube, and follow', async ({ page, request }) => {
    const suffix = `${Date.now()}`.slice(-7)
    const targetUsername = `Other${suffix}`
    const target = await seedAccount(request, {
      email: `onboarding-target-${suffix}@example.com`,
      username: targetUsername,
    })
    const gameTag = `Kage${suffix}`
    const clanName = `Hidden Blood ${suffix}`
    const clanTag = `H${suffix.slice(-4)}`
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location().url ? ` (${message.location().url})` : ''
        if (
          message.location().url.endsWith('/api/connect/status')
          && message.text().includes('503')
        ) return
        errors.push(`console.error: ${message.text()}${location}`)
      }
    })
    page.on('response', (response) => {
      if (response.status() === 503 && response.url().endsWith('/api/connect/status')) return
      if (response.status() >= 400) {
        errors.push(`http ${response.status()}: ${response.url()}`)
      }
    })

    await page.goto(`${BASE}/signup?league=shinobistrikerleague`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Email').fill(`onboarding-player-${suffix}@example.com`)
    await page.getByLabel('Password', { exact: true }).fill(PASSWORD)
    await page.getByLabel('Confirm password').fill(PASSWORD)
    await page.getByLabel('I am 13 or older.').check()
    await page.getByLabel(/I agree to the Terms of Service and Privacy Policy/).check()
    await page.getByRole('button', { name: 'Create account' }).click()
    await expect(page).toHaveURL(/\/setup(?:\?|$)/, { timeout: 20_000 })
    await expect(page.getByRole('heading', { name: 'Ask SSL' })).toBeVisible()
    await expect(page.getByText('Powered by TKO.cam', { exact: true })).toBeVisible()

    // Deferring is durable, but never traps the player. Settings is the discreet
    // way back into the same server-owned conversation.
    await page.getByRole('button', { name: 'Not now' }).click()
    await expect(page).toHaveURL(`${BASE}/`)
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: /Continue setup with Ask SSL/ }).click()
    await expect(page).toHaveURL(/\/setup\?returnTo=/)
    await expect(page.getByText('Setup is paused. You can pick up right where you left off whenever you are ready.')).toBeVisible()

    await answer(
      page,
      `I'm ${gameTag}, I run ${clanName} [${clanTag}], I play Shinobi Striker on PlayStation and want to build our roster. Follow @${targetUsername}`,
    )
    await expect(page.getByText('Paste one full YouTube gameplay video.', { exact: false })).toBeVisible()
    await answer(page, VIDEO_URL)

    await expect(page.getByText('Review changes')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel(`Confirm Use ${gameTag} as my gamer tag`)).toBeChecked()
    await expect(page.getByLabel(`Confirm Create ${clanName} [${clanTag}]`)).toBeChecked()
    await expect(page.getByLabel(`Confirm Create [${clanTag}] Main roster`)).toBeChecked()
    await expect(page.getByLabel(`Confirm Follow @${targetUsername}`)).toBeChecked()
    await page.getByRole('button', { name: /Confirm selected/ }).click()
    await expect(page.getByRole('heading', { name: "You're ready" })).toBeVisible({ timeout: 30_000 })

    // Read the results through the same normal APIs used by the existing app.
    const managed = await apiGet(page, '/organizer/clans/mine')
    const clan = managed.clans.find((row: { name: string }) => row.name === clanName)
    expect(clan).toMatchObject({ name: clanName, clan_tag: clanTag, role: 'leader' })

    const dashboard = await apiGet(page, `/organizer/clans/${clan.id}/dashboard`)
    expect(dashboard.rosters).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: `[${clanTag}] Main`, members: expect.arrayContaining([
        expect.objectContaining({ member_role: 'captain' }),
      ]) }),
    ]))

    const youtube = await apiPost(page, '/fn/youtube-channel-settings', { action: 'get' })
    expect(youtube.channel).toMatchObject({ url: expect.stringContaining('youtube.com/') })

    const follows = await apiPost(page, '/db', {
      table: 'follows',
      action: 'select',
      filters: [{ col: 'following_id', op: 'eq', val: target.id }],
    })
    expect(follows.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ following_id: target.id }),
    ]))

    await page.goto(`${BASE}/profile`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Gamer tag', { exact: true })).toBeVisible()
    await expect(page.getByText(gameTag, { exact: true }).last()).toBeVisible()

    await page.goto(`${BASE}/settings#youtube`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#account-youtube-url')).toHaveValue(youtube.channel.url)

    await page.goto(`${BASE}/clans/${clan.id}/manage`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByText('Leader dashboard', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: `[${clanTag}] ${clanName}` })).toBeVisible()
    await page.getByRole('button', { name: /Competition rosters/ }).click()
    await expect(page.getByText(`[${clanTag}] Main`, { exact: true })).toBeVisible()

    await page.goto(`${BASE}/profile/${target.id}`, { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Following', exact: true })).toBeVisible()

    // The account token and completed onboarding state both survive a reload.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('button', { name: 'Following', exact: true })).toBeVisible()
    // A fresh app session shows the SSL splash before mounting onboarding.
    await page.evaluate(() => sessionStorage.removeItem('tko_splash_seen'))
    await page.goto(`${BASE}/setup`, { waitUntil: 'domcontentloaded' })
    const setupSplash = page.locator('video[src*="shinobistrikerleague-splash.mp4"]')
    await expect(setupSplash).toBeVisible()
    await expect(page.getByRole('heading', { name: "You're ready" })).toHaveCount(0)
    await expect(setupSplash).toBeHidden({ timeout: 10_000 })
    await expect(page.getByRole('heading', { name: "You're ready" })).toBeVisible()

    // SSL takeover pages may mention TKO only in the single bottom attribution.
    const visibleText = await page.locator('body').innerText()
    expect(visibleText.match(/TKO(?:\.cam)?/g) ?? []).toEqual(['TKO.cam'])

    expect(errors, `front-end errors:\n${errors.join('\n')}`).toEqual([])
  })
})
