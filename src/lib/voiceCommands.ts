/**
 * Voice/text command parser for the KillCam director + accessibility.
 *
 * Pure + synchronous so it's trivially testable and runs on-device. Each user
 * speaks on their OWN phone/account, so "who" is already known — this only has
 * to figure out "what". A heavier agent (Open Interpreter 01 / a backend LLM)
 * can take over for anything that returns `unknown`.
 */

export type DirectorAction = 'all' | 'single' | 'focus' | 'replay' | 'slowmo' | 'golive' | 'stats'

export type VoiceIntent =
  | { kind: 'navigate'; path: string; say: string }
  | { kind: 'director'; action: DirectorAction; screen?: number; say: string }
  | { kind: 'create'; category: 'ko' | 'ultimate' | 'flag' | 'opening' | 'closing' | 'all'; say: string }
  | { kind: 'accessibility'; action: 'read' | 'help'; say: string }
  | { kind: 'unknown'; transcript: string }

const NAV: { rx: RegExp; path: string; say: string }[] = [
  { rx: /\b(home|dashboard home)\b/, path: '/', say: 'Home' },
  { rx: /\breels?\b/, path: '/reels', say: 'Reels' },
  { rx: /\b(tournaments?|brackets?)\b/, path: '/tournaments', say: 'Tournaments' },
  { rx: /\b(boards?|servers?|chat)\b/, path: '/boards', say: 'Boards' },
  { rx: /\b(browser|playstation|xbox|post (a )?clip)\b/, path: '/browser', say: 'Browser' },
  { rx: /\b(live|stream)\b/, path: '/live', say: 'Live' },
  { rx: /\b(rankings?|leaderboards?|power)\b/, path: '/rankings', say: 'Rankings' },
  { rx: /\b(profile|my account)\b/, path: '/profile', say: 'Profile' },
  { rx: /\b(redeem|pass|code)\b/, path: '/redeem', say: 'Redeem' },
  { rx: /\bdashboard\b/, path: '/dashboard', say: 'Dashboard' },
]

const wordToNum: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 }

function screenNumber(t: string): number | undefined {
  const digit = t.match(/screen\s*(\d)/) || t.match(/(\d)\b/)
  if (digit) return parseInt(digit[1], 10)
  for (const [w, n] of Object.entries(wordToNum)) if (t.includes(`screen ${w}`) || t.includes(`cam ${w}`)) return n
  return undefined
}

export function parseCommand(raw: string): VoiceIntent {
  const t = raw.toLowerCase().trim()
  if (!t) return { kind: 'unknown', transcript: raw }

  // Accessibility / help
  if (/\b(help|what can i say|commands)\b/.test(t)) return { kind: 'accessibility', action: 'help', say: 'Here are the commands' }
  if (/\b(read (this|the )?(screen|page)|read it out)\b/.test(t)) return { kind: 'accessibility', action: 'read', say: 'Reading the screen' }

  // Director controls (checked before nav so "single screen" doesn't hit nav)
  if (/\b(all|every) (screens?|angles?|cams?)\b|\bsplit ?screen\b|\bfour up\b|\beight up\b/.test(t))
    return { kind: 'director', action: 'all', say: 'All angles' }
  if (/\b(single|one|full) ?(screen|cam)\b|\bjust one\b/.test(t))
    return { kind: 'director', action: 'single', say: 'Single screen' }
  if (/\b(focus|zoom|switch to|go to) (screen|cam|angle)\b|\bfocus\b/.test(t)) {
    const n = screenNumber(t)
    return { kind: 'director', action: 'focus', screen: n, say: n ? `Focusing screen ${n}` : 'Focusing' }
  }
  if (/\b(slow ?mo(tion)?|slow it down)\b/.test(t)) return { kind: 'director', action: 'slowmo', say: 'Slow motion' }
  if (/\b(replay|run (it|that) back|show that (kill|again))\b/.test(t)) return { kind: 'director', action: 'replay', say: 'Replay' }
  if (/\b(go live|start (the )?stream|in the pit)\b/.test(t)) return { kind: 'director', action: 'golive', say: 'Going live' }
  if (/\b(stats?|scoreboard|results?)\b/.test(t)) return { kind: 'director', action: 'stats', say: 'Stats' }

  // Create a clip of a category
  if (/\b(make|build|clip|cut) /.test(t) || /\bmy (ko|k\.?o|kills|ultimates?|flags?)/.test(t)) {
    if (/\b(k\.?o|kills?|knockouts?)\b/.test(t)) return { kind: 'create', category: 'ko', say: 'Clipping your K.O.s' }
    if (/\bultimate|ougi|jutsu\b/.test(t)) return { kind: 'create', category: 'ultimate', say: 'Clipping your ultimates' }
    if (/\bflags?|scrolls?\b/.test(t)) return { kind: 'create', category: 'flag', say: 'Clipping your flag runs' }
    if (/\bopening|start\b/.test(t)) return { kind: 'create', category: 'opening', say: 'Clipping the opening' }
    if (/\bclosing|stats?|results?\b/.test(t)) return { kind: 'create', category: 'closing', say: 'Clipping the closing stats' }
    return { kind: 'create', category: 'all', say: 'Building your reel' }
  }

  // Navigation (last, most general)
  for (const n of NAV) if (n.rx.test(t)) return { kind: 'navigate', path: n.path, say: n.say }

  return { kind: 'unknown', transcript: raw }
}
