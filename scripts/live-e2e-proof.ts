/* eslint-disable no-console */
import { chromium, devices } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.env.TKO_LIVE_PROOF_BASE || 'http://127.0.0.1:8799'
const OUT = path.resolve(process.env.TKO_LIVE_PROOF_OUT || 'test-results/live-proof')
const PASSWORD = 'TestOnly-Password-2026'
const PLAYER_COUNT = 8
const VIDEO_IDS = [
  'dPCS6ACHeQ0',
  'IZcwiJrMwas',
  'xU45LZvPkYg',
  '6kM_PgLUjSM',
  'dPCS6ACHeQ0',
  'IZcwiJrMwas',
  'xU45LZvPkYg',
  '6kM_PgLUjSM',
]

type User = { id: string; token: string; username: string }
type Stream = { id: string; token: string; title: string }

async function jsonRequest<T>(
  url: string,
  init: RequestInit,
  expectedStatus = 200,
): Promise<T> {
  const response = await fetch(url, init)
  const text = await response.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = { raw: text }
  }
  if (response.status !== expectedStatus) {
    throw new Error(`${init.method || 'GET'} ${url} returned ${response.status}: ${text.slice(0, 300)}`)
  }
  return body as T
}

async function createUser(index: number, runId: string): Promise<User> {
  const username = `liveproof_${runId}_${index}`
  const response = await jsonRequest<{
    token: string
    user: { id: string }
  }>(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `${username}@tko.test`,
      password: PASSWORD,
      username,
      date_of_birth: '1990-01-01',
      terms_accepted: true,
      terms_version: '2026-07-25',
      privacy_accepted: true,
      privacy_version: '2026-07-25',
    }),
  })
  // The hardened backend correctly blocks unpaid accounts from publishing a
  // live placement. The isolated E2E server grants these synthetic users the
  // creator tier without weakening any production route or policy.
  await jsonRequest(`${BASE}/__e2e/grant-creator`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: response.user.id }),
  })
  return { id: response.user.id, token: response.token, username }
}

async function createLiveStream(user: User, index: number): Promise<Stream> {
  const title = `TKO Live Proof - Player ${index + 1}`
  const response = await jsonRequest<{ data: { id: string }; error: null }>(
    `${BASE}/api/db`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        table: 'live_streams',
        action: 'insert',
        single: true,
        values: {
          user_id: user.id,
          youtube_url: `https://youtu.be/${VIDEO_IDS[index]}`,
          title,
          is_live: true,
          placement: 'front_page',
        },
      }),
    },
  )
  if (response.error !== null || !response.data?.id) {
    throw new Error(`Live stream ${index + 1} was not created`)
  }
  return { id: response.data.id, token: user.token, title }
}

async function endLiveStream(stream: Stream): Promise<void> {
  await jsonRequest(
    `${BASE}/api/db`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${stream.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        table: 'live_streams',
        action: 'update',
        single: true,
        filters: [{ col: 'id', op: 'eq', val: stream.id }],
        values: { is_live: false },
      }),
    },
  )
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const runId = Date.now().toString(36)
  const startedAt = new Date().toISOString()
  const users = await Promise.all(
    Array.from({ length: PLAYER_COUNT }, (_, index) => createUser(index, runId)),
  )
  const streams = await Promise.all(users.map(createLiveStream))
  const browser = await chromium.launch({ headless: true })

  try {
    const deviceProfiles = [
      devices['Pixel 5'],
      devices['iPhone 13'],
      devices['Galaxy S9+'],
      devices['iPhone 12'],
    ]
    const viewerContexts = await Promise.all(
      Array.from({ length: PLAYER_COUNT }, (_, index) =>
        browser.newContext({ ...deviceProfiles[index % deviceProfiles.length] }),
      ),
    )
    const viewerErrors: string[] = []
    const viewerPages = await Promise.all(
      viewerContexts.map(async (context, index) => {
        const page = await context.newPage()
        page.on('pageerror', (error) => viewerErrors.push(`viewer-${index + 1}: ${error.message}`))
        await page.goto(`${BASE}/live-streams`, { waitUntil: 'domcontentloaded' })
        // The public Live page intentionally previews four cards even when the
        // program output has eight feeds. Every concurrent viewer should still
        // receive the same live state and render the first current feed.
        await page.getByText(/TKO Live Proof - Player \d+/, { exact: true }).first().waitFor({
          state: 'visible',
          timeout: 20_000,
        })
        return page
      }),
    )

    const recordContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      recordVideo: {
        dir: OUT,
        size: { width: 1920, height: 1080 },
      },
    })
    const program = await recordContext.newPage()
    const programErrors: string[] = []
    program.on('pageerror', (error) => programErrors.push(error.message))
    await program.goto(`${BASE}/program?layout=8`, { waitUntil: 'domcontentloaded' })
    await program.waitForFunction(
      (count) => document.querySelectorAll('iframe').length === count,
      PLAYER_COUNT,
      { timeout: 25_000 },
    )
    // The global app splash is intentionally brief, but it must not be the
    // frame used to certify the populated program output.
    await program.waitForTimeout(3_500)
    const iframeCount = await program.locator('iframe').count()
    const labels = await program.locator('[data-live-feed]').count()
    await program.screenshot({
      path: path.join(OUT, 'program-8-angle-1080p.png'),
      fullPage: false,
    })

    const video = program.video()
    if (!video) throw new Error('Playwright did not start the 1080p screen recording')

    // Give the eight embeds time to move, then exercise focus switching while
    // the recording is running. The first and last panes are selected to prove
    // the program output remains interactive under capture.
    await program.waitForTimeout(4_000)
    const panes = program.locator('[data-live-feed]')
    const paneCount = await panes.count()
    if (paneCount !== PLAYER_COUNT) {
      throw new Error(`Expected ${PLAYER_COUNT} interactive panes, found ${paneCount}`)
    }
    await panes.nth(PLAYER_COUNT - 1).click()
    await program.waitForTimeout(4_000)
    await panes.nth(0).click()
    await program.waitForTimeout(3_000)

    await program.close()
    await recordContext.close()
    const recordedVideo = await video.path()

    await Promise.all(viewerPages.map((page) => page.close()))
    await Promise.all(viewerContexts.map((context) => context.close()))

    const report = {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      baseUrl: BASE,
      concurrentMobileClients: PLAYER_COUNT,
      liveStreams: streams.length,
      programIframes: iframeCount,
      observedProgramNodes: labels,
      viewerErrors,
      programErrors,
      recording: recordedVideo,
      screenshot: path.join(OUT, 'program-8-angle-1080p.png'),
    }
    if (viewerErrors.length || programErrors.length) {
      throw new Error(`Browser errors found: ${JSON.stringify({ viewerErrors, programErrors })}`)
    }
    await writeFile(path.join(OUT, 'live-proof-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    console.log(`PROOF_VIDEO=${recordedVideo}`)
  } finally {
    await Promise.allSettled(streams.map(endLiveStream))
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
