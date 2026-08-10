import { createHash } from 'node:crypto'

export type BoundaryCue = 'start' | 'end' | 'result' | 'timer' | 'roster' | 'unknown'

export type MatchBoundaryObservation = {
  atSec: number
  cue?: BoundaryCue
  text?: string
  timerSec?: number | null
  mode?: string | null
  map?: string | null
  roster?: string[]
  confidence?: number
  evidenceRef?: string | null
}

export type DetectedMatchSegment = {
  segmentIndex: number
  startSec: number
  endSec: number
  startReason: 'start_cue' | 'timer_detected' | 'timer_reset' | 'gap_restart'
  endReason: 'result_cue' | 'timer_reset' | 'gap_restart' | 'source_end'
  boundaryConfidence: number
  firstTimerSec: number | null
  lastTimerSec: number | null
  mode: string | null
  map: string | null
  roster: string[]
  evidence: Array<{
    atSec: number
    cue: BoundaryCue
    timerSec: number | null
    confidence: number
    evidenceRef: string | null
  }>
}

export type DetectMatchOptions = {
  sourceDurationSec?: number | null
  minimumMatchSec?: number
  timerResetSec?: number
  restartGapSec?: number
}

type NormalizedObservation = MatchBoundaryObservation & {
  cue: BoundaryCue
  timerSec: number | null
  confidence: number
  evidenceRef: string | null
}

type OpenSegment = {
  startSec: number
  startReason: DetectedMatchSegment['startReason']
  startConfidence: number
  observations: NormalizedObservation[]
}

const START_CUES = [
  /\bbattle\s+start(?:s|ed)?\b/i,
  /\bmatch\s+start(?:s|ed)?\b/i,
  /\bready\s+(?:to\s+)?(?:fight|battle)\b/i,
  /\bbegin\s+(?:the\s+)?(?:match|battle)\b/i,
]

const END_CUES = [
  /\bbattle\s+(?:complete|finished|over)\b/i,
  /\bmatch\s+(?:complete|finished|over)\b/i,
  /\bresults?\b/i,
  /\bvictory\b/i,
  /\bdefeat\b/i,
  /\bdraw\b/i,
  /\byour\s+team\s+(?:won|lost)\b/i,
  /\bwinner\b/i,
]

function finite(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function clampConfidence(value: unknown, fallback = 0.65): number {
  const parsed = finite(value)
  return Math.max(0, Math.min(1, parsed ?? fallback))
}

export function parseGameTimer(text: string): number | null {
  const matches = String(text || '').matchAll(/(?:^|\D)(\d{1,2})\s*[:.]\s*([0-5]\d)(?!\d)/g)
  for (const match of matches) {
    const minutes = Number(match[1])
    const seconds = Number(match[2])
    const total = minutes * 60 + seconds
    if (total >= 0 && total <= 30 * 60) return total
  }
  return null
}

function inferredCue(observation: MatchBoundaryObservation, timerSec: number | null): BoundaryCue {
  if (observation.cue && observation.cue !== 'unknown') return observation.cue
  const text = String(observation.text || '')
  if (START_CUES.some((pattern) => pattern.test(text))) return 'start'
  if (END_CUES.some((pattern) => pattern.test(text))) return 'result'
  if (timerSec != null) return 'timer'
  if (Array.isArray(observation.roster) && observation.roster.length) return 'roster'
  return 'unknown'
}

function normalizeObservations(input: MatchBoundaryObservation[]): NormalizedObservation[] {
  return input
    .map((observation) => {
      const atSec = finite(observation.atSec)
      if (atSec == null || atSec < 0) return null
      const explicitTimer = finite(observation.timerSec)
      const timerSec = explicitTimer == null
        ? parseGameTimer(String(observation.text || ''))
        : Math.max(0, Math.round(explicitTimer))
      return {
        ...observation,
        atSec,
        timerSec,
        cue: inferredCue(observation, timerSec),
        confidence: clampConfidence(observation.confidence),
        evidenceRef: observation.evidenceRef ? String(observation.evidenceRef) : null,
      }
    })
    .filter((observation): observation is NormalizedObservation => observation != null)
    .sort((a, b) => a.atSec - b.atSec)
}

function openSegment(
  observation: NormalizedObservation,
  reason: OpenSegment['startReason'],
): OpenSegment {
  return {
    startSec: Math.max(0, observation.atSec),
    startReason: reason,
    startConfidence: observation.confidence,
    observations: [observation],
  }
}

function compactEvidence(observations: NormalizedObservation[]) {
  const important = observations.filter((observation, index) =>
    observation.cue !== 'unknown'
      || observation.timerSec != null
      || index === 0
      || index === observations.length - 1,
  )
  const sampled = important.length <= 24
    ? important
    : important.filter((_, index) => index === 0 || index === important.length - 1 || index % Math.ceil(important.length / 22) === 0)
  return sampled.map((observation) => ({
    atSec: observation.atSec,
    cue: observation.cue,
    timerSec: observation.timerSec,
    confidence: observation.confidence,
    evidenceRef: observation.evidenceRef,
  }))
}

function segmentDetails(
  open: OpenSegment,
  endSec: number,
  endReason: DetectedMatchSegment['endReason'],
  endConfidence: number,
  segmentIndex: number,
): DetectedMatchSegment {
  const observations = open.observations
  const timers = observations
    .map((observation) => observation.timerSec)
    .filter((value): value is number => value != null)
  const roster = new Map<string, string>()
  for (const observation of observations) {
    for (const raw of observation.roster || []) {
      const display = String(raw || '').trim()
      const key = normalizeGameAlias(display)
      if (key && !roster.has(key)) roster.set(key, display)
    }
  }
  const latest = <T>(values: Array<T | null | undefined>): T | null => {
    for (let index = values.length - 1; index >= 0; index--) {
      if (values[index] != null && String(values[index]).trim()) return values[index] as T
    }
    return null
  }
  const boundaryConfidence = Math.max(0, Math.min(1, (open.startConfidence + endConfidence) / 2))
  return {
    segmentIndex,
    startSec: Number(open.startSec.toFixed(2)),
    endSec: Number(Math.max(open.startSec, endSec).toFixed(2)),
    startReason: open.startReason,
    endReason,
    boundaryConfidence: Number(boundaryConfidence.toFixed(3)),
    firstTimerSec: timers.length ? timers[0] : null,
    lastTimerSec: timers.length ? timers[timers.length - 1] : null,
    mode: latest(observations.map((observation) => observation.mode)),
    map: latest(observations.map((observation) => observation.map)),
    roster: [...roster.values()],
    evidence: compactEvidence(observations),
  }
}

export function detectMatchSegments(
  rawObservations: MatchBoundaryObservation[],
  options: DetectMatchOptions = {},
): DetectedMatchSegment[] {
  const observations = normalizeObservations(rawObservations)
  const sourceDuration = finite(options.sourceDurationSec)
  const minimumMatchSec = Math.max(10, finite(options.minimumMatchSec) ?? 20)
  const timerResetSec = Math.max(30, finite(options.timerResetSec) ?? 45)
  const restartGapSec = Math.max(30, finite(options.restartGapSec) ?? 90)
  const segments: DetectedMatchSegment[] = []
  let open: OpenSegment | null = null

  const close = (
    endSec: number,
    reason: DetectedMatchSegment['endReason'],
    confidence: number,
  ) => {
    if (!open) return
    if (endSec - open.startSec >= minimumMatchSec) {
      segments.push(segmentDetails(open, endSec, reason, confidence, segments.length))
    }
    open = null
  }

  for (const observation of observations) {
    if (!open) {
      if (observation.cue === 'start') open = openSegment(observation, 'start_cue')
      else if (
        observation.timerSec != null
        && observation.timerSec > 0
        && observation.confidence > 0.5
      ) open = openSegment(observation, 'timer_detected')
      continue
    }

    const previous = open.observations[open.observations.length - 1]
    const previousTimerObservation = [...open.observations]
      .reverse()
      .find((candidate) =>
        candidate.timerSec != null
        && candidate.confidence > 0.5
        && (candidate.timerSec > 0 || candidate.cue === 'result' || candidate.cue === 'end'),
      )
    const gap = observation.atSec - previous.atSec
    const timerReset = observation.timerSec != null
      && observation.timerSec > 0
      && observation.confidence > 0.5
      && previousTimerObservation?.timerSec != null
      && observation.timerSec - previousTimerObservation.timerSec >= timerResetSec
      && observation.atSec - open.startSec >= minimumMatchSec

    if (timerReset) {
      close(previous.atSec, 'timer_reset', Math.min(previous.confidence, observation.confidence))
      open = openSegment(observation, 'timer_reset')
      continue
    }

    // OCR samples can be minutes apart on low-cost analysis passes. A gap by
    // itself is not evidence that a new match began; require a fresh start cue.
    if (gap >= restartGapSec && observation.cue === 'start') {
      close(previous.atSec, 'gap_restart', Math.min(previous.confidence, 0.75))
      open = openSegment(observation, 'gap_restart')
      continue
    }

    open.observations.push(observation)
    if (
      (observation.cue === 'end' || observation.cue === 'result')
      && observation.confidence > 0.5
    ) {
      close(observation.atSec, 'result_cue', observation.confidence)
    }
  }

  if (open) {
    const last = open.observations[open.observations.length - 1]
    const end = sourceDuration != null && sourceDuration > open.startSec
      ? sourceDuration
      : last.atSec
    close(end, 'source_end', Math.min(last.confidence, 0.55))
  }

  return segments.map((segment, segmentIndex) => ({ ...segment, segmentIndex }))
}

export function normalizeGameAlias(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

export function matchSegmentFingerprint(
  sourceFingerprint: string,
  segment: Pick<DetectedMatchSegment, 'startSec' | 'endSec' | 'mode' | 'map' | 'roster'>,
): string {
  const identity = [
    sourceFingerprint,
    Math.round(segment.startSec),
    Math.round(segment.endSec),
    normalizeGameAlias(segment.mode || ''),
    normalizeGameAlias(segment.map || ''),
    segment.roster.map(normalizeGameAlias).filter(Boolean).sort().join(','),
  ].join('|')
  return createHash('sha256').update(identity).digest('hex')
}
