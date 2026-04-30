/**
 * Local-AI contracts.
 *
 * This module defines the *interfaces* between ClutchLens and the on-device
 * AI stack. Real backends (Ollama LLM, Piper TTS, ElevenLabs cloud TTS) plug
 * in via `setLLM()` / `setTTS()`. Today, the web build ships with a no-op
 * LLM and a Web-Speech-API TTS so callers can develop against the real API
 * surface; the desktop installer (Tauri sidecar) replaces them at boot.
 *
 * Design notes:
 *   - Tiny prompts. We're targeting 1B-class LLMs on consumer CPUs, so the
 *     prompt template is deliberately short. Long context = slow + drift.
 *   - Game profile drives vocabulary. Whatever the LLM says must come back
 *     within the profile's tone + stay near the phrase bank. The phrase
 *     bank doubles as a fallback when the LLM is offline.
 *   - Streaming where possible (LLM token stream, TTS audio chunks) so the
 *     reel can speak before the whole sentence is generated.
 *   - Explicit "bring-your-own" credentials. ElevenLabs key, OpenAI key,
 *     etc. live in localStorage under `clutchlens.byok.<provider>` and the
 *     UI is the only thing that ever reads them. Never sent to our servers.
 */

import type { GameProfile } from './gameProfile'

// ─────────────────────────────────────────────────────────────────────────
//  LLM
// ─────────────────────────────────────────────────────────────────────────

export type LLMRole = 'system' | 'user' | 'assistant'
export type LLMMessage = { role: LLMRole; content: string }

export type LLMRequest = {
  messages: LLMMessage[]
  /** Hard cap on output tokens. Tiny LLM friendly. */
  max_tokens?: number
  temperature?: number
  /** Stop sequences — useful to keep the model from rambling. */
  stop?: string[]
}

export interface LLM {
  readonly id: string
  readonly available: boolean
  /** One-shot generation. Use `generateStream` for streaming UIs. */
  generate(req: LLMRequest): Promise<string>
  /** Streaming generation; yields token chunks as they arrive. */
  generateStream?(req: LLMRequest): AsyncIterable<string>
}

/**
 * Default LLM in the web build: returns a phrase from the active game
 * profile so the UI works end-to-end with no model installed.
 */
const NoopLLM: LLM = {
  id: 'noop',
  available: false,
  async generate(req) {
    const last = req.messages[req.messages.length - 1]?.content ?? ''
    // Tiny smoke response. Real backends override.
    return last.length > 0 ? '' : ''
  },
}

let activeLLM: LLM = NoopLLM
export function getLLM(): LLM { return activeLLM }
export function setLLM(impl: LLM): void { activeLLM = impl }

// ─────────────────────────────────────────────────────────────────────────
//  TTS
// ─────────────────────────────────────────────────────────────────────────

export type TTSVoice = {
  /** Provider-scoped voice id (e.g. 'piper:en_US-amy-medium'). */
  id: string
  name: string
  language: string
  /** Rough description: "hype female narrator", "calm male", etc. */
  description?: string
}

export type TTSRequest = {
  text: string
  voice?: string
  /** 0.5–2.0 speech rate. Provider may clamp. */
  rate?: number
  /** 0.5–2.0 pitch. Provider may ignore. */
  pitch?: number
}

export interface TTS {
  readonly id: string
  readonly available: boolean
  voices(): Promise<TTSVoice[]>
  /** Synthesize and return audio as a Blob. */
  synthesize(req: TTSRequest): Promise<Blob>
  /** Optional: speak directly out the default audio device. */
  speak?(req: TTSRequest): Promise<void>
}

/**
 * Default TTS: Web Speech API. Free, available in every modern browser,
 * sounds robotic but works. Replaced at boot in the desktop app by Piper
 * (better quality, fully offline).
 */
const WebSpeechTTS: TTS = {
  id: 'webspeech',
  get available(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  },
  async voices(): Promise<TTSVoice[]> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
    const list = window.speechSynthesis.getVoices()
    return list.map((v) => ({
      id: `webspeech:${v.voiceURI}`,
      name: v.name,
      language: v.lang,
      description: v.default ? 'Default browser voice' : undefined,
    }))
  },
  async synthesize(): Promise<Blob> {
    // Web Speech doesn't expose audio chunks — only direct playback. We
    // return an empty placeholder so callers using `speak()` still work.
    return new Blob([], { type: 'audio/wav' })
  },
  async speak(req: TTSRequest): Promise<void> {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const utter = new SpeechSynthesisUtterance(req.text)
    if (req.rate) utter.rate = req.rate
    if (req.pitch) utter.pitch = req.pitch
    if (req.voice) {
      const want = req.voice.replace(/^webspeech:/, '')
      const v = window.speechSynthesis.getVoices().find((x) => x.voiceURI === want)
      if (v) utter.voice = v
    }
    window.speechSynthesis.speak(utter)
  },
}

let activeTTS: TTS = WebSpeechTTS
export function getTTS(): TTS { return activeTTS }
export function setTTS(impl: TTS): void { activeTTS = impl }

// ─────────────────────────────────────────────────────────────────────────
//  Bring-your-own-key storage
// ─────────────────────────────────────────────────────────────────────────

export type BYOKProvider = 'elevenlabs' | 'openai' | 'anthropic'

const BYOK_PREFIX = 'clutchlens.byok.'

export function getByokKey(provider: BYOKProvider): string {
  if (typeof localStorage === 'undefined') return ''
  return localStorage.getItem(`${BYOK_PREFIX}${provider}`) ?? ''
}

export function setByokKey(provider: BYOKProvider, key: string): void {
  if (typeof localStorage === 'undefined') return
  if (key) localStorage.setItem(`${BYOK_PREFIX}${provider}`, key)
  else localStorage.removeItem(`${BYOK_PREFIX}${provider}`)
}

export function clearByok(provider: BYOKProvider): void {
  setByokKey(provider, '')
}

// ─────────────────────────────────────────────────────────────────────────
//  Commentary prompt builder
// ─────────────────────────────────────────────────────────────────────────

export type CommentaryEvent =
  | { kind: 'intro'; angles: number }
  | { kind: 'switch'; from: number; to: number; reason: string }
  | { kind: 'kill'; angle: number }
  | { kind: 'clutch'; angle: number; description?: string }
  | { kind: 'teamwork'; angles: number[] }
  | { kind: 'outro' }

/**
 * Build a tight LLM prompt for a single beat of commentary.
 *
 * Keep it small. Tiny LLMs lose track in long contexts. We include:
 *   - persona + tone (10-30 words)
 *   - profile vocabulary hint
 *   - the phrase bank for the matching event (so the model can quote)
 *   - the event itself
 *   - "respond with ≤ N words. No quotes, no explanation."
 */
export function buildCommentaryPrompt(
  event: CommentaryEvent,
  profile: GameProfile,
): LLMMessage[] {
  const phrases = phrasesFor(event.kind, profile)
  const persona = profile.tone.persona ?? 'a concise, friendly play-by-play voice'
  const max = profile.tone.max_words_per_call

  const sys =
    `You are ${persona}. Tone: ${profile.tone.energy}, vocab: ${profile.tone.vocabulary}. ` +
    `Game: ${profile.name}. Reply with ONE line, ${max} words max. No quotes. No explanation.`

  const eventLine = describeEvent(event)
  const phraseHint =
    phrases.length > 0
      ? `Style examples (pick a vibe; do not copy verbatim unless one fits perfectly): ${phrases.join(' / ')}`
      : ''

  const user = [eventLine, phraseHint].filter(Boolean).join('\n')

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]
}

function phrasesFor(kind: CommentaryEvent['kind'], profile: GameProfile): string[] {
  switch (kind) {
    case 'intro': return profile.narration.intro
    case 'kill': return profile.narration.kill
    case 'clutch': return profile.narration.clutch
    case 'teamwork': return profile.narration.teamwork
    case 'outro': return profile.narration.outro
    case 'switch':
    default:
      return []
  }
}

function describeEvent(event: CommentaryEvent): string {
  switch (event.kind) {
    case 'intro': return `Reel intro. ${event.angles} angles in this team play.`
    case 'switch': return `Cut from angle P${event.from + 1} to angle P${event.to + 1}: ${event.reason}.`
    case 'kill': return `Kill / takedown on angle P${event.angle + 1}.`
    case 'clutch': return `Clutch on angle P${event.angle + 1}.${event.description ? ' ' + event.description : ''}`
    case 'teamwork': return `Coordinated team play across angles ${event.angles.map((a) => `P${a + 1}`).join(', ')}.`
    case 'outro': return 'Reel outro. Wrap it.'
  }
}

/**
 * Pick a fallback phrase from the profile's bank for an event. Used when
 * no LLM is available (web build, offline desktop) so the reel still has
 * a voice line.
 */
export function fallbackPhrase(event: CommentaryEvent, profile: GameProfile): string {
  const bank = phrasesFor(event.kind, profile)
  if (bank.length === 0) return ''
  return bank[Math.floor(Math.random() * bank.length)]
}

/**
 * High-level: get a single line of commentary for an event. Tries the
 * active LLM; on failure or unavailable, returns a phrase from the bank.
 *
 * Throws never. Returns empty string only if the bank is empty too.
 */
export async function commentaryFor(
  event: CommentaryEvent,
  profile: GameProfile,
): Promise<string> {
  const llm = getLLM()
  if (llm.available) {
    try {
      const out = await llm.generate({
        messages: buildCommentaryPrompt(event, profile),
        max_tokens: profile.tone.max_words_per_call * 3,
        temperature: 0.7,
        stop: ['\n', '"'],
      })
      const cleaned = out.trim().replace(/^["']|["']$/g, '')
      if (cleaned) return cleaned
    } catch (err) {
      console.warn('[localAi] LLM generate failed, falling back to phrase bank:', err)
    }
  }
  return fallbackPhrase(event, profile)
}
