/**
 * Lightweight client-side OCR for match-result screenshots.
 *
 * We use Tesseract.js (WebAssembly) so this stays $0 — no Vision API, no
 * server. Worker assets are loaded from the jsDelivr CDN on-demand the first
 * time `parseMatchScreenshot` is called.
 *
 * Heuristics over a generic VICTORY/DEFEAT word match plus a regex for
 * obvious "kills / deaths / assists" digit triplets. Returns a confidence
 * score (0–1) so the UI can decide whether to auto-fill the form or just
 * show the parsed text as a hint.
 */

import type Tesseract from 'tesseract.js'

export type MatchOcrResult = {
  raw: string
  outcome: 'victory' | 'defeat' | 'draw' | null
  kills: number | null
  deaths: number | null
  assists: number | null
  confidence: number
}

let workerPromise: Promise<Tesseract.Worker> | null = null

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const T = await import('tesseract.js')
      // Tesseract.js v5 takes the language as the first arg of createWorker.
      const w = await T.createWorker('eng')
      return w
    })()
  }
  return workerPromise
}

const VICTORY_PATTERNS = [
  /\bVICTORY\b/i,
  /\bWIN\b/i,
  /\bWINNER\b/i,
  /\bMISSION\s+COMPLETE\b/i,
  /\bSUCCESS\b/i,
]
const DEFEAT_PATTERNS = [
  /\bDEFEAT\b/i,
  /\bLOSE\b/i,
  /\bLOSS\b/i,
  /\bMISSION\s+FAILED\b/i,
  /\bFAILURE\b/i,
]
const DRAW_PATTERNS = [/\bDRAW\b/i, /\bTIE\b/i]

/**
 * Run Tesseract on the given file/blob and try to extract victory state +
 * kills/deaths/assists numbers.
 */
export async function parseMatchScreenshot(file: File | Blob): Promise<MatchOcrResult> {
  const worker = await getWorker()
  const url = URL.createObjectURL(file)
  try {
    const out = await worker.recognize(url)
    const raw = out.data.text || ''
    const ocrConfidence = (out.data.confidence ?? 0) / 100 // tesseract returns 0..100
    const outcome = pickOutcome(raw)

    // KDA — common "12 / 3 / 7" or "K 12  D 3  A 7" patterns.
    let kills: number | null = null
    let deaths: number | null = null
    let assists: number | null = null
    const tripleSlash = raw.match(/(\d{1,3})\s*[\\\/|]\s*(\d{1,3})\s*[\\\/|]\s*(\d{1,3})/)
    if (tripleSlash) {
      kills = parseInt(tripleSlash[1], 10)
      deaths = parseInt(tripleSlash[2], 10)
      assists = parseInt(tripleSlash[3], 10)
    } else {
      const kRe = raw.match(/\bK(?:ILLS)?[\s:]*([0-9]{1,3})\b/i)
      const dRe = raw.match(/\bD(?:EATHS)?[\s:]*([0-9]{1,3})\b/i)
      const aRe = raw.match(/\bA(?:SSISTS)?[\s:]*([0-9]{1,3})\b/i)
      if (kRe) kills = parseInt(kRe[1], 10)
      if (dRe) deaths = parseInt(dRe[1], 10)
      if (aRe) assists = parseInt(aRe[1], 10)
    }

    // Composite confidence: blend OCR confidence with whether we matched
    // anything meaningful. Pure OCR confidence on a noisy game screenshot
    // is wildly optimistic, so we de-rate when no outcome / numbers found.
    const matchedSomething = outcome !== null || kills !== null
    const confidence = matchedSomething ? Math.max(0.55, ocrConfidence) : Math.min(0.4, ocrConfidence)

    return {
      raw,
      outcome,
      kills,
      deaths,
      assists,
      confidence,
    }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function pickOutcome(text: string): MatchOcrResult['outcome'] {
  for (const p of VICTORY_PATTERNS) if (p.test(text)) return 'victory'
  for (const p of DEFEAT_PATTERNS) if (p.test(text)) return 'defeat'
  for (const p of DRAW_PATTERNS) if (p.test(text)) return 'draw'
  return null
}

/** Free the Tesseract worker. Call on logout / route change to reclaim memory. */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return
  const w = await workerPromise
  workerPromise = null
  try {
    await w.terminate()
  } catch {
    /* ignore */
  }
}
