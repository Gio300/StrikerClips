import {
  normalizeGameAlias,
  parseGameTimer,
  type BoundaryCue,
  type MatchBoundaryObservation,
} from './matchDetection'
import type {
  CombatObservation,
  MatchResultObservation,
  ParticipantObservation,
} from './mediaEvidence'

export type MediaAliasCatalogEntry = {
  profileId: string
  displayAlias: string
  normalizedAlias: string
  validFrom: string
  validTo: string | null
  confidence: number
  isPrimary: boolean
}

export type MediaOcrSample = {
  atSec: number
  text: string
  evidenceRef: string
}

export type ParsedMediaEvidence = {
  observations: MatchBoundaryObservation[]
  participants: ParticipantObservation[]
  combatEvents: CombatObservation[]
  results: MatchResultObservation[]
  ownerAlias: { displayAlias: string; confidence: number; evidenceRef: string } | null
}

type ParseMediaOcrOptions = {
  sourceOwnerId: string
  sourceRecordedAt?: string | null
}

type AliasMatch = {
  entry: MediaAliasCatalogEntry
  confidence: number
}

const START_PATTERN = /\b(?:battle|match)\s+start(?:s|ed)?\b|\bready\s+(?:to\s+)?(?:fight|battle)\b/i
const RESULT_PATTERN = /^(?:victory|defeat|draw)$/i
const WIN_PATTERN = /^your\s+team\s+(?:won|wins)$/i
const LOSS_PATTERN = /^your\s+team\s+(?:lost|loses)$/i
const EVENT_VERB = '(?:defeated|knocked\\s+out|eliminated|killed|ko(?:\\s*(?:d|ed))?)'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compactLine(value: string): string {
  return value
    .replace(/[^a-z0-9\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function aliasCores(entry: MediaAliasCatalogEntry): string[] {
  const cores = new Set<string>()
  const chunks = String(entry.displayAlias || '')
    .replace(/\[[^\]]+\]/g, ' ')
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
  if (chunks.length) cores.add(chunks.map(escapeRegExp).join('[\\s._\\-]*'))
  const normalized = normalizeGameAlias(entry.normalizedAlias || entry.displayAlias)
  if (normalized) cores.add(escapeRegExp(normalized))
  return [...cores]
}

function boundedAliasPattern(core: string): RegExp {
  return new RegExp(`(?:^|[^a-z0-9])(?:${core})(?=$|[^a-z0-9])`, 'i')
}

function aliasMatchesText(entry: MediaAliasCatalogEntry, text: string): boolean {
  return aliasCores(entry).some((core) => boundedAliasPattern(core).test(text))
}

function aliasExpression(entry: MediaAliasCatalogEntry): string {
  const cores = aliasCores(entry)
  return `(?:${cores.join('|')})`
}

function sampleObservedAt(recordedAt: string | null | undefined, atSec: number): number {
  const base = recordedAt ? new Date(recordedAt).getTime() : Date.now()
  return (Number.isFinite(base) ? base : Date.now()) + Math.max(0, atSec) * 1_000
}

function aliasActiveAt(entry: MediaAliasCatalogEntry, observedAtMs: number): boolean {
  const from = new Date(entry.validFrom).getTime()
  const to = entry.validTo ? new Date(entry.validTo).getTime() : Number.POSITIVE_INFINITY
  return (!Number.isFinite(from) || from <= observedAtMs) && (!Number.isFinite(to) || observedAtMs < to)
}

function aliasesInSample(
  sample: MediaOcrSample,
  aliases: MediaAliasCatalogEntry[],
  recordedAt?: string | null,
): AliasMatch[] {
  const observedAt = sampleObservedAt(recordedAt, sample.atSec)
  const found = new Map<string, AliasMatch>()
  for (const entry of aliases) {
    if (!aliasActiveAt(entry, observedAt) || !aliasMatchesText(entry, sample.text)) continue
    const key = normalizeGameAlias(entry.normalizedAlias || entry.displayAlias)
    const previous = found.get(key)
    const match = { entry, confidence: 0.96 }
    if (!previous || entry.confidence > previous.entry.confidence) found.set(key, match)
  }
  return [...found.values()]
}

function inferMode(text: string): string | null {
  if (/\bflag\s+battle\b/i.test(text)) return 'Flag Battle'
  if (/\bbase\s+battle\b/i.test(text)) return 'Base Battle'
  if (/\bcombat\s+battle\b/i.test(text)) return 'Combat Battle'
  if (/\bbarrier\s+battle\b/i.test(text)) return 'Barrier Battle'
  return null
}

function resultFromText(text: string): { outcome: MatchResultObservation['outcome']; exactText: string } | null {
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = compactLine(rawLine)
    if (line.length > 36) continue
    if (RESULT_PATTERN.test(line)) {
      return { outcome: line.toLowerCase() as MatchResultObservation['outcome'], exactText: rawLine.trim() }
    }
    if (WIN_PATTERN.test(line)) return { outcome: 'victory', exactText: rawLine.trim() }
    if (LOSS_PATTERN.test(line)) return { outcome: 'defeat', exactText: rawLine.trim() }
  }
  return null
}

function labeledNumber(text: string, label: string): number | null {
  const match = text.match(new RegExp(`\\b(?:${label})\\s*(?:[:=x-]\\s*)?(\\d{1,3})\\b`, 'i'))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) && value <= 999 ? value : null
}

function scoreLine(text: string): string | null {
  const labeled = text.match(/\bscore\s*[:=]?\s*(\d{1,2})\s*[-:]\s*(\d{1,2})\b/i)
  if (labeled && Number(labeled[1]) <= 30 && Number(labeled[2]) <= 30) {
    return `${Number(labeled[1])}-${Number(labeled[2])}`
  }
  const dashed = text.match(/(?:^|\n)\s*(\d{1,2})\s*-\s*(\d{1,2})\s*(?:$|\n)/)
  if (dashed && Number(dashed[1]) <= 30 && Number(dashed[2]) <= 30) {
    return `${Number(dashed[1])}-${Number(dashed[2])}`
  }
  return null
}

function boundaryCue(text: string, aliases: AliasMatch[]): BoundaryCue {
  if (resultFromText(text)) return 'result'
  if (START_PATTERN.test(text)) return 'start'
  if (parseGameTimer(text) != null) return 'timer'
  if (aliases.length) return 'roster'
  return 'unknown'
}

function ownerAliasAt(
  aliases: MediaAliasCatalogEntry[],
  ownerId: string,
  observedAtMs: number,
): MediaAliasCatalogEntry | null {
  return aliases
    .filter((entry) => entry.profileId === ownerId && aliasActiveAt(entry, observedAtMs))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.confidence - a.confidence)[0] || null
}

function exactPairEvent(
  text: string,
  a: MediaAliasCatalogEntry,
  b: MediaAliasCatalogEntry,
): { killer: MediaAliasCatalogEntry; victim: MediaAliasCatalogEntry } | null {
  const aName = aliasExpression(a)
  const bName = aliasExpression(b)
  const aDefeatsB = new RegExp(`(?:${aName})\\s+(?:has\\s+)?${EVENT_VERB}\\s+(?:${bName})`, 'i')
  if (aDefeatsB.test(text)) return { killer: a, victim: b }
  const aDefeatedByB = new RegExp(`(?:${aName})\\s+(?:was\\s+)?${EVENT_VERB}\\s+by\\s+(?:${bName})`, 'i')
  if (aDefeatedByB.test(text)) return { killer: b, victim: a }
  return null
}

function ownerPerspectiveEvent(
  text: string,
  owner: MediaAliasCatalogEntry,
  other: MediaAliasCatalogEntry,
): { killer: MediaAliasCatalogEntry; victim: MediaAliasCatalogEntry; eventType: 'ko' | 'death' } | null {
  const otherName = aliasExpression(other)
  const ownerWins = [
    new RegExp(`\\byou\\s+(?:have\\s+)?${EVENT_VERB}\\s+(?:${otherName})`, 'i'),
    new RegExp(`(?:${otherName})\\s+(?:was\\s+)?${EVENT_VERB}\\s+by\\s+you\\b`, 'i'),
  ]
  if (ownerWins.some((pattern) => pattern.test(text))) {
    return { killer: owner, victim: other, eventType: 'ko' }
  }
  const ownerLoses = [
    new RegExp(`\\byou\\s+(?:were|have\\s+been)\\s+${EVENT_VERB}\\s+by\\s+(?:${otherName})`, 'i'),
    new RegExp(`(?:^|[^a-z0-9])${EVENT_VERB}\\s+by\\s+(?:${otherName})(?=$|[^a-z0-9])`, 'i'),
  ]
  if (ownerLoses.some((pattern) => pattern.test(text))) {
    return { killer: other, victim: owner, eventType: 'death' }
  }
  return null
}

function combatEventsFromSample(
  sample: MediaOcrSample,
  matches: AliasMatch[],
  owner: MediaAliasCatalogEntry | null,
): CombatObservation[] {
  const events = new Map<string, CombatObservation>()
  const clock = parseGameTimer(sample.text)
  const emit = (
    killer: MediaAliasCatalogEntry,
    victim: MediaAliasCatalogEntry,
    eventType: 'ko' | 'death' = 'ko',
  ) => {
    if (killer.profileId === victim.profileId) return
    const key = `${killer.profileId}:${victim.profileId}:${eventType}`
    events.set(key, {
      atSec: sample.atSec,
      eventType,
      matchClockSec: clock,
      killerAlias: killer.displayAlias,
      victimAlias: victim.displayAlias,
      confidence: 0.96,
      evidenceRef: sample.evidenceRef,
    })
  }

  for (let i = 0; i < matches.length; i++) {
    for (let j = i + 1; j < matches.length; j++) {
      const event = exactPairEvent(sample.text, matches[i].entry, matches[j].entry)
      if (event) emit(event.killer, event.victim)
    }
  }
  if (owner) {
    for (const match of matches) {
      if (match.entry.profileId === owner.profileId) continue
      const event = ownerPerspectiveEvent(sample.text, owner, match.entry)
      if (event) emit(event.killer, event.victim, event.eventType)
    }
  }
  return [...events.values()]
}

export function parseMediaOcrSamples(
  rawSamples: MediaOcrSample[],
  aliases: MediaAliasCatalogEntry[],
  options: ParseMediaOcrOptions,
): ParsedMediaEvidence {
  const samples = rawSamples
    .filter((sample) => Number.isFinite(sample.atSec) && sample.atSec >= 0 && String(sample.text || '').trim())
    .sort((a, b) => a.atSec - b.atSec)
  const observations: MatchBoundaryObservation[] = []
  const participants = new Map<string, ParticipantObservation>()
  const combatEvents: CombatObservation[] = []
  const results = new Map<string, MatchResultObservation>()
  let observedOwnerAlias: ParsedMediaEvidence['ownerAlias'] = null

  for (const sample of samples) {
    const observedAt = sampleObservedAt(options.sourceRecordedAt, sample.atSec)
    const matches = aliasesInSample(sample, aliases, options.sourceRecordedAt)
    const owner = ownerAliasAt(aliases, options.sourceOwnerId, observedAt)
    if (!observedOwnerAlias && owner && aliasMatchesText(owner, sample.text)) {
      observedOwnerAlias = {
        displayAlias: owner.displayAlias,
        confidence: 0.96,
        evidenceRef: sample.evidenceRef,
      }
    }
    const cue = boundaryCue(sample.text, matches)
    const timerSec = parseGameTimer(sample.text)
    const confidence = cue === 'result' || cue === 'start' ? 0.96 : cue === 'unknown' ? 0.5 : 0.88
    observations.push({
      atSec: sample.atSec,
      cue,
      text: sample.text.slice(0, 4_000),
      timerSec,
      mode: inferMode(sample.text),
      roster: matches.map((match) => match.entry.displayAlias),
      confidence,
      evidenceRef: sample.evidenceRef,
    })

    for (const match of matches) {
      const aliasKey = normalizeGameAlias(match.entry.normalizedAlias || match.entry.displayAlias)
      const bucket = Math.floor(sample.atSec / 60)
      const key = `${aliasKey}:${bucket}`
      if (!participants.has(key)) {
        participants.set(key, {
          alias: match.entry.displayAlias,
          atSec: sample.atSec,
          confidence: match.confidence,
          evidenceRef: sample.evidenceRef,
        })
      }
    }

    combatEvents.push(...combatEventsFromSample(sample, matches, owner))
    const result = resultFromText(sample.text)
    if (result) {
      const key = `${result.outcome}:${Math.floor(sample.atSec / 10)}`
      if (!results.has(key)) {
        results.set(key, {
          atSec: sample.atSec,
          outcome: result.outcome,
          kills: labeledNumber(sample.text, 'kills?|k[.]?o[.]?s?'),
          deaths: labeledNumber(sample.text, 'deaths?'),
          assists: labeledNumber(sample.text, 'assists?'),
          scoreLine: scoreLine(sample.text),
          confidence: 0.96,
          explicitEvidence: true,
          exactText: result.exactText,
          evidenceRef: sample.evidenceRef,
        })
      }
    }
  }

  return {
    observations,
    participants: [...participants.values()],
    combatEvents,
    results: [...results.values()],
    ownerAlias: observedOwnerAlias,
  }
}
