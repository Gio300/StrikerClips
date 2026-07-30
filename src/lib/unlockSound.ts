/**
 * unlockSound — a tiny WebAudio "blip" generated on the fly, so there is NO audio
 * asset to ship or load. Used by the chat emoji-burst to give a satisfying little
 * "unlock" chirp when an emoji lands.
 *
 * Rules of good citizenship, all enforced here:
 *   • Nothing plays until the user has interacted with the page at least once
 *     (browsers block audio before a gesture anyway — we track it explicitly so
 *     we never even try, avoiding console warnings).
 *   • A session-remembered mute flag hard-silences it.
 *   • The AudioContext is created lazily and reused; if WebAudio is unavailable
 *     every call is a no-op.
 */

const MUTE_KEY = 'tko_chat_sound_muted'

let ctx: AudioContext | null = null
let gestureSeen = false

/** Call from any first user gesture (pointerdown/keydown) to arm audio. */
export function armUnlockSound(): void {
  gestureSeen = true
}

export function isChatSoundMuted(): boolean {
  try {
    return sessionStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

export function setChatSoundMuted(muted: boolean): void {
  try {
    if (muted) sessionStorage.setItem(MUTE_KEY, '1')
    else sessionStorage.removeItem(MUTE_KEY)
  } catch {
    /* storage may be unavailable — mute state is best-effort */
  }
}

function audioCtx(): AudioContext | null {
  try {
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    if (!ctx) ctx = new Ctor()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}

/**
 * Play a brief two-note "unlock" blip. No-op before a gesture, when muted, or
 * when WebAudio is unavailable. Safe to call rapidly (each burst schedules its
 * own short envelope).
 */
export function playUnlockBlip(): void {
  if (!gestureSeen || isChatSoundMuted()) return
  const ac = audioCtx()
  if (!ac) return
  try {
    const now = ac.currentTime
    const master = ac.createGain()
    master.gain.value = 0.0001
    master.connect(ac.destination)

    // A quick rising two-tone chirp: 660Hz -> 990Hz, ~140ms, gentle envelope.
    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(660, now)
    osc.frequency.exponentialRampToValueAtTime(990, now + 0.09)
    osc.connect(master)

    master.gain.exponentialRampToValueAtTime(0.12, now + 0.015)
    master.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)

    osc.start(now)
    osc.stop(now + 0.18)
    osc.onended = () => {
      try { master.disconnect() } catch { /* already gone */ }
    }
  } catch {
    /* audio scheduling failed — never let sound break the UI */
  }
}
