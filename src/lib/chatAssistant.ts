/**
 * chatAssistant — addressing the in-app AI from a chat composer, shared by every
 * chat surface (live, stage, tournament, channel, DM).
 *
 * ONE AI PATH, NOT TWO. The assistant is "Ask TKO", the Vertex/Gemini-backed
 * `ask` fn (server/app.ts). This module is a thin, pure-ish front door to THAT
 * endpoint — it does not add a model, a prompt, or a second call site. (Note for
 * anyone reading the brief: "Oracle" elsewhere in this codebase is the cash-free
 * prediction/betting system, NOT the assistant. `@oracle` is accepted here only
 * as a spoken-language ALIAS the owner asked for, and it routes to `ask` like
 * every other handle.)
 *
 * COST CONTROL IS THE POINT. A public live room where anyone can type "@tko …"
 * is a direct line from an anonymous keyboard to a paid Gemini call. Two gates
 * stand in front of it:
 *   1. this module's per-surface CLIENT cooldown — cheap, instant feedback, and
 *      it stops the accidental double-send;
 *   2. the SERVER's per-user sliding window in the `ask` fn — the real limit,
 *      because a client gate is advice, not enforcement.
 * The server answers a throttled caller with 200 + `{ok:false, rateLimited:true}`
 * (the convention `ask` already uses for every other failure), so a throttled
 * room degrades to a short in-chat note instead of an error state.
 */

import { callFn } from '@/lib/backend'
import { bankAnswer } from '@/lib/answerBank'
import { TKO_BOT_PREFIX, STREAM_HIGHLIGHT_PREFIX } from '@/lib/streamChatMarkup'

/** How the assistant is named in chat UI. */
export const ASSISTANT_NAME = 'TKO'

/**
 * Handles that summon the assistant. `tko` is the established one (already live
 * in StreamChat + ChatSpace); `oracle` and `ai` are aliases so a player who
 * reaches for either word still gets an answer.
 */
export const ASSISTANT_HANDLES = ['tko', 'oracle', 'ai'] as const

/** Slash commands that summon the assistant from the start of a line. */
export const ASSISTANT_SLASH_COMMANDS = ['tko', 'ask', 'ai', 'oracle'] as const

/** Longest question we forward — matches the `ask` fn's own server-side cap. */
export const ASSISTANT_QUESTION_MAX = 500

/**
 * Client-side cooldown between assistant calls on one surface. Sized so a room
 * cannot turn into a model-call firehose from a single tab even before the
 * server's window applies.
 */
export const ASSISTANT_COOLDOWN_MS = 12_000

const HANDLE_PATTERN = new RegExp(
  `(?:^|\\s)@(?:${ASSISTANT_HANDLES.join('|')})\\b[:,]?\\s+(.+)$`,
  'i',
)

const SLASH_PATTERN = new RegExp(
  `^\\s*/(?:${ASSISTANT_SLASH_COMMANDS.join('|')})\\b[:,]?\\s+(.+)$`,
  'i',
)

/**
 * The question a chat line asks the assistant, or null.
 *
 * Requires real content after the handle, so a bare "@tko" (or talking ABOUT
 * the Oracle feature) never spends a model call. Our own in-band markers are
 * refused outright, which is what stops a bot reply from asking a question and
 * looping the room.
 */
export function extractAssistantQuestion(text: string): string | null {
  if (typeof text !== 'string') return null
  if (text.startsWith(TKO_BOT_PREFIX) || text.startsWith(STREAM_HIGHLIGHT_PREFIX)) return null
  const raw = text.match(SLASH_PATTERN)?.[1] ?? text.match(HANDLE_PATTERN)?.[1]
  const question = (raw ?? '').trim()
  return question ? question.slice(0, ASSISTANT_QUESTION_MAX) : null
}

/** True when a line would summon the assistant (for composer hints). */
export function mentionsAssistant(text: string): boolean {
  return extractAssistantQuestion(text) !== null
}

// ───────────────────────────────────────────────────────────────────────────
//  Cooldown
// ───────────────────────────────────────────────────────────────────────────

/**
 * Milliseconds still to wait before this surface may call the assistant again.
 * 0 means "go". Pure, so the cadence is testable without timers.
 */
export function cooldownRemainingMs(
  lastAskAt: number | null,
  now: number,
  cooldownMs: number = ASSISTANT_COOLDOWN_MS,
): number {
  if (lastAskAt === null || !Number.isFinite(lastAskAt)) return 0
  const elapsed = now - lastAskAt
  if (elapsed < 0) return cooldownMs // clock skew — hold rather than let a burst through
  return Math.max(0, cooldownMs - elapsed)
}

/** The in-chat note shown when the assistant is throttled. Never blames the user. */
export function throttleLine(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil((retryAfterMs || 0) / 1000))
  return `${ASSISTANT_NAME} is catching up — try again in ${seconds}s.`
}

// ───────────────────────────────────────────────────────────────────────────
//  The call
// ───────────────────────────────────────────────────────────────────────────

/** What a chat surface does with an assistant attempt. */
export type AssistantResult =
  /**
   * Post this as a badged assistant line. `source` says where it came from:
   * 'model' is a live grounded answer, 'offline' is the local answer bank
   * (src/lib/answerBank.ts) standing in because the model was throttled or
   * unreachable. Both are real answers — callers that just post `answer` need
   * no change.
   */
  | { kind: 'answer'; answer: string; source: 'model' | 'offline' }
  /** Throttled AND the bank has nothing — show `message` locally; post NOTHING. */
  | { kind: 'throttled'; retryAfterMs: number; message: string }
  /** Backend unreachable / model hiccup — stay silent, chat is unaffected. */
  | { kind: 'unavailable' }

interface AskResponse {
  ok?: boolean
  answer?: string
  rateLimited?: boolean
  retryAfterMs?: number
  error?: string
}

/**
 * Ask the assistant one question through the existing `ask` fn.
 *
 * NEVER THROWS. Every failure mode collapses to 'unavailable', because the
 * assistant is a garnish on chat — a model outage must not break sending
 * messages. `path` is the route the player is on; the fn already uses it to
 * situate answers ("on this tournament").
 */
export async function askAssistant(
  question: string,
  options: { path?: string } = {},
): Promise<AssistantResult> {
  const q = (question ?? '').trim().slice(0, ASSISTANT_QUESTION_MAX)
  if (!q) return { kind: 'unavailable' }

  /**
   * THE $0 FALLBACK. The panel has degraded to a local answer for years; the
   * chat surfaces degraded to SILENCE, which is the one thing the operator's
   * convention forbids — a rate limit must never look like a broken chat. The
   * bank answers only what it is sure of and returns null otherwise, so this
   * can add an answer where there was none and can never replace a live one.
   */
  const offline = (): AssistantResult | null => {
    const local = bankAnswer(q)
    return local ? { kind: 'answer', answer: local, source: 'offline' } : null
  }

  try {
    const res = await callFn<AskResponse>('ask', {
      question: q,
      clientContext: { path: (options.path ?? '').slice(0, 160) },
    })
    if (!res) return offline() ?? { kind: 'unavailable' }
    if (res.rateLimited) {
      const retryAfterMs = Number(res.retryAfterMs) || 0
      return (
        offline() ??
        { kind: 'throttled', retryAfterMs, message: throttleLine(retryAfterMs) }
      )
    }
    const answer = res.ok ? (res.answer || '').trim() : ''
    if (answer) return { kind: 'answer', answer, source: 'model' }
    return offline() ?? { kind: 'unavailable' }
  } catch {
    return offline() ?? { kind: 'unavailable' }
  }
}

/** The route hint to send with an assistant call, safe outside a browser. */
export function currentPath(): string {
  try {
    return typeof window === 'undefined' ? '' : window.location?.pathname ?? ''
  } catch {
    return ''
  }
}
