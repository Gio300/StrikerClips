/**
 * chatEmoji — the shortcode table + picker index shared by every chat composer.
 *
 * Deliberately a hand-kept map rather than a dependency: an emoji-data package
 * is ~1MB of JSON for a feature that needs a couple of hundred entries, and the
 * repo's rule is to prefer what is already in package.json. Everything here is
 * plain data + pure functions, so it unit-tests like lib/chat.ts.
 *
 * Rendering rule: shortcodes are expanded at RENDER time inside a text segment
 * (see components/chat/ChatRichText.tsx), never by rewriting stored bodies. That
 * keeps message offsets — which structural @mentions depend on — stable, and
 * means an unknown shortcode just stays visible as typed instead of vanishing.
 */

export interface EmojiEntry {
  /** Shortcode WITHOUT the surrounding colons, e.g. 'fire'. */
  shortcode: string
  /** The emoji character(s). */
  char: string
  /** Extra words the picker search matches on. */
  keywords: readonly string[]
}

export interface EmojiGroup {
  name: string
  emoji: readonly EmojiEntry[]
}

const e = (shortcode: string, char: string, ...keywords: string[]): EmojiEntry => ({
  shortcode,
  char,
  keywords,
})

/**
 * The picker's contents, grouped. Chosen for a competitive-gaming chat: the
 * reaction set first, then the sports/hype set people actually reach for.
 */
export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    name: 'Reactions',
    emoji: [
      e('joy', '😂', 'laugh', 'lol', 'funny'),
      e('sob', '😭', 'cry', 'sad'),
      e('skull', '💀', 'dead', 'died'),
      e('heart', '❤️', 'love', 'red'),
      e('fire', '🔥', 'lit', 'hot', 'flame'),
      e('clap', '👏', 'applause', 'gg'),
      e('pray', '🙏', 'please', 'thanks'),
      e('eyes', '👀', 'look', 'watching'),
      e('thinking', '🤔', 'hmm', 'think'),
      e('sunglasses', '😎', 'cool', 'shades'),
      e('smile', '😄', 'happy', 'grin'),
      e('wink', '😉', 'nudge'),
      e('sweat_smile', '😅', 'nervous', 'phew'),
      e('rage', '😡', 'angry', 'mad'),
      e('cold_face', '🥶', 'cold', 'frozen'),
      e('exploding_head', '🤯', 'mind', 'blown'),
      e('salute', '🫡', 'respect', 'o7'),
      e('shrug', '🤷', 'idk', 'dunno'),
      e('sleeping', '😴', 'bored', 'zzz'),
      e('nauseated', '🤢', 'gross', 'ew'),
    ],
  },
  {
    name: 'Hands',
    emoji: [
      e('+1', '👍', 'thumbsup', 'yes', 'up'),
      e('-1', '👎', 'thumbsdown', 'no', 'down'),
      e('ok_hand', '👌', 'ok', 'perfect'),
      e('muscle', '💪', 'strong', 'flex'),
      e('handshake', '🤝', 'deal', 'gg'),
      e('wave', '👋', 'hi', 'bye', 'hello'),
      e('point_right', '👉', 'this'),
      e('raised_hands', '🙌', 'celebrate', 'praise'),
      e('fist', '✊', 'bump', 'power'),
      e('v', '✌️', 'peace', 'victory'),
    ],
  },
  {
    name: 'Game',
    emoji: [
      e('crossed_swords', '⚔️', 'fight', 'battle', 'vs'),
      e('shield', '🛡️', 'defend', 'block'),
      e('dart', '🎯', 'target', 'headshot', 'accurate'),
      e('boom', '💥', 'explosion', 'ko'),
      e('zap', '⚡', 'fast', 'speed', 'lightning'),
      e('video_game', '🎮', 'controller', 'game'),
      e('joystick', '🕹️', 'arcade'),
      e('ninja', '🥷', 'shinobi', 'stealth'),
      e('dragon', '🐉', 'boss'),
      e('ghost', '👻', 'spooky', 'invisible'),
      e('alien', '👽', 'sus'),
      e('robot', '🤖', 'bot', 'ai'),
      e('skull_crossbones', '☠️', 'death', 'ko'),
      e('ice', '🧊', 'clutch', 'cold'),
    ],
  },
  {
    name: 'Hype',
    emoji: [
      e('trophy', '🏆', 'win', 'champion', 'first'),
      e('crown', '👑', 'king', 'best', 'goat'),
      e('medal', '🏅', 'award', 'placed'),
      e('100', '💯', 'hundred', 'perfect', 'real'),
      e('rocket', '🚀', 'launch', 'up', 'fast'),
      e('star', '⭐', 'fav', 'favourite'),
      e('sparkles', '✨', 'shiny', 'new'),
      e('tada', '🎉', 'party', 'celebrate'),
      e('gem', '💎', 'diamond', 'rare'),
      e('money', '💰', 'cash', 'bag', 'paid'),
      e('chart_up', '📈', 'rising', 'gains'),
      e('chart_down', '📉', 'falling', 'losses'),
      e('bell', '🔔', 'notify', 'alert'),
      e('mega', '📣', 'announce', 'shout'),
      e('camera', '📸', 'clip', 'screenshot'),
      e('film', '🎬', 'video', 'reel', 'highlight'),
      e('red_circle', '🔴', 'live', 'record'),
      e('stopwatch', '⏱️', 'timer', 'time'),
      e('warning', '⚠️', 'careful', 'caution'),
      e('check', '✅', 'done', 'yes', 'confirmed'),
      e('x', '❌', 'no', 'wrong', 'fail'),
      e('question', '❓', 'ask', 'huh'),
    ],
  },
]

/** Flat list of every entry, in picker order. */
export const EMOJI_LIST: readonly EmojiEntry[] = EMOJI_GROUPS.flatMap((g) => g.emoji)

/** shortcode -> character. Built once from EMOJI_GROUPS. */
export const EMOJI_SHORTCODES: Readonly<Record<string, string>> = Object.freeze(
  EMOJI_LIST.reduce<Record<string, string>>((acc, entry) => {
    acc[entry.shortcode] = entry.char
    return acc
  }, {}),
)

// Shortcodes are :lower_snake:, plus exactly the two universal punctuation
// names (":+1:", ":-1:") — admitted by their own alternative rather than by
// widening the general form. Deliberately narrow so ordinary text with colons —
// a URL, "12:30", "note: this", "a:B:c" — can never be mistaken for one.
const SHORTCODE_PATTERN = /:((?:[+-]1|[a-z0-9][a-z0-9_+-]{0,30})):/g

/** The character for a shortcode name, or null when it isn't one of ours. */
export function emojiForShortcode(name: string): string | null {
  if (typeof name !== 'string') return null
  return Object.prototype.hasOwnProperty.call(EMOJI_SHORTCODES, name)
    ? EMOJI_SHORTCODES[name]
    : null
}

/**
 * Expand every KNOWN `:shortcode:` in a plain-text run. Unknown shortcodes are
 * left exactly as typed — a chat that silently eats ":shipit:" looks broken.
 */
export function expandShortcodes(text: string): string {
  if (typeof text !== 'string' || text.indexOf(':') === -1) return typeof text === 'string' ? text : ''
  return text.replace(SHORTCODE_PATTERN, (whole, name: string) => emojiForShortcode(name) ?? whole)
}

/**
 * Picker search. Empty query returns everything in group order; otherwise
 * matches on shortcode prefix/substring and keywords, prefix hits first so
 * ":fi" puts :fire: at the top.
 */
export function searchEmoji(query: string, limit = 48): EmojiEntry[] {
  const q = (query ?? '').trim().toLowerCase().replace(/^:+|:+$/g, '')
  if (!q) return EMOJI_LIST.slice(0, limit)
  const prefix: EmojiEntry[] = []
  const contains: EmojiEntry[] = []
  for (const entry of EMOJI_LIST) {
    if (entry.shortcode.startsWith(q)) {
      prefix.push(entry)
      continue
    }
    if (entry.shortcode.includes(q) || entry.keywords.some((k) => k.includes(q))) {
      contains.push(entry)
    }
  }
  return [...prefix, ...contains].slice(0, limit)
}
