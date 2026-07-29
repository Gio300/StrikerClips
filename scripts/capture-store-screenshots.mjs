import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.TKO_STORE_PREVIEW_URL || 'http://127.0.0.1:8798'
const token = process.env.TKO_REVIEW_TOKEN
if (!token) throw new Error('TKO_REVIEW_TOKEN is required')

const outputRoot = path.resolve('store-assets', 'screenshots')
const routes = [
  ['01-home', '/'],
  ['02-create-highlight', '/reels/create'],
  ['03-watch', '/reels'],
  ['04-tko-king', '/king'],
  ['05-oracle', '/oracle'],
]

const targets = [
  { folder: 'apple-iphone-6.9', width: 430, height: 932, scale: 3 },
  { folder: 'apple-ipad-13', width: 1032, height: 1376, scale: 2 },
  { folder: 'google-phone', width: 432, height: 768, scale: 2.5 },
]

const browser = await chromium.launch({ headless: true })
try {
  for (const target of targets) {
    const outputDir = path.join(outputRoot, target.folder)
    await mkdir(outputDir, { recursive: true })
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
      deviceScaleFactor: target.scale,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    })
    await context.addInitScript((reviewToken) => {
      window.localStorage.setItem('kc_token', reviewToken)
      window.localStorage.setItem('tko_onboarding_complete', '1')
      window.sessionStorage.setItem('tko_splash_seen', '1')
    }, token)
    const page = await context.newPage()

    for (const [name, route] of routes) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3000)
      const laterButton = page.getByRole('button', { name: 'Later', exact: true })
      if (await laterButton.isVisible().catch(() => false)) {
        await laterButton.click()
        await page.waitForTimeout(500)
      }
      const skipButton = page.getByRole('button', { name: 'Skip', exact: true })
      if (await skipButton.isVisible().catch(() => false)) {
        await skipButton.click()
        await page.waitForTimeout(500)
      }
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.screenshot({
        path: path.join(outputDir, `${name}.png`),
        fullPage: false,
        animations: 'disabled',
      })
    }
    await context.close()
  }
} finally {
  await browser.close()
}
