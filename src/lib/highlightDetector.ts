/**
 * Audio-energy auto-highlight detector. Browser-only, zero API costs.
 *
 * Decodes a video file's audio track via the Web Audio API, computes RMS energy
 * over short windows, and returns the timestamps where loudness spikes above a
 * statistical threshold (mean + N * std-dev).
 *
 * Works on many game clips: big hits, explosions, KOs, and sound effects show up as
 * large spikes against background music.
 */

export type HighlightMoment = {
  startSec: number
  endSec: number
  energy: number      // raw RMS at peak (0..1ish)
  intensity: number   // z-score above the clip's baseline
}

export type DetectorOptions = {
  windowMs?: number              // analysis window size, default 500ms
  minSpacingMs?: number          // min gap between detected highlights, default 1500ms
  zThreshold?: number            // how many std-devs above mean counts as a spike, default 1.8
  paddingBeforeMs?: number       // pre-roll context to include in clip, default 1500ms
  paddingAfterMs?: number        // post-roll context to include, default 1000ms
  maxHighlights?: number         // hard cap on returned moments, default 12
}

const DEFAULTS: Required<DetectorOptions> = {
  windowMs: 500,
  minSpacingMs: 1500,
  zThreshold: 1.8,
  paddingBeforeMs: 1500,
  paddingAfterMs: 1000,
  maxHighlights: 12,
}

/**
 * Decode a video/audio file into a single mono PCM track.
 * Returns null if decoding fails (e.g. codec not supported by the browser).
 */
async function decodeToMono(file: File): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  try {
    const buffer = await file.arrayBuffer()
    type AnyWindow = typeof window & { webkitAudioContext?: typeof AudioContext }
    const Ctor: typeof AudioContext = window.AudioContext ?? (window as AnyWindow).webkitAudioContext!
    const ctx = new Ctor()
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
    const channels = audioBuffer.numberOfChannels
    const length = audioBuffer.length
    const mono = new Float32Array(length)
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuffer.getChannelData(ch)
      for (let i = 0; i < length; i++) {
        mono[i] += data[i] / channels
      }
    }
    await ctx.close()
    return { samples: mono, sampleRate: audioBuffer.sampleRate }
  } catch (err) {
    console.warn('[highlightDetector] audio decode failed:', err)
    return null
  }
}

/**
 * Detect highlight moments in a single video file based on audio energy spikes.
 */
export async function detectHighlights(file: File, opts: DetectorOptions = {}): Promise<HighlightMoment[]> {
  const o = { ...DEFAULTS, ...opts }
  const decoded = await decodeToMono(file)
  if (!decoded) return []

  const { samples, sampleRate } = decoded
  const windowSize = Math.max(1, Math.floor((o.windowMs / 1000) * sampleRate))
  const totalWindows = Math.floor(samples.length / windowSize)
  if (totalWindows < 4) return []

  const energies = new Float32Array(totalWindows)
  for (let w = 0; w < totalWindows; w++) {
    const start = w * windowSize
    let sumSq = 0
    for (let i = 0; i < windowSize; i++) {
      const s = samples[start + i]
      sumSq += s * s
    }
    energies[w] = Math.sqrt(sumSq / windowSize)
  }

  let mean = 0
  for (let i = 0; i < energies.length; i++) mean += energies[i]
  mean /= energies.length
  let variance = 0
  for (let i = 0; i < energies.length; i++) {
    const d = energies[i] - mean
    variance += d * d
  }
  const std = Math.sqrt(variance / energies.length) || 1e-6

  const spikes: { windowIdx: number; energy: number; z: number }[] = []
  for (let i = 0; i < energies.length; i++) {
    const z = (energies[i] - mean) / std
    if (z >= o.zThreshold) spikes.push({ windowIdx: i, energy: energies[i], z })
  }
  spikes.sort((a, b) => b.z - a.z)

  const minSpacingWindows = Math.ceil(o.minSpacingMs / o.windowMs)
  const picked: typeof spikes = []
  for (const s of spikes) {
    if (picked.length >= o.maxHighlights) break
    const tooClose = picked.some((p) => Math.abs(p.windowIdx - s.windowIdx) < minSpacingWindows)
    if (!tooClose) picked.push(s)
  }
  picked.sort((a, b) => a.windowIdx - b.windowIdx)

  const totalDurationSec = samples.length / sampleRate
  return picked.map((p) => {
    const peakSec = (p.windowIdx * o.windowMs) / 1000
    const startSec = Math.max(0, peakSec - o.paddingBeforeMs / 1000)
    const endSec = Math.min(totalDurationSec, peakSec + o.paddingAfterMs / 1000)
    return {
      startSec,
      endSec,
      energy: p.energy,
      intensity: p.z,
    }
  })
}

export function formatTimestamp(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60).toString().padStart(2, '0')
  return `${m}:${s}`
}
