/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'
import type { Request, RequestHandler, Response, Router } from 'express'
import { normalizeGameAlias } from './matchDetection'
import { youtubeChannelIdFromPage } from './youtubeChannel'

export type OnboardingPool = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount?: number | null }>
}

export type OnboardingLane = 'solo' | 'member' | 'leader' | 'organizer'

export type OnboardingVideoMetadata = {
  videoUrl: string
  videoId: string
  videoTitle: string
  thumbnailUrl: string | null
  channelId: string
  channelUrl: string
  channelTitle: string
}

export type OnboardingInterpretation = {
  lane?: OnboardingLane | null
  roles?: string[]
  facts?: Record<string, unknown>
}

export interface OnboardingRouteDeps {
  router: Router
  pool: OnboardingPool
  auth: RequestHandler
  uid: (req: Request) => string
  loadActor?: (req: Request) => Promise<{ id: string; host: boolean } | null>
  withTransaction: <T>(fn: (db: OnboardingPool) => Promise<T>) => Promise<T>
  now: () => Date
  pushUsers?: (
    userIds: string[],
    payload: { title: string; body: string; url: string; tag?: string },
  ) => Promise<void>
  resolveVideo?: (url: string) => Promise<OnboardingVideoMetadata>
  interpretText?: (
    text: string,
    currentFacts: Record<string, unknown>,
    context?: { lane: OnboardingLane | null; current_step: string },
  ) => Promise<OnboardingInterpretation | null>
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CHANNEL_ID_RE = /^UC[\w-]{20,}$/
export const ONBOARDING_CLANMATE_FOLLOW_CAP = 24
const ONBOARDING_TOURNAMENT_LIMIT = 6
const ACTION_PRIORITY: Record<string, number> = {
  update_identity: 10,
  connect_youtube: 20,
  create_clan: 30,
  claim_clan: 30,
  apply_clan: 30,
  create_roster: 40,
  follow_player: 50,
  follow_clanmates: 60,
}
const IMMEDIATE_CHAT_ACTIONS = new Set([
  'update_identity',
  'create_clan',
  'claim_clan',
  'apply_clan',
  'create_roster',
])
const REQUIRED_CHAT_ACTIONS = new Set(IMMEDIATE_CHAT_ACTIONS)

const clean = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max)

function jsonObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} }
  }
  return {}
}

function jsonArray(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [] } catch { return [] }
  }
  return []
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function isYouTubeChannelPage(value: unknown): boolean {
  try {
    const parsed = new URL(clean(value, 1000))
    return /^(?:\/@|\/channel\/|\/c\/|\/user\/)/i.test(parsed.pathname)
  } catch { return false }
}

const unique = (values: string[]): string[] => [...new Set(values.map((value) => clean(value, 40).toLowerCase()).filter(Boolean))]
const safeRoles = (values: string[]): string[] => unique(values)
  .filter((role) => ['solo', 'member', 'leader', 'organizer'].includes(role))

function safeLane(value: unknown): OnboardingLane | null {
  const lane = clean(value, 20).toLowerCase()
  return ['solo', 'member', 'leader', 'organizer'].includes(lane) ? lane as OnboardingLane : null
}

function safeFacts(value: unknown): Record<string, unknown> {
  const incoming = jsonObject(value)
  const out: Record<string, unknown> = {}
  const textKeys: Record<string, number> = {
    game_tag: 48,
    platform: 32,
    game: 80,
    clan_name: 32,
    clan_tag: 5,
    intent: 120,
  }
  for (const [key, max] of Object.entries(textKeys)) {
    const text = clean(incoming[key], max)
    if (text) out[key] = text
  }
  if (Array.isArray(incoming.follow_handles)) {
    out.follow_handles = unique(incoming.follow_handles.map((item: unknown) => clean(item, 40))).slice(0, 12)
  }
  return out
}

function normalizedMention(value: unknown): string {
  return clean(value, 120)
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function textExplicitlyIncludes(text: string, value: unknown): boolean {
  const needle = normalizedMention(value)
  if (!needle) return false
  return normalizedMention(text).split(' ').join(' ').includes(needle)
}

/**
 * A short reply is only treated as the answer to the active question when it
 * looks like a name. This keeps "I don't know", "maybe later", questions, and
 * other conversational turns from silently becoming a gamer tag or clan.
 */
function confidentBareName(text: string, max: number): string | null {
  const value = text.replace(/[.!]+$/, '').trim().replace(/^@/, '')
  if (value.length < 2 || value.length > max || text.includes('?')) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9 _.'-]*$/.test(value)) return null
  if (/\b(?:don'?t know|do not know|not sure|maybe|later|skip|pass|help|whatever|nothing|none|nope|cancel)\b/i.test(value)) return null
  return value
}

/**
 * Clan writes are too consequential to infer through contradictory model
 * output. When the player's own words explicitly say they are solo or do not
 * have a clan, that statement vetoes clan facts and the member/leader lanes.
 */
function explicitlyDeclinesClan(textValue: unknown): boolean {
  const text = clean(textValue, 2000)
  return [
    /\b(?:play(?:ing)?\s+)?solo\b/i,
    /\bsolo\s+player\b/i,
    /\bon my own\b/i,
    /\bno\s+(?:clan|crew)\b/i,
    /\bwithout\s+(?:a\s+|any\s+)?(?:clan|crew)\b/i,
    /\bnot\s+(?:in|with|part of|a member of)\s+(?:a\s+|the\s+|any\s+)?(?:clan|crew)\b/i,
    /\b(?:do not|don(?:'|\u2019)t)\s+(?:have|belong to)\s+(?:a\s+|the\s+|any\s+)?(?:clan|crew)\b/i,
    /\bclanless\b/i,
  ].some((pattern) => pattern.test(text))
}

/**
 * Deterministic, deliberately conservative fallback for tests and model
 * outages. A model may propose the same bounded facts, but never action rows or
 * database writes.
 */
export function parseOnboardingText(textValue: unknown): OnboardingInterpretation {
  const text = clean(textValue, 2000)
  const lower = text.toLowerCase()
  const facts: Record<string, unknown> = {}
  const roles: string[] = []

  const solo = explicitlyDeclinesClan(text)
  const leader = !solo && (
    /\b(?:i\s+)?(?:run|lead|own|founded)\s+(?:the\s+|my\s+|a\s+)?(?:[A-Za-z0-9][A-Za-z0-9 .'-]*\s+)?clan\b/i.test(text)
      || /\bI\s+(?:run|lead|founded)\s+(?!on\s+my\s+own\b)(?:the\s+)?(?:clan\s+)?[A-Z0-9]/.test(text)
      || /\bI\s+own\s+(?!my\s+own\b)(?:the\s+)?(?:clan\s+)?[A-Z0-9][A-Za-z0-9 .'-]{1,99}\s*\[[A-Za-z0-9]{2,5}\]/.test(text)
      || /\b(?:founder|kage)(?:\s+of)?\s+(?:the\s+)?(?:clan\s+)?[A-Za-z0-9]/i.test(text)
  )
  const organizer = /\b(?:organize|organizer|host tournaments?|run tournaments?|run events?)\b/i.test(text)
  const member = !solo && !leader && (
    /\b(?:member of|part of|joined|joining|belong(?:s|ed)? to|roll with)\b/i.test(text)
    || /\b(?:in|with)\s+(?:a |the |my )?(?:clan|crew)\b/i.test(text)
  )

  let lane: OnboardingLane | null = solo ? 'solo' : leader ? 'leader' : member ? 'member' : organizer ? 'organizer' : null
  if (leader) roles.push('leader')
  if (member) roles.push('member')
  if (solo) roles.push('solo')
  if (organizer) roles.push('organizer')

  const tagMatch = text.match(/(?:gamer\s*tag|gamertag|player\s*name|psn|xbox\s*tag)\s*(?:is|:)?\s*@?([A-Za-z0-9][\w.-]{1,47})/i)
    || text.match(/\b(?:people\s+)?call\s+me\s+@?([A-Za-z0-9][\w.-]{1,47})(?=\s*(?:,|;|\.|!|\?|\band\b|$))/i)
    || text.match(/\bmy\s+handle\s+is\s+@?([A-Za-z0-9][\w.-]{1,47})(?=\s*(?:,|;|\.|!|\?|\band\b|$))/i)
    || text.match(/\b(?:i(?:'m|\s+am)\s+)?known\s+as\s+@?([A-Za-z0-9][\w.-]{1,47})(?=\s*(?:,|;|\.|!|\?|\band\b|$))/i)
    || text.match(/\bI(?:'m| am)\s+@?([A-Za-z0-9][\w.-]{1,47})(?=\s*(?:,|;|\.|\band\b|$))/i)
  const reservedTags = new Set(['solo', 'organizer', 'member', 'leader', 'kage', 'in', 'with'])
  if (tagMatch && !reservedTags.has(tagMatch[1].toLowerCase())) {
    facts.game_tag = tagMatch[1].replace(/[.,;:!?]+$/, '')
  }

  if (/\b(?:playstation|ps[45]|psn)\b/i.test(text)) facts.platform = 'PlayStation'
  else if (/\bxbox\b/i.test(text)) facts.platform = 'Xbox'
  else if (/\b(?:pc|steam)\b/i.test(text)) facts.platform = 'PC'
  if (/\b(?:shinobi striker|naruto to boruto)\b/i.test(text)) facts.game = 'Shinobi Striker'

  const clanPatterns = leader
    ? [
        /\b(?:run|lead|own|founded)\s+(?:the\s+)?(?:clan\s+)?([A-Za-z0-9][A-Za-z0-9 .'-]{1,99}?)(?=\s*(?:\[[A-Za-z0-9]{2,5}\])?\s*(?:,|;|\.|\band\b|\bon\s+(?:playstation|ps[45]|psn|xbox|pc|steam)\b|$))/i,
        /\bkage(?:\s+of)?\s+(?:the\s+)?(?:clan\s+)?([A-Za-z0-9][A-Za-z0-9 .'-]{1,99}?)(?=\s*(?:,|;|\.|\band\b|$))/i,
      ]
    : [
        /\b(?:member of|part of|joined|joining|belong(?:s|ed)? to|roll with)\s+(?:the\s+)?(?:clan\s+)?([A-Za-z0-9][A-Za-z0-9 .'-]{1,99}?)(?=\s*(?:\[[A-Za-z0-9]{2,5}\])?\s*(?:,|;|\.|\band\b|\bon\s+(?:playstation|ps[45]|psn|xbox|pc|steam)\b|$))/i,
        /\b(?:my clan is|clan is|clan:)\s*([A-Za-z0-9][A-Za-z0-9 .'-]{1,99}?)(?=\s*(?:\[[A-Za-z0-9]{2,5}\])?\s*(?:,|;|\.|\band\b|$))/i,
      ]
  for (const pattern of clanPatterns) {
    const found = text.match(pattern)?.[1]?.trim().replace(/^the\s+/i, '').replace(/\s+clan$/i, '')
    if (found && !['a', 'the', 'clan', 'a clan', 'the clan'].includes(found.toLowerCase())) {
      facts.clan_name = found
      break
    }
  }
  const clanTag = text.match(/\[([A-Za-z0-9]{2,5})\]/)?.[1]
  if (clanTag) facts.clan_tag = clanTag.toUpperCase()

  if (/\broster\b/i.test(text)) facts.intent = 'build a roster'
  else if (/\btournament\b/i.test(text)) facts.intent = 'tournaments'

  if (/\bfollow\b/i.test(text)) {
    const handles = [...text.matchAll(/@([A-Za-z0-9_]{2,40})/g)].map((match) => match[1])
    if (handles.length) facts.follow_handles = unique(handles).slice(0, 12)
  }

  return { lane, roles: unique(roles), facts }
}

export function normalizeGameplayVideoUrl(raw: unknown): { videoUrl: string; videoId: string } | null {
  const value = clean(raw, 1000)
  if (!value) return null
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    const host = parsed.hostname.toLowerCase()
    let videoId = ''
    if (host === 'youtu.be') videoId = parsed.pathname.split('/').filter(Boolean)[0] || ''
    else if (['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)) {
      if (/^\/shorts\//i.test(parsed.pathname)) return null
      if (parsed.pathname === '/watch') videoId = parsed.searchParams.get('v') || ''
      else videoId = parsed.pathname.match(/^\/(?:live|embed)\/([A-Za-z0-9_-]+)/i)?.[1] || ''
    }
    if (!/^[A-Za-z0-9_-]{6,32}$/.test(videoId)) return null
    return { videoId, videoUrl: `https://www.youtube.com/watch?v=${videoId}` }
  } catch { return null }
}

export async function resolveOnboardingVideo(
  rawUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<OnboardingVideoMetadata> {
  const normalized = normalizeGameplayVideoUrl(rawUrl)
  if (!normalized) throw Object.assign(new Error('Share a full YouTube gameplay video link (Shorts are not supported).'), { status: 400 })
  const headers = {
    'user-agent': 'Mozilla/5.0 (compatible; TKOOnboarding/1.0; +https://tko.cam)',
    'accept-language': 'en-US,en;q=0.9',
  }
  const [pageResponse, embedResponse] = await Promise.all([
    fetchFn(normalized.videoUrl, { headers, redirect: 'follow', signal: AbortSignal.timeout(12_000) }).catch(() => null),
    fetchFn(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(normalized.videoUrl)}`, {
      headers, signal: AbortSignal.timeout(12_000),
    }).catch(() => null),
  ])
  if (!pageResponse?.ok) throw Object.assign(new Error('That public YouTube video could not be opened.'), { status: 422 })
  const html = await pageResponse.text()
  const channelId = youtubeChannelIdFromPage(pageResponse.url || normalized.videoUrl, html)
  if (!channelId) throw Object.assign(new Error('The YouTube channel for that video could not be identified.'), { status: 422 })
  let embed: any = {}
  if (embedResponse?.ok) {
    try { embed = await embedResponse.json() } catch { embed = {} }
  }
  const authorUrl = clean(embed.author_url, 500)
  return {
    ...normalized,
    videoTitle: clean(embed.title, 300) || 'Gameplay video',
    thumbnailUrl: clean(embed.thumbnail_url, 1000) || null,
    channelId,
    channelUrl: authorUrl.startsWith('https://www.youtube.com/')
      ? authorUrl.replace(/[?#].*$/, '').replace(/\/$/, '')
      : `https://www.youtube.com/channel/${channelId}`,
    channelTitle: clean(embed.author_name, 200) || 'YouTube channel',
  }
}

async function one(db: OnboardingPool, sql: string, params: any[] = []): Promise<any | null> {
  return (await db.query(sql, params)).rows[0] ?? null
}

function stateShape(row: any): any {
  return {
    status: row.status,
    current_step: row.current_step,
    revision: Number(row.revision || 0),
    lane: safeLane(row.lane),
    roles: safeRoles(jsonArray(row.roles).map(String)),
    facts: jsonObject(row.facts),
    deferred_until: row.deferred_until || null,
    completed_at: row.completed_at || null,
  }
}

function actionShape(row: any): any {
  return {
    id: String(row.id),
    kind: String(row.kind),
    status: String(row.status),
    label: row.label || undefined,
    payload: jsonObject(row.payload),
    ...(row.result == null ? {} : { result: jsonObject(row.result) }),
    ...(row.error ? { error: String(row.error) } : {}),
  }
}

function promptFor(state: any, actions: any[]): { prompt: string; suggestions: string[] } {
  if (state.status === 'complete') {
    if (state.facts.clan_application_status === 'pending') return {
      prompt: `Your application to ${clean(state.facts.clan_name, 32) || 'the clan'} was sent. A clan leader will review it.`,
      suggestions: [],
    }
    if (state.facts.clan_claim_status === 'disputed') return {
      prompt: `Your ownership request for ${clean(state.facts.clan_name, 32) || 'that clan'} was sent for review. The current clan was not changed.`,
      suggestions: [],
    }
    if (state.facts.clan_claim_status === 'owned') return {
      prompt: `${clean(state.facts.clan_name, 32) || 'Your clan'} and its main roster are ready.`,
      suggestions: [],
    }
    return { prompt: "You're all set. Your player identity is saved.", suggestions: [] }
  }
  if (state.status === 'deferred') return {
    prompt: 'Setup is paused. You can pick up right where you left off whenever you are ready.',
    suggestions: ['Resume setup'],
  }
  if (state.facts.clan_claim_status === 'rejected') return {
    prompt: 'That clan ownership claim was not approved. Tell me a different clan, or continue as a member or solo player.',
    suggestions: ['Play solo instead', "I'm in a different clan"],
  }
  if (!state.lane || !clean(state.facts.game_tag, 48)) return {
    prompt: 'Tell me your gamer tag, whether you play solo or with a clan, and what you want to do.',
    suggestions: ['Play solo', "I'm in a clan", 'I run a clan', 'I organize events'],
  }
  if ((state.lane === 'member' || state.lane === 'leader') && !clean(state.facts.clan_name, 32)) return {
    prompt: "What's your clan's exact name or tag?",
    suggestions: [],
  }
  if (state.facts.clan_match_missing) return {
    prompt: `I couldn't find ${clean(state.facts.clan_name, 32) || 'that clan'}. Check the exact clan name or tag and send it again.`,
    suggestions: [],
  }
  if (state.facts.clan_identity_conflict) return {
    prompt: 'That clan name and tag belong to different existing clans. Send just the exact clan name or just its tag so I do not place you in the wrong clan.',
    suggestions: [],
  }
  if (state.facts.clan_application_blocked === 'not_recruiting') return {
    prompt: `${clean(state.facts.clan_name, 32) || 'That clan'} is not accepting applications right now. Tell me a different clan or say you play solo.`,
    suggestions: [],
  }
  if (state.facts.clan_application_blocked === 'full') return {
    prompt: `${clean(state.facts.clan_name, 32) || 'That clan'} is currently full. Tell me a different clan or say you play solo.`,
    suggestions: [],
  }
  if (state.facts.clan_application_blocked === 'join_fee') return {
    prompt: `${clean(state.facts.clan_name, 32) || 'That clan'} requires ${Number(state.facts.clan_join_fee_tokens) || 0} Tokens to join. Open the clan page to review the fee before applying.`,
    suggestions: [],
  }
  if (actions.some((action) => action.kind === 'claim_clan' && action.status === 'proposed')) return {
    prompt: `That clan already has an owner. If you are the owner, say “I own ${clean(state.facts.clan_name, 32) || 'that clan'} and request ownership review.”`,
    suggestions: [],
  }
  if (actions.some((action) => action.status === 'failed' && REQUIRED_CHAT_ACTIONS.has(action.kind))) return {
    prompt: "I couldn't finish that change. Correct the name or send it again and I'll retry.",
    suggestions: [],
  }
  return { prompt: 'Tell me your gamer tag and whether you play solo, belong to a clan, or run one.', suggestions: [] }
}

function captureStep(lane: OnboardingLane | null, facts: Record<string, unknown>): 'identity' | 'clan' | 'video' {
  if (!lane || !clean(facts.game_tag, 48)) return 'identity'
  if ((lane === 'member' || lane === 'leader') && !clean(facts.clan_name, 32)) return 'clan'
  return 'video'
}

async function ensureState(db: OnboardingPool, userId: string): Promise<any> {
  let state = await one(db, 'select * from member_onboarding where user_id=$1', [userId])
  if (state) return state
  const profile = await one(
    db,
    `select p.game_tag,u.user_metadata from profiles p join users u on u.id=p.id where p.id=$1`,
    [userId],
  )
  if (!profile) throw Object.assign(new Error('profile_not_found'), { status: 404 })
  const metadata = jsonObject(profile.user_metadata)
  const facts: Record<string, unknown> = {}
  if (clean(profile.game_tag, 48)) facts.game_tag = clean(profile.game_tag, 48)
  if (clean(metadata.platform, 32)) facts.platform = clean(metadata.platform, 32)
  const youtube = await one(
    db,
    `select channel_id,url,title,claim_status from user_youtube_links
      where user_id=$1 order by created_at desc limit 1`,
    [userId],
  )
  if (youtube?.channel_id) {
    facts.youtube_channel_id = String(youtube.channel_id)
    facts.youtube_channel_url = String(youtube.url || '')
    facts.youtube_channel_title = String(youtube.title || '')
    facts.youtube_claim_status = String(youtube.claim_status || 'legacy')
  }
  const inserted = await db.query(
    `insert into member_onboarding (user_id,facts)
     values ($1,$2::jsonb) on conflict (user_id) do nothing returning *`,
    [userId, JSON.stringify(facts)],
  )
  state = inserted.rows[0] || await one(db, 'select * from member_onboarding where user_id=$1', [userId])
  return state
}

async function readEnvelope(db: OnboardingPool, userId: string): Promise<any> {
  await ensureState(db, userId)
  if (await syncApprovedClanmateAction(db, userId)) {
    await refreshStateAfterActions(db, userId)
  }
  const row = await one(db, 'select * from member_onboarding where user_id=$1', [userId])
  const actionRows = (await db.query(
    'select * from onboarding_actions where user_id=$1 order by created_at,id',
    [userId],
  )).rows
  const state = stateShape(row)
  const actions = actionRows.map(actionShape)
  const tournaments = await readTournamentHandoff(db, userId)
  return { state, actions, tournaments, ...promptFor(state, actions) }
}

async function proposeAction(
  db: OnboardingPool,
  userId: string,
  kind: string,
  idempotencyKey: string,
  label: string,
  payload: Record<string, unknown>,
): Promise<any> {
  const mutableSingleton = idempotencyKey === 'identity'
    || idempotencyKey === 'youtube-connection'
  let effectiveKey = idempotencyKey
  if (mutableSingleton) {
    const history = (await db.query(
      `select * from onboarding_actions
        where user_id=$1 and (idempotency_key=$2 or idempotency_key like $3)
        order by created_at desc,id desc`,
      [userId, idempotencyKey, `${idempotencyKey}:correction:%`],
    )).rows
    const latestApplied = history.find((row) => row.status === 'done' && jsonObject(row.result).skipped !== true)
    if (latestApplied && canonicalJson(jsonObject(latestApplied.payload)) === canonicalJson(payload)) {
      return latestApplied
    }
    if (latestApplied) {
      const digest = createHash('sha256').update(canonicalJson(payload)).digest('hex').slice(0, 16)
      effectiveKey = `${idempotencyKey}:correction:${digest}`
      await db.query(
        `delete from onboarding_actions
          where user_id=$1 and idempotency_key like $2 and idempotency_key<>$3
            and status in ('proposed','failed')`,
        [userId, `${idempotencyKey}:correction:%`, effectiveKey],
      )
    }
  }
  const current = await one(
    db,
    'select * from onboarding_actions where user_id=$1 and idempotency_key=$2',
    [userId, effectiveKey],
  )
  if (current) {
    const skipped = current.status === 'done' && jsonObject(current.result).skipped === true
    if ((current.status === 'done' && !skipped) || current.status === 'processing' || current.status === 'confirmed') return current
    return (await db.query(
      `update onboarding_actions set kind=$3,label=$4,payload=$5::jsonb,status='proposed',
         result=null,error=null,completed_at=null,updated_at=now()
        where user_id=$1 and idempotency_key=$2 returning *`,
      [userId, effectiveKey, kind, label, JSON.stringify(payload)],
    )).rows[0]
  }
  return (await db.query(
    `insert into onboarding_actions (user_id,kind,label,payload,idempotency_key)
     values ($1,$2,$3,$4::jsonb,$5) returning *`,
    [userId, kind, label, JSON.stringify(payload), effectiveKey],
  )).rows[0]
}

async function clanmateConnectionSnapshot(
  db: OnboardingPool,
  serverId: string,
  userId: string,
): Promise<{ connectableIds: string[]; followingIds: Set<string>; eligibleIds: string[] }> {
  // Keep these bounded relationship reads separate instead of using correlated
  // subqueries. Clans are capped at 100 members, and this shape works on both
  // production Postgres and the pg-mem verification database.
  const [members, follows, blocks] = await Promise.all([
    db.query(
      'select user_id from clan_members where server_id=$1 and user_id<>$2 order by joined_at,user_id',
      [serverId, userId],
    ),
    db.query('select following_id from follows where follower_id=$1', [userId]),
    db.query('select blocker_id,blocked_id from blocks where blocker_id=$1 or blocked_id=$1', [userId]),
  ])
  const blockedIds = new Set<string>()
  for (const row of blocks.rows) {
    const blocker = String(row.blocker_id)
    const blocked = String(row.blocked_id)
    blockedIds.add(blocker === userId ? blocked : blocker)
  }
  const followingIds = new Set(follows.rows.map((row) => String(row.following_id)))
  const connectableIds = members.rows
    .map((row) => String(row.user_id))
    .filter((id) => id !== userId && !blockedIds.has(id))
  return {
    connectableIds,
    followingIds,
    eligibleIds: connectableIds.filter((id) => !followingIds.has(id)),
  }
}

async function syncApprovedClanmateAction(db: OnboardingPool, userId: string): Promise<boolean> {
  const state = await ensureState(db, userId)
  const facts = jsonObject(state.facts)
  const serverId = clean(facts.clan_id, 50)
  if (!UUID_RE.test(serverId)) return false

  // A stated clan is not enough. Only an existing approved membership may
  // unlock the clanmate-follow proposal; pending applications and ownership
  // disputes remain untouched.
  const membership = await one(
    db,
    `select cm.role,s.name,s.owner_id
       from clan_members cm join servers s on s.id=cm.server_id
      where cm.server_id=$1 and cm.user_id=$2 and s.kind='clan' limit 1`,
    [serverId, userId],
  )
  if (!membership) return false

  let factsChanged = false
  if (safeLane(state.lane) === 'member' && facts.clan_application_status !== 'already_member') {
    facts.clan_application_status = 'already_member'
    factsChanged = true
  }
  if (String(membership.owner_id || '') === userId && facts.clan_claim_status !== 'owned') {
    facts.clan_claim_status = 'owned'
    factsChanged = true
  }

  const idempotencyKey = `follow-clanmates:${serverId}`
  const existingAction = await one(
    db,
    'select * from onboarding_actions where user_id=$1 and idempotency_key=$2',
    [userId, idempotencyKey],
  )
  let proposed = false
  if (!existingAction) {
    const snapshot = await clanmateConnectionSnapshot(db, serverId, userId)
    const eligibleCount = snapshot.eligibleIds.length
    if (eligibleCount > 0) {
      const batchCount = Math.min(eligibleCount, ONBOARDING_CLANMATE_FOLLOW_CAP)
      const clanName = clean(membership.name, 80) || 'your clan'
      await proposeAction(
        db,
        userId,
        'follow_clanmates',
        idempotencyKey,
        eligibleCount > ONBOARDING_CLANMATE_FOLLOW_CAP
          ? `Follow ${batchCount} ${clanName} clanmates (of ${eligibleCount})`
          : `Follow ${batchCount} ${clanName} clanmate${batchCount === 1 ? '' : 's'}`,
        {
          server_id: serverId,
          clan_name: clanName,
          eligible_count: eligibleCount,
          batch_count: batchCount,
          cap: ONBOARDING_CLANMATE_FOLLOW_CAP,
        },
      )
      proposed = true
    }
  }

  if (!factsChanged && !proposed) return false
  const reopenReview = proposed && state.status === 'complete'
  await db.query(
    `update member_onboarding
        set facts=$2::jsonb,
            status=case when $3::boolean then 'ready' else status end,
            current_step=case when $3::boolean then 'review' else current_step end,
            completed_at=case when $3::boolean then null else completed_at end,
            revision=revision+1,updated_at=now()
      where user_id=$1`,
    [userId, JSON.stringify(facts), reopenReview],
  )
  return true
}

async function readTournamentHandoff(db: OnboardingPool, userId: string): Promise<Record<string, unknown>> {
  const limit = ONBOARDING_TOURNAMENT_LIMIT
  const take = limit + 1
  let clanInvitations: any[] = []
  let entries: any[] = []
  let openTournaments: any[] = []

  // These are additive organizer tables, so an older or partially migrated
  // database must not prevent account setup from loading.
  try {
    clanInvitations = (await db.query(
      `select i.id,i.tournament_id,i.clan_id,i.source_clan_roster_id,i.status,
              t.name as tournament_name,t.start_at,t.end_at,t.status as tournament_status,
              s.name as clan_name,s.clan_tag,r.name as source_clan_roster_name
         from tournament_clan_invitations i
         join tournaments t on t.id=i.tournament_id
         join servers s on s.id=i.clan_id
         left join clan_rosters r on r.id=i.source_clan_roster_id
         left join clan_members cm on cm.server_id=i.clan_id and cm.user_id=$1
        where i.status='invited' and t.status in ('draft','open','live')
          and (s.owner_id=$1 or cm.role in ('leader','officer','recruiter'))
        order by i.updated_at desc limit $2`,
      [userId, take],
    )).rows
  } catch { clanInvitations = [] }

  try {
    entries = (await db.query(
      `select e.id,e.tournament_id,e.status as entrant_status,e.invited_by,
              t.name as tournament_name,t.start_at,t.end_at,t.status as tournament_status
         from tournament_entrants e join tournaments t on t.id=e.tournament_id
        where e.user_id=$1 and e.status in ('pending','accepted') and t.status<>'closed'
        order by e.created_at desc limit $2`,
      [userId, take],
    )).rows
  } catch { entries = [] }

  try {
    const [candidates, membershipRows, ownedRows, entrantRows, invitationRows] = await Promise.all([
      db.query(
        `select id,name,start_at,end_at,status,entry_scope,server_id,clan_entry_mode,created_at
           from tournaments where status in ('open','live')
          order by created_at desc limit 100`,
      ),
      db.query('select server_id,role from clan_members where user_id=$1', [userId]),
      db.query("select id from servers where owner_id=$1 and kind='clan'", [userId]),
      db.query('select tournament_id from tournament_entrants where user_id=$1', [userId]),
      db.query("select tournament_id,clan_id from tournament_clan_invitations where status in ('invited','accepted')"),
    ])
    const memberClanIds = new Set(membershipRows.rows.map((row) => String(row.server_id)))
    const managerClanIds = new Set([
      ...ownedRows.rows.map((row) => String(row.id)),
      ...membershipRows.rows
        .filter((row) => ['leader', 'officer', 'recruiter'].includes(String(row.role)))
        .map((row) => String(row.server_id)),
    ])
    const enteredIds = new Set(entrantRows.rows.map((row) => String(row.tournament_id)))
    const managerInvitedTournamentIds = new Set(
      invitationRows.rows
        .filter((row) => managerClanIds.has(String(row.clan_id)))
        .map((row) => String(row.tournament_id)),
    )
    openTournaments = candidates.rows.filter((row) => {
      const id = String(row.id)
      if (enteredIds.has(id)) return false
      const scope = String(row.entry_scope || 'public')
      if (scope !== 'public' && !memberClanIds.has(String(row.server_id || ''))) return false
      return String(row.clan_entry_mode || 'open') !== 'invited_only'
        || managerInvitedTournamentIds.has(id)
    }).slice(0, take)
  } catch { openTournaments = [] }

  const hasMore = (rows: any[]) => rows.length > limit
  const dateValue = (value: unknown) => value == null ? null : value
  return {
    clan_invitations: clanInvitations.slice(0, limit).map((row) => ({
      id: String(row.id),
      tournament_id: String(row.tournament_id),
      tournament_name: String(row.tournament_name),
      tournament_status: String(row.tournament_status),
      start_at: dateValue(row.start_at),
      end_at: dateValue(row.end_at),
      clan_id: String(row.clan_id),
      clan_name: String(row.clan_name),
      clan_tag: row.clan_tag ? String(row.clan_tag) : null,
      source_clan_roster_id: row.source_clan_roster_id ? String(row.source_clan_roster_id) : null,
      source_clan_roster_name: row.source_clan_roster_name ? String(row.source_clan_roster_name) : null,
      link: `/tournaments/${row.tournament_id}?section=rosters`,
    })),
    entries: entries.slice(0, limit).map((row) => ({
      id: String(row.id),
      tournament_id: String(row.tournament_id),
      tournament_name: String(row.tournament_name),
      tournament_status: String(row.tournament_status),
      entrant_status: String(row.entrant_status),
      invited: Boolean(row.invited_by),
      start_at: dateValue(row.start_at),
      end_at: dateValue(row.end_at),
      link: `/tournaments/${row.tournament_id}`,
    })),
    open_tournaments: openTournaments.slice(0, limit).map((row) => ({
      id: String(row.id),
      tournament_id: String(row.id),
      tournament_name: String(row.name),
      tournament_status: String(row.status),
      entry_scope: String(row.entry_scope || 'public'),
      start_at: dateValue(row.start_at),
      end_at: dateValue(row.end_at),
      link: `/tournaments/${row.id}`,
    })),
    more: {
      clan_invitations: hasMore(clanInvitations),
      entries: hasMore(entries),
      open_tournaments: hasMore(openTournaments),
    },
  }
}

function clanTag(name: string, asked: unknown): string {
  const explicit = clean(asked, 5).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (explicit.length >= 2) return explicit
  const words = name.match(/[A-Za-z0-9]+/g) || []
  const initials = words.map((word) => word[0]).join('').toUpperCase().slice(0, 5)
  const fallback = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5)
  return (initials.length >= 2 ? initials : fallback.padEnd(2, 'X')).slice(0, 5)
}

async function proposeFromFacts(
  db: OnboardingPool,
  userId: string,
  lane: OnboardingLane | null,
  facts: Record<string, any>,
): Promise<any[]> {
  const proposed: any[] = []
  const gameTag = clean(facts.game_tag, 48)
  if (gameTag) {
    proposed.push(await proposeAction(db, userId, 'update_identity', 'identity',
      `Use ${gameTag} as my gamer tag`, {
        game_tag: gameTag,
        platform: clean(facts.platform, 32) || null,
        game: clean(facts.game, 80) || 'Shinobi Striker',
      }))
  }

  const name = clean(facts.clan_name, 32)
  if ((lane === 'member' || lane === 'leader') && name) {
    const explicitTag = clean(facts.clan_tag, 5).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    const tag = clanTag(name, explicitTag)
    const matches = (await db.query(
      `select id,name,clan_tag,owner_id,is_recruiting,max_members,join_fee_tokens from servers
        where kind='clan' and (lower(name)=lower($1)
          or ($2<>'' and lower(coalesce(clan_tag,''))=lower($2)))
        order by case when lower(name)=lower($1) then 0 else 1 end limit 2`,
      [name, explicitTag],
    )).rows
    const nameMatch = matches.find((row) => String(row.name).toLowerCase() === name.toLowerCase())
    const tagMatch = explicitTag
      ? matches.find((row) => String(row.clan_tag || '').toLowerCase() === explicitTag.toLowerCase())
      : null
    if (matches.length) delete facts.clan_match_missing
    if (nameMatch && tagMatch && String(nameMatch.id) !== String(tagMatch.id)) {
      facts.clan_identity_conflict = true
      return proposed
    }
    delete facts.clan_identity_conflict
    const existing = nameMatch || tagMatch || null
    if (existing) {
      delete facts.clan_match_missing
      facts.clan_id = String(existing.id)
      facts.clan_name = String(existing.name)
      if (existing.clan_tag) facts.clan_tag = String(existing.clan_tag)
    }
    if (lane === 'member') {
      if (existing) {
        const alreadyMember = await one(
          db,
          'select id from clan_members where server_id=$1 and user_id=$2 limit 1',
          [existing.id, userId],
        )
        const memberCount = Number((await one(
          db,
          'select count(*)::int as count from clan_members where server_id=$1',
          [existing.id],
        ))?.count || 0)
        const joinFee = Math.max(0, Number(existing.join_fee_tokens) || 0)
        const full = !alreadyMember && memberCount >= Math.max(1, Number(existing.max_members) || 100)
        if (!alreadyMember && existing.is_recruiting === false) {
          facts.clan_application_blocked = 'not_recruiting'
        } else if (!alreadyMember && full) {
          facts.clan_application_blocked = 'full'
        } else if (!alreadyMember && joinFee > 0) {
          facts.clan_application_blocked = 'join_fee'
          facts.clan_join_fee_tokens = joinFee
        } else {
          delete facts.clan_application_blocked
          delete facts.clan_join_fee_tokens
          proposed.push(await proposeAction(db, userId, 'apply_clan', `clan-apply:${existing.id}`,
            `Apply to ${existing.name}`, { server_id: String(existing.id), name: String(existing.name) }))
        }
      } else {
        facts.clan_match_missing = true
      }
    } else if (lane === 'leader') {
      let clanAction: any = null
      if (!existing) {
        const target = createHash('sha256').update(`${name.toLowerCase()}|${tag.toLowerCase()}`).digest('hex').slice(0, 16)
        clanAction = await proposeAction(db, userId, 'create_clan', `clan-create:${target}`,
          `Create ${name} [${tag}]`, { name, clan_tag: tag })
      } else if (String(existing.owner_id || '') !== userId) {
        clanAction = await proposeAction(db, userId, 'claim_clan', `clan-claim:${existing.id}`,
          `Request ownership review for ${existing.name}`, { server_id: String(existing.id), name: String(existing.name) })
      } else {
        facts.clan_claim_status = 'owned'
      }
      if (clanAction) proposed.push(clanAction)
      if (!existing) {
        const rosterName = `${tag ? `[${tag}] ` : ''}Main`
        proposed.push(await proposeAction(db, userId, 'create_roster', `default-roster:${clanAction?.id || existing?.id}`,
          `Create ${rosterName} roster`, {
            server_id: existing ? String(existing.id) : null,
            clan_action_id: clanAction?.id ? String(clanAction.id) : null,
            clan_name: name,
            name: rosterName,
            max_members: 4,
          }))
      }
    }
  }

  for (const handle of (Array.isArray(facts.follow_handles) ? facts.follow_handles : []).slice(0, 12)) {
    const profile = await one(db, 'select id,username from profiles where lower(username)=lower($1)', [handle])
    if (!profile || String(profile.id) === userId) continue
    proposed.push(await proposeAction(db, userId, 'follow_player', `follow:${profile.id}`,
      `Follow @${profile.username}`, { following_id: String(profile.id), username: String(profile.username) }))
  }
  return proposed
}

async function patchStateFacts(
  db: OnboardingPool,
  userId: string,
  patch: Record<string, unknown>,
  remove: string[] = [],
): Promise<void> {
  const current = await one(db, 'select facts from member_onboarding where user_id=$1', [userId])
  const facts = { ...jsonObject(current?.facts), ...patch }
  remove.forEach((key) => delete facts[key])
  await db.query('update member_onboarding set facts=$2::jsonb,updated_at=now() where user_id=$1', [userId, JSON.stringify(facts)])
}

async function withdrawOnboardingApplication(
  db: OnboardingPool,
  userId: string,
  applicationId: unknown,
): Promise<void> {
  const id = clean(applicationId, 50)
  if (!UUID_RE.test(id)) return
  await db.query(
    `update clan_applications set status='withdrawn',updated_at=now()
      where id=$1 and applicant_id=$2 and status='pending'`,
    [id, userId],
  )
  const actions = (await db.query(
    `select id,result from onboarding_actions
      where user_id=$1 and kind='apply_clan' and status='done'`,
    [userId],
  )).rows
  for (const action of actions) {
    const result = jsonObject(action.result)
    if (String(result.application_id || '') !== id) continue
    await db.query(
      'update onboarding_actions set result=$2::jsonb,updated_at=now() where id=$1',
      [action.id, JSON.stringify({ ...result, status: 'withdrawn', superseded: true })],
    )
  }
}

async function openDispute(
  db: OnboardingPool,
  kind: 'youtube_channel' | 'clan',
  subjectKey: string,
  currentOwnerId: string | null,
  challengerId: string,
  evidence: Record<string, unknown>,
): Promise<any> {
  const existing = await one(
    db,
    `select * from identity_claim_disputes
      where kind=$1 and subject_key=$2 and challenger_id=$3 and status='open' limit 1`,
    [kind, subjectKey, challengerId],
  )
  if (existing) return existing
  const dispute = (await db.query(
    `insert into identity_claim_disputes
       (kind,subject_key,current_owner_id,challenger_id,evidence)
     values ($1,$2,$3,$4,$5::jsonb) returning *`,
    [kind, subjectKey, currentOwnerId, challengerId, JSON.stringify(evidence)],
  )).rows[0]
  if (currentOwnerId) {
    await db.query(
      `insert into notifications (user_id,kind,title,body,link,related_id,actor_id)
       values ($1,'identity_claim_dispute',$2,$3,'/settings',$4,$5)`,
      [currentOwnerId,
        kind === 'clan' ? 'A clan ownership claim needs review' : 'A YouTube channel claim needs review',
        'Your existing ownership was preserved while this claim is reviewed.',
        dispute.id, challengerId],
    )
  }
  return dispute
}

async function ensureClanMembership(db: OnboardingPool, serverId: string, userId: string, role: string): Promise<void> {
  if (!await one(db, 'select id from clan_members where server_id=$1 and user_id=$2', [serverId, userId])) {
    await db.query('insert into clan_members (server_id,user_id,role) values ($1,$2,$3)', [serverId, userId, role])
  }
  if (!await one(db, 'select id from server_members where server_id=$1 and user_id=$2', [serverId, userId])) {
    await db.query('insert into server_members (server_id,user_id,role) values ($1,$2,$3)', [serverId, userId, role])
  }
}

async function executeAction(db: OnboardingPool, userId: string, action: any, now: Date): Promise<Record<string, unknown>> {
  const payload = jsonObject(action.payload)
  switch (String(action.kind)) {
    case 'update_identity': {
      const gameTag = clean(payload.game_tag, 48)
      const normalized = normalizeGameAlias(gameTag)
      if (normalized.length < 2 || normalized.length > 48) throw new Error('invalid_gamer_tag')
      let usernameBase = (clean(payload.username, 48) || gameTag)
        .replace(/^@+/, '')
        .replace(/[^A-Za-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 20)
      if (usernameBase.length < 3) usernameBase = `player_${userId.replace(/-/g, '').slice(0, 8)}`
      const compactId = userId.replace(/-/g, '')
      const candidates = [
        usernameBase,
        `${usernameBase.slice(0, 11)}_${compactId.slice(0, 8)}`,
        `p_${compactId.slice(0, 16)}`,
      ]
      let username = candidates[candidates.length - 1]
      for (const candidate of candidates) {
        if (!await one(db, 'select id from profiles where lower(username)=lower($1) and id<>$2 limit 1', [candidate, userId])) {
          username = candidate
          break
        }
      }
      await db.query('update profiles set game_tag=$2,username=$3 where id=$1', [userId, gameTag, username])
      const user = await one(db, 'select user_metadata from users where id=$1', [userId])
      const metadata = jsonObject(user?.user_metadata)
      metadata.game_tag = gameTag
      metadata.username = username
      if (clean(payload.platform, 32)) metadata.platform = clean(payload.platform, 32)
      await db.query('update users set user_metadata=$2::jsonb where id=$1', [userId, JSON.stringify(metadata)])

      const game = clean(payload.game, 80) === 'Shinobi Striker' ? 'shinobi_striker' : 'shinobi_striker'
      let alias = await one(
        db,
        `select id,status,is_primary,confidence from player_aliases where profile_id=$1 and game=$2 and normalized_alias=$3
          and status in ('candidate','verified','ambiguous') limit 1`,
        [userId, game, normalized],
      )
      if (alias) {
        await db.query(
          `update player_aliases set display_alias=$2,last_seen_at=$3,updated_at=now() where id=$1`,
          [alias.id, gameTag, now.toISOString()],
        )
      } else {
        alias = (await db.query(
          `insert into player_aliases
             (profile_id,game,display_alias,normalized_alias,status,valid_from,confidence,is_primary,
              first_seen_at,last_seen_at)
           values ($1,$2,$3,$4,'candidate',$5,0,false,$5,$5)
           returning id,status,is_primary,confidence`,
          [userId, game, gameTag, normalized, now.toISOString()],
        )).rows[0]
      }
      // A self-entered gamer tag is only a candidate until media evidence
      // verifies it. When the player corrects that tag, retire only their old,
      // unevidenced candidates; verified/ambiguous aliases and any alias with
      // evidence remain immutable scoring history.
      const candidatesToRetire = (await db.query(
        `select id from player_aliases
          where profile_id=$1 and game=$2 and status='candidate' and is_primary=false and id<>$3`,
        [userId, game, alias.id],
      )).rows
      for (const candidate of candidatesToRetire) {
        if (!await one(db, 'select id from player_alias_evidence where alias_id=$1 limit 1', [candidate.id])) {
          await db.query('delete from player_aliases where id=$1 and profile_id=$2', [candidate.id, userId])
        }
      }
      const aliasStatus = String(alias.status || 'candidate')
      await patchStateFacts(db, userId, { game_tag: gameTag, alias_status: aliasStatus })
      return { game_tag: gameTag, username, alias_id: String(alias.id), alias_status: aliasStatus }
    }

    case 'connect_youtube': {
      const channelId = clean(payload.channel_id, 100)
      const channelUrl = clean(payload.channel_url, 500)
      const videoId = clean(payload.video_id, 64)
      const videoUrl = clean(payload.video_url, 1000)
      if (!CHANNEL_ID_RE.test(channelId) || !videoId || !videoUrl || !channelUrl) throw new Error('invalid_youtube_metadata')
      const claimed = await one(
        db,
        `select user_id from user_youtube_links
          where user_id<>$2 and (
            channel_id=$1
            or lower(url)=lower($3)
            or lower(url)=lower($4)
          ) limit 1`,
        [channelId, userId, channelUrl, `https://www.youtube.com/channel/${channelId}`],
      )
      const otherOwner = claimed?.user_id || null
      if (otherOwner) {
        const dispute = await openDispute(db, 'youtube_channel', channelId, String(otherOwner), userId, {
          video_id: videoId, video_url: videoUrl, channel_url: channelUrl,
          channel_title: clean(payload.channel_title, 200) || null,
        })
        await db.query(
          `update onboarding_video_reports set status='disputed',updated_at=now()
            where user_id=$1 and video_id=$2`,
          [userId, videoId],
        )
        await patchStateFacts(db, userId, { youtube_claim_status: 'disputed', youtube_dispute_id: String(dispute.id) })
        return { status: 'disputed', dispute_id: String(dispute.id), channel_id: channelId }
      }

      const existingLinks = (await db.query(
        'select id,url,title,channel_id,claim_status,claim_method from user_youtube_links where user_id=$1 order by created_at desc',
        [userId],
      )).rows
      let link = existingLinks.find((row) => isYouTubeChannelPage(row.url) && (
        String(row.channel_id || '') === channelId
        || String(row.url || '').toLowerCase() === channelUrl.toLowerCase()
        || String(row.url || '').toLowerCase() === `https://www.youtube.com/channel/${channelId}`.toLowerCase()
      ))
      if (link) {
        await db.query(
          `update user_youtube_links set url=$2,title=$3,channel_id=$4,
             claim_status='claimed',claim_method='onboarding_video',
             claimed_at=coalesce(claimed_at,now()) where id=$1`,
          [link.id, channelUrl, clean(payload.channel_title, 200) || null, channelId],
        )
      } else {
        link = (await db.query(
          `insert into user_youtube_links
             (user_id,url,title,channel_id,claim_status,claim_method,claimed_at)
           values ($1,$2,$3,$4,'claimed','onboarding_video',now()) returning id`,
          [userId, channelUrl, clean(payload.channel_title, 200) || null, channelId],
        )).rows[0]
      }
      // A connected account has one active channel. Correcting it supersedes
      // older channel-page links but preserves saved watch/video URLs.
      for (const prior of existingLinks) {
        if (String(prior.id) !== String(link.id) && isYouTubeChannelPage(prior.url)) {
          await db.query('delete from user_youtube_links where id=$1 and user_id=$2', [prior.id, userId])
        }
      }
      const account = await one(db, 'select user_metadata from users where id=$1', [userId])
      const metadata = jsonObject(account?.user_metadata)
      metadata.youtube_url = channelUrl
      await db.query('update users set user_metadata=$2::jsonb where id=$1', [userId, JSON.stringify(metadata)])

      await db.query(
        `update onboarding_video_reports set status='superseded',updated_at=now()
          where user_id=$1 and channel_id<>$2 and status='connected'`,
        [userId, channelId],
      )
      await db.query(
        `update onboarding_video_reports set media_source_id=null,status='connected',updated_at=now()
          where user_id=$1 and video_id=$2`,
        [userId, videoId],
      )
      await patchStateFacts(db, userId, {
        youtube_claim_status: 'claimed', youtube_channel_id: channelId,
        youtube_channel_url: channelUrl,
      })
      return { status: 'claimed', link_id: String(link.id), channel_id: channelId }
    }

    case 'create_clan': {
      const name = clean(payload.name, 32)
      const tag = clanTag(name, payload.clan_tag)
      if (name.length < 2) throw new Error('invalid_clan_name')
      let clan = await one(
        db,
        `select * from servers where kind='clan'
          and (lower(name)=lower($1) or lower(coalesce(clan_tag,''))=lower($2))
          order by case when lower(name)=lower($1) then 0 else 1 end limit 1`,
        [name, tag],
      )
      if (clan && String(clan.owner_id || '') !== userId) {
        const dispute = await openDispute(db, 'clan', String(clan.id), String(clan.owner_id || '') || null, userId, { name, clan_tag: tag })
        await patchStateFacts(db, userId, { clan_claim_status: 'disputed', clan_dispute_id: String(dispute.id) })
        return { status: 'disputed', dispute_id: String(dispute.id), server_id: String(clan.id) }
      }
      if (!clan) {
        // A correction to a clan this same onboarding flow just created updates
        // that owned record; it never creates a second clan or touches a clan
        // owned by somebody else.
        const priorCreates = (await db.query(
          `select id,result from onboarding_actions
            where user_id=$1 and kind='create_clan' and status='done' and id<>$2
            order by completed_at desc,created_at desc`,
          [userId, action.id],
        )).rows
        let priorOwned: any = null
        for (const prior of priorCreates) {
          const serverId = clean(jsonObject(prior.result).server_id, 50)
          if (!UUID_RE.test(serverId)) continue
          const candidate = await one(db, "select * from servers where id=$1 and kind='clan' and owner_id=$2", [serverId, userId])
          if (candidate) { priorOwned = candidate; break }
        }
        if (priorOwned) {
          clan = (await db.query(
            `update servers set name=$2,clan_tag=$3 where id=$1 and owner_id=$4 returning *`,
            [priorOwned.id, name, tag, userId],
          )).rows[0]
          await db.query(
            `update chat_spaces set name=$2 where clan_id=$1 and kind='clan' and owner_id=$3`,
            [priorOwned.id, `${name} Chat`, userId],
          )
          const rosterActions = (await db.query(
            `select result from onboarding_actions
              where user_id=$1 and kind='create_roster' and status='done'
              order by completed_at desc,created_at desc`,
            [userId],
          )).rows
          for (const rosterAction of rosterActions) {
            const rosterId = clean(jsonObject(rosterAction.result).roster_id, 50)
            if (!UUID_RE.test(rosterId)) continue
            await db.query(
              `update clan_rosters set name=$2 where id=$1 and server_id=$3 and created_by=$4`,
              [rosterId, `[${tag}] Main`, priorOwned.id, userId],
            )
            break
          }
        } else {
          clan = (await db.query(
            `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
             values ($1,$2,$3,'clan',true,100) returning *`,
            [name, tag, userId],
          )).rows[0]
        }
      }
      await ensureClanMembership(db, String(clan.id), userId, 'leader')
      if (!await one(db, "select id from channels where server_id=$1 and name='general'", [clan.id])) {
        await db.query("insert into channels (server_id,name,type) values ($1,'general','text')", [clan.id])
      }
      let space = await one(db, "select id from chat_spaces where clan_id=$1 and kind='clan' limit 1", [clan.id])
      if (!space) {
        space = (await db.query(
          `insert into chat_spaces (kind,name,clan_id,owner_id) values ('clan',$2,$1,$3) returning id`,
          [clan.id, `${name} Chat`, userId],
        )).rows[0]
      }
      if (!await one(db, "select id from chat_channels where space_id=$1 and name='general' limit 1", [space.id])) {
        await db.query(
          "insert into chat_channels (space_id,name,category,position,is_announcement) values ($1,'general',null,0,false)",
          [space.id],
        )
      }
      await patchStateFacts(db, userId, { clan_id: String(clan.id), clan_name: String(clan.name), clan_tag: tag, clan_claim_status: 'owned' })
      return { status: 'owned', server_id: String(clan.id), name: String(clan.name), clan_tag: String(clan.clan_tag || tag), chat_space_id: String(space.id) }
    }

    case 'claim_clan': {
      const serverId = clean(payload.server_id, 50)
      if (!UUID_RE.test(serverId)) throw new Error('invalid_clan')
      const clan = await one(db, "select * from servers where id=$1 and kind='clan'", [serverId])
      if (!clan) throw new Error('clan_not_found')
      const claimantManager = await one(db, `select user_id from clan_members where server_id=$1
          and role in ('leader','officer','recruiter') and user_id=$2 limit 1`, [serverId, userId])
      const legacyManager = !clan.owner_id
        ? await one(db, `select user_id from clan_members where server_id=$1
            and role in ('leader','officer','recruiter') and user_id<>$2 limit 1`, [serverId, userId])
        : null
      if (String(clan.owner_id || '') === userId || (!clan.owner_id && claimantManager)) {
        await db.query('update servers set owner_id=$2 where id=$1', [serverId, userId])
        await ensureClanMembership(db, serverId, userId, 'leader')
        await patchStateFacts(db, userId, { clan_id: serverId, clan_claim_status: 'owned' })
        return { status: 'owned', server_id: serverId }
      }
      const disputeOwner = clan.owner_id || legacyManager?.user_id || null
      const dispute = await openDispute(db, 'clan', serverId, disputeOwner ? String(disputeOwner) : null, userId, { name: clan.name, clan_tag: clan.clan_tag })
      await patchStateFacts(db, userId, { clan_id: serverId, clan_claim_status: 'disputed', clan_dispute_id: String(dispute.id) })
      return { status: 'disputed', server_id: serverId, dispute_id: String(dispute.id) }
    }

    case 'apply_clan': {
      const serverId = clean(payload.server_id, 50)
      if (!UUID_RE.test(serverId)) throw new Error('invalid_clan')
      const clan = await one(db, "select * from servers where id=$1 and kind='clan'", [serverId])
      if (!clan) throw new Error('clan_not_found')
      if (await one(db, 'select id from clan_members where server_id=$1 and user_id=$2', [serverId, userId])) {
        await patchStateFacts(db, userId, { clan_id: serverId, clan_application_status: 'already_member' })
        return { status: 'already_member', server_id: serverId }
      }
      let application = await one(db, 'select id from clan_applications where server_id=$1 and applicant_id=$2', [serverId, userId])
      if (application) {
        application = (await db.query(
          `update clan_applications set status='pending',message=$3,reviewed_by=null,reviewed_at=null,updated_at=now()
            where server_id=$1 and applicant_id=$2 returning *`,
          [serverId, userId, 'Sent during guided setup.'],
        )).rows[0]
      } else {
        application = (await db.query(
          `insert into clan_applications
             (server_id,applicant_id,status,message,fee_tokens_snapshot,updated_at)
           values ($1,$2,'pending',$3,$4,now()) returning *`,
          [serverId, userId, 'Sent during guided setup.', Math.max(0, Number(clan.join_fee_tokens) || 0)],
        )).rows[0]
      }
      const recipients = new Set<string>()
      if (clan.owner_id) recipients.add(String(clan.owner_id))
      const managers = await db.query(
        `select user_id from clan_members where server_id=$1 and role in ('leader','officer','recruiter')`,
        [serverId],
      )
      managers.rows.forEach((row) => recipients.add(String(row.user_id)))
      const applicant = await one(db, 'select username from profiles where id=$1', [userId])
      for (const recipient of recipients) {
        if (recipient === userId) continue
        await db.query(
          `insert into notifications (user_id,kind,title,body,link,related_id,actor_id)
           values ($1,'clan_application_received',$2,$3,$4,$5,$6)`,
          [recipient, `${applicant?.username || 'A player'} applied to ${clan.name}`,
            'Review this clan application.', `/boards/${serverId}`, application.id, userId],
        )
      }
      await patchStateFacts(db, userId, { clan_id: serverId, clan_application_status: 'pending', clan_application_id: String(application.id) })
      const pushRecipients = [...recipients].filter((recipient) => recipient !== userId)
      return {
        status: 'pending', server_id: serverId, application_id: String(application.id),
        __post_commit_push: pushRecipients.length ? {
          user_ids: pushRecipients,
          title: `${applicant?.username || 'A player'} applied to ${clan.name}`,
          body: 'Review this clan application.',
          url: `/boards/${serverId}`,
          tag: `clan-application:${serverId}`,
        } : null,
      }
    }

    case 'create_roster': {
      let serverId = clean(payload.server_id, 50)
      if (!UUID_RE.test(serverId) && UUID_RE.test(clean(payload.clan_action_id, 50))) {
        const clanAction = await one(db, 'select result from onboarding_actions where id=$1 and user_id=$2', [payload.clan_action_id, userId])
        serverId = clean(jsonObject(clanAction?.result).server_id, 50)
      }
      if (!UUID_RE.test(serverId)) {
        const owned = await one(db, "select id from servers where owner_id=$1 and kind='clan' and lower(name)=lower($2) limit 1", [userId, clean(payload.clan_name, 32)])
        serverId = clean(owned?.id, 50)
      }
      if (!UUID_RE.test(serverId)) throw new Error('confirm_the_clan_first')
      const clan = await one(db, "select owner_id,name from servers where id=$1 and kind='clan'", [serverId])
      const manager = String(clan?.owner_id || '') === userId
        || Boolean(await one(db, "select id from clan_members where server_id=$1 and user_id=$2 and role in ('leader','officer')", [serverId, userId]))
      if (!clan || !manager) throw new Error('clan_manager_required')
      const name = clean(payload.name, 100) || 'Main'
      let roster = await one(db, 'select * from clan_rosters where server_id=$1 and lower(name)=lower($2)', [serverId, name])
      if (!roster) {
        roster = (await db.query(
          `insert into clan_rosters (server_id,name,game,max_members,created_by)
           values ($1,$2,'Shinobi Striker',$3,$4) returning *`,
          [serverId, name, Math.max(1, Math.min(100, Number(payload.max_members) || 4)), userId],
        )).rows[0]
      }
      await ensureClanMembership(db, serverId, userId, 'leader')
      if (!await one(db, 'select id from clan_roster_members where roster_id=$1 and user_id=$2', [roster.id, userId])) {
        await db.query(
          `insert into clan_roster_members (roster_id,user_id,member_role,added_by)
           values ($1,$2,'captain',$2)`,
          [roster.id, userId],
        )
      }
      await patchStateFacts(db, userId, {
        clan_id: serverId,
        roster_id: String(roster.id),
        clan_claim_status: 'owned',
      })
      return { roster_id: String(roster.id), server_id: serverId, name: String(roster.name) }
    }

    case 'follow_player': {
      const followingId = clean(payload.following_id, 50)
      if (!UUID_RE.test(followingId) || followingId === userId) throw new Error('invalid_follow_target')
      if (!await one(db, 'select id from profiles where id=$1', [followingId])) throw new Error('player_not_found')
      if (!await one(db, 'select id from follows where follower_id=$1 and following_id=$2', [userId, followingId])) {
        await db.query('insert into follows (follower_id,following_id) values ($1,$2)', [userId, followingId])
      }
      return { following_id: followingId }
    }

    case 'follow_clanmates': {
      const serverId = clean(payload.server_id, 50)
      if (!UUID_RE.test(serverId)) throw new Error('invalid_clan')
      const membership = await one(
        db,
        `select cm.id,s.name
           from clan_members cm join servers s on s.id=cm.server_id
          where cm.server_id=$1 and cm.user_id=$2 and s.kind='clan' limit 1`,
        [serverId, userId],
      )
      if (!membership) throw new Error('approved_clan_membership_required')

      const snapshot = await clanmateConnectionSnapshot(db, serverId, userId)
      const targets = snapshot.eligibleIds.slice(0, ONBOARDING_CLANMATE_FOLLOW_CAP)
      let followedCount = 0
      const followingIds: string[] = []
      for (const targetId of targets) {
        const inserted = await db.query(
          `insert into follows (follower_id,following_id)
           values ($1,$2) on conflict (follower_id,following_id) do nothing returning id`,
          [userId, targetId],
        )
        if (inserted.rows[0]) {
          followedCount += 1
          followingIds.push(targetId)
        }
      }
      const totalCount = snapshot.connectableIds.length
      const alreadyFollowingCount = snapshot.connectableIds.filter((id) => snapshot.followingIds.has(id)).length
      const eligibleCount = snapshot.eligibleIds.length
      return {
        server_id: serverId,
        clan_name: String(membership.name || payload.clan_name || 'Clan'),
        total_clanmates: totalCount,
        eligible_count: eligibleCount,
        already_following_count: alreadyFollowingCount,
        followed_count: followedCount,
        remaining_count: Math.max(0, eligibleCount - followedCount),
        capped: eligibleCount > ONBOARDING_CLANMATE_FOLLOW_CAP,
        cap: ONBOARDING_CLANMATE_FOLLOW_CAP,
        following_ids: followingIds,
      }
    }

    default:
      throw new Error('unsupported_onboarding_action')
  }
}

type OnboardingPostCommitPush = {
  user_ids: string[]
  title: string
  body: string
  url: string
  tag?: string
}

async function executeActionIds(
  deps: OnboardingRouteDeps,
  userId: string,
  actionIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(actionIds.filter((id) => UUID_RE.test(id)))]
  const wanted = new Set(uniqueIds)
  const rows = uniqueIds.length
    ? (await deps.pool.query(
        "select id,kind from onboarding_actions where user_id=$1 and status in ('proposed','failed','confirmed')",
        [userId],
      )).rows.filter((row) => wanted.has(String(row.id)))
    : []
  rows.sort((a, b) => (ACTION_PRIORITY[a.kind] || 999) - (ACTION_PRIORITY[b.kind] || 999))

  for (const row of rows) {
    try {
      let postCommitPush: OnboardingPostCommitPush | null = null
      await deps.withTransaction(async (db) => {
        const action = await one(db, 'select * from onboarding_actions where id=$1 and user_id=$2 for update', [row.id, userId])
        if (!action || action.status === 'done') return
        if (!['proposed', 'failed', 'confirmed'].includes(String(action.status))) return
        await db.query(
          `update onboarding_actions set status='processing',confirmed_at=coalesce(confirmed_at,now()),
             error=null,updated_at=now() where id=$1`,
          [row.id],
        )
        const result = await executeAction(db, userId, action, deps.now())
        const internalPush = jsonObject(result.__post_commit_push)
        delete result.__post_commit_push
        const pushIds = Array.isArray(internalPush.user_ids)
          ? [...new Set(internalPush.user_ids.map(String).filter((id) => UUID_RE.test(id)))]
          : []
        if (pushIds.length) {
          postCommitPush = {
            user_ids: pushIds,
            title: clean(internalPush.title, 180),
            body: clean(internalPush.body, 300),
            url: clean(internalPush.url, 500),
            ...(clean(internalPush.tag, 180) ? { tag: clean(internalPush.tag, 180) } : {}),
          }
        }
        await db.query(
          `update onboarding_actions set status='done',result=$2::jsonb,error=null,
             completed_at=now(),updated_at=now() where id=$1`,
          [row.id, JSON.stringify(result)],
        )
      })
      // Device delivery starts only after the application is durable. In-app
      // notifications remain the fallback if push delivery is unavailable.
      if (postCommitPush && deps.pushUsers) {
        try { await deps.pushUsers(postCommitPush.user_ids, postCommitPush) } catch { /* fail soft */ }
      }
    } catch (error: any) {
      await deps.pool.query(
        `update onboarding_actions set status='failed',error=$2,updated_at=now()
          where id=$1 and user_id=$3 and status<>'done'`,
        [row.id, clean(error?.message || 'action_failed', 240), userId],
      )
    }
  }
  await refreshStateAfterActions(deps.pool, userId)
}

async function refreshStateAfterActions(db: OnboardingPool, userId: string): Promise<void> {
  const state = await ensureState(db, userId)
  const facts = jsonObject(state.facts)
  const actions = (await db.query('select kind,status from onboarding_actions where user_id=$1', [userId])).rows
  const outstanding = actions.some((action) => REQUIRED_CHAT_ACTIONS.has(String(action.kind))
    && ['proposed', 'confirmed', 'processing', 'failed'].includes(String(action.status)))
  const identity = Boolean(clean((await one(db, 'select game_tag from profiles where id=$1', [userId]))?.game_tag, 48))
  const lane = safeLane(state.lane)
  const clanNeeded = lane === 'member' || lane === 'leader'
  const clanNamed = Boolean(clean(facts.clan_name, 32))
  const clanHandled = !clanNeeded || ['pending', 'already_member', 'owned', 'disputed'].includes(String(
    facts.clan_application_status || facts.clan_claim_status || '',
  ))
  const blocked = Boolean(facts.clan_match_missing || facts.clan_application_blocked || facts.clan_identity_conflict)
  const complete = identity && clanHandled && !outstanding && !blocked
  const status = complete ? 'complete' : 'active'
  const pendingCaptureStep = captureStep(lane, {
    ...facts,
    game_tag: identity ? clean(facts.game_tag, 48) || 'confirmed' : '',
  })
  const currentStep = complete
    ? 'complete'
    : pendingCaptureStep === 'video'
      ? (clanNamed || !clanNeeded ? 'identity' : 'clan')
      : pendingCaptureStep
  await db.query(
    `update member_onboarding set status=$2,current_step=$3,
       completed_at=case when $2='complete' then coalesce(completed_at,now()) else null end,
       updated_at=now() where user_id=$1`,
    [userId, status, currentStep],
  )
}

function disputeShape(row: any, viewerId: string, host: boolean): Record<string, unknown> {
  const currentOwnerId = row.current_owner_id ? String(row.current_owner_id) : null
  const challengerId = String(row.challenger_id)
  const role = host ? 'admin' : currentOwnerId === viewerId ? 'current_owner' : 'challenger'
  return {
    id: String(row.id),
    kind: String(row.kind),
    subject_key: String(row.subject_key),
    status: String(row.status),
    freeze_state: String(row.freeze_state),
    current_owner: currentOwnerId ? {
      id: currentOwnerId,
      username: row.current_owner_username ? String(row.current_owner_username) : null,
    } : null,
    challenger: {
      id: challengerId,
      username: row.challenger_username ? String(row.challenger_username) : null,
    },
    evidence: jsonObject(row.evidence),
    reviewer_id: row.reviewer_id ? String(row.reviewer_id) : null,
    resolution_note: row.resolution_note ? String(row.resolution_note) : null,
    resolved_at: row.resolved_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    viewer_role: role,
    can_resolve: row.status === 'open' && (host || currentOwnerId === viewerId),
  }
}

async function disputeWithProfiles(db: OnboardingPool, disputeId: string): Promise<any | null> {
  return one(
    db,
    `select d.*,owner.username as current_owner_username,
            challenger.username as challenger_username
       from identity_claim_disputes d
       left join profiles owner on owner.id=d.current_owner_id
       left join profiles challenger on challenger.id=d.challenger_id
      where d.id=$1`,
    [disputeId],
  )
}

async function updateDisputedActionResult(
  db: OnboardingPool,
  challengerId: string,
  disputeId: string,
  status: string,
): Promise<void> {
  const actions = (await db.query(
    `select id,result from onboarding_actions
      where user_id=$1 and status='done' and kind in ('connect_youtube','claim_clan','create_clan')`,
    [challengerId],
  )).rows
  for (const action of actions) {
    const result = jsonObject(action.result)
    if (String(result.dispute_id || '') !== disputeId) continue
    await db.query(
      'update onboarding_actions set result=$2::jsonb,updated_at=now() where id=$1',
      [action.id, JSON.stringify({ ...result, status, resolution: status })],
    )
  }
}

async function resolveYouTubeDispute(
  db: OnboardingPool,
  dispute: any,
  approve: boolean,
  reviewerIsHost: boolean,
): Promise<void> {
  const channelId = clean(dispute.subject_key, 100)
  if (!CHANNEL_ID_RE.test(channelId)) throw Object.assign(new Error('invalid_dispute_subject'), { status: 409 })
  const evidence = jsonObject(dispute.evidence)
  const challengerId = String(dispute.challenger_id)
  const currentOwnerId = dispute.current_owner_id ? String(dispute.current_owner_id) : null
  const channelUrl = clean(evidence.channel_url, 500) || `https://www.youtube.com/channel/${channelId}`
  const channelTitle = clean(evidence.channel_title, 200) || null

  if (!approve) {
    await db.query(
      `update onboarding_video_reports set status='rejected',updated_at=now()
        where user_id=$1 and channel_id=$2`,
      [challengerId, channelId],
    )
    const activeLinks = (await db.query(
      `select id,url,title,channel_id from user_youtube_links
        where user_id=$1 and claim_status='claimed' order by created_at desc`,
      [challengerId],
    )).rows
    const active = activeLinks.find((row) => isYouTubeChannelPage(row.url)) || null
    if (active) {
      await patchStateFacts(db, challengerId, {
        youtube_claim_status: 'claimed',
        youtube_channel_id: clean(active.channel_id, 100),
        youtube_channel_url: clean(active.url, 500),
        youtube_channel_title: clean(active.title, 200),
      }, ['youtube_dispute_id'])
    } else {
      await patchStateFacts(db, challengerId, { youtube_claim_status: 'rejected' }, [
        'youtube_dispute_id', 'youtube_channel_id', 'youtube_channel_url', 'youtube_channel_title',
        'youtube_video_id', 'youtube_video_url',
      ])
    }
    return
  }

  const thirdParty = await one(
    db,
    `select user_id from user_youtube_links
      where user_id<>$1 and ($2::uuid is null or user_id<>$2) and (
          channel_id=$3 or lower(url)=lower($4) or lower(url)=lower($5)
        ) limit 1`,
    [challengerId, currentOwnerId, channelId, channelUrl, `https://www.youtube.com/channel/${channelId}`],
  )
  if (thirdParty) throw Object.assign(new Error('channel_ownership_changed'), { status: 409 })

  let currentOwnerClaims: any[] = []
  if (currentOwnerId) {
    currentOwnerClaims = (await db.query(
      `select id,url,channel_id from user_youtube_links
        where user_id=$1 and (
          channel_id=$2 or lower(url)=lower($3) or lower(url)=lower($4)
        )`,
      [currentOwnerId, channelId, channelUrl, `https://www.youtube.com/channel/${channelId}`],
    )).rows
    if (!currentOwnerClaims.length && !reviewerIsHost) {
      throw Object.assign(new Error('channel_ownership_changed'), { status: 409 })
    }
    for (const row of currentOwnerClaims) {
      await db.query('delete from user_youtube_links where id=$1 and user_id=$2', [row.id, currentOwnerId])
    }
    const ownerAccount = await one(db, 'select user_metadata from users where id=$1', [currentOwnerId])
    const ownerMetadata = jsonObject(ownerAccount?.user_metadata)
    const ownerYoutubeUrl = clean(ownerMetadata.youtube_url, 500)
    if (ownerYoutubeUrl && (ownerYoutubeUrl.toLowerCase() === channelUrl.toLowerCase()
      || ownerYoutubeUrl.toLowerCase() === `https://www.youtube.com/channel/${channelId}`.toLowerCase())) {
      delete ownerMetadata.youtube_url
      await db.query('update users set user_metadata=$2::jsonb where id=$1', [currentOwnerId, JSON.stringify(ownerMetadata)])
    }
  }

  const challengerLinks = (await db.query(
    'select id,url,channel_id from user_youtube_links where user_id=$1 order by created_at desc',
    [challengerId],
  )).rows
  let link = challengerLinks.find((row) => isYouTubeChannelPage(row.url) && (
    String(row.channel_id || '') === channelId || String(row.url || '').toLowerCase() === channelUrl.toLowerCase()
  ))
  if (link) {
    await db.query(
      `update user_youtube_links set url=$2,title=$3,channel_id=$4,claim_status='claimed',
         claim_method='ownership_transfer',claimed_at=coalesce(claimed_at,now()) where id=$1`,
      [link.id, channelUrl, channelTitle, channelId],
    )
  } else {
    link = (await db.query(
      `insert into user_youtube_links
         (user_id,url,title,channel_id,claim_status,claim_method,claimed_at)
       values ($1,$2,$3,$4,'claimed','ownership_transfer',now()) returning id`,
      [challengerId, channelUrl, channelTitle, channelId],
    )).rows[0]
  }
  for (const prior of challengerLinks) {
    if (String(prior.id) !== String(link.id) && isYouTubeChannelPage(prior.url)) {
      await db.query('delete from user_youtube_links where id=$1 and user_id=$2', [prior.id, challengerId])
    }
  }
  const challengerAccount = await one(db, 'select user_metadata from users where id=$1', [challengerId])
  const challengerMetadata = jsonObject(challengerAccount?.user_metadata)
  challengerMetadata.youtube_url = channelUrl
  await db.query('update users set user_metadata=$2::jsonb where id=$1', [challengerId, JSON.stringify(challengerMetadata)])
  await db.query(
    `update onboarding_video_reports set status=case when channel_id=$2 then 'connected' else
       case when status='connected' then 'superseded' else status end end,updated_at=now()
      where user_id=$1`,
    [challengerId, channelId],
  )
  await patchStateFacts(db, challengerId, {
    youtube_claim_status: 'claimed', youtube_channel_id: channelId,
    youtube_channel_url: channelUrl, youtube_channel_title: channelTitle || '',
  }, ['youtube_dispute_id'])
}

async function resolveClanDispute(
  db: OnboardingPool,
  dispute: any,
  approve: boolean,
  reviewerIsHost: boolean,
): Promise<void> {
  const serverId = clean(dispute.subject_key, 50)
  if (!UUID_RE.test(serverId)) throw Object.assign(new Error('invalid_dispute_subject'), { status: 409 })
  const challengerId = String(dispute.challenger_id)
  const currentOwnerId = dispute.current_owner_id ? String(dispute.current_owner_id) : null
  if (!approve) {
    await patchStateFacts(db, challengerId, { clan_claim_status: 'rejected' }, ['clan_dispute_id', 'clan_id'])
    return
  }
  const clan = await one(db, "select id,name,owner_id from servers where id=$1 and kind='clan' for update", [serverId])
  if (!clan) throw Object.assign(new Error('clan_not_found'), { status: 409 })
  const ownerNow = clan.owner_id ? String(clan.owner_id) : null
  if (!reviewerIsHost && ownerNow !== currentOwnerId && !(ownerNow === null && currentOwnerId)) {
    throw Object.assign(new Error('clan_ownership_changed'), { status: 409 })
  }
  if (reviewerIsHost && ownerNow && ownerNow !== currentOwnerId && ownerNow !== challengerId) {
    throw Object.assign(new Error('clan_ownership_changed'), { status: 409 })
  }
  await db.query('update servers set owner_id=$2 where id=$1', [serverId, challengerId])
  await ensureClanMembership(db, serverId, challengerId, 'leader')
  await db.query('update clan_members set role=$3 where server_id=$1 and user_id=$2', [serverId, challengerId, 'leader'])
  await db.query('update server_members set role=$3 where server_id=$1 and user_id=$2', [serverId, challengerId, 'leader'])
  if (currentOwnerId && currentOwnerId !== challengerId) {
    await db.query('update clan_members set role=$3 where server_id=$1 and user_id=$2', [serverId, currentOwnerId, 'member'])
    await db.query('update server_members set role=$3 where server_id=$1 and user_id=$2', [serverId, currentOwnerId, 'member'])
  }
  await patchStateFacts(db, challengerId, {
    clan_id: serverId, clan_name: String(clan.name), clan_claim_status: 'owned',
  }, ['clan_dispute_id'])
}

function routeError(res: Response, error: any): Response {
  const status = Number(error?.status) || 500
  if (status >= 500) console.error('[onboarding]', error)
  return res.status(status).json({ error: clean(error?.message || 'onboarding_request_failed', 240) })
}

export function installOnboardingRoutes(deps: OnboardingRouteDeps): void {
  const { router, auth, pool } = deps
  const videoResolver = deps.resolveVideo || ((url: string) => resolveOnboardingVideo(url))

  const conflict = async (res: Response, userId: string): Promise<Response> => {
    const envelope = await readEnvelope(pool, userId)
    return res.status(409).json({ error: 'revision_conflict', ...envelope })
  }

  router.get('/onboarding', auth, async (req, res) => {
    try { return res.json(await readEnvelope(pool, deps.uid(req))) } catch (error) { return routeError(res, error) }
  })

  router.get('/onboarding/disputes', auth, async (req, res) => {
    const userId = deps.uid(req)
    try {
      const actor = await deps.loadActor?.(req)
      const host = actor?.host === true
      const rows = (await pool.query(
        `select d.*,owner.username as current_owner_username,
                challenger.username as challenger_username
           from identity_claim_disputes d
           left join profiles owner on owner.id=d.current_owner_id
           left join profiles challenger on challenger.id=d.challenger_id
          where $2=true or d.current_owner_id=$1 or d.challenger_id=$1
          order by d.created_at desc,d.id desc`,
        [userId, host],
      )).rows
      return res.json({ disputes: rows.map((row) => disputeShape(row, userId, host)) })
    } catch (error) { return routeError(res, error) }
  })

  router.post('/onboarding/disputes/:id/resolve', auth, async (req, res) => {
    const userId = deps.uid(req)
    const disputeId = String(req.params.id || '')
    const decision = clean(req.body?.decision, 20).toLowerCase()
    const note = clean(req.body?.note, 1000)
    if (!UUID_RE.test(disputeId)) return res.status(400).json({ error: 'valid_dispute_id_required' })
    if (!['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'decision_must_be_approve_or_reject' })
    }
    try {
      const actor = await deps.loadActor?.(req)
      const host = actor?.host === true
      const resolved = await deps.withTransaction(async (db) => {
        const dispute = await one(db, 'select * from identity_claim_disputes where id=$1 for update', [disputeId])
        if (!dispute) throw Object.assign(new Error('ownership_dispute_not_found'), { status: 404 })
        if (String(dispute.status) !== 'open') {
          throw Object.assign(new Error('ownership_dispute_already_resolved'), { status: 409 })
        }
        if (!host && String(dispute.current_owner_id || '') !== userId) {
          throw Object.assign(new Error('ownership_dispute_reviewer_required'), { status: 403 })
        }

        const approve = decision === 'approve'
        if (dispute.kind === 'youtube_channel') {
          await resolveYouTubeDispute(db, dispute, approve, host)
        } else if (dispute.kind === 'clan') {
          await resolveClanDispute(db, dispute, approve, host)
        } else {
          throw Object.assign(new Error('unsupported_dispute_kind'), { status: 409 })
        }
        const actionStatus = approve
          ? dispute.kind === 'youtube_channel' ? 'claimed' : 'owned'
          : 'rejected'
        await updateDisputedActionResult(db, String(dispute.challenger_id), disputeId, actionStatus)
        const updated = (await db.query(
          `update identity_claim_disputes
              set status=$2,freeze_state='released',reviewer_id=$3,resolution_note=$4,
                  resolved_at=now(),updated_at=now()
            where id=$1 returning *`,
          [disputeId, approve ? 'transferred' : 'rejected', userId, note || null],
        )).rows[0]
        await db.query(
          `insert into notifications (user_id,kind,title,body,link,related_id,actor_id)
           values ($1,'identity_claim_resolved',$2,$3,'/settings',$4,$5)`,
          [dispute.challenger_id,
            approve ? 'Your ownership claim was approved' : 'Your ownership claim was rejected',
            note || (approve ? 'The ownership record has been transferred.' : 'The current ownership record was preserved.'),
            disputeId, userId],
        )
        if (host && dispute.current_owner_id && String(dispute.current_owner_id) !== userId) {
          await db.query(
            `insert into notifications (user_id,kind,title,body,link,related_id,actor_id)
             values ($1,'identity_claim_resolved',$2,$3,'/settings',$4,$5)`,
            [dispute.current_owner_id,
              approve ? 'An ownership claim was approved' : 'An ownership claim was rejected',
              note || (approve ? 'The ownership record has been transferred.' : 'Your current ownership record was preserved.'),
              disputeId, userId],
          )
        }
        await refreshStateAfterActions(db, String(dispute.challenger_id))
        return updated
      })
      const detailed = await disputeWithProfiles(pool, disputeId) || resolved
      return res.json({ dispute: disputeShape(detailed, userId, host) })
    } catch (error) { return routeError(res, error) }
  })

  router.post('/onboarding/defer', auth, async (req, res) => {
    const userId = deps.uid(req)
    const revision = Number(req.body?.revision)
    if (!Number.isInteger(revision) || revision < 0) return res.status(400).json({ error: 'revision_required' })
    try {
      const changed = await deps.withTransaction(async (db) => {
        await ensureState(db, userId)
        return (await db.query(
          `update member_onboarding set revision=revision+1,status='deferred',current_step='deferred',
             deferred_until=$3,updated_at=now() where user_id=$1 and revision=$2 returning user_id`,
          [userId, revision, new Date(deps.now().getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()],
        )).rows[0]
      })
      if (!changed) return conflict(res, userId)
      return res.json(await readEnvelope(pool, userId))
    } catch (error) { return routeError(res, error) }
  })

  router.post('/onboarding/turn', auth, async (req, res) => {
    const userId = deps.uid(req)
    const text = clean(req.body?.text, 2000)
    const revision = Number(req.body?.revision)
    if (!text) return res.status(400).json({ error: 'text_required' })
    if (!Number.isInteger(revision) || revision < 0) return res.status(400).json({ error: 'revision_required' })
    try {
      const current = await ensureState(pool, userId)
      if (Number(current.revision || 0) !== revision) return conflict(res, userId)
      const deterministic = parseOnboardingText(text)
      const explicitSolo = explicitlyDeclinesClan(text)
      const currentFacts = jsonObject(current.facts)
      const parsedFacts = safeFacts(deterministic.facts)
      // A deterministic multi-turn session still understands short, natural
      // answers. The active state disambiguates "KageOne" (the requested gamer
      // tag) from "Hidden Blood" (the clan name requested next).
      const currentLane = safeLane(current.lane)
      if (current.status !== 'new' && !safeLane(deterministic.lane) && !Object.keys(parsedFacts).length) {
        const bareIdentity = confidentBareName(text, 48)
        const bareClan = confidentBareName(text, 32)
        if (!clean(currentFacts.game_tag, 48) && bareIdentity) {
          parsedFacts.game_tag = bareIdentity
        } else if ((currentLane === 'member' || currentLane === 'leader')
          && !clean(currentFacts.clan_name, 32)
          && bareClan) {
          parsedFacts.clan_name = bareClan
        }
      }
      let interpreted: OnboardingInterpretation | null = null
      // Flash sees every meaningful chat turn so natural phrasing works. The
      // deterministic parser remains the fail-safe when Vertex is unavailable,
      // and wins on any fact it understood directly.
      if (deps.interpretText) {
        try {
          interpreted = await deps.interpretText(text, currentFacts, {
            lane: currentLane,
            current_step: String(current.current_step || 'identity'),
          })
        } catch { interpreted = null }
      }
      const modelFacts = safeFacts(interpreted?.facts)
      // Sensitive identifiers must appear in the player's raw message. This
      // prevents a model guess from becoming an identity or clan mutation.
      for (const key of ['game_tag', 'clan_name', 'clan_tag']) {
        if (modelFacts[key] && !textExplicitlyIncludes(text, modelFacts[key])) delete modelFacts[key]
      }
      if (explicitSolo) {
        for (const key of ['clan_name', 'clan_tag']) {
          delete parsedFacts[key]
          delete modelFacts[key]
        }
      }
      const lane = explicitSolo ? 'solo' : safeLane(deterministic.lane) || safeLane(interpreted?.lane)
      const interpretedRoles = safeRoles([...(deterministic.roles || []), ...(interpreted?.roles || [])])
      const roles = explicitSolo
        ? safeRoles(interpretedRoles.filter((role) => !['member', 'leader'].includes(role)).concat('solo'))
        : interpretedRoles
      const explicitIdentity = Boolean(parsedFacts.game_tag || modelFacts.game_tag)
      const explicitClan = !explicitSolo && Boolean(parsedFacts.clan_name || modelFacts.clan_name)
      const meaningful = Boolean(lane || roles.length || Object.keys(parsedFacts).length || Object.keys(modelFacts).length)
      // A model outage or an ambiguous sentence should not advance the
      // revision, create an action, or turn arbitrary prose into a name.
      if (!meaningful) return res.json(await readEnvelope(pool, userId))

      let immediateActionIds: string[] = []

      const changed = await deps.withTransaction(async (db) => {
        const state = await ensureState(db, userId)
        const reserved = await db.query(
          `update member_onboarding set revision=revision+1,updated_at=now()
            where user_id=$1 and revision=$2 returning *`,
          [userId, revision],
        )
        if (!reserved.rows[0]) return false
        const priorFacts = jsonObject(state.facts)
        const correctedClanName = clean(parsedFacts.clan_name ?? modelFacts.clan_name, 32)
        if (correctedClanName && correctedClanName.toLowerCase() !== clean(priorFacts.clan_name, 32).toLowerCase()) {
          await withdrawOnboardingApplication(db, userId, priorFacts.clan_application_id)
          for (const key of ['clan_id', 'clan_match_missing', 'clan_application_status',
            'clan_application_id', 'clan_application_blocked', 'clan_join_fee_tokens',
            'clan_identity_conflict', 'clan_claim_status', 'clan_dispute_id', 'roster_id']) delete priorFacts[key]
          await db.query(
            `delete from onboarding_actions where user_id=$1
              and kind in ('create_clan','claim_clan','apply_clan','create_roster')
              and status in ('proposed','failed')`,
            [userId],
          )
        }
        const facts = { ...priorFacts, ...modelFacts, ...parsedFacts }
        const nextLane = lane || safeLane(state.lane)
        let nextRoles = safeRoles([...jsonArray(state.roles).map(String), ...roles])
        if (nextLane === 'solo' && explicitSolo) {
          await withdrawOnboardingApplication(db, userId, facts.clan_application_id)
          for (const key of ['clan_id', 'clan_name', 'clan_tag', 'clan_match_missing',
            'clan_application_status', 'clan_application_id', 'clan_claim_status', 'clan_dispute_id',
            'clan_application_blocked', 'clan_join_fee_tokens', 'clan_identity_conflict', 'roster_id']) delete facts[key]
          nextRoles = safeRoles(nextRoles.filter((role) => !['member', 'leader'].includes(role)).concat('solo'))
          await db.query(
            `delete from onboarding_actions where user_id=$1
              and kind in ('create_clan','claim_clan','apply_clan','create_roster')
              and status in ('proposed','failed')`,
            [userId],
          )
        } else if (nextLane === 'member') {
          await db.query(
            `delete from onboarding_actions where user_id=$1 and kind in ('create_clan','claim_clan','create_roster')
              and status in ('proposed','failed')`,
            [userId],
          )
        }
        const proposed = await proposeFromFacts(db, userId, nextLane, facts)
        const actionable = proposed.filter((action) => ['proposed', 'failed'].includes(String(action.status)))
        if (explicitIdentity) {
          immediateActionIds.push(...actionable.filter((action) => action.kind === 'update_identity').map((action) => String(action.id)))
        }
        if (explicitClan) {
          immediateActionIds.push(...actionable.filter((action) => action.kind === 'apply_clan').map((action) => String(action.id)))
          const create = actionable.find((action) => action.kind === 'create_clan')
          if (create) {
            immediateActionIds.push(String(create.id))
            immediateActionIds.push(...actionable.filter((action) => action.kind === 'create_roster').map((action) => String(action.id)))
          }
          const strictOwnershipStatement = nextLane === 'leader'
            && textExplicitlyIncludes(text, facts.clan_name)
            && /\b(?:i\s+)?(?:run|lead|own|founded)|\b(?:founder|kage)(?:\s+of)?\b/i.test(text)
          if (strictOwnershipStatement) {
            immediateActionIds.push(...actionable.filter((action) => action.kind === 'claim_clan').map((action) => String(action.id)))
          }
        }
        const history = [...jsonArray(state.history), { role: 'user', text, at: deps.now().toISOString() }].slice(-12)
        await db.query(
          `update member_onboarding set status='active',current_step=$2,lane=$3,roles=$4::jsonb,
             facts=$5::jsonb,history=$6::jsonb,deferred_until=null,completed_at=null,updated_at=now()
            where user_id=$1`,
          [userId, captureStep(nextLane, facts), nextLane, JSON.stringify(nextRoles),
            JSON.stringify(facts), JSON.stringify(history)],
        )
        return true
      })
      if (!changed) return conflict(res, userId)
      await executeActionIds(deps, userId, immediateActionIds.filter((id, index, all) => all.indexOf(id) === index))
      return res.json(await readEnvelope(pool, userId))
    } catch (error) { return routeError(res, error) }
  })

  router.post('/onboarding/video', auth, async (req, res) => {
    const userId = deps.uid(req)
    const revision = Number(req.body?.revision)
    const rawUrl = clean(req.body?.url, 1000)
    if (!Number.isInteger(revision) || revision < 0) return res.status(400).json({ error: 'revision_required' })
    if (!normalizeGameplayVideoUrl(rawUrl)) return res.status(400).json({ error: 'full_youtube_video_required' })
    try {
      const metadata = await videoResolver(rawUrl)
      if (!CHANNEL_ID_RE.test(metadata.channelId) || !normalizeGameplayVideoUrl(metadata.videoUrl)) {
        throw Object.assign(new Error('invalid_youtube_metadata'), { status: 422 })
      }
      const changed = await deps.withTransaction(async (db) => {
        const state = await ensureState(db, userId)
        const reserved = await db.query(
          `update member_onboarding set revision=revision+1,updated_at=now()
            where user_id=$1 and revision=$2 returning user_id`,
          [userId, revision],
        )
        if (!reserved.rows[0]) return false
        const currentReport = await one(db, 'select id from onboarding_video_reports where user_id=$1 and video_id=$2', [userId, metadata.videoId])
        if (currentReport) {
          await db.query(
            `update onboarding_video_reports set video_url=$3,channel_id=$4,channel_url=$5,
               channel_title=$6,video_title=$7,thumbnail_url=$8,status='resolved',error=null,updated_at=now()
              where user_id=$1 and video_id=$2`,
            [userId, metadata.videoId, metadata.videoUrl, metadata.channelId, metadata.channelUrl,
              metadata.channelTitle, metadata.videoTitle, metadata.thumbnailUrl],
          )
        } else {
          await db.query(
            `insert into onboarding_video_reports
               (user_id,video_url,video_id,channel_id,channel_url,channel_title,video_title,thumbnail_url,status)
             values ($1,$2,$3,$4,$5,$6,$7,$8,'resolved')`,
            [userId, metadata.videoUrl, metadata.videoId, metadata.channelId, metadata.channelUrl,
              metadata.channelTitle, metadata.videoTitle, metadata.thumbnailUrl],
          )
        }
        await proposeAction(db, userId, 'connect_youtube', 'youtube-connection',
          `Connect ${metadata.channelTitle}`, {
            video_url: metadata.videoUrl, video_id: metadata.videoId, video_title: metadata.videoTitle,
            thumbnail_url: metadata.thumbnailUrl, channel_id: metadata.channelId,
            channel_url: metadata.channelUrl, channel_title: metadata.channelTitle,
          })
        const facts = {
          ...jsonObject(state.facts),
          youtube_video_url: metadata.videoUrl,
          youtube_video_id: metadata.videoId,
          youtube_channel_id: metadata.channelId,
          youtube_channel_url: metadata.channelUrl,
          youtube_channel_title: metadata.channelTitle,
          youtube_claim_status: 'proposed',
        }
        await db.query(
          `update member_onboarding set status='ready',current_step='review',facts=$2::jsonb,
             deferred_until=null,updated_at=now() where user_id=$1`,
          [userId, JSON.stringify(facts)],
        )
        return true
      })
      if (!changed) return conflict(res, userId)
      // YouTube is an optional post-onboarding connection. Recording a video
      // proposal must not reopen an identity+clan conversation that is done.
      await refreshStateAfterActions(pool, userId)
      return res.json(await readEnvelope(pool, userId))
    } catch (error) { return routeError(res, error) }
  })

  const confirm = async (
    req: Request,
    res: Response,
    selected: string[] | null,
    dismissUnselected: boolean,
  ): Promise<Response> => {
    const userId = deps.uid(req)
    const revision = Number(req.body?.revision)
    if (!Number.isInteger(revision) || revision < 0) return res.status(400).json({ error: 'revision_required' })
    if (selected && selected.some((id) => !UUID_RE.test(id))) return res.status(400).json({ error: 'valid_action_ids_required' })
    try {
      if (selected) {
        for (const actionId of selected) {
          if (!await one(pool, 'select id from onboarding_actions where id=$1 and user_id=$2', [actionId, userId])) {
            return res.status(404).json({ error: 'onboarding_action_not_found' })
          }
        }
      }
      const reserved = await deps.withTransaction(async (db) => {
        await ensureState(db, userId)
        return (await db.query(
          `update member_onboarding set revision=revision+1,status='active',deferred_until=null,updated_at=now()
            where user_id=$1 and revision=$2 returning user_id`,
          [userId, revision],
        )).rows[0]
      })
      if (!reserved) return conflict(res, userId)

      let rows = (await pool.query(
        `select * from onboarding_actions where user_id=$1 and status in ('proposed','failed','confirmed')`,
        [userId],
      )).rows
      if (selected) {
        const selectedSet = new Set(selected)
        if (dismissUnselected) {
          for (const row of rows) {
            if (selectedSet.has(String(row.id))) continue
            await pool.query(
              `update onboarding_actions set status='done',result=$2::jsonb,error=null,
                 completed_at=now(),updated_at=now() where id=$1 and user_id=$3`,
              [row.id, JSON.stringify({ skipped: true }), userId],
            )
          }
        }
        rows = rows.filter((row) => selectedSet.has(String(row.id)))
      }
      rows.sort((a, b) => (ACTION_PRIORITY[a.kind] || 999) - (ACTION_PRIORITY[b.kind] || 999))
      for (const row of rows) {
        try {
          let postCommitPush: {
            user_ids: string[]; title: string; body: string; url: string; tag?: string
          } | null = null
          await deps.withTransaction(async (db) => {
            const action = await one(db, 'select * from onboarding_actions where id=$1 and user_id=$2 for update', [row.id, userId])
            if (!action || action.status === 'done') return
            await db.query(
              `update onboarding_actions set status='processing',confirmed_at=coalesce(confirmed_at,now()),
                 error=null,updated_at=now() where id=$1`,
              [row.id],
            )
            const result = await executeAction(db, userId, action, deps.now())
            const internalPush = jsonObject(result.__post_commit_push)
            delete result.__post_commit_push
            const pushIds = Array.isArray(internalPush.user_ids)
              ? [...new Set(internalPush.user_ids.map(String).filter((id) => UUID_RE.test(id)))]
              : []
            if (pushIds.length) {
              postCommitPush = {
                user_ids: pushIds,
                title: clean(internalPush.title, 180),
                body: clean(internalPush.body, 300),
                url: clean(internalPush.url, 500),
                ...(clean(internalPush.tag, 180) ? { tag: clean(internalPush.tag, 180) } : {}),
              }
            }
            await db.query(
              `update onboarding_actions set status='done',result=$2::jsonb,error=null,
                 completed_at=now(),updated_at=now() where id=$1`,
              [row.id, JSON.stringify(result)],
            )
          })
          // Device delivery begins only after the application/action commit is
          // durable. Push is fail-soft: a provider outage cannot roll back or
          // relabel an application that leadership can already see in-app.
          if (postCommitPush && deps.pushUsers) {
            try {
              await deps.pushUsers(postCommitPush.user_ids, postCommitPush)
            } catch { /* the in-app notifications remain the durable fallback */ }
          }
        } catch (error: any) {
          await pool.query(
            `update onboarding_actions set status='failed',error=$2,updated_at=now()
              where id=$1 and user_id=$3 and status<>'done'`,
            [row.id, clean(error?.message || 'action_failed', 240), userId],
          )
        }
      }
      await refreshStateAfterActions(pool, userId)
      return res.json(await readEnvelope(pool, userId))
    } catch (error) { return routeError(res, error) }
  }

  router.post('/onboarding/actions/confirm-selected', auth, (req, res) => {
    const supplied = req.body?.action_ids
    const selected = supplied == null ? null : Array.isArray(supplied) ? supplied.map(String) : []
    void confirm(req, res, selected, true)
  })

  router.post('/onboarding/actions/:id/confirm', auth, (req, res) => {
    void confirm(req, res, [String(req.params.id || '')], false)
  })
}
