import { dataUrlBytes } from '@/lib/avatar'

export const LIVE_BANNER_WIDTH = 1600
export const LIVE_BANNER_HEIGHT = 900
export const LIVE_BANNER_MAX_BYTES = 600_000
const LIVE_BANNER_MAX_SOURCE_BYTES = 12_000_000

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function bannerLabel(value: string | null | undefined, fallback: string): string {
  const clean = (value ?? '').trim().replace(/\s+/g, ' ')
  return escapeXml((clean || fallback).slice(0, 36).toUpperCase())
}

/** The editable TKO template before it is flattened to a compact JPEG. */
export function buildLiveBannerSvg(input: {
  title?: string | null
  teamA?: string | null
  teamB?: string | null
}): string {
  const title = bannerLabel(input.title, 'LIVE MATCH')
  const teamA = bannerLabel(input.teamA, 'TEAM A')
  const teamB = bannerLabel(input.teamB, 'TEAM B')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LIVE_BANNER_WIDTH}" height="${LIVE_BANNER_HEIGHT}" viewBox="0 0 ${LIVE_BANNER_WIDTH} ${LIVE_BANNER_HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" x2="1"><stop stop-color="#07181d"/><stop offset=".5" stop-color="#090a10"/><stop offset="1" stop-color="#2a0d08"/></linearGradient>
    <radialGradient id="cyan"><stop stop-color="#31d2dc" stop-opacity=".34"/><stop offset="1" stop-color="#31d2dc" stop-opacity="0"/></radialGradient>
    <radialGradient id="coral"><stop stop-color="#ff5a45" stop-opacity=".38"/><stop offset="1" stop-color="#ff5a45" stop-opacity="0"/></radialGradient>
    <filter id="glow"><feGaussianBlur stdDeviation="10" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>
  <rect width="1600" height="900" fill="url(#bg)"/>
  <circle cx="280" cy="430" r="470" fill="url(#cyan)"/>
  <circle cx="1320" cy="430" r="470" fill="url(#coral)"/>
  <g opacity=".12" stroke="#fff"><path d="M0 150h1600M0 300h1600M0 450h1600M0 600h1600M0 750h1600"/><path d="M200 0v900M400 0v900M600 0v900M800 0v900M1000 0v900M1200 0v900M1400 0v900"/></g>
  <text x="800" y="100" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="42" font-weight="800" text-anchor="middle">TKO<tspan fill="#ff5a45">.cam</tspan></text>
  <text x="800" y="172" fill="#adb0bd" font-family="Arial,Helvetica,sans-serif" font-size="24" font-weight="700" text-anchor="middle" letter-spacing="5">${title}</text>
  <path d="M800 250v420" stroke="#fff" stroke-opacity=".22" stroke-width="2"/>
  <path d="M170 690h500" stroke="#31d2dc" stroke-width="8" filter="url(#glow)"/>
  <path d="M930 690h500" stroke="#ff5a45" stroke-width="8" filter="url(#glow)"/>
  <text x="420" y="515" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="72" font-weight="900" text-anchor="middle">${teamA}</text>
  <text x="1180" y="515" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="72" font-weight="900" text-anchor="middle">${teamB}</text>
  <circle cx="800" cy="500" r="70" fill="#090a10" stroke="#fff" stroke-width="3"/>
  <text x="800" y="522" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="900" text-anchor="middle">VS</text>
  <text x="800" y="820" fill="#777b89" font-family="Arial,Helvetica,sans-serif" font-size="20" font-weight="700" text-anchor="middle" letter-spacing="4">EVERY ANGLE OF THE KNOCKOUT. ONE CAM.</text>
</svg>`
}

export function isSafeLiveBannerUrl(value: string | null | undefined): boolean {
  const clean = (value ?? '').trim()
  if (!clean) return false
  if (/^https:\/\//i.test(clean)) return !/[\s<>"']/.test(clean)
  if (!/^data:image\/(png|jpe?g|webp);base64,/i.test(clean)) return false
  const bytes = dataUrlBytes(clean)
  return bytes > 0 && bytes <= LIVE_BANNER_MAX_BYTES
}

export function normalizeLiveBannerUrl(value: string | null | undefined): string | null {
  const clean = (value ?? '').trim()
  return isSafeLiveBannerUrl(clean) ? clean : null
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('That image could not be read.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('That image could not be opened.'))
    image.src = src
  })
}

function drawCover(image: HTMLImageElement, width: number, height: number): HTMLCanvasElement {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) throw new Error('That image looks empty.')

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Your browser could not prepare that banner.')

  const sourceRatio = sourceWidth / sourceHeight
  const targetRatio = width / height
  let sx = 0
  let sy = 0
  let sw = sourceWidth
  let sh = sourceHeight
  if (sourceRatio > targetRatio) {
    sw = sourceHeight * targetRatio
    sx = (sourceWidth - sw) / 2
  } else {
    sh = sourceWidth / targetRatio
    sy = (sourceHeight - sh) / 2
  }
  context.fillStyle = '#090a10'
  context.fillRect(0, 0, width, height)
  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
  return canvas
}

async function imageToCompactBanner(image: HTMLImageElement): Promise<string> {
  const widths = [LIVE_BANNER_WIDTH, 1280, 960]
  const qualities = [0.82, 0.72, 0.62, 0.52]
  for (const width of widths) {
    const canvas = drawCover(image, width, Math.round(width * 9 / 16))
    for (const quality of qualities) {
      const output = canvas.toDataURL('image/jpeg', quality)
      if (dataUrlBytes(output) <= LIVE_BANNER_MAX_BYTES) return output
    }
  }
  throw new Error('That image is too detailed to use as a live banner.')
}

export async function fileToLiveBannerDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose a JPG, PNG, or WebP image.')
  if (file.size > LIVE_BANNER_MAX_SOURCE_BYTES) throw new Error('Choose an image smaller than 12 MB.')
  return imageToCompactBanner(await loadImage(await readAsDataUrl(file)))
}

export async function makeTkoLiveBannerDataUrl(input: {
  title?: string | null
  teamA?: string | null
  teamB?: string | null
}): Promise<string> {
  const svg = buildLiveBannerSvg(input)
  const source = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  return imageToCompactBanner(await loadImage(source))
}
