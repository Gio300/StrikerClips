/**
 * guides.ts — the scripted, step-by-step WALKTHROUGHS that power the "Ask TKO"
 * guided assistant.
 *
 * This file is PURE DATA plus a handful of tiny, side-effect-free helpers so it
 * can be unit-tested without React. The Ask-TKO panel (src/components/CommandBar
 * .tsx) reads a `Guide`, shows the current step big and clear, and steps the user
 * forward/back with the bounds helpers below. Route → guide suggestion (used when
 * the panel opens on a given screen) also lives here so it's testable.
 *
 * Each guide is an ordered list of steps. A step has a short plain-language
 * instruction and an OPTIONAL deep-link CTA (e.g. "Open Connect →" to /connect)
 * that takes a confused user straight to the right screen.
 */

export type GuideCta = {
  /** Button label, e.g. "Open Connect". */
  label: string
  /** In-app route to deep-link to, e.g. "/connect". */
  to: string
}

export type GuideStep = {
  /** Short, big headline for the step. */
  title: string
  /** One or two plain-language sentences telling the user exactly what to do. */
  body: string
  /** Optional deep-link CTA that jumps the user to the right screen. */
  cta?: GuideCta
}

export type Guide = {
  /** Stable id used for deep-linking the panel (e.g. from an entry point). */
  id: string
  /** Menu title, e.g. "Register for TKO King". */
  title: string
  /** One-line description shown in the guide picker. */
  summary: string
  /** NinjaIcon name for the picker card / header. */
  icon: string
  /** The ordered walkthrough steps. */
  steps: GuideStep[]
}

// ─────────────────────────────────────────────────────────────────────────
//  The guides
// ─────────────────────────────────────────────────────────────────────────

/** TKO King is an always-open ladder: enter, schedule, play, and report. */
const tkoKing: Guide = {
  id: 'tko-king',
  title: 'Climb the TKO King ladder',
  summary: 'Enter the never-ending ladder, get auto-matched, and climb toward the crown.',
  icon: 'trophy',
  steps: [
    {
      title: 'Enter the ladder',
      body: 'On the King page, hit "Enter the ladder — find my match". You\'re rated (everyone starts at Genin, 1000) and auto-matched with someone in your rank band. No enrollment window — the ladder is always open.',
      cta: { label: 'Open TKO King', to: '/king' },
    },
    {
      title: 'Agree on a time',
      body: 'When you\'re matched, you each propose a day/time. The match schedules itself the moment your times overlap — you\'ll get a notification for your upcoming battle.',
      cta: { label: 'Open TKO King', to: '/king' },
    },
    {
      title: 'Play + report the result',
      body: 'Play your match, then report who won (verified from your linked YouTube / auto-merge). You\'re re-rated and immediately re-paired. This permanent ladder is separate from the seasonal King bracket, which can have its own enrollment dates.',
      cta: { label: 'Open TKO King', to: '/king' },
    },
  ],
}

/** Connect your YouTube — link the channel so TKO can pull your uploads. */
const connectYoutube: Guide = {
  id: 'connect-youtube',
  title: 'Connect your YouTube',
  summary: 'Connect your channel page so battles and clips can be matched to your account.',
  icon: 'watch',
  steps: [
    {
      title: 'Open YouTube settings',
      body: 'Open Settings and find YouTube channel. This is the account connection used for your profile, live status, and automatic footage matching.',
      cta: { label: 'Open YouTube settings', to: '/settings' },
    },
    {
      title: 'Use your channel page or @handle',
      body: 'Paste youtube.com/@yourname, your YouTube channel page, or enter your @handle. A watch, Shorts, or live-video link is footage—not a channel connection—and will be rejected here.',
    },
    {
      title: 'Confirm the connected channel',
      body: 'Tap Connect channel or Save change. Do not leave until the page shows the connected channel and a saved confirmation.',
      cta: { label: 'Open YouTube settings', to: '/settings' },
    },
    {
      title: 'Add individual videos separately',
      body: 'Use Connect or Create when you want to save a specific YouTube video as reel footage. Eligible public gameplay posted after signup can be picked up automatically; older uploads are not automatically backfilled.',
      cta: { label: 'Open saved footage', to: '/connect' },
    },
  ],
}

/** Make your first clip / reel — pull footage in and build a highlight. */
const makeClip: Guide = {
  id: 'make-clip',
  title: 'Make your first clip',
  summary: 'Turn your footage into a highlight reel, step by step.',
  icon: 'create',
  steps: [
    {
      title: 'Open Create',
      body: 'The highlight builder is where reels are made. Open it to begin — nothing you do here posts until you hit Create.',
      cta: { label: 'Open Create', to: '/highlight/create' },
    },
    {
      title: 'Pull in your footage',
      body: 'Add clips by pasting a YouTube link, picking from your connected channel, or using your squad\'s clips. Add one or a few.',
    },
    {
      title: 'Trim to the good part',
      body: 'Use the trimmer to cut each clip down to the moment that matters — the KO, the ougi, the clutch. Short and punchy wins.',
    },
    {
      title: 'Pick how they combine',
      body: 'Choose a layout: a single clip, a side-by-side, a 2x2 squad view, or picture-in-picture. This is your reel\'s style.',
    },
    {
      title: 'Create your reel',
      body: 'Hit Create reel. My Clips will show whether it is saved, playable, produced, or needs attention. A saved reel is not necessarily a finished rendered video yet.',
      cta: { label: 'Open Create', to: '/highlight/create' },
    },
  ],
}

/** Go live — pick a stream link, choose placement, broadcast. */
const goLive: Guide = {
  id: 'go-live',
  title: 'Go live',
  summary: 'Start a live stream and choose where it shows.',
  icon: 'live',
  steps: [
    {
      title: 'Going live is a member perk',
      body: 'You need a paid membership to stream. If you see a members-only screen, redeem a pass or upgrade first — then come back.',
      cta: { label: 'Redeem / upgrade', to: '/redeem' },
    },
    {
      title: 'Open Go Live',
      body: 'Head to the Go Live screen. This is where you paste your stream link and choose where it lands.',
      cta: { label: 'Open Go Live', to: '/go-live' },
    },
    {
      title: 'Paste your stream link',
      body: 'Drop in your YouTube live link or any https stream URL. If your channel is already linked, you are set to go.',
    },
    {
      title: 'Choose where it goes',
      body: 'Pick a placement: your profile, your clan page, the front page, or a tournament. Higher placements need a higher tier — locked ones show why.',
    },
    {
      title: 'Broadcast',
      body: 'Tap the "Go live" button. You will get a watch link and a share button so your crew can jump straight in.',
      cta: { label: 'Open Go Live', to: '/go-live' },
    },
  ],
}

/** Join a clan — find a recruiting clan and join it. */
const joinClan: Guide = {
  id: 'join-clan',
  title: 'Join a clan',
  summary: 'Apply to a recruiting clan and wait for a leader to approve you.',
  icon: 'clan',
  steps: [
    {
      title: 'Open Find a clan',
      body: 'The discovery page lists every clan recruiting right now. Head there to browse them.',
      cta: { label: 'Find a clan', to: '/clans/discover' },
    },
    {
      title: 'Pick a clan and apply',
      body: 'Each card shows open spots and the join fee (or "Free to join"). Open the clan and tap Apply. Applying does not add you immediately.',
    },
    {
      title: 'Have Tokens ready for paid clans',
      body: 'Some clans charge a Token fee, split with the clan treasury. If you are short, grab more from the Store, then join.',
      cta: { label: 'Get Tokens', to: '/store' },
    },
    {
      title: 'Wait for approval',
      body: 'The clan leader or officer must approve your application. Watch Notifications. After acceptance, the clan board and chat open and a manager can add you to a saved roster.',
      cta: { label: 'Open clans', to: '/clans' },
    },
  ],
}

/** Manage a reusable clan roster and enter it into tournaments. */
const manageClanRoster: Guide = {
  id: 'manage-clan-roster',
  title: 'Build a clan roster',
  summary: 'Create a reusable lineup, add registered clan members, and enter it in events.',
  icon: 'clan',
  steps: [
    {
      title: 'Approve the player first',
      body: 'A player must have an account and be an approved member of your clan before they can be placed on a roster. Open Clan tools and approve any pending applications first.',
      cta: { label: 'Open clan tools', to: '/clans' },
    },
    {
      title: 'Open My clan rosters',
      body: 'Clan leaders and officers can manage reusable lineups from Profile → About → My clan rosters, or from Clan tools.',
      cta: { label: 'Open my profile', to: '/profile' },
    },
    {
      title: 'Create and fill the lineup',
      body: 'Create a roster, choose its size, then use Add clan member for each slot. Empty slots are not players. Save only after the right names are visible.',
    },
    {
      title: 'Fix or remove a lineup',
      body: 'Use Remove beside a player to change one slot. Use Delete roster when the whole saved lineup is no longer needed. The app asks for confirmation before deleting it.',
    },
    {
      title: 'Enter the saved roster',
      body: 'Open the tournament, choose the saved clan roster, and submit it. A tournament entry can be withdrawn before roster lock; organizer changes after that require an audit reason.',
      cta: { label: 'Open tournaments', to: '/tournaments' },
    },
  ],
}

/** Create and operate an in-clan event or inter-clan tournament. */
const runTournament: Guide = {
  id: 'run-tournament',
  title: 'Create or edit a tournament',
  summary: 'Choose the event type, invite clans, use saved rosters, and manage entries.',
  icon: 'trophy',
  steps: [
    {
      title: 'Choose the right event type',
      body: 'Use Run an in-clan event for your own clan only. Use Host an inter-clan tournament when other clans should be invited or allowed to apply.',
      cta: { label: 'Open tournaments', to: '/tournaments' },
    },
    {
      title: 'Set the event details',
      body: 'Give it a clear name, start and end time, rules, roster size, and registration deadline. Review the summary before publishing.',
    },
    {
      title: 'Choose who can enter',
      body: 'Allow clan applications, invite specific clans, or select already-saved clan rosters. Only registered, approved clan members can occupy roster slots.',
    },
    {
      title: 'Edit from the organizer tools',
      body: 'Open the tournament and use Organizer tools to edit details, approve or reject entries, and manage invited clans. Every button says the action it performs.',
    },
    {
      title: 'Handle roster changes',
      body: 'A roster-change perk applies to this tournament only. Choose a finite number of changes or unlimited changes for this event; it never grants unlimited changes to every future tournament.',
    },
  ],
}

/** Explain the player-visible media pipeline and verified power rules. */
const videoAndPowerStatus: Guide = {
  id: 'video-and-power-status',
  title: 'Check clips and power',
  summary: 'Understand clip status, automatic processing, and verified power changes.',
  icon: 'watch',
  steps: [
    {
      title: 'Check My Clips for the real status',
      body: 'Saved means the reel record exists. Playable means it can be watched. Produced means the finished video was rendered. Needs attention or failed means it did not finish and should be retried or reported.',
      cta: { label: 'Open My Clips', to: '/my-clips' },
    },
    {
      title: 'Know what is automatic',
      body: 'Eligible public gameplay posted after signup can enter the automatic pipeline. Connecting a channel does not automatically backfill every older upload.',
    },
    {
      title: 'Power uses verified activity',
      body: 'Power can go up or down from verified match and league activity. Screenshots and manual result forms do not add power by themselves, so a picture cannot be used to inflate a ranking.',
      cta: { label: 'Open my profile', to: '/profile' },
    },
    {
      title: 'Report a stuck item',
      body: 'If an eligible battle stays unchanged or a clip remains failed, include the player name, YouTube video link, and approximate match time when you contact support.',
      cta: { label: 'Open Help', to: '/help' },
    },
  ],
}

/** All guides, in menu order. */
export const GUIDES: Guide[] = [
  tkoKing,
  connectYoutube,
  makeClip,
  goLive,
  joinClan,
  manageClanRoster,
  runTournament,
  videoAndPowerStatus,
]

// ─────────────────────────────────────────────────────────────────────────
//  Lookup + step helpers (pure, testable)
// ─────────────────────────────────────────────────────────────────────────

/** Look up a guide by id. Returns undefined for unknown / null ids. */
export function getGuide(id: string | null | undefined): Guide | undefined {
  if (!id) return undefined
  return GUIDES.find((g) => g.id === id)
}

/** The ids of every guide, in menu order. */
export function guideIds(): string[] {
  return GUIDES.map((g) => g.id)
}

/** Clamp a step index into the valid range [0, total-1]. Empty → 0. */
export function clampStepIndex(index: number, total: number): number {
  if (total <= 0) return 0
  if (Number.isNaN(index)) return 0
  return Math.max(0, Math.min(Math.floor(index), total - 1))
}

/** Next step, clamped so it never runs past the last step. */
export function nextStepIndex(index: number, total: number): number {
  return clampStepIndex(index + 1, total)
}

/** Previous step, clamped so it never goes below the first step. */
export function prevStepIndex(index: number): number {
  return index <= 0 ? 0 : index - 1
}

/** True on the last step of a guide of `total` steps. */
export function isLastStep(index: number, total: number): boolean {
  return total > 0 && index >= total - 1
}

// ─────────────────────────────────────────────────────────────────────────
//  Route → guide suggestion
// ─────────────────────────────────────────────────────────────────────────

/**
 * Route-prefix → guide id. When the panel opens we suggest the guide that
 * matches the screen the user is stuck on. Longest prefix wins, so more specific
 * routes (e.g. /clans/discover) beat broader ones.
 */
export const ROUTE_GUIDE_SUGGESTIONS: { prefix: string; guideId: string }[] = [
  { prefix: '/king', guideId: 'tko-king' },
  { prefix: '/stat-check', guideId: 'tko-king' },
  { prefix: '/connect', guideId: 'connect-youtube' },
  { prefix: '/highlight/create', guideId: 'make-clip' },
  { prefix: '/reels/create', guideId: 'make-clip' },
  { prefix: '/go-live', guideId: 'go-live' },
  { prefix: '/clans/discover', guideId: 'join-clan' },
  { prefix: '/clans', guideId: 'manage-clan-roster' },
  { prefix: '/tournaments', guideId: 'run-tournament' },
  { prefix: '/my-clips', guideId: 'video-and-power-status' },
  { prefix: '/profile', guideId: 'video-and-power-status' },
]

/** Does `pathname` sit at or under `prefix`? (exact, or prefix + "/…") */
function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/**
 * Suggest the guide id for a route, or null if none matches. The longest
 * matching prefix wins so specific routes beat their parents.
 */
export function suggestGuideId(pathname: string): string | null {
  if (!pathname) return null
  // Normalise a trailing slash (but keep the root "/").
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const matches = ROUTE_GUIDE_SUGGESTIONS
    .filter((m) => matchesPrefix(path, m.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)
  return matches[0]?.guideId ?? null
}

/** Suggest the guide object for a route, or undefined if none matches. */
export function suggestGuide(pathname: string): Guide | undefined {
  return getGuide(suggestGuideId(pathname))
}
