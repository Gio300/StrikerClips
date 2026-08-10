/**
 * League preview fixture — the FAKE, LOCAL data the Studio's phone preview
 * renders so a league owner can see the real app shell (home / reels / live /
 * bracket / standings) populated, before they have any members of their own.
 *
 * IMPORTANT (operator vision 2026-08-03): every handle, team, score and comment
 * in here is INVENTED — it is NOT real SSL (or any league's) user data and must
 * never be. The preview mounts the app's own surfaces under a
 * <LeagueThemeScope> fed the DRAFT config and feeds them THIS fixture, so what
 * the owner sees is "the real app, my skin, sample data" — the same story the
 * deployed app tells a visitor, minus real people.
 *
 * GAME-AGNOSTIC (operator 2026-08-04): "I need to advertise something other
 * than 1 video game with people I know." The fixture is therefore built from a
 * VERTICAL — esports, shooter, soccer, racing, fighting, hoops — which swaps
 * the vocabulary (team vs club vs fighter; match vs fixture vs set vs race),
 * the team names, the clip titles and the chat, so a Rocket League, FIFA or
 * Call of Duty owner sees THEIR league in the mockup instead of somebody
 * else's game. Nothing about the app changes — only the sample data does,
 * which is exactly the honest claim: one app, any competition.
 *
 * SALES BAR (operator 2026-08-04): the mockup has to read as a THRIVING
 * league, not a wireframe — a dozen players, a full clip grid with view
 * counts, standings with movement and streaks, a bracket mid-tournament, a
 * live match with a viewer count and a moving chat, and an activity feed. If
 * it looks empty, it doesn't sell.
 *
 * Pure data + deterministic builders, dependency-free, so the preview screens
 * (and their tests) import one source of truth instead of scattering inline
 * arrays. The persisted "which vertical" choice lives next door in
 * src/lib/leaguePreviewVertical.ts (that one needs localStorage; this must not).
 */

// ───────────────────────────────────────────────────────────────────────────
//  Types
// ───────────────────────────────────────────────────────────────────────────

export type PreviewVerticalId =
  | 'esports'
  | 'shooter'
  | 'soccer'
  | 'racing'
  | 'fighting'
  | 'hoops'

/** The words a vertical swaps + the sample names it plays with. */
export type PreviewVertical = {
  id: PreviewVerticalId
  /** Menu label ("Soccer / football"). */
  label: string
  /** The games/sports an owner would recognize ("FIFA · FC · Sunday league"). */
  hint: string
  /** What a competitor is called ("Team", "Club", "Fighter"). */
  unit: string
  /** Plural of `unit` — column headers and counts. */
  unitPlural: string
  /** What a head-to-head is called ("Match", "Fixture", "Set", "Race"). */
  matchWord: string
  /** The competition currently running in the sample. */
  event: string
  /** Where the season is at ("Season 4 · Week 9"). */
  season: string
  /** The live headline ("Grand Final · Game 5"). */
  liveTitle: string
  /** Eight invented competitors. */
  teams: { name: string; abbr: string }[]
  /** Six invented clip headlines in this vertical's language. */
  clipTitles: string[]
  /** Chat pool — the live screen tickers through these. */
  chat: string[]
}

export type PreviewPlayer = {
  id: string
  /** Display handle (invented). */
  name: string
  /** First glyph for the avatar monogram. */
  initial: string
  /** Whether this player is "live" in the sample (rings the avatar). */
  live: boolean
  /**
   * Avatar hue offset in degrees, applied as a `hue-rotate` filter over the
   * LEAGUE'S OWN gradient — so the roster looks like a dozen different people
   * while every avatar still belongs to the owner's palette. Generated, never
   * a photo of a real person.
   */
  hue: number
}

export type PreviewReel = {
  id: string
  /** Headline line on the reel ("Buzzer-beater from the logo"). */
  title: string
  /** Secondary line ("Semifinals · Game 3"). */
  subtitle: string
  /** Clock badge ("0:34"). */
  length: string
  likes: string
  comments: string
  /** Play count under the tile ("61.2K"). */
  views: string
  /** Who posted it — a handle from `players`. */
  author: string
  /** Scoreboard burned into the thumbnail ("STM 3 – 2 NVA"), when it has one. */
  scoreTag?: string
  /** Thumbnail hue offset (same trick as avatars — the league's own gradient). */
  hue: number
  /** Trending tile (gets the flame chip). */
  hot?: boolean
}

export type PreviewStanding = {
  rank: number
  team: string
  /** Short code shown on the compact phone table ("STM"). */
  abbr: string
  wins: number
  losses: number
  points: number
  /** Rank movement since last week — drives the arrow. */
  move: 'up' | 'down' | 'same'
  /** Current run ("W4", "L2"). */
  streak: string
  /** Last five results, newest last — the form dots. */
  form: ('W' | 'L')[]
  hue: number
}

export type PreviewMatch = {
  id: string
  a: string
  b: string
  scoreA: number
  scoreB: number
  live?: boolean
  /** Not played yet — renders as a TBD/soon row instead of a result. */
  upcoming?: boolean
  /** When an upcoming match starts ("Sat · 8:00 PM"). */
  when?: string
}

export type PreviewRound = {
  name: string
  /** Round state — drives the header pill (Done / Live / Up next). */
  status: 'done' | 'live' | 'upcoming'
  matches: PreviewMatch[]
}

export type PreviewLive = {
  title: string
  /** Human viewer count ("2,914 watching"). */
  watching: string
  /** Numeric seed so the preview can tick the counter and look alive. */
  viewers: number
  /** Match clock badge ("14:22"). */
  clock: string
  teamA: string
  teamB: string
  scoreA: number
  scoreB: number
  /** The multi-angle camera tiles — one per operator on the match. */
  angles: (PreviewPlayer & { viewers: string })[]
}

/** One line in the league's activity feed (home screen). */
export type PreviewActivity = {
  id: string
  kind: 'result' | 'join' | 'clip' | 'trophy'
  text: string
  when: string
}

/** The "this league has users" counters on the home screen. */
export type PreviewStats = {
  members: string
  clipsThisWeek: string
  matchesPlayed: string
  hoursWatched: string
}

export type PreviewFixture = {
  vertical: PreviewVertical
  players: PreviewPlayer[]
  reels: PreviewReel[]
  standings: PreviewStanding[]
  bracket: PreviewRound[]
  live: PreviewLive
  activity: PreviewActivity[]
  stats: PreviewStats
  /** The short social pulse shared by the home + live screens. */
  chat: { who: string; msg: string }[]
}

// ───────────────────────────────────────────────────────────────────────────
//  The verticals — same app, different words
// ───────────────────────────────────────────────────────────────────────────

export const PREVIEW_VERTICALS: PreviewVertical[] = [
  {
    id: 'esports',
    label: 'Esports',
    hint: 'Any competitive title',
    unit: 'Team',
    unitPlural: 'Teams',
    matchWord: 'Match',
    event: 'Season 4 Playoffs',
    season: 'Season 4 · Week 9',
    liveTitle: 'Grand Final · Game 5',
    teams: [
      { name: 'Storm', abbr: 'STM' },
      { name: 'Volt', abbr: 'VLT' },
      { name: 'Nova', abbr: 'NVA' },
      { name: 'Ember', abbr: 'EMB' },
      { name: 'Riptide', abbr: 'RIP' },
      { name: 'Ironclad', abbr: 'IRN' },
      { name: 'Zenith', abbr: 'ZEN' },
      { name: 'Outlaw', abbr: 'OUT' },
    ],
    clipTitles: [
      'Clutch round, one HP left',
      'Full-team wipe in nine seconds',
      'Reverse sweep from 0–2 down',
      'Round-winning read on the flank',
      'Backline collapse, then the steal',
      'Match point denied twice',
    ],
    chat: [
      'that read was insane',
      'RUN IT BACK',
      'clip that immediately',
      'no way they held that',
      'best series of the season',
      'chat we are so back',
      'angle 3 is the only angle',
      'my bracket is ruined lol',
    ],
  },
  {
    id: 'shooter',
    label: 'Shooter',
    hint: 'Call of Duty · Valorant · Siege',
    unit: 'Squad',
    unitPlural: 'Squads',
    matchWord: 'Series',
    event: 'Season 4 Playoffs',
    season: 'Season 4 · Week 9',
    liveTitle: 'Grand Final · Map 5',
    teams: [
      { name: 'Static', abbr: 'STC' },
      { name: 'Vanta', abbr: 'VNT' },
      { name: 'Recoil', abbr: 'RCL' },
      { name: 'Ember', abbr: 'EMB' },
      { name: 'Highground', abbr: 'HGD' },
      { name: 'Ironclad', abbr: 'IRN' },
      { name: 'Nightfall', abbr: 'NGF' },
      { name: 'Outlaw', abbr: 'OUT' },
    ],
    clipTitles: [
      '1v4 retake for the map',
      'Ace on the site hold',
      'Cross-map snipe to close it',
      'Defuse with 0.4 on the clock',
      'Triple through the smoke',
      'Overtime hold, zero deaths',
    ],
    chat: [
      'HOW did that connect',
      'ace ace ace',
      'defuse was frame perfect',
      'that spray control is dirty',
      'clip it',
      'they are cooking',
      'best hold of the split',
      'give me the POV angle',
    ],
  },
  {
    id: 'soccer',
    label: 'Soccer / football',
    hint: 'FIFA · FC · Sunday league',
    unit: 'Club',
    unitPlural: 'Clubs',
    matchWord: 'Fixture',
    event: 'Cup Knockouts',
    season: 'Matchday 18 · Season 4',
    liveTitle: 'Cup Final · 2nd half',
    teams: [
      { name: 'Harbour FC', abbr: 'HAR' },
      { name: 'Ironside', abbr: 'IRN' },
      { name: 'Northgate', abbr: 'NGT' },
      { name: 'Ember City', abbr: 'EMB' },
      { name: 'Riverside', abbr: 'RIV' },
      { name: 'Kingsway', abbr: 'KGW' },
      { name: 'Zenith Athletic', abbr: 'ZEN' },
      { name: 'Old Mill', abbr: 'OML' },
    ],
    clipTitles: [
      'Winner in the 94th minute',
      'Free kick into the top corner',
      'Goal-line clearance, twice',
      'Keeper to finish in eight seconds',
      'Shootout: the save that won it',
      'One-touch move, six passes',
    ],
    chat: [
      'WHAT A FINISH',
      'keeper had no chance',
      'offside? never',
      'that was a worldie',
      'run it back next matchday',
      'goal of the season already',
      'commentary went crazy',
      'replay it from angle 2',
    ],
  },
  {
    id: 'racing',
    label: 'Racing & car sports',
    hint: 'Rocket League · F1 · sim racing',
    unit: 'Team',
    unitPlural: 'Teams',
    matchWord: 'Race',
    event: 'Championship Rounds',
    season: 'Round 9 · Season 4',
    liveTitle: 'Championship Final · Game 7',
    teams: [
      { name: 'Apex Drift', abbr: 'APX' },
      { name: 'Velocity', abbr: 'VEL' },
      { name: 'Nitro Union', abbr: 'NTU' },
      { name: 'Ember Motors', abbr: 'EMB' },
      { name: 'Riptide Racing', abbr: 'RIP' },
      { name: 'Ironclad GT', abbr: 'IRN' },
      { name: 'Zenith Speed', abbr: 'ZEN' },
      { name: 'Outlaw Garage', abbr: 'OUT' },
    ],
    clipTitles: [
      'Ceiling shot for the overtime win',
      'Last-lap overtake around the outside',
      'Double touch off the wall',
      'Save on the line, then the counter',
      'Pit call wins it by 0.3s',
      'Triple-team air dribble',
    ],
    chat: [
      'HOW did they save that',
      'that overtake was clean',
      'overtime is unfair to my heart',
      'clip it clip it clip it',
      'ceiling shot on game point??',
      'insane car control',
      'best final we have had',
      'give me the chase cam',
    ],
  },
  {
    id: 'fighting',
    label: 'Fighting games',
    hint: 'Tekken · Street Fighter · anime fighters',
    unit: 'Fighter',
    unitPlural: 'Fighters',
    matchWord: 'Set',
    event: 'Top 8 Bracket',
    season: 'Season 4 · Ranked ladder',
    liveTitle: 'Grand Final · Set 2',
    teams: [
      { name: 'Kodiak', abbr: 'KDK' },
      { name: 'Sable', abbr: 'SBL' },
      { name: 'Mirage', abbr: 'MRG' },
      { name: 'Ember', abbr: 'EMB' },
      { name: 'Rook', abbr: 'ROK' },
      { name: 'Talon', abbr: 'TLN' },
      { name: 'Zephyr', abbr: 'ZPH' },
      { name: 'Cinder', abbr: 'CND' },
    ],
    clipTitles: [
      'Comeback from one pixel of health',
      'Perfect round to reset the bracket',
      'Parry into the full punish',
      'Read on the wake-up, set over',
      'Five-hit conversion off a whiff',
      'Runback: the counter-pick',
    ],
    chat: [
      'ONE PIXEL',
      'that parry was frame perfect',
      'bracket reset LETS GO',
      'the read on wake-up though',
      'clip that punish',
      'never seen that conversion',
      'crowd went insane',
      'watch the hands cam',
    ],
  },
  {
    id: 'hoops',
    label: 'Basketball & court sports',
    hint: 'NBA 2K · rec league · pickup',
    unit: 'Team',
    unitPlural: 'Teams',
    matchWord: 'Game',
    event: 'Playoff Bracket',
    season: 'Season 4 · Week 9',
    liveTitle: 'Finals · 4th quarter',
    teams: [
      { name: 'Southside', abbr: 'SSD' },
      { name: 'Ironclad', abbr: 'IRN' },
      { name: 'Northgate', abbr: 'NGT' },
      { name: 'Ember', abbr: 'EMB' },
      { name: 'Riverside', abbr: 'RIV' },
      { name: 'Kingsway', abbr: 'KGW' },
      { name: 'Zenith', abbr: 'ZEN' },
      { name: 'Outlaw', abbr: 'OUT' },
    ],
    clipTitles: [
      'Buzzer-beater from the logo',
      'Poster dunk in transition',
      'Four-point play to tie it',
      'Chase-down block, then the outlet',
      'Ten straight in the fourth',
      'Full-court inbound with 1.9 left',
    ],
    chat: [
      'FROM THE LOGO',
      'that block was a statement',
      'game of the season',
      'clip the buzzer beater',
      'crowd cam is going crazy',
      'run it back Sunday',
      'give me the baseline angle',
      'and-one all day',
    ],
  },
]

export const DEFAULT_PREVIEW_VERTICAL: PreviewVerticalId = 'esports'

/** Coerce an untrusted vertical id to a known one (falls back to the default). */
export function normalizePreviewVertical(raw: unknown): PreviewVerticalId {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  const hit = PREVIEW_VERTICALS.find((v) => v.id === s)
  return hit ? hit.id : DEFAULT_PREVIEW_VERTICAL
}

/** The vertical record for an id (never throws — unknown ids get the default). */
export function previewVertical(id: PreviewVerticalId | string): PreviewVertical {
  const wanted = normalizePreviewVertical(id)
  return PREVIEW_VERTICALS.find((v) => v.id === wanted) ?? PREVIEW_VERTICALS[0]
}

// ───────────────────────────────────────────────────────────────────────────
//  The roster — invented handles, generated avatars
// ───────────────────────────────────────────────────────────────────────────

/**
 * Twelve invented handles. NOT real people, and never seeded from a real
 * roster: the avatars are monograms over the league's own gradient, hue-shifted
 * per handle (see PreviewPlayer.hue), so the preview looks populated without
 * shipping a single photo of anybody.
 */
const HANDLES = [
  'Zephyr',
  'Kodiak',
  'Vanta',
  'Mirage',
  'Sable',
  'Nyx',
  'Orbit',
  'Rook',
  'Talon',
  'Juno',
  'Cinder',
  'Wren',
] as const

/**
 * Deterministic hue offset from a seed string, inside a ±`spread`/2 window
 * around the LEAGUE'S OWN gradient.
 *
 * FNV-1a, not a naive `h * 31 + c`: the seeds here differ only in their LAST
 * character ("racing-reel-0" … "racing-reel-5"), and a weak hash maps those to
 * hues one degree apart — which is exactly how a six-tile clip grid ends up
 * looking like one flat swatch. FNV's avalanche spreads them.
 *
 * The WINDOW matters as much as the spread: swing it too far and a crimson
 * league's feed comes back a rainbow, which quietly kills the whole "this is
 * YOUR app in YOUR colors" claim. Keep it narrow enough that every tile still
 * reads as the owner's brand.
 */
export function previewHue(seed: string, spread = 90): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % spread) - Math.round(spread / 2)
}

/** Thumbnails sit in a tighter window than avatars — a feed must look branded. */
const REEL_HUE_SPREAD = 56

function buildPlayers(): PreviewPlayer[] {
  // The first four are "live" — the home strip rings them.
  return HANDLES.map((name, i) => ({
    id: `p-${name.toLowerCase()}`,
    name,
    initial: name.charAt(0).toUpperCase(),
    live: i < 4,
    hue: previewHue(name),
  }))
}

// ───────────────────────────────────────────────────────────────────────────
//  Builders — everything below is derived from the vertical, deterministically
// ───────────────────────────────────────────────────────────────────────────

/** Sample engagement numbers, biggest first (illustrative, not a promise). */
const REEL_STATS: { length: string; likes: string; comments: string; views: string }[] = [
  { length: '0:34', likes: '4.1K', comments: '218', views: '61.2K' },
  { length: '0:52', likes: '2.8K', comments: '164', views: '38.9K' },
  { length: '0:41', likes: '1.9K', comments: '97', views: '24.4K' },
  { length: '1:04', likes: '1.4K', comments: '88', views: '19.7K' },
  { length: '0:28', likes: '980', comments: '54', views: '12.1K' },
  { length: '0:47', likes: '742', comments: '41', views: '9.6K' },
]

const ROUND_NAMES = ['Quarterfinals', 'Semifinals', 'Final'] as const

function buildReels(v: PreviewVertical, players: PreviewPlayer[]): PreviewReel[] {
  const t = v.teams
  const scoreTags = [
    `${t[0].abbr} 3 – 2 ${t[2].abbr}`,
    `${t[1].abbr} 2 – 0 ${t[3].abbr}`,
    undefined,
    `${t[4].abbr} 1 – 1 ${t[5].abbr}`,
    undefined,
    `${t[6].abbr} 2 – 1 ${t[7].abbr}`,
  ]
  const contexts = [
    `${ROUND_NAMES[2]} · ${v.matchWord} 5`,
    `${ROUND_NAMES[1]} · ${v.matchWord} 3`,
    `${ROUND_NAMES[1]} · ${v.matchWord} 1`,
    `${ROUND_NAMES[0]} · ${v.matchWord} 4`,
    v.season,
    `${ROUND_NAMES[0]} · ${v.matchWord} 2`,
  ]
  return v.clipTitles.map((title, i) => ({
    id: `r-${v.id}-${i + 1}`,
    title,
    subtitle: contexts[i],
    author: players[(i * 3 + 1) % players.length].name,
    scoreTag: scoreTags[i],
    hue: previewHue(`${v.id}-reel-${i}`, REEL_HUE_SPREAD),
    hot: i === 0,
    ...REEL_STATS[i],
  }))
}

/** Records for the eight rows, top to bottom — a believable mid-season table. */
const TABLE_ROWS: {
  wins: number
  losses: number
  move: PreviewStanding['move']
  streak: string
  form: ('W' | 'L')[]
}[] = [
  { wins: 15, losses: 3, move: 'same', streak: 'W6', form: ['W', 'W', 'L', 'W', 'W'] },
  { wins: 14, losses: 4, move: 'up', streak: 'W3', form: ['L', 'W', 'W', 'W', 'W'] },
  { wins: 12, losses: 6, move: 'up', streak: 'W2', form: ['W', 'L', 'L', 'W', 'W'] },
  { wins: 11, losses: 7, move: 'down', streak: 'L1', form: ['W', 'W', 'W', 'L', 'L'] },
  { wins: 9, losses: 9, move: 'same', streak: 'W1', form: ['L', 'W', 'L', 'L', 'W'] },
  { wins: 7, losses: 11, move: 'down', streak: 'L3', form: ['W', 'L', 'L', 'L', 'L'] },
  { wins: 5, losses: 13, move: 'up', streak: 'W1', form: ['L', 'L', 'L', 'W', 'W'] },
  { wins: 3, losses: 15, move: 'down', streak: 'L5', form: ['L', 'L', 'L', 'L', 'L'] },
]

function buildStandings(v: PreviewVertical): PreviewStanding[] {
  return v.teams.map((team, i) => {
    const row = TABLE_ROWS[i]
    return {
      rank: i + 1,
      team: team.name,
      abbr: team.abbr,
      wins: row.wins,
      losses: row.losses,
      points: row.wins * 3,
      move: row.move,
      streak: row.streak,
      form: row.form,
      hue: previewHue(team.abbr),
    }
  })
}

/**
 * A bracket caught MID-TOURNAMENT: quarterfinals played out, one semi decided
 * and the other live right now, the final still waiting on a name. That
 * "something is happening" shape is what makes the mockup read as a running
 * league instead of an empty template.
 */
function buildBracket(v: PreviewVertical): PreviewRound[] {
  const t = v.teams
  return [
    {
      name: ROUND_NAMES[0],
      status: 'done',
      matches: [
        { id: 'm-qf1', a: t[0].name, b: t[7].name, scoreA: 3, scoreB: 1 },
        { id: 'm-qf2', a: t[3].name, b: t[4].name, scoreA: 2, scoreB: 3 },
        { id: 'm-qf3', a: t[1].name, b: t[6].name, scoreA: 3, scoreB: 0 },
        { id: 'm-qf4', a: t[2].name, b: t[5].name, scoreA: 3, scoreB: 2 },
      ],
    },
    {
      name: ROUND_NAMES[1],
      status: 'live',
      matches: [
        { id: 'm-sf1', a: t[0].name, b: t[4].name, scoreA: 3, scoreB: 1 },
        { id: 'm-sf2', a: t[1].name, b: t[2].name, scoreA: 2, scoreB: 2, live: true },
      ],
    },
    {
      name: ROUND_NAMES[2],
      status: 'upcoming',
      matches: [
        {
          id: 'm-final',
          a: t[0].name,
          b: `Winner ${ROUND_NAMES[1]}`,
          scoreA: 0,
          scoreB: 0,
          upcoming: true,
          when: 'Sat · 8:00 PM',
        },
      ],
    },
  ]
}

function buildLive(v: PreviewVertical, players: PreviewPlayer[]): PreviewLive {
  const viewers = 2914
  return {
    title: v.liveTitle,
    watching: `${viewers.toLocaleString('en-US')} watching`,
    viewers,
    clock: '14:22',
    teamA: v.teams[1].abbr,
    teamB: v.teams[2].abbr,
    scoreA: 2,
    scoreB: 2,
    angles: players.slice(0, 4).map((p, i) => ({
      ...p,
      live: true,
      viewers: ['1.1K', '812', '604', '397'][i],
    })),
  }
}

function buildActivity(v: PreviewVertical, players: PreviewPlayer[]): PreviewActivity[] {
  const t = v.teams
  return [
    {
      id: 'a-1',
      kind: 'result',
      text: `${t[0].name} beat ${t[4].name} 3–1 in the ${ROUND_NAMES[1].toLowerCase()}`,
      when: '12m',
    },
    { id: 'a-2', kind: 'clip', text: `${players[1].name} posted a new highlight`, when: '24m' },
    { id: 'a-3', kind: 'join', text: `${players[9].name} joined ${t[3].name}`, when: '1h' },
    {
      id: 'a-4',
      kind: 'trophy',
      text: `${players[4].name} took #1 on the ${v.unit.toLowerCase()} ladder`,
      when: '3h',
    },
    {
      id: 'a-5',
      kind: 'result',
      text: `${t[1].name} and ${t[2].name} are tied 2–2 — live now`,
      when: 'now',
    },
  ]
}

const STATS: PreviewStats = {
  members: '1,284',
  clipsThisWeek: '96',
  matchesPlayed: '412',
  hoursWatched: '18.6K',
}

function buildChat(v: PreviewVertical, players: PreviewPlayer[]): { who: string; msg: string }[] {
  return v.chat.map((msg, i) => ({ who: players[(i * 5 + 2) % players.length].name, msg }))
}

/**
 * Build the whole fixture for a vertical. Pure + deterministic: the same id
 * always yields the same league, so the preview never flickers between renders
 * and tests can assert on it.
 */
export function buildPreviewFixture(
  id: PreviewVerticalId | string = DEFAULT_PREVIEW_VERTICAL,
): PreviewFixture {
  const v = previewVertical(id)
  const players = buildPlayers()
  return {
    vertical: v,
    players,
    reels: buildReels(v, players),
    standings: buildStandings(v),
    bracket: buildBracket(v),
    live: buildLive(v, players),
    activity: buildActivity(v, players),
    stats: STATS,
    chat: buildChat(v, players),
  }
}

/**
 * THE DEFAULT FAKE FIXTURE — the neutral esports league. Kept as a named export
 * so callers that don't care about the vertical (tests, the read-only
 * league-card hover preview) keep one import.
 */
export const PREVIEW_FIXTURE: PreviewFixture = buildPreviewFixture(DEFAULT_PREVIEW_VERTICAL)
