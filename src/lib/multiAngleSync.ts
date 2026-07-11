/**
 * Multi-angle audio SYNC — KillCam's differentiator.
 *
 * Problem: several players each recorded THE SAME real-world moment from a
 * different camera / POV. Their clips start at arbitrary times, so naively
 * stacking them (all inputs at t=0, as gridStack4/sideBySide/pipOverlay do
 * today) shows four DIFFERENT instants side-by-side. We want the gunshot / KO /
 * callout to happen on the same frame in every tile.
 *
 * Key assumption: the AUDIO of a shared moment is correlated across angles.
 * A gunshot, a teammate's callout, the crowd reaction, or the in-game music
 * all reach every player's mic/capture at (nearly) the same wall-clock instant.
 * The video pixels are wildly different between POVs, but the SOUND envelope is
 * essentially the same signal, just time-shifted by however much later each
 * player hit "record". So we recover the per-clip time offset by finding the
 * lag that maximises the cross-correlation between each clip's loudness
 * envelope and a reference clip's envelope.
 *
 * Everything here is browser-only and dependency-free: we decode audio with the
 * Web Audio API (AudioContext.decodeAudioData) and do the cross-correlation in
 * plain typed-array loops. Style/approach mirrors src/lib/highlightDetector.ts
 * (mono mixdown + RMS-per-window energy analysis).
 *
 * Output contract: offsets[i] is the number of seconds to seek INTO clip i so
 * that, once every clip is seeked by its offset, they all line up on the shared
 * moment. Offsets are normalised so the minimum is 0 (every seek is >= 0): the
 * clip whose moment happens EARLIEST gets offset 0, and clips whose moment
 * happens later get a positive seek. Feed these straight into ffmpeg as
 * per-input `-ss <offset>` before the xstack/hstack/overlay (see the ffmpeg
 * integration notes returned with this module).
 */

export type SyncResult = {
  /** Seconds to seek into clip i so all clips align on the shared moment. Always >= 0. */
  offsets: number[]
  /** Peak normalised cross-correlation for clip i, 0..1. The reference clip is 1; silent/undecodable clips are 0. */
  confidence: number[]
  /** Index of the clip used as the alignment anchor (offset may be non-zero after normalisation). */
  referenceIndex: number
}

/** ---- Tunables -------------------------------------------------------------- */

/** Default max lag we search on either side, in seconds. Players rarely start
 *  recording more than a few seconds apart for the same moment. */
const DEFAULT_MAX_LAG_SEC = 5

/** Default envelope sample rate (Hz). We downsample the raw PCM to a coarse
 *  loudness envelope so cross-correlation is cheap: at 1000 Hz one envelope
 *  sample == 1 ms, which is far finer than a video frame (~33 ms @ 30fps). */
const DEFAULT_ENVELOPE_RATE = 1000

/** Only analyse the first N seconds of each clip. The shared moment is almost
 *  always near the front of a highlight clip, and this bounds memory + CPU. */
const ANALYZE_SEC = 30

/** Target PCM decode rate (Hz). We ask the AudioContext to resample on decode
 *  so we hold far fewer samples in memory (8 kHz is plenty to build a loudness
 *  envelope). If the browser ignores the request we just use its native rate —
 *  the envelope math reads the decoded buffer's actual sampleRate either way. */
const DECODE_RATE = 8000

/** Below this peak RMS a clip is treated as silent (no usable audio to sync on). */
const SILENCE_RMS = 1e-3

/** ---- Public API ------------------------------------------------------------ */

/**
 * Compute per-clip seek offsets that align every source on the same moment.
 *
 * @param sources  the clips (File or Blob) to align — order is preserved in the result
 * @param opts.maxLagSec   max search lag on either side (default 5s)
 * @param opts.sampleRate  envelope downsample rate in Hz (default 1000)
 */
export async function computeSyncOffsets(
  sources: (File | Blob)[],
  opts?: { maxLagSec?: number; sampleRate?: number },
): Promise<SyncResult> {
  const n = sources.length
  // Nothing to align: 0 or 1 clip is trivially "in sync".
  if (n === 0) return { offsets: [], confidence: [], referenceIndex: 0 }
  if (n === 1) return { offsets: [0], confidence: [0], referenceIndex: 0 }

  const envRate = Math.max(50, Math.floor(opts?.sampleRate ?? DEFAULT_ENVELOPE_RATE))
  const maxLagSec = Math.max(0, opts?.maxLagSec ?? DEFAULT_MAX_LAG_SEC)
  const maxLag = Math.max(1, Math.round(maxLagSec * envRate)) // max lag in envelope samples

  // Decode every clip to a normalised loudness envelope. We reuse ONE
  // AudioContext and process clips sequentially so peak memory is roughly a
  // single decoded clip at a time; the envelopes we keep are tiny.
  const ctx = makeDecodeContext()
  const analyzed: Analyzed[] = []
  try {
    for (let i = 0; i < n; i++) {
      analyzed.push(await analyzeSource(sources[i], envRate, ctx))
    }
  } finally {
    // Always release the audio hardware/context.
    try { await ctx.close() } catch { /* already closed */ }
  }

  // Reference = the clip with the strongest/longest signal (most total acoustic
  // energy), so we correlate weaker angles against the cleanest one. Ties keep
  // the earliest index. If nothing has usable audio, fall back to manual (zeros).
  let referenceIndex = 0
  let refStrength = -1
  for (let i = 0; i < n; i++) {
    if (!analyzed[i].silent && analyzed[i].strength > refStrength) {
      refStrength = analyzed[i].strength
      referenceIndex = i
    }
  }
  if (refStrength < 0) return manualOffsets(n)

  const ref = analyzed[referenceIndex].envelope

  // rawOffset[i] is clip i's moment time minus the reference's moment time (in
  // seconds). Positive => clip i's moment happens later => needs a larger seek.
  const rawOffset: number[] = new Array<number>(n).fill(0)
  const confidence: number[] = new Array<number>(n).fill(0)
  const usable: boolean[] = new Array<boolean>(n).fill(false)

  // The reference is, by definition, perfectly aligned with itself.
  rawOffset[referenceIndex] = 0
  confidence[referenceIndex] = 1
  usable[referenceIndex] = true

  for (let i = 0; i < n; i++) {
    if (i === referenceIndex) continue
    if (analyzed[i].silent || analyzed[i].envelope.length === 0) {
      // No / silent audio: we have no evidence, so don't shift and don't claim
      // confidence. It stays at offset 0 (handled below) with confidence 0.
      continue
    }
    // Find the lag (in envelope samples) that maximises the normalised
    // correlation between this clip and the reference.
    const { lag, corr } = bestLag(ref, analyzed[i].envelope, maxLag, envRate)
    rawOffset[i] = lag / envRate                 // envelope samples -> seconds
    confidence[i] = clamp01(corr)                // peak correlation as confidence
    usable[i] = true
  }

  // Normalise so the smallest offset among clips we actually aligned is 0. This
  // guarantees every emitted seek is >= 0 (ffmpeg `-ss` can't go negative): the
  // earliest-moment clip anchors at 0, later ones get positive seeks. Note the
  // reference itself can end up with a positive seek if some other angle's
  // moment happens even earlier than the reference's.
  let minOff = Infinity
  for (let i = 0; i < n; i++) if (usable[i]) minOff = Math.min(minOff, rawOffset[i])
  if (!Number.isFinite(minOff)) minOff = 0

  const offsets: number[] = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    // Clips we couldn't analyse stay at 0: we refuse to blindly seek into a clip
    // whose moment we never located.
    offsets[i] = usable[i] ? round3(rawOffset[i] - minOff) : 0
  }

  return {
    offsets,
    confidence: confidence.map(round3),
    referenceIndex,
  }
}

/**
 * Identity fallback: every clip aligned to its own start, zero confidence.
 * Use when the user wants to nudge offsets by hand, or when audio sync is not
 * possible (all clips silent / undecodable).
 */
export function manualOffsets(n: number): SyncResult {
  const size = Math.max(0, Math.floor(n))
  return {
    offsets: new Array<number>(size).fill(0),
    confidence: new Array<number>(size).fill(0),
    referenceIndex: 0,
  }
}

/** ---- Internals ------------------------------------------------------------- */

type Analyzed = {
  /** Mean-subtracted RMS loudness envelope at `envRate` Hz, ready for correlation. */
  envelope: Float32Array
  /** Total acoustic energy proxy (sum of RMS) used to pick the reference clip. */
  strength: number
  /** True if the clip has no usable audio (decode failed, or effectively silent). */
  silent: boolean
}

/** Create an AudioContext that (best-effort) resamples decoded audio down to
 *  DECODE_RATE to save memory. Falls back to the browser default rate, and to
 *  the webkit-prefixed constructor on older Safari. */
function makeDecodeContext(): AudioContext {
  type Wk = typeof window & { webkitAudioContext?: typeof AudioContext }
  const Ctor: typeof AudioContext = window.AudioContext ?? (window as Wk).webkitAudioContext!
  try {
    return new Ctor({ sampleRate: DECODE_RATE })
  } catch {
    // Some browsers reject a custom sampleRate — use the native rate instead.
    return new Ctor()
  }
}

/**
 * Decode one source and reduce it to a normalised loudness envelope.
 *
 * 1. Read the File/Blob as an ArrayBuffer and decodeAudioData it.
 * 2. Mix all channels down to mono (average), capping at ANALYZE_SEC.
 * 3. Compute RMS over fixed windows to get a coarse loudness envelope at
 *    `envRate` Hz (one envelope sample per window).
 * 4. Mean-subtract the envelope. Removing the DC/baseline (crowd hum, music bed
 *    level) makes the cross-correlation lock onto the transient EVENTS — the
 *    shots and callouts that actually mark the shared moment — instead of just
 *    matching overall loudness. Scale is irrelevant because the correlation is
 *    cosine-normalised.
 *
 * Never throws: on any failure it returns a silent Analyzed so the caller can
 * degrade gracefully (confidence 0, offset 0 for that clip).
 */
async function analyzeSource(source: File | Blob, envRate: number, ctx: AudioContext): Promise<Analyzed> {
  try {
    const arrayBuffer = await source.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer)

    const sr = audioBuffer.sampleRate
    const maxSamples = Math.min(audioBuffer.length, Math.floor(ANALYZE_SEC * sr))
    if (maxSamples <= 0) return SILENT

    // Mono mixdown (average of channels), first ANALYZE_SEC only.
    const channels = audioBuffer.numberOfChannels
    const mono = new Float32Array(maxSamples)
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuffer.getChannelData(ch)
      for (let i = 0; i < maxSamples; i++) mono[i] += data[i] / channels
    }

    // RMS envelope: one sample per `win` PCM samples.
    const win = Math.max(1, Math.round(sr / envRate))
    const count = Math.floor(maxSamples / win)
    if (count < 4) return SILENT // too short to correlate meaningfully

    const env = new Float32Array(count)
    let strength = 0
    let peak = 0
    for (let w = 0; w < count; w++) {
      const start = w * win
      let sumSq = 0
      for (let i = 0; i < win; i++) {
        const v = mono[start + i]
        sumSq += v * v
      }
      const rms = Math.sqrt(sumSq / win)
      env[w] = rms
      strength += rms
      if (rms > peak) peak = rms
    }

    if (peak < SILENCE_RMS) {
      // Effectively silent — no transients to sync on.
      return { envelope: env, strength: 0, silent: true }
    }

    // Mean-subtract in place so correlation focuses on transients, not baseline.
    let mean = 0
    for (let i = 0; i < count; i++) mean += env[i]
    mean /= count
    for (let i = 0; i < count; i++) env[i] -= mean

    return { envelope: env, strength, silent: false }
  } catch (err) {
    // Codec not supported, no audio track, corrupt data, etc.
    console.warn('[multiAngleSync] audio decode failed:', err)
    return SILENT
  }
}

/** Shared "no usable audio" result (envelope intentionally empty). */
const SILENT: Analyzed = { envelope: new Float32Array(0), strength: 0, silent: true }

/**
 * Cross-correlate `sig` against `ref` over lags in [-maxLag, +maxLag] and return
 * the lag (in envelope samples) with the highest normalised correlation, plus
 * that peak correlation.
 *
 * Convention: at lag L we compare ref[t] with sig[t + L]. If `sig`'s copy of the
 * shared event sits L samples LATER than `ref`'s, the products line up and peak
 * at that L. Hence the returned lag == (sig's moment time - ref's moment time):
 * a positive lag means sig's moment happens later, so sig needs a larger seek.
 *
 * Correlation is cosine-normalised over the OVERLAP region only:
 *     corr(L) = Σ ref[t]·sig[t+L] / sqrt( Σ ref[t]² · Σ sig[t+L]² )
 * which lands in [-1, 1] and is invariant to each clip's loudness. Prefix sums
 * of squares give the two energy terms in O(1) per lag, so the only per-lag cost
 * is the dot-product over the overlap. Both envelopes are mean-subtracted, so
 * this is effectively a Pearson correlation of the loudness envelopes.
 */
function bestLag(
  ref: Float32Array,
  sig: Float32Array,
  maxLag: number,
  envRate: number,
): { lag: number; corr: number } {
  const nr = ref.length
  const ns = sig.length

  // Prefix sums of squares: Pr[k] = Σ_{t<k} ref[t]², Ps[k] = Σ_{t<k} sig[t]².
  const Pr = new Float64Array(nr + 1)
  for (let i = 0; i < nr; i++) Pr[i + 1] = Pr[i] + ref[i] * ref[i]
  const Ps = new Float64Array(ns + 1)
  for (let i = 0; i < ns; i++) Ps[i + 1] = Ps[i] + sig[i] * sig[i]

  // Require a meaningful overlap so a tiny sliver of samples can't fake a high
  // correlation: at least 0.5s of envelope, and at least 10% of the shorter clip.
  const minOverlap = Math.max(Math.floor(envRate * 0.5), Math.floor(Math.min(nr, ns) * 0.1), 1)

  let bestLagSamples = 0
  let bestCorr = -Infinity
  for (let L = -maxLag; L <= maxLag; L++) {
    // Valid t range where both ref[t] and sig[t+L] exist.
    const start = Math.max(0, -L)
    const end = Math.min(nr, ns - L)
    if (end - start < minOverlap) continue

    let dot = 0
    for (let t = start; t < end; t++) dot += ref[t] * sig[t + L]

    const energyRef = Pr[end] - Pr[start]
    const energySig = Ps[end + L] - Ps[start + L]
    const denom = Math.sqrt(energyRef * energySig)
    if (denom <= 0) continue

    const corr = dot / denom
    if (corr > bestCorr) {
      bestCorr = corr
      bestLagSamples = L
    }
  }

  if (bestCorr === -Infinity) return { lag: 0, corr: 0 } // never found a valid overlap
  return { lag: bestLagSamples, corr: bestCorr }
}

/** Clamp a correlation into a 0..1 confidence (negative correlation => 0). */
function clamp01(x: number): number {
  if (x < 0) return 0
  if (x > 1) return 1
  return x
}

/** Round to millisecond precision to keep the result readable/serialisable. */
function round3(x: number): number {
  return Math.round(x * 1000) / 1000
}
