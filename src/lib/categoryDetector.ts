/**
 * Category-aware highlight detector (browser-only, zero API cost).
 *
 * Samples frames from an uploaded video, OCRs each one with tesseract.js
 * (already a dependency), and flags frames whose on-screen text matches a
 * category's cues (e.g. the gold "K.O." banner, "Ultimate Ninjutsu", a
 * scroll/flag notice, the opening "Combat Battle", or the closing results
 * screen). Matches are merged into moments with per-category padding.
 *
 * For the "all" category there are no cues — we defer to the audio-energy
 * detector so nothing changes for that path.
 */

import type { Worker } from 'tesseract.js'
import type { HighlightMoment } from '@/lib/highlightDetector'
import { detectHighlights } from '@/lib/highlightDetector'
import { getCategory, type HighlightCategoryId } from '@/lib/highlightCategories'

export type CategoryProgress = (done: number, total: number) => void

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9.!]/g, '')

async function loadVideo(file: File): Promise<HTMLVideoElement> {
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.src = URL.createObjectURL(file)
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Could not read that video.'))
  })
  return video
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => { video.removeEventListener('seeked', done); resolve() }
    video.addEventListener('seeked', done)
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.05))
  })
}

/**
 * Detect moments of a given category. Falls back to the audio detector for
 * 'all'. `sampleEverySec` trades speed for recall (0.5s is thorough, 1s fast).
 */
export async function detectByCategory(
  file: File,
  categoryId: HighlightCategoryId,
  opts: { sampleEverySec?: number; maxMoments?: number; onProgress?: CategoryProgress } = {},
): Promise<HighlightMoment[]> {
  const cat = getCategory(categoryId)
  if (categoryId === 'all' || cat.cues.length === 0) {
    return detectHighlights(file, { maxHighlights: opts.maxMoments ?? 12 })
  }

  const step = opts.sampleEverySec ?? 0.75
  const maxMoments = opts.maxMoments ?? 16
  const video = await loadVideo(file)
  const dur = video.duration || 0
  if (!dur || dur < 1) return []

  const canvas = document.createElement('canvas')
  const w = 854, h = Math.round((video.videoHeight / video.videoWidth) * w) || 480
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return []

  let worker: Worker | null = null
  const hits: number[] = []
  try {
    const { createWorker } = await import('tesseract.js')
    worker = await createWorker('eng')
    const times: number[] = []
    for (let t = 0; t < dur; t += step) times.push(t)
    for (let i = 0; i < times.length; i++) {
      const t = times[i]
      await seek(video, t)
      ctx.drawImage(video, 0, 0, w, h)
      try {
        const { data } = await worker.recognize(canvas)
        const text = norm(data.text || '')
        if (cat.cues.some((cue) => text.includes(norm(cue)))) hits.push(t)
      } catch { /* skip unreadable frame */ }
      opts.onProgress?.(i + 1, times.length)
    }
  } finally {
    if (worker) await worker.terminate()
    URL.revokeObjectURL(video.src)
  }

  // Merge hits that are within ~4s into single moments; keep the strongest set.
  hits.sort((a, b) => a - b)
  const moments: HighlightMoment[] = []
  let clusterStart: number | null = null
  let last = -Infinity
  const flush = (end: number) => {
    if (clusterStart === null) return
    moments.push({
      startSec: Math.max(0, clusterStart - cat.padBefore),
      endSec: Math.min(dur, end + cat.padAfter),
      energy: 1,
      intensity: 1,
    })
    clusterStart = null
  }
  for (const t of hits) {
    if (clusterStart === null) clusterStart = t
    else if (t - last > 4) { flush(last); clusterStart = t }
    last = t
  }
  flush(last)
  return moments.slice(0, maxMoments)
}
