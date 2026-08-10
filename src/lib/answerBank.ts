/**
 * answerBank — the $0 answers.
 *
 * A large share of what people ask Ask TKO is not a question about live data at
 * all. "How do I go live?", "what does Legend include?", "why aren't my clips
 * grouping with my squad's?" have the same answer today, tomorrow and for every
 * player. Paying a model to re-derive them is slow and pointless, and the
 * answer it invents drifts from the product.
 *
 * THIS IS SPEED, NOT A CAP. Nothing here refuses, shortens or redirects a real
 * question. `bankAnswer` returns a string ONLY when it is confident, and `null`
 * the rest of the time so the caller goes to the model exactly as before. It is
 * a fast path in front of the assistant, never a gate in front of it.
 *
 * WHY IT LIVES IN src/lib. Two callers need it:
 *   • src/components/CommandBar.tsx — the panel, which already had its own
 *     hand-written KB and keeps it; this bank answers what that one does not.
 *   • src/lib/chatAssistant.ts — the chat surfaces, which had NO bank at all. A
 *     throttled "@tko …" in a live room used to post nothing, so the operator's
 *     rule that "a rate limit must never look like a broken chat" was only half
 *     true. Now a throttled room still gets the real answer when the bank knows
 *     it.
 *
 * IT IS GENERATED, NOT TRANSCRIBED. The walkthrough answers are built from
 * src/lib/guides.ts and the tier answers from src/lib/tiers.ts, so a step or a
 * feature that changes there changes here too. Nothing in this file hard-codes
 * a PRICE: prices are catalogue data that moves (the $1.99 rung was retired
 * while this was being written), and a stale price quoted to a throttled user
 * is exactly the drift this file exists to prevent. Pricing questions go to the
 * Upgrade screen.
 */

import { GUIDES, type Guide } from './guides'
import { FEATURE_LABELS, LEVEL_TIER_NAME, proFeatures } from './tiers'

/** What the bank knows about the person asking, when anything is known. */
export type BankContext = {
  /** The asking player's power level, when the caller has it. */
  power?: number
  signedIn?: boolean
}

/**
 * A matcher. Most entries are one regex, but the interesting questions are not
 * one keyword — "my clips aren't showing up with my squad" is a SUBJECT plus a
 * NEGATION plus a VISIBILITY word, in any order and any phrasing, and squeezing
 * that into a single expression makes it both unreadable and too narrow. A
 * predicate says what it means.
 */
type Matcher = RegExp | ((text: string) => boolean)

const matches = (matcher: Matcher, text: string): boolean =>
  typeof matcher === 'function' ? matcher(text) : matcher.test(text)

/** True when every pattern appears somewhere in the text. */
const all = (...patterns: RegExp[]) => (text: string): boolean =>
  patterns.every((pattern) => pattern.test(text))

type BankEntry = {
  /** Stable id — what a test names, and what telemetry would count. */
  id: string
  test: Matcher
  answer: (ctx: BankContext) => string
}

// ─────────────────────────────────────────────────────────────────────────────
//  Generated answers
// ─────────────────────────────────────────────────────────────────────────────

/** A guide, flattened into one spoken answer with its steps in order. */
function guideAnswer(guide: Guide, opener: string): string {
  const steps = guide.steps.map((step, i) => `${i + 1}) ${step.title}: ${step.body}`)
  const link = guide.steps.find((step) => step.cta)?.cta
  return [
    opener,
    ...steps,
    link ? `Jump straight there: ${link.label} (${link.to}).` : '',
    `Say "walk me through it" and I'll open the "${guide.title}" guide step by step.`,
  ].filter(Boolean).join(' ')
}

const guideById = (id: string): Guide | undefined => GUIDES.find((g) => g.id === id)

function fromGuide(id: string, opener: string): (() => string) | null {
  const guide = guideById(id)
  if (!guide) return null
  return () => guideAnswer(guide, opener)
}

/** The paid tiers described by what they DO, generated from the feature table. */
function tierFeatureAnswer(): string {
  const paid = proFeatures().map((f) => f.label)
  const free = (Object.keys(FEATURE_LABELS) as (keyof typeof FEATURE_LABELS)[])
    .filter((f) => !paid.includes(FEATURE_LABELS[f]))
    .map((f) => FEATURE_LABELS[f])
  return (
    `Free gets you ${free.join(', ')}. ` +
    `${LEVEL_TIER_NAME[1]} unlocks the creation tools — ${paid.join(', ')} — and live streaming on your profile. ` +
    `${LEVEL_TIER_NAME[2]} adds streaming on your clan page and the live studio. ` +
    `${LEVEL_TIER_NAME[3]} adds front-page placement, the longest automatic cuts, and creator support subscriptions. ` +
    'Open /upgrade for what each one costs today.'
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  The bank
//
//  ORDER IS THE RANKING. The first regex to match wins, so the SPECIFIC
//  patterns are listed before the broad ones — the panel's older table has the
//  opposite problem (a bare "help" in entry 0 swallows "help me enter a
//  tournament"), which is precisely why the entries here lead with the exact
//  phrase people actually type.
// ─────────────────────────────────────────────────────────────────────────────

const ENTRIES: BankEntry[] = [
  // ── The clock fix. The single highest-value answer in the product: it is the
  // documented cause of "my clips aren't in the squad video", it is completely
  // static, and until now ONLY the paid model knew it. A throttled or offline
  // player got nothing.
  {
    id: 'clip-grouping-clock',
    // SUBJECT + (NEGATION or "same match"). Phrased as three small patterns
    // because people say this a dozen different ways and every one of them is
    // the same device-clock problem.
    test: all(
      /\b(clips?|angles?|videos?|footage|reels?|squad|team|match|game|lobby)\b/,
      /\b(not|n'?t|never|missing|left out|wrong|why|didn|isn|aren|won)\b/,
      /\b(show\w*|appear\w*|group\w*|includ\w*|match\w*|together|with (my|our|the)|up in|in (the )?video|same (match|game|lobby))\b/,
    ),
    answer: () =>
      'TKO groups players into the same match partly by WHEN each clip was recorded, so the usual cause is a device clock. ' +
      "Check the DATE, TIME and TIME ZONE on whatever you capture with — even the right zone with the wrong time stamps your clips hours off and keeps them out of your squad's group. " +
      'Fix the clock, re-upload, and they group. If they still miss, make sure everyone in the match has connected their YouTube.',
  },

  // ── Walkthroughs, generated from guides.ts.
  {
    id: 'go-live',
    test: /\b(go(ing)? live|live ?stream\w*|livestream\w*|start\w* (a )?stream\w*|how .*\bstream\w*|broadcast\w*)\b/,
    answer: fromGuide('go-live', 'Going live takes three steps.')
      ?? (() => 'Head to Live → Go Live to start a broadcast. Streaming is a paid perk and where it lands — your profile, your clan page, or the front page — depends on your tier.'),
  },
  {
    id: 'connect-youtube',
    test: /\b(connect|link|linking)\b.*\b(youtube|channel|account)\b|\byoutube\b.*\b(connect|link)\b/,
    answer: fromGuide('connect-youtube', 'Connecting your YouTube is quick.')
      ?? (() => 'Open the Connect screen to link your YouTube channel so TKO can pull your uploads.'),
  },
  {
    id: 'make-clip',
    test: /\b(make|create|build|cut)\b.*\b(clip|reel|highlight|short|video)\b|\bfirst (clip|reel)\b/,
    answer: fromGuide('make-clip', "Here's how a clip gets made.")
      ?? (() => 'Tap Create, pull in your footage, pick how to combine the angles, and hit Create reel. It lands in My Clips.'),
  },
  {
    id: 'manage-clan-roster',
    test: /\b(add|remove|delete|build|create|edit|manage|submit|enter)\b.*\b(clan )?roster|\broster\b.*\b(member|player|clan|tournament|lineup)\b/,
    answer: fromGuide('manage-clan-roster', 'A clan roster uses approved, registered clan members.')
      ?? (() => 'Approve the player in Clan tools, create a saved roster, add the member, then select that roster in the tournament.'),
  },
  {
    id: 'run-tournament',
    test: /\b(create|host|run|edit|organize|invite)\b.*\b(tournament|event|bracket)\b|\btournament\b.*\b(edit|organizer|invite clans?)\b/,
    answer: fromGuide('run-tournament', 'Tournament organizer tools handle setup, clan invitations, saved rosters, and later edits.')
      ?? (() => 'Open Tournaments, create the event, choose who can enter, then use Organizer tools on the tournament page to edit and review entries.'),
  },
  {
    id: 'join-clan',
    test: /\b(join|start|create|make)\b.*\b(clan|crew|village|team)\b|\bhow.*\bclans?\b.*\bwork\b/,
    answer: fromGuide('join-clan', 'Clans are your crew.')
      ?? (() => 'Head to Clans & Chat to join or create one.'),
  },
  {
    id: 'tko-king',
    test: /\b(tko ?king|the king|the ladder|climb the ladder|get matched|auto-?match)\b/,
    answer: fromGuide('tko-king', 'TKO King is an always-open ladder.')
      ?? (() => 'TKO King is an always-open ladder — enter, get auto-matched in your rank band, agree a time, play, and report the result.'),
  },

  // ── What a tier DOES (never what it costs — see the file header).
  {
    id: 'tier-features',
    test: /\b(what (does|do|is)|what'?s)\b.*\b(pro|elite|legend|paid|premium|upgrade|membership|tier)\b.*\b(include|get|give|unlock|come with|for)\b|\b(pro|elite|legend)\b.*\b(perks?|features?|benefits?)\b|\bwhat'?s in\b.*\b(pro|elite|legend)\b/,
    answer: () => tierFeatureAnswer(),
  },

  // ── Static product facts the panel's table does not cover.
  {
    id: 'stat-check',
    test: /\bstat ?checks?\b/,
    answer: () =>
      'A stat check is a short clip showing your loadout and buffs so the host and the other entrants can verify it — it is what keeps a bracket honest. ' +
      'You submit it when you enter a tournament, and the host or a tournament admin approves it. Your entry stays PENDING until they do, so you are not actually in until it reads accepted.',
  },
  {
    id: 'enter-tournament',
    test: /\b(enter|join|sign ?up for|get into|register for)\b.*\btournament|\bhow.*\btournament.*\b(work|enter|join)\b/,
    answer: () =>
      'Find one on /tournaments (the Play tab), open its page, and press Enter/Join. You agree to the rules and submit a stat-check video, then the host or a tournament admin approves you — entries start PENDING, so watch for yours to read accepted. ' +
      'The Match Board is where you attach your stream link and clips for your own match. You have to be signed in; the Create button and the entry controls are hidden while you are logged out.',
  },
  {
    id: 'sweeps-vs-tokens',
    test: /\b(give ?points?|sweeps?|tokens?|currency|coins?)\b/,
    answer: () =>
      'Two different things. Utility Tokens are what you spend inside the app — highlighting a chat line, clan dues, marketplace buys. ' +
      'Give Points are non-cash support and prestige: they back prize pools and creators, and they never pay out as money. TKO does not take cash wagers.',
  },
  {
    id: 'ads',
    test: /\b(ads?|advert|advertising|commercials?|ad-?free|remove ads|skip ads)\b/,
    answer: () =>
      'Free accounts see ads, and there is a short ad gate before some create actions. Every paid tier hides ads everywhere, and members of a league on a paid plan are ad-free automatically — including everyone on the Shinobi Striker League. ' +
      'Open /upgrade to see the current tiers.',
  },
  {
    id: 'conquest',
    test: /\b(conquest|territor|map|land|capture)\b/,
    answer: () =>
      'Shinobi Conquest is the clan land war: clans take and hold territories on a shared map, and winning clan battles flips ownership. ' +
      'Ask me "who is winning Conquest" and I will read the live map for you.',
  },
  {
    id: 'power-level',
    test: /\b(power ?level|my rank|how strong|my score|my rating)\b/,
    answer: ({ power }) =>
      (typeof power === 'number' ? `Your power level is ${power}. ` : '') +
      'It is recomputed from verified match outcomes and stats, eligible system-detected YouTube battle participation, produced videos, and Oracle points. Losses and verified deaths can lower it. Screenshots, manual result forms, and simply passing a stat check do not add power by themselves.',
  },
  {
    id: 'video-status',
    test: /\b(clip|reel|video)\b.*\b(stuck|missing|failed|saved|playable|produced|processing|ready|status|not showing|not online)\b|\bwhy\b.*\b(clip|reel|video)\b.*\b(not|isn|didn|won)\b/,
    answer: fromGuide('video-and-power-status', 'My Clips shows the player-visible media status and what to do next.')
      ?? (() => 'Open My Clips. Saved is not the same as produced; a failed or needs-attention item should be retried or reported with its YouTube link.'),
  },
  {
    id: 'multi-angle',
    test: /\b(multi-?angle|other angles?|their angle|my angle|re-?render|rebuild|add me to)\b/,
    answer: () =>
      'When several players in the same match have uploaded, TKO can assemble their angles into one video. ' +
      'If you were in a match that became a video, connect your YouTube and the system can add your angle and rebuild it with you in it.',
  },
  {
    id: 'sign-in',
    test: /\b(sign ?in|log ?in|sign ?up|make an account|create an account|button.*(missing|gone|not there)|can'?t see the (create|enter) button)\b/,
    answer: () =>
      'Most of the controls that change something — creating a tournament, entering one, going live, forging — are hidden while you are logged out. ' +
      'Sign in and go back to that screen and the button appears.',
  },
]

/**
 * The bank's answer, or null when it is not confident.
 *
 * Null is the important half of the contract: it means "I do not know this, ask
 * the model", so adding entries here can never remove an answer the player
 * would otherwise have got.
 */
export function bankAnswer(text: string, ctx: BankContext = {}): string | null {
  const t = String(text ?? '').toLowerCase().trim()
  if (t.length < 3) return null
  const hit = ENTRIES.find((entry) => matches(entry.test, t))
  return hit ? hit.answer(ctx) : null
}

/** Which entry would answer this, or null. Exposed for tests and telemetry. */
export function bankEntryId(text: string): string | null {
  const t = String(text ?? '').toLowerCase().trim()
  if (t.length < 3) return null
  return ENTRIES.find((entry) => matches(entry.test, t))?.id ?? null
}

/** Every id in the bank, in ranking order. */
export function bankEntryIds(): string[] {
  return ENTRIES.map((entry) => entry.id)
}
