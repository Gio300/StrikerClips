/**
 * Game profile — per-game knowledge the director and the (future) local AI
 * commentator both pull from.
 *
 * The director uses `audio_cues` and `clutch_rules` to weight scoring beyond
 * the base "most replayed" heatmap. The AI commentator (Ollama / Piper / TTS
 * fallback) uses `narration` + `tone` to keep its lines short, on-topic, and
 * game-specific. Each profile is a plain JSON file under
 * `public/game-profiles/<id>.json` so the community can contribute without
 * touching the build.
 *
 * The schema is intentionally simple — it grows as we ship features. Adding
 * a new field always defaults safely so older profiles keep working.
 */

export type GameProfile = {
  /** URL-safe identifier (e.g. "shinobi-strikers"). */
  id: string
  /** Display name. */
  name: string
  /** Optional short description shown in the Create reel UI. */
  description?: string

  /** Voice / vocabulary guidance for the narrator. */
  tone: {
    /** "hype" | "chill" | "dry" | "cinematic" — used to pick voices and pacing. */
    energy: 'hype' | 'chill' | 'dry' | 'cinematic'
    /** "casual" | "esports" | "anime" | "noir" — flavors the prompt template. */
    vocabulary: 'casual' | 'esports' | 'anime' | 'noir'
    /** Hard cap so commentary never steps on the action. */
    max_words_per_call: number
    /**
     * Persona seed. Free-text, fed verbatim into the LLM prompt. Keep it
     * short — long personas blow tiny LLM context.
     */
    persona?: string
  }

  /**
   * Director-side scoring boosts. Each rule pattern matches a runtime
   * condition; when matched, the matching clip's action score gets the boost
   * applied. We keep this declarative so the director engine stays pure.
   *
   * Today these are evaluated lightly (we only have heatmap signal). When
   * the local-AI vision tagging ships, these become the primary scoring.
   */
  clutch_rules: ClutchRule[]

  /**
   * Audio cue dictionary. Phrases the AI listens for when the user runs the
   * desktop app (Whisper.cpp tiny). Web build can also surface them in the
   * "what to look for" UI. Keys are cue names; values are listen patterns.
   */
  audio_cues: Record<string, AudioCueDef>

  /**
   * Narration phrase bank — short pre-baked lines the AI may quote verbatim
   * to stay on-game. Avoids the tiny LLM hallucinating goofy things.
   */
  narration: {
    intro: string[]
    kill: string[]
    clutch: string[]
    teamwork: string[]
    outro: string[]
  }
}

export type ClutchRule = {
  /** Human-friendly name shown in tooltips. */
  name: string
  /**
   * Predicate keys — these are runtime signals the director provides. The
   * engine only acts on keys it understands; anything unknown is ignored.
   * (Predicate evaluation lives in `evaluateRule()` below.)
   */
  when: ClutchPredicate
  /** How much to add to that clip's effective score, 0..0.5. */
  boost: number
}

export type ClutchPredicate = {
  audio_loudness_jump?: number      // dB jump > N
  remaining_allies?: { lt?: number; eq?: number }
  enemies_remaining?: { gte?: number }
  match_won?: boolean
  time_remaining_lt?: number        // seconds
  kill_event?: boolean
  score_delta_was_lt?: number
  score_delta_now_gte?: number
  // Game-specific boolean flag the user/UI can set (e.g. "ougi_active")
  flag?: string
}

export type AudioCueDef = {
  /** Phrases / keywords for speech-to-text matching. */
  phrases?: string[]
  /** dB jump to flag a sound spike (explosion, impact). */
  min_db_jump?: number
  /** Minimum duration of the spike, ms. */
  min_duration_ms?: number
}

/**
 * Built-in profiles — also written out to public/ so external tooling can
 * fetch them. The library default is `default` (any game) and there's a
 * sample for Shinobi Striker that doubles as documentation of what a real
 * profile looks like.
 */
export const DEFAULT_PROFILE: GameProfile = {
  id: 'default',
  name: 'Any game',
  description:
    'A safe profile that works for any title. Uses the "most replayed" heatmap as the only signal and keeps narration neutral.',
  tone: {
    energy: 'chill',
    vocabulary: 'casual',
    max_words_per_call: 12,
    persona: 'a concise, friendly play-by-play voice',
  },
  clutch_rules: [
    { name: 'Big audio spike', when: { audio_loudness_jump: 12 }, boost: 0.18 },
  ],
  audio_cues: {
    explosion: { min_db_jump: 12, min_duration_ms: 200 },
    cheer: { phrases: ['nice', 'lets go', 'oh my', 'wow'] },
  },
  narration: {
    intro: ['Squad lined up.', 'Game on.', 'Watch this.'],
    kill: ['Down.', 'Clean.', 'Got him.'],
    clutch: ['He is the only one left.', 'Nobody is home but him.', 'And he holds it down.'],
    teamwork: ['Right behind him.', 'Same play, two angles.', 'Backup is here.'],
    outro: ['And that is the play.', 'Good game.', 'Send it.'],
  },
}

let runtimeProfile: GameProfile = DEFAULT_PROFILE

/** Active profile getter. Components reading from this always get the latest. */
export function getActiveProfile(): GameProfile {
  return runtimeProfile
}

/**
 * Sets the active profile. Components reading via `getActiveProfile()` see
 * the change on next read; React components subscribed via `useProfile`
 * re-render.
 */
export function setActiveProfile(p: GameProfile): void {
  runtimeProfile = p
  for (const fn of subscribers) fn(p)
}

const subscribers = new Set<(p: GameProfile) => void>()

export function subscribeProfile(fn: (p: GameProfile) => void): () => void {
  subscribers.add(fn)
  return () => subscribers.delete(fn)
}

/**
 * Loads a profile from `public/game-profiles/<id>.json`. Returns the default
 * profile on any error (404, parse fail) so the UI never breaks.
 *
 * This deliberately uses fetch + relative path so it works the same in:
 *   - dev (vite dev server)
 *   - the built app (any base path)
 *   - the standalone marketing build (which doesn't include the loader)
 */
export async function loadProfile(id: string): Promise<GameProfile> {
  if (id === DEFAULT_PROFILE.id) return DEFAULT_PROFILE
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  try {
    const res = await fetch(`${base}/game-profiles/${id}.json`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    return { ...DEFAULT_PROFILE, ...json } satisfies GameProfile
  } catch (err) {
    console.warn(`[gameProfile] falling back to default; could not load "${id}":`, err)
    return DEFAULT_PROFILE
  }
}

/**
 * Apply a profile's clutch rules to a vector of base scores. Returns the
 * boosted scores. The director engine calls this every tick — keep it
 * cheap.
 *
 * `runtime` carries the live signals the rules read from. Only the keys
 * the rule references are required; everything else can be omitted.
 */
export function applyClutchBoost(
  baseScores: number[],
  runtime: ClutchRuntime[],
  profile: GameProfile = runtimeProfile,
): number[] {
  if (!profile.clutch_rules.length) return baseScores
  return baseScores.map((s, i) => {
    const r = runtime[i]
    if (!r) return s
    let boost = 0
    for (const rule of profile.clutch_rules) {
      if (evaluateRule(rule.when, r)) boost += rule.boost
    }
    // Cap so a stack of rules can't blow past 1.0.
    return Math.min(1, s + Math.min(0.5, boost))
  })
}

/**
 * Per-clip live signals. The runtime scoring layer fills as much as it
 * knows. Today only `audio_loudness_jump` and `flag` are populated; the
 * rest become useful as we add game telemetry.
 */
export type ClutchRuntime = {
  audio_loudness_jump?: number
  remaining_allies?: number
  enemies_remaining?: number
  match_won?: boolean
  time_remaining?: number
  kill_event?: boolean
  score_delta_was?: number
  score_delta_now?: number
  flags?: Set<string>
}

function evaluateRule(p: ClutchPredicate, r: ClutchRuntime): boolean {
  if (p.audio_loudness_jump !== undefined) {
    if ((r.audio_loudness_jump ?? -Infinity) < p.audio_loudness_jump) return false
  }
  if (p.remaining_allies?.lt !== undefined) {
    if ((r.remaining_allies ?? Infinity) >= p.remaining_allies.lt) return false
  }
  if (p.remaining_allies?.eq !== undefined) {
    if ((r.remaining_allies ?? -1) !== p.remaining_allies.eq) return false
  }
  if (p.enemies_remaining?.gte !== undefined) {
    if ((r.enemies_remaining ?? -Infinity) < p.enemies_remaining.gte) return false
  }
  if (p.match_won !== undefined) {
    if (r.match_won !== p.match_won) return false
  }
  if (p.time_remaining_lt !== undefined) {
    if ((r.time_remaining ?? Infinity) >= p.time_remaining_lt) return false
  }
  if (p.kill_event !== undefined) {
    if (r.kill_event !== p.kill_event) return false
  }
  if (p.score_delta_was_lt !== undefined) {
    if ((r.score_delta_was ?? Infinity) >= p.score_delta_was_lt) return false
  }
  if (p.score_delta_now_gte !== undefined) {
    if ((r.score_delta_now ?? -Infinity) < p.score_delta_now_gte) return false
  }
  if (p.flag !== undefined) {
    if (!r.flags?.has(p.flag)) return false
  }
  return true
}
