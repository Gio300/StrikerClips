import { randomBytes, randomUUID } from 'node:crypto'
import type { NextFunction, Request, RequestHandler, Response, Router } from 'express'
import type { RosterInviteEmail } from './authEmail'

type QueryResult = { rows: any[] }
export type OrganizerPool = {
  query: (text: string, params?: any[]) => Promise<QueryResult>
}

export type OrganizerActor = {
  id: string
  host: boolean
  tier: string
}

type PushPayload = {
  title: string
  body: string
  url: string
  tag?: string
}

export interface OrganizerRouteDeps {
  router: Router
  pool: OrganizerPool
  auth: RequestHandler
  uid: (req: Request) => string
  loadActor: (req: Request) => Promise<OrganizerActor | null>
  isClanManager: (pool: OrganizerPool, actor: OrganizerActor, serverId: string) => Promise<boolean>
  isClanMember: (pool: OrganizerPool, actor: OrganizerActor, serverId: string) => Promise<boolean>
  isTournamentHost: (pool: OrganizerPool, actor: OrganizerActor, tournamentId: string) => Promise<boolean>
  withTransaction: <T>(fn: (db: OrganizerPool) => Promise<T>) => Promise<T>
  hashInviteToken: (raw: string) => string
  publicOrigin: (req: Request) => string
  brandName: (req: Request) => Promise<string>
  sendRosterInviteEmail: (message: RosterInviteEmail) => Promise<void>
  pushUsers: (userIds: string[], payload: PushPayload) => Promise<void>
  sellerTier: (userId: string) => Promise<'pro' | 'supporter' | 'creator' | null>
  isAllowedPrice: (priceCents: number) => boolean
  now: () => Date
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MEMBER_ROLES = new Set(['captain', 'starter', 'substitute', 'coach'])
const REVIEW_ROLES = new Set(['leader', 'officer', 'recruiter'])

const one = async (db: OrganizerPool, sql: string, params: any[] = []): Promise<any | null> =>
  (await db.query(sql, params)).rows[0] ?? null

const userBelongsToClan = async (db: OrganizerPool, userId: string, serverId: string): Promise<boolean> => {
  const server = await one(db, 'select owner_id from servers where id=$1', [serverId])
  if (String(server?.owner_id || '') === userId) return true
  if (await one(db, 'select 1 from clan_members where server_id=$1 and user_id=$2', [serverId, userId])) return true
  return !!(await one(db, 'select 1 from server_members where server_id=$1 and user_id=$2', [serverId, userId]))
}

const userBelongsToVillage = async (db: OrganizerPool, userId: string, villageId: string): Promise<boolean> => {
  const clans = await db.query('select server_id from village_clans where village_id=$1', [villageId])
  for (const clan of clans.rows) {
    if (await userBelongsToClan(db, userId, String(clan.server_id))) return true
  }
  return false
}

const cleanText = (value: unknown, max: number): string =>
  String(value ?? '').trim().slice(0, max)

const memberRole = (value: unknown): string => {
  const role = cleanText(value, 20).toLowerCase()
  return MEMBER_ROLES.has(role) ? role : 'starter'
}

const jsonValue = <T>(value: unknown, fallback: T): T => {
  if (value && typeof value === 'object') return value as T
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  return fallback
}

export type TournamentPackBenefits = {
  roster_changes: number
  unlimited_roster_changes: boolean
  artifact_slots: number
}

export function sanitizeTournamentPackBenefits(value: unknown): TournamentPackBenefits {
  const raw = jsonValue<Record<string, unknown>>(value, {})
  const rosterChanges = Math.max(0, Math.min(25, Math.floor(Number(raw.roster_changes) || 0)))
  const unlimitedRosterChanges = raw.unlimited_roster_changes === true
  const artifactSlots = Math.max(0, Math.min(12, Math.floor(Number(raw.artifact_slots) || 0)))
  return {
    roster_changes: unlimitedRosterChanges ? 0 : rosterChanges,
    unlimited_roster_changes: unlimitedRosterChanges,
    artifact_slots: artifactSlots,
  }
}

type PerkSource = {
  pack: any
  sourceKind: 'purchase' | 'artifact' | 'grant'
  sourceRef: string
  allowance: number
  unlimited: boolean
  used: number
  remaining: number
}

async function profileName(db: OrganizerPool, userId: string): Promise<string> {
  const profile = await one(db, 'select username from profiles where id=$1', [userId])
  return cleanText(profile?.username || 'A player', 80)
}

async function notify(
  db: OrganizerPool,
  input: {
    userId: string
    kind: string
    title: string
    body?: string | null
    link: string
    relatedId?: string | null
    actorId?: string | null
  },
): Promise<void> {
  await db.query(
    `insert into notifications (user_id,kind,title,body,link,related_id,actor_id)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      input.userId,
      input.kind,
      cleanText(input.title, 180),
      input.body ? cleanText(input.body, 800) : null,
      input.link,
      input.relatedId || null,
      input.actorId || null,
    ],
  )
}

async function clanRecruiterIds(db: OrganizerPool, serverId: string): Promise<string[]> {
  const clan = await one(db, 'select owner_id from servers where id=$1', [serverId])
  const members = await db.query(
    `select user_id from clan_members
      where server_id=$1 and role in ('leader','officer','recruiter')`,
    [serverId],
  )
  return [...new Set([
    clan?.owner_id ? String(clan.owner_id) : '',
    ...members.rows.map((row) => String(row.user_id)),
  ].filter(Boolean))]
}

async function canRecruitForClan(
  db: OrganizerPool,
  actor: OrganizerActor,
  serverId: string,
): Promise<boolean> {
  if (actor.host) return true
  const clan = await one(db, 'select owner_id from servers where id=$1', [serverId])
  if (clan && String(clan.owner_id) === actor.id) return true
  const member = await one(
    db,
    'select role from clan_members where server_id=$1 and user_id=$2',
    [serverId, actor.id],
  )
  return REVIEW_ROLES.has(String(member?.role || ''))
}

async function clanMemberCount(db: OrganizerPool, serverId: string): Promise<number> {
  const count = await one(db, 'select count(*)::int as n from clan_members where server_id=$1', [serverId])
  return Number(count?.n || 0)
}

async function chargeClanJoin(
  db: OrganizerPool,
  clan: any,
  userId: string,
  feeSnapshot: number,
): Promise<{ charged: number; clanShare: number; platformShare: number }> {
  const currentPrice = Math.max(0, Math.round(Number(clan.join_fee_tokens) || 0))
  const charged = Math.min(currentPrice, Math.max(0, Math.round(feeSnapshot)))
  if (charged === 0) return { charged: 0, clanShare: 0, platformShare: 0 }
  await db.query(
    `insert into wallets (user_id,tokens,sweeps,paid_sweeps_cents,created_at,updated_at)
     values ($1,0,0,0,now(),now()) on conflict (user_id) do nothing`,
    [userId],
  )
  const debit = await db.query(
    `update wallets set tokens=tokens-cast($2 as integer), updated_at=now()
      where user_id=$1 and tokens >= cast($2 as integer) returning tokens`,
    [userId, charged],
  )
  if (!debit.rows[0]) throw Object.assign(new Error('applicant_insufficient_tokens'), { status: 409 })
  const platformShare = Math.round(charged * 0.2)
  const clanShare = charged - platformShare
  await db.query(
    `insert into wallet_ledger
       (user_id,kind,tokens_delta,event,status,reason,ref_id)
     values ($1,'clan_dues',$2,$3,'Paid','join fee',$4)`,
    [userId, -charged, cleanText(clan.name || 'Clan', 120), String(clan.id)],
  )
  await db.query(
    'update servers set treasury_tokens=coalesce(treasury_tokens,0)+$2 where id=$1',
    [clan.id, clanShare],
  )
  await db.query(
    `insert into clan_dues_payments
       (server_id,user_id,kind,gross_tokens,clan_tokens,platform_tokens)
     values ($1,$2,'join',$3,$4,$5)`,
    [clan.id, userId, charged, clanShare, platformShare],
  )
  return { charged, clanShare, platformShare }
}

async function addClanMembership(
  db: OrganizerPool,
  serverId: string,
  userId: string,
): Promise<void> {
  const existing = await one(
    db,
    'select id from clan_members where server_id=$1 and user_id=$2',
    [serverId, userId],
  )
  if (!existing) {
    await db.query(
      `insert into clan_members (server_id,user_id,role) values ($1,$2,'member')`,
      [serverId, userId],
    )
  }
  const chatMember = await one(
    db,
    'select id from server_members where server_id=$1 and user_id=$2',
    [serverId, userId],
  )
  if (!chatMember) {
    await db.query(
      `insert into server_members (server_id,user_id,role) values ($1,$2,'member')`,
      [serverId, userId],
    )
  }
}

async function rosterMembers(db: OrganizerPool, rosterId: string): Promise<any[]> {
  return (await db.query(
    `select m.*, p.username, p.avatar_url
       from clan_roster_members m
       join profiles p on p.id=m.user_id
      where m.roster_id=$1
      order by case m.member_role
        when 'captain' then 0 when 'starter' then 1 when 'substitute' then 2 else 3 end,
        lower(p.username)`,
    [rosterId],
  )).rows
}

async function tournamentMembers(db: OrganizerPool, rosterId: string): Promise<any[]> {
  return (await db.query(
    `select m.*, p.username, p.avatar_url
       from tournament_roster_members m
       join profiles p on p.id=m.user_id
      where m.tournament_roster_id=$1
      order by case m.member_role
        when 'captain' then 0 when 'starter' then 1 when 'substitute' then 2 else 3 end,
        lower(p.username)`,
    [rosterId],
  )).rows
}

async function tournamentArtifacts(db: OrganizerPool, rosterId: string): Promise<any[]> {
  return (await db.query(
    `select ra.id,ra.asset_id,ra.attached_by,ra.entitlement_source,ra.reason,ra.attached_at,
            a.name,a.image_url,a.kind,p.username as attached_by_name
       from tournament_roster_artifacts ra
       join assets a on a.id=ra.asset_id
       join profiles p on p.id=ra.attached_by
      where ra.tournament_roster_id=$1 order by ra.attached_at`,
    [rosterId],
  )).rows
}

async function canManageTournamentRoster(
  deps: OrganizerRouteDeps,
  db: OrganizerPool,
  actor: OrganizerActor,
  roster: any,
): Promise<{ allowed: boolean; host: boolean }> {
  const host = await deps.isTournamentHost(db, actor, String(roster.tournament_id))
  if (host) return { allowed: true, host: true }
  if (String(roster.created_by) === actor.id || String(roster.captain_id || '') === actor.id) {
    return { allowed: true, host: false }
  }
  if (roster.clan_id && await deps.isClanManager(db, actor, String(roster.clan_id))) {
    return { allowed: true, host: false }
  }
  return { allowed: false, host: false }
}

async function perkSources(
  db: OrganizerPool,
  tournamentId: string,
  userId: string,
  rosterId: string,
  benefit: 'roster_change' | 'artifact_slot' = 'roster_change',
): Promise<PerkSource[]> {
  const candidates: Array<{ pack: any; sourceKind: PerkSource['sourceKind']; sourceRef: string }> = []
  const purchases = await db.query(
    `select p.*, e.id as source_ref
       from tournament_perk_packs p
       join creator_entitlements e on e.offer_id=p.offer_id
      where p.tournament_id=$1 and p.active=true
        and e.user_id=$2 and e.status='active'
        and (e.expires_at is null or e.expires_at > now())`,
    [tournamentId, userId],
  )
  for (const row of purchases.rows) {
    candidates.push({ pack: row, sourceKind: 'purchase', sourceRef: String(row.source_ref) })
  }
  const artifacts = await db.query(
    `select p.*, o.id as source_ref
       from tournament_perk_packs p
       join asset_ownership o on o.asset_id=p.qualifying_asset_id
      where p.tournament_id=$1 and p.active=true and o.user_id=$2`,
    [tournamentId, userId],
  )
  for (const row of artifacts.rows) {
    candidates.push({ pack: row, sourceKind: 'artifact', sourceRef: String(row.source_ref) })
  }
  const grants = await db.query(
    `select p.*, g.id as source_ref
       from tournament_perk_packs p
       join tournament_perk_grants g on g.pack_id=p.id
      where p.tournament_id=$1 and p.active=true and g.status='active'
        and (g.user_id=$2 or g.tournament_roster_id=$3)`,
    [tournamentId, userId, rosterId],
  )
  for (const row of grants.rows) {
    candidates.push({ pack: row, sourceKind: 'grant', sourceRef: String(row.source_ref) })
  }

  const sources: PerkSource[] = []
  for (const candidate of candidates) {
    const benefits = sanitizeTournamentPackBenefits(candidate.pack.benefits)
    const unlimited = benefit === 'roster_change' && benefits.unlimited_roster_changes
    const allowance = benefit === 'roster_change' ? benefits.roster_changes : benefits.artifact_slots
    if (!unlimited && allowance <= 0) continue
    const use = await one(
      db,
      `select coalesce(sum(units),0)::int as n from tournament_perk_usage
        where source_kind=$1 and source_ref=$2 and benefit=$3`,
      [candidate.sourceKind, candidate.sourceRef, benefit],
    )
    const used = Number(use?.n || 0)
    sources.push({
      ...candidate,
      allowance,
      unlimited,
      used,
      remaining: unlimited ? 0 : Math.max(0, allowance - used),
    })
  }
  return sources.sort((a, b) => Number(b.unlimited) - Number(a.unlimited) || b.remaining - a.remaining)
}

async function authorizeArtifactAttachment(
  deps: OrganizerRouteDeps,
  db: OrganizerPool,
  actor: OrganizerActor,
  roster: any,
  management: { host: boolean },
  reason: string,
  mutationId: string,
): Promise<{ source: 'purchase' | 'artifact' | 'grant' | 'host_override'; ref: string }> {
  const tournament = await one(db, 'select status from tournaments where id=$1', [roster.tournament_id])
  if (!tournament || String(tournament.status) === 'closed') {
    throw Object.assign(new Error('closed_tournament_artifacts_cannot_change'), { status: 409 })
  }
  if (management.host) {
    if (!reason) throw Object.assign(new Error('host_override_reason_required'), { status: 400 })
    return { source: 'host_override', ref: actor.id }
  }
  const source = (await perkSources(
    db,
    String(roster.tournament_id),
    actor.id,
    String(roster.id),
    'artifact_slot',
  )).find((candidate) => candidate.remaining > 0)
  if (!source) throw Object.assign(new Error('tournament_artifact_perk_required'), { status: 409 })
  await db.query(
    `insert into tournament_perk_usage
       (pack_id,tournament_roster_id,user_id,source_kind,source_ref,benefit,units,idempotency_key)
     values ($1,$2,$3,$4,$5,'artifact_slot',1,$6)`,
    [source.pack.id, roster.id, actor.id, source.sourceKind, source.sourceRef, mutationId],
  )
  return { source: source.sourceKind, ref: source.sourceRef }
}

async function authorizeRosterMutation(
  deps: OrganizerRouteDeps,
  db: OrganizerPool,
  actor: OrganizerActor,
  roster: any,
  management: { host: boolean },
  reason: string,
  mutationId: string,
): Promise<{ source: string | null; ref: string | null }> {
  const tournament = await one(db, 'select status from tournaments where id=$1', [roster.tournament_id])
  if (!tournament || String(tournament.status) === 'closed') {
    throw Object.assign(new Error('closed_tournament_rosters_cannot_change'), { status: 409 })
  }
  if (roster.status === 'draft' || roster.status === 'changes_requested') {
    return { source: null, ref: null }
  }
  if (management.host) {
    if (!reason) throw Object.assign(new Error('host_override_reason_required'), { status: 400 })
    return { source: 'host_override', ref: actor.id }
  }
  const source = (await perkSources(
    db,
    String(roster.tournament_id),
    actor.id,
    String(roster.id),
  )).find((candidate) => candidate.unlimited || candidate.remaining > 0)
  if (!source) {
    throw Object.assign(new Error('roster_locked_perk_required'), { status: 409 })
  }
  await db.query(
    `insert into tournament_perk_usage
       (pack_id,tournament_roster_id,user_id,source_kind,source_ref,benefit,units,idempotency_key)
     values ($1,$2,$3,$4,$5,'roster_change',1,$6)`,
    [source.pack.id, roster.id, actor.id, source.sourceKind, source.sourceRef, mutationId],
  )
  return { source: source.sourceKind, ref: source.sourceRef }
}

async function mirrorRosterEntrants(db: OrganizerPool, roster: any): Promise<void> {
  const members = await tournamentMembers(db, String(roster.id))
  const memberIds = new Set(members.map((member) => String(member.user_id)))
  for (const member of members) {
    const existing = await one(
      db,
      'select * from tournament_entrants where tournament_id=$1 and user_id=$2',
      [roster.tournament_id, member.user_id],
    )
    if (existing) {
      await db.query(
        `update tournament_entrants
            set team_name=$3, team_server_id=$4,
                status=case when status='withdrawn' then 'pending' else status end
          where id=$1 and tournament_id=$2`,
        [existing.id, roster.tournament_id, roster.name, roster.clan_id || null],
      )
    } else {
      await db.query(
        `insert into tournament_entrants
           (tournament_id,user_id,team_name,team_server_id,status,invited_by)
         values ($1,$2,$3,$4,'pending',$5)`,
        [roster.tournament_id, member.user_id, roster.name, roster.clan_id || null, roster.created_by],
      )
    }
  }
  const prior = await db.query(
    `select id,user_id from tournament_entrants
      where tournament_id=$1 and team_name=$2
        and (($3::text is null and team_server_id is null) or team_server_id::text=$3::text)`,
    [roster.tournament_id, roster.name, roster.clan_id || null],
  )
  for (const entrant of prior.rows) {
    if (!memberIds.has(String(entrant.user_id))) {
      await db.query(
        `update tournament_entrants set status='withdrawn' where id=$1`,
        [entrant.id],
      )
    }
  }
}

async function villageBoard(db: OrganizerPool, villageId: string): Promise<any | null> {
  const village = await one(
    db,
    `select v.*,t.name as home_territory_name
       from villages v
       left join territories t on t.id=v.home_territory_id
      where v.id=$1 and v.status='active'`,
    [villageId],
  )
  if (!village) return null
  const clans = (await db.query(
    `select s.id,s.name,s.clan_tag,s.owner_id,s.total_points,s.treasury_tokens,
            vc.joined_at,vc.under_strength,count(cm.id)::int as member_count
       from village_clans vc
       join servers s on s.id=vc.server_id
       left join clan_members cm on cm.server_id=s.id
      where vc.village_id=$1
      group by s.id,s.name,s.clan_tag,s.owner_id,s.total_points,s.treasury_tokens,
               vc.joined_at,vc.under_strength
      order by lower(s.name)`,
    [villageId],
  )).rows
  const territories = (await db.query(
    `select id,name,owner_clan_id,owner_village_id,captured_at
       from territories where owner_village_id=$1 order by name`,
    [villageId],
  )).rows
  const tournaments = (await db.query(
    `select id,name,status,start_at,end_at,entry_scope
       from tournaments where village_id=$1 order by created_at desc limit 20`,
    [villageId],
  )).rows
  return { ...village, clans, territories, tournaments }
}

async function villageAccess(
  deps: OrganizerRouteDeps,
  db: OrganizerPool,
  actor: OrganizerActor,
  villageId: string,
): Promise<{ member: boolean; manager: boolean; managedClanId: string | null }> {
  const rows = await db.query('select server_id from village_clans where village_id=$1', [villageId])
  let member = actor.host
  let manager = actor.host
  let managedClanId: string | null = null
  for (const row of rows.rows) {
    const serverId = String(row.server_id)
    if (!member && await deps.isClanMember(db, actor, serverId)) member = true
    if (!manager && await deps.isClanManager(db, actor, serverId)) {
      manager = true
      managedClanId = serverId
    } else if (actor.host && !managedClanId) {
      managedClanId = serverId
    }
  }
  return { member, manager, managedClanId }
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<unknown>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch((error: any) => {
      if (res.headersSent) return next(error)
      const status = Number(error?.status) || 500
      if (status >= 500) console.error('[organizer]', error)
      res.status(status).json({ ok: false, error: cleanText(error?.message || 'organizer_request_failed', 240) })
    })
  }
}

export function installOrganizerRoutes(deps: OrganizerRouteDeps): void {
  const { router, auth, pool } = deps

  router.get('/organizer/clan-applications/mine', auth, asyncRoute(async (req, res) => {
    const rows = await pool.query(
      `select a.*, s.name as clan_name, s.clan_tag
         from clan_applications a join servers s on s.id=a.server_id
        where a.applicant_id=$1 order by a.updated_at desc`,
      [deps.uid(req)],
    )
    return res.json({ ok: true, applications: rows.rows })
  }))

  router.get('/organizer/clans/mine', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    if (!actor) return res.status(401).json({ ok: false, error: 'authentication_required' })
    // PostgreSQL requires every DISTINCT sort expression to appear in the
    // selected output. s.name is already selected; lower(s.name) is not.
    const rows = await pool.query(
      `select distinct s.id,s.name,s.clan_tag,s.owner_id,s.total_points,s.treasury_tokens,
              s.village_id,cm.role
         from servers s
         left join clan_members cm on cm.server_id=s.id and cm.user_id=$1
        where s.kind='clan'
          and ($2::boolean=true or s.owner_id=$1 or cm.role in ('leader','officer'))
        order by s.name`,
      [actor.id, actor.host],
    )
    return res.json({ ok: true, clans: rows.rows })
  }))

  router.get('/organizer/clans/:serverId/alliance-dashboard', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const serverId = String(req.params.serverId || '')
    if (!actor || !UUID_RE.test(serverId)) {
      return res.status(400).json({ ok: false, error: 'valid_clan_required' })
    }
    if (!await deps.isClanMember(pool, actor, serverId)) {
      return res.status(403).json({ ok: false, error: 'clan_membership_required' })
    }
    const clan = await one(
      pool,
      `select s.*,coalesce(vc.village_id,s.village_id) as resolved_village_id
         from servers s left join village_clans vc on vc.server_id=s.id
        where s.id=$1 and s.kind='clan'`,
      [serverId],
    )
    if (!clan) return res.status(404).json({ ok: false, error: 'clan_not_found' })
    const canManage = await deps.isClanManager(pool, actor, serverId)
    const villageId = String(clan.resolved_village_id || '')
    const village = villageId ? await villageBoard(pool, villageId) : null
    if (!canManage) {
      return res.json({ ok: true, clan, can_manage: false, village, incoming: [], outgoing: [], eligible_clans: [] })
    }
    const requests = await pool.query(
      `select r.*,source.name as from_clan_name,target.name as to_clan_name
         from clan_alliance_requests r
         join servers source on source.id=r.from_clan_id
         join servers target on target.id=r.to_clan_id
        where r.from_clan_id=$1 or r.to_clan_id=$1
        order by case r.status when 'pending' then 0 else 1 end,r.updated_at desc`,
      [serverId],
    )
    const pendingClanIds = new Set<string>()
    for (const row of requests.rows) {
      if (row.status !== 'pending') continue
      pendingClanIds.add(String(row.from_clan_id))
      pendingClanIds.add(String(row.to_clan_id))
    }
    const candidates = await pool.query(
      `select s.id,s.name,s.clan_tag,s.total_points,s.village_id
         from servers s where s.kind='clan' and s.id<>$1 order by lower(s.name)`,
      [serverId],
    )
    const eligibleClans = []
    for (const row of candidates.rows) {
      if (pendingClanIds.has(String(row.id))) continue
      if (villageId && row.village_id && String(row.village_id) !== villageId) continue
      if (!villageId || !row.village_id || String(row.village_id) === villageId) {
        eligibleClans.push({ ...row, member_count: await clanMemberCount(pool, String(row.id)) })
      }
    }
    return res.json({
      ok: true,
      clan,
      can_manage: true,
      village,
      incoming: requests.rows.filter((row) => String(row.to_clan_id) === serverId),
      outgoing: requests.rows.filter((row) => String(row.from_clan_id) === serverId),
      eligible_clans: eligibleClans,
    })
  }))

  router.post('/organizer/clans/:serverId/alliance-requests', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const fromClanId = String(req.params.serverId || '')
    const toClanId = String(req.body?.to_clan_id || '')
    if (!actor || !UUID_RE.test(fromClanId) || !UUID_RE.test(toClanId) || fromClanId === toClanId) {
      return res.status(400).json({ ok: false, error: 'two_valid_clans_required' })
    }
    if (!await deps.isClanManager(pool, actor, fromClanId)) {
      return res.status(403).json({ ok: false, error: 'clan_manager_required' })
    }
    const source = await one(pool, 'select id,name,village_id from servers where id=$1 and kind=$2', [fromClanId, 'clan'])
    const target = await one(pool, 'select id,name,village_id from servers where id=$1 and kind=$2', [toClanId, 'clan'])
    if (!source || !target) return res.status(404).json({ ok: false, error: 'clan_not_found' })
    if (source.village_id && target.village_id && String(source.village_id) !== String(target.village_id)) {
      return res.status(409).json({ ok: false, error: 'clans_belong_to_different_villages' })
    }
    const pending = await one(
      pool,
      `select id from clan_alliance_requests where status='pending'
        and ((from_clan_id=$1 and to_clan_id=$2) or (from_clan_id=$2 and to_clan_id=$1))`,
      [fromClanId, toClanId],
    )
    if (pending) return res.status(409).json({ ok: false, error: 'alliance_request_already_pending' })
    const proposedName = cleanText(req.body?.village_name, 100)
      || cleanText(`${source.name} + ${target.name}`, 100)
    const inserted = await pool.query(
      `insert into clan_alliance_requests
         (from_clan_id,to_clan_id,requester_id,proposed_village_name,status,updated_at)
       values ($1,$2,$3,$4,'pending',now())
       on conflict (from_clan_id,to_clan_id) do update set
         requester_id=excluded.requester_id,proposed_village_name=excluded.proposed_village_name,
         status='pending',reviewed_by=null,reviewed_at=null,updated_at=now()
       returning *`,
      [fromClanId, toClanId, actor.id, proposedName],
    )
    const allianceRequest = inserted.rows[0]
    const recipients = (await clanRecruiterIds(pool, toClanId)).filter((id) => id !== actor.id)
    for (const recipient of recipients) {
      await notify(pool, {
        userId: recipient,
        kind: 'clan_alliance_requested',
        title: `${source.name} proposed an alliance`,
        body: `Review the proposal for ${proposedName}.`,
        link: `/clans/${toClanId}/manage?section=village`,
        relatedId: allianceRequest.id,
        actorId: actor.id,
      })
    }
    await deps.pushUsers(recipients, {
      title: `${source.name} proposed an alliance`,
      body: `Review the proposal for ${proposedName}.`,
      url: `/clans/${toClanId}/manage?section=village`,
      tag: `clan-alliance:${toClanId}`,
    }).catch(() => undefined)
    return res.status(201).json({ ok: true, request: allianceRequest })
  }))

  router.post('/organizer/alliance-requests/:requestId/review', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const requestId = String(req.params.requestId || '')
    const decision = String(req.body?.decision || '')
    if (!actor || !UUID_RE.test(requestId) || !['accept', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, error: 'valid_alliance_review_required' })
    }
    const current = await one(pool, 'select * from clan_alliance_requests where id=$1', [requestId])
    if (!current) return res.status(404).json({ ok: false, error: 'alliance_request_not_found' })
    if (!await deps.isClanManager(pool, actor, String(current.to_clan_id))) {
      return res.status(403).json({ ok: false, error: 'target_clan_manager_required' })
    }
    const result = await deps.withTransaction(async (db) => {
      const requestRow = await one(db, 'select * from clan_alliance_requests where id=$1 for update', [requestId])
      if (!requestRow || requestRow.status !== 'pending') {
        throw Object.assign(new Error('alliance_request_already_reviewed'), { status: 409 })
      }
      const source = await one(db, 'select * from servers where id=$1 for update', [requestRow.from_clan_id])
      const target = await one(db, 'select * from servers where id=$1 for update', [requestRow.to_clan_id])
      if (!source || !target) throw Object.assign(new Error('clan_not_found'), { status: 404 })
      if (decision === 'reject') {
        const reviewed = await db.query(
          `update clan_alliance_requests set status='rejected',reviewed_by=$2,
                  reviewed_at=now(),updated_at=now() where id=$1 returning *`,
          [requestId, actor.id],
        )
        return { request: reviewed.rows[0], village: null, source, target }
      }

      const sourceMembership = await one(db, 'select village_id from village_clans where server_id=$1', [source.id])
      const targetMembership = await one(db, 'select village_id from village_clans where server_id=$1', [target.id])
      const sourceVillageId = String(sourceMembership?.village_id || source.village_id || '')
      const targetVillageId = String(targetMembership?.village_id || target.village_id || '')
      if (sourceVillageId && targetVillageId && sourceVillageId !== targetVillageId) {
        throw Object.assign(new Error('clans_belong_to_different_villages'), { status: 409 })
      }
      let villageId = sourceVillageId || targetVillageId
      if (!villageId) {
        const villageName = cleanText(requestRow.proposed_village_name, 100)
          || cleanText(`${source.name} + ${target.name}`, 100)
        const created = await db.query(
          `insert into villages (name,chief_profile_id,created_by)
           values ($1,$2,$2) returning *`,
          [villageName, actor.id],
        )
        villageId = String(created.rows[0].id)
      }
      for (const clanId of [String(source.id), String(target.id)]) {
        await db.query(
          `insert into village_clans (village_id,server_id,joined_by)
           values ($1,$2,$3) on conflict (server_id) do nothing`,
          [villageId, clanId, actor.id],
        )
        await db.query('update servers set village_id=$2 where id=$1', [clanId, villageId])
      }

      const villageClans = await db.query('select server_id from village_clans where village_id=$1', [villageId])
      const clanIds = villageClans.rows.map((row) => String(row.server_id)).sort()
      for (let left = 0; left < clanIds.length; left += 1) {
        for (let right = left + 1; right < clanIds.length; right += 1) {
          await db.query(
            `insert into clan_alliances (clan_id,ally_clan_id,village_id)
             values ($1,$2,$3)
             on conflict (clan_id,ally_clan_id) do update set village_id=excluded.village_id`,
            [clanIds[left], clanIds[right], villageId],
          )
        }
      }
      const reviewed = await db.query(
        `update clan_alliance_requests set status='accepted',reviewed_by=$2,
                reviewed_at=now(),updated_at=now() where id=$1 returning *`,
        [requestId, actor.id],
      )
      return { request: reviewed.rows[0], village: await villageBoard(db, villageId), source, target }
    })

    const recipients = [...new Set([
      ...(await clanRecruiterIds(pool, String(result.source.id))),
      ...(await clanRecruiterIds(pool, String(result.target.id))),
    ])].filter((id) => id !== actor.id)
    const accepted = decision === 'accept'
    for (const recipient of recipients) {
      await notify(pool, {
        userId: recipient,
        kind: 'clan_alliance_reviewed',
        title: accepted ? 'Clan alliance accepted' : 'Clan alliance declined',
        body: accepted ? `Your clans now share ${result.village?.name || 'a village'}.` : 'The alliance proposal was declined.',
        link: accepted ? `/villages/${result.village?.id}` : `/clans/${result.source.id}/manage?section=village`,
        relatedId: requestId,
        actorId: actor.id,
      })
    }
    await deps.pushUsers(recipients, {
      title: accepted ? 'Clan alliance accepted' : 'Clan alliance declined',
      body: accepted ? `Open ${result.village?.name || 'the shared village'} dashboard.` : 'The alliance proposal was declined.',
      url: accepted ? `/villages/${result.village?.id}` : `/clans/${result.source.id}/manage?section=village`,
      tag: `clan-alliance-review:${requestId}`,
    }).catch(() => undefined)
    return res.json({ ok: true, ...result })
  }))

  router.get('/organizer/villages/:villageId', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const villageId = String(req.params.villageId || '')
    if (!actor || !UUID_RE.test(villageId)) {
      return res.status(400).json({ ok: false, error: 'valid_village_required' })
    }
    const access = await villageAccess(deps, pool, actor, villageId)
    if (!access.member) return res.status(403).json({ ok: false, error: 'village_membership_required' })
    const village = await villageBoard(pool, villageId)
    if (!village) return res.status(404).json({ ok: false, error: 'village_not_found' })
    return res.json({ ok: true, village, can_manage: access.manager })
  }))

  router.post('/organizer/villages/:villageId/home-territory', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const villageId = String(req.params.villageId || '')
    const territoryId = String(req.body?.territory_id || '')
    if (!actor || !UUID_RE.test(villageId) || !UUID_RE.test(territoryId)) {
      return res.status(400).json({ ok: false, error: 'valid_village_and_territory_required' })
    }
    const claimed = await deps.withTransaction(async (db) => {
      const access = await villageAccess(deps, db, actor, villageId)
      if (!access.manager || !access.managedClanId) {
        throw Object.assign(new Error('village_manager_required'), { status: 403 })
      }
      const village = await one(db, 'select * from villages where id=$1 and status=$2 for update', [villageId, 'active'])
      if (!village) throw Object.assign(new Error('village_not_found'), { status: 404 })
      const territory = await one(db, 'select * from territories where id=$1 for update', [territoryId])
      if (!territory) throw Object.assign(new Error('territory_not_found'), { status: 404 })
      if (village.home_territory_id && String(village.home_territory_id) !== territoryId) {
        throw Object.assign(new Error('village_home_already_claimed'), { status: 409 })
      }
      if (territory.owner_village_id && String(territory.owner_village_id) !== villageId) {
        throw Object.assign(new Error('territory_already_claimed'), { status: 409 })
      }
      if (territory.owner_clan_id && !territory.owner_village_id) {
        throw Object.assign(new Error('territory_already_claimed'), { status: 409 })
      }
      await db.query(
        `update territories set owner_clan_id=$2,owner_village_id=$3,
                captured_at=coalesce(captured_at,now()) where id=$1`,
        [territoryId, access.managedClanId, villageId],
      )
      await db.query(
        'update villages set home_territory_id=$2,updated_at=now() where id=$1',
        [villageId, territoryId],
      )
      return villageBoard(db, villageId)
    })
    const memberRows = await pool.query(
      `select distinct cm.user_id from village_clans vc
         join clan_members cm on cm.server_id=vc.server_id where vc.village_id=$1`,
      [villageId],
    )
    const recipients = memberRows.rows.map((row) => String(row.user_id)).filter((id) => id !== actor.id)
    await deps.pushUsers(recipients, {
      title: `${claimed?.name || 'Your village'} claimed a home`,
      body: `${claimed?.home_territory_name || 'A territory'} is now your village home.`,
      url: '/conquest',
      tag: `village-home:${villageId}`,
    }).catch(() => undefined)
    return res.json({ ok: true, village: claimed })
  }))

  router.post('/organizer/clans/:serverId/applications', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const serverId = String(req.params.serverId || '')
    if (!actor || !UUID_RE.test(serverId)) return res.status(400).json({ ok: false, error: 'valid_clan_required' })
    const clan = await one(pool, 'select * from servers where id=$1 and kind=$2', [serverId, 'clan'])
    if (!clan) return res.status(404).json({ ok: false, error: 'clan_not_found' })
    const member = await one(pool, 'select id from clan_members where server_id=$1 and user_id=$2', [serverId, actor.id])
    if (member) return res.status(409).json({ ok: false, error: 'already_a_clan_member' })
    const cap = Math.max(1, Number(clan.max_members) || 100)
    if (await clanMemberCount(pool, serverId) >= cap) {
      return res.status(409).json({ ok: false, error: 'clan_is_full' })
    }
    const fee = Math.max(0, Math.round(Number(clan.join_fee_tokens) || 0))
    const message = cleanText(req.body?.message, 500)
    const inserted = await pool.query(
      `insert into clan_applications
         (server_id,applicant_id,status,message,fee_tokens_snapshot,updated_at)
       values ($1,$2,'pending',$3,$4,now())
       on conflict (server_id,applicant_id) do update set
         status='pending', message=excluded.message,
         fee_tokens_snapshot=excluded.fee_tokens_snapshot,
         reviewed_by=null, reviewed_at=null, updated_at=now()
       returning *`,
      [serverId, actor.id, message, fee],
    )
    const application = inserted.rows[0]
    const applicantName = await profileName(pool, actor.id)
    const recipients = (await clanRecruiterIds(pool, serverId)).filter((id) => id !== actor.id)
    for (const recipient of recipients) {
      await notify(pool, {
        userId: recipient,
        kind: 'clan_application_received',
        title: `${applicantName} applied to ${cleanText(clan.name, 120)}`,
        body: message || 'Review this clan application.',
        link: `/boards/${serverId}`,
        relatedId: application.id,
        actorId: actor.id,
      })
    }
    await deps.pushUsers(recipients, {
      title: `${applicantName} applied to ${cleanText(clan.name, 120)}`,
      body: message || 'Open clan management to approve or reject the application.',
      url: `/boards/${serverId}`,
      tag: `clan-application:${serverId}`,
    }).catch(() => undefined)
    return res.status(201).json({ ok: true, application })
  }))

  router.get('/organizer/clans/:serverId/dashboard', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const serverId = String(req.params.serverId || '')
    if (!actor || !await canRecruitForClan(pool, actor, serverId)) {
      return res.status(403).json({ ok: false, error: 'clan_recruiter_required' })
    }
    const applications = await pool.query(
      `select a.*, p.username, p.avatar_url
         from clan_applications a join profiles p on p.id=a.applicant_id
        where a.server_id=$1 order by
          case a.status when 'pending' then 0 else 1 end, a.updated_at desc`,
      [serverId],
    )
    const clanMembers = await pool.query(
      `select m.id,m.user_id,m.role,m.joined_at,p.username,p.avatar_url
         from clan_members m join profiles p on p.id=m.user_id
        where m.server_id=$1 order by lower(p.username)`,
      [serverId],
    )
    const rosters = await pool.query(
      `select * from clan_rosters where server_id=$1 and status='active' order by updated_at desc`,
      [serverId],
    )
    const rosterRows = []
    for (const roster of rosters.rows) {
      const members = await rosterMembers(pool, String(roster.id))
      const invites = await pool.query(
        `select id,roster_id,email,invitee_id,member_role,status,fee_tokens_snapshot,
                invited_by,expires_at,accepted_at,created_at
           from clan_roster_invites where roster_id=$1 order by created_at desc`,
        [roster.id],
      )
      rosterRows.push({ ...roster, members, invites: invites.rows })
    }
    return res.json({ ok: true, applications: applications.rows, members: clanMembers.rows, rosters: rosterRows })
  }))

  router.get('/organizer/clan-rosters/mine', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    if (!actor) return res.status(401).json({ ok: false, error: 'authentication_required' })
    const rows = await pool.query(
      `select distinct r.*,s.name as clan_name,s.clan_tag
         from clan_rosters r
         join servers s on s.id=r.server_id
         left join clan_members cm on cm.server_id=s.id and cm.user_id=$1
        where r.status='active'
          and ($2::boolean=true or s.owner_id=$1 or cm.role in ('leader','officer'))
        order by lower(s.name),lower(r.name)`,
      [actor.id, actor.host],
    )
    const rosters = []
    for (const roster of rows.rows) {
      rosters.push({ ...roster, members: await rosterMembers(pool, String(roster.id)) })
    }
    return res.json({ ok: true, rosters })
  }))

  router.get('/organizer/clan-roster-memberships/mine', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    if (!actor) return res.status(401).json({ ok: false, error: 'authentication_required' })
    const rows = await pool.query(
      `select r.id,r.server_id,r.name,r.game,r.max_members,r.status,
              s.name as clan_name,s.clan_tag,m.member_role,m.added_at
         from clan_roster_members m
         join clan_rosters r on r.id=m.roster_id
         join servers s on s.id=r.server_id
        where m.user_id=$1 and r.status='active'
        order by lower(s.name),lower(r.name)`,
      [actor.id],
    )
    return res.json({ ok: true, rosters: rows.rows })
  }))

  router.post('/organizer/clan-applications/:applicationId/review', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const applicationId = String(req.params.applicationId || '')
    const decision = String(req.body?.decision || '')
    if (!actor || !UUID_RE.test(applicationId) || !['approve', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, error: 'valid_review_required' })
    }
    const current = await one(pool, 'select * from clan_applications where id=$1', [applicationId])
    if (!current) return res.status(404).json({ ok: false, error: 'application_not_found' })
    if (!await canRecruitForClan(pool, actor, String(current.server_id))) {
      return res.status(403).json({ ok: false, error: 'clan_recruiter_required' })
    }
    if (current.status !== 'pending') {
      return res.status(409).json({ ok: false, error: `application_already_${current.status}` })
    }
    const result = await deps.withTransaction(async (db) => {
      const application = await one(db, 'select * from clan_applications where id=$1 for update', [applicationId])
      if (!application || application.status !== 'pending') {
        throw Object.assign(new Error('application_already_reviewed'), { status: 409 })
      }
      const clan = await one(db, 'select * from servers where id=$1 for update', [application.server_id])
      if (!clan) throw Object.assign(new Error('clan_not_found'), { status: 404 })
      let payment = { charged: 0, clanShare: 0, platformShare: 0 }
      if (decision === 'approve') {
        const cap = Math.max(1, Number(clan.max_members) || 100)
        if (await clanMemberCount(db, String(clan.id)) >= cap) {
          throw Object.assign(new Error('clan_is_full'), { status: 409 })
        }
        payment = await chargeClanJoin(db, clan, String(application.applicant_id), Number(application.fee_tokens_snapshot))
        await addClanMembership(db, String(clan.id), String(application.applicant_id))
      }
      const status = decision === 'approve' ? 'approved' : 'rejected'
      const updated = await db.query(
        `update clan_applications set status=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now()
          where id=$1 returning *`,
        [applicationId, status, actor.id],
      )
      await notify(db, {
        userId: String(application.applicant_id),
        kind: 'clan_application_reviewed',
        title: decision === 'approve'
          ? `Welcome to ${cleanText(clan.name, 120)}`
          : `${cleanText(clan.name, 120)} reviewed your application`,
        body: decision === 'approve'
          ? (payment.charged ? `${payment.charged.toLocaleString()} Tokens were paid as the join fee.` : 'Your clan membership is active.')
          : 'Your application was not approved this time.',
        link: `/boards/${clan.id}`,
        relatedId: applicationId,
        actorId: actor.id,
      })
      return { application: updated.rows[0], clan, payment }
    })
    await deps.pushUsers([String(result.application.applicant_id)], {
      title: decision === 'approve' ? `Welcome to ${result.clan.name}` : `${result.clan.name} reviewed your application`,
      body: decision === 'approve' ? 'Your clan membership is active.' : 'Open TKO to see the decision.',
      url: `/boards/${result.clan.id}`,
      tag: `clan-application:${result.clan.id}`,
    }).catch(() => undefined)
    return res.json({ ok: true, ...result })
  }))

  router.post('/organizer/clans/:serverId/rosters', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const serverId = String(req.params.serverId || '')
    if (!actor || !await deps.isClanManager(pool, actor, serverId)) {
      return res.status(403).json({ ok: false, error: 'clan_manager_required' })
    }
    const name = cleanText(req.body?.name, 100)
    const game = cleanText(req.body?.game || 'Shinobi Striker', 80)
    const maxMembers = Math.max(1, Math.min(100, Math.floor(Number(req.body?.max_members) || 4)))
    if (!name) return res.status(400).json({ ok: false, error: 'roster_name_required' })
    const created = await deps.withTransaction(async (db) => {
      const inserted = await db.query(
        `insert into clan_rosters (server_id,name,game,max_members,created_by)
         values ($1,$2,$3,$4,$5) returning *`,
        [serverId, name, game, maxMembers, actor.id],
      )
      const roster = inserted.rows[0]
      const requested = Array.isArray(req.body?.member_ids) ? req.body.member_ids : []
      for (const rawUserId of requested.slice(0, maxMembers)) {
        const userId = String(rawUserId || '')
        const member = await one(db, 'select id from clan_members where server_id=$1 and user_id=$2', [serverId, userId])
        if (!member) continue
        await db.query(
          `insert into clan_roster_members (roster_id,user_id,member_role,added_by)
           values ($1,$2,$3,$4) on conflict (roster_id,user_id) do nothing`,
          [roster.id, userId, userId === actor.id ? 'captain' : 'starter', actor.id],
        )
      }
      return roster
    })
    return res.status(201).json({ ok: true, roster: { ...created, members: await rosterMembers(pool, created.id), invites: [] } })
  }))

  router.patch('/organizer/clan-rosters/:rosterId', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    const roster = await one(pool, 'select * from clan_rosters where id=$1', [rosterId])
    if (!actor || !roster || !await deps.isClanManager(pool, actor, String(roster.server_id))) {
      return res.status(403).json({ ok: false, error: 'clan_manager_required' })
    }
    const name = cleanText(req.body?.name ?? roster.name, 100)
    const maxMembers = Math.max(1, Math.min(100, Math.floor(Number(req.body?.max_members ?? roster.max_members) || 4)))
    const count = (await rosterMembers(pool, rosterId)).length
    if (!name || maxMembers < count) return res.status(400).json({ ok: false, error: 'invalid_roster_settings' })
    const updated = await pool.query(
      `update clan_rosters set name=$2,max_members=$3,updated_at=now() where id=$1 returning *`,
      [rosterId, name, maxMembers],
    )
    return res.json({ ok: true, roster: { ...updated.rows[0], members: await rosterMembers(pool, rosterId) } })
  }))

  router.delete('/organizer/clan-rosters/:rosterId', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    if (!actor) return res.status(401).json({ ok: false, error: 'authentication_required' })
    const roster = await one(pool, 'select * from clan_rosters where id=$1', [rosterId])
    if (!roster) return res.status(404).json({ ok: false, error: 'clan_roster_not_found' })
    if (!await deps.isClanManager(pool, actor, String(roster.server_id))) {
      return res.status(403).json({ ok: false, error: 'clan_manager_required' })
    }
    await pool.query('delete from clan_rosters where id=$1', [rosterId])
    return res.json({ ok: true, deleted_roster_id: rosterId })
  }))

  router.post('/organizer/clan-rosters/:rosterId/members', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    const userId = String(req.body?.user_id || '')
    const roster = await one(pool, 'select * from clan_rosters where id=$1', [rosterId])
    if (!actor || !roster || !UUID_RE.test(userId) || !await deps.isClanManager(pool, actor, String(roster.server_id))) {
      return res.status(403).json({ ok: false, error: 'clan_manager_required' })
    }
    const clanMember = await one(pool, 'select id from clan_members where server_id=$1 and user_id=$2', [roster.server_id, userId])
    if (!clanMember) return res.status(409).json({ ok: false, error: 'player_must_join_clan_first' })
    if ((await rosterMembers(pool, rosterId)).length >= Number(roster.max_members || 4)) {
      return res.status(409).json({ ok: false, error: 'roster_is_full' })
    }
    await pool.query(
      `insert into clan_roster_members (roster_id,user_id,member_role,added_by)
       values ($1,$2,$3,$4) on conflict (roster_id,user_id) do update set member_role=excluded.member_role`,
      [rosterId, userId, memberRole(req.body?.member_role), actor.id],
    )
    return res.json({ ok: true, members: await rosterMembers(pool, rosterId) })
  }))

  router.delete('/organizer/clan-rosters/:rosterId/members/:userId', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    const userId = String(req.params.userId || '')
    const roster = await one(pool, 'select * from clan_rosters where id=$1', [rosterId])
    if (!actor) return res.status(401).json({ ok: false, error: 'authentication_required' })
    if (!roster) return res.status(404).json({ ok: false, error: 'clan_roster_not_found' })
    const selfRemoval = userId === actor.id
    if (!selfRemoval && !await deps.isClanManager(pool, actor, String(roster.server_id))) {
      return res.status(403).json({ ok: false, error: 'clan_manager_required' })
    }
    await pool.query('delete from clan_roster_members where roster_id=$1 and user_id=$2', [rosterId, userId])
    return res.json({ ok: true, members: await rosterMembers(pool, rosterId) })
  }))

  router.post('/organizer/clan-rosters/:rosterId/invites', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    const roster = await one(
      pool,
      `select r.*, s.name as clan_name, s.join_fee_tokens
         from clan_rosters r join servers s on s.id=r.server_id where r.id=$1`,
      [rosterId],
    )
    if (!actor || !roster || !await canRecruitForClan(pool, actor, String(roster.server_id))) {
      return res.status(403).json({ ok: false, error: 'clan_recruiter_required' })
    }
    if ((await rosterMembers(pool, rosterId)).length >= Number(roster.max_members || 4)) {
      return res.status(409).json({ ok: false, error: 'roster_is_full' })
    }
    const target = cleanText(req.body?.target || req.body?.email || req.body?.username, 320).replace(/^@/, '')
    if (!target) return res.status(400).json({ ok: false, error: 'email_or_username_required' })
    let account: any | null = null
    if (target.includes('@')) {
      if (!EMAIL_RE.test(target)) return res.status(400).json({ ok: false, error: 'valid_email_required' })
      account = await one(
        pool,
        `select u.id,u.email,p.username from users u left join profiles p on p.id=u.id
          where lower(u.email)=lower($1)`,
        [target],
      )
    } else {
      account = await one(
        pool,
        `select u.id,u.email,p.username from profiles p join users u on u.id=p.id
          where lower(p.username)=lower($1)`,
        [target],
      )
      if (!account) return res.status(404).json({ ok: false, error: 'player_not_found' })
    }
    const email = cleanText(account?.email || target, 320).toLowerCase()
    const inviteeId = account?.id ? String(account.id) : null
    await pool.query(
      `update clan_roster_invites set status='revoked'
        where roster_id=$1 and lower(email)=lower($2) and status='pending'`,
      [rosterId, email],
    )
    const rawToken = randomBytes(32).toString('base64url')
    const tokenHash = deps.hashInviteToken(rawToken)
    const expiresAt = new Date(deps.now().getTime() + 7 * 24 * 60 * 60 * 1000)
    const inserted = await pool.query(
      `insert into clan_roster_invites
         (roster_id,email,invitee_id,member_role,token_hash,fee_tokens_snapshot,invited_by,expires_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [
        rosterId,
        email,
        inviteeId,
        memberRole(req.body?.member_role),
        tokenHash,
        Math.max(0, Number(roster.join_fee_tokens) || 0),
        actor.id,
        expiresAt,
      ],
    )
    const invite = inserted.rows[0]
    const inviterName = await profileName(pool, actor.id)
    const origin = deps.publicOrigin(req)
    const inviteUrl = new URL('/roster-invite', origin)
    inviteUrl.searchParams.set('token', rawToken)
    if (inviteeId) {
      await notify(pool, {
        userId: inviteeId,
        kind: 'clan_roster_invite',
        title: `${inviterName} invited you to ${roster.name}`,
        body: `${roster.clan_name} competition roster invitation`,
        link: `/roster-invite?token=${encodeURIComponent(rawToken)}`,
        relatedId: invite.id,
        actorId: actor.id,
      })
      await deps.pushUsers([inviteeId], {
        title: `${inviterName} invited you to ${roster.name}`,
        body: `${roster.clan_name} sent you a competition roster invitation.`,
        url: `/roster-invite?token=${encodeURIComponent(rawToken)}`,
        tag: `clan-roster-invite:${invite.id}`,
      }).catch(() => undefined)
    }
    let emailSent = true
    try {
      await deps.sendRosterInviteEmail({
        to: email,
        inviteUrl: inviteUrl.toString(),
        brandName: await deps.brandName(req),
        clanName: String(roster.clan_name),
        rosterName: String(roster.name),
        inviterName,
        expiresAt: expiresAt.toISOString(),
      })
    } catch (error) {
      emailSent = false
      console.error('[organizer] roster invite email failed:', (error as Error).message)
    }
    const safeInvite = { ...invite }
    delete safeInvite.token_hash
    return res.status(201).json({ ok: true, invite: safeInvite, email_sent: emailSent })
  }))

  router.get('/organizer/roster-invites/preview', asyncRoute(async (req, res) => {
    const rawToken = cleanText(req.query.token, 500)
    if (rawToken.length < 32) return res.status(400).json({ ok: false, error: 'invalid_invitation' })
    const invite = await one(
      pool,
      `select i.id,i.status,i.member_role,i.fee_tokens_snapshot,i.expires_at,
              r.id as roster_id,r.name as roster_name,r.game,s.id as clan_id,s.name as clan_name,
              p.username as inviter_name
         from clan_roster_invites i
         join clan_rosters r on r.id=i.roster_id
         join servers s on s.id=r.server_id
         join profiles p on p.id=i.invited_by
        where i.token_hash=$1`,
      [deps.hashInviteToken(rawToken)],
    )
    if (!invite) return res.status(404).json({ ok: false, error: 'invitation_not_found' })
    const expired = new Date(invite.expires_at).getTime() <= deps.now().getTime()
    return res.json({ ok: true, invitation: { ...invite, expired } })
  }))

  router.post('/organizer/roster-invites/accept', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rawToken = cleanText(req.body?.token, 500)
    if (!actor || rawToken.length < 32) return res.status(400).json({ ok: false, error: 'invalid_invitation' })
    const result = await deps.withTransaction(async (db) => {
      const invite = await one(
        db,
        `select i.*,r.server_id,r.max_members,r.name as roster_name,
                s.name as clan_name,s.join_fee_tokens,s.max_members as clan_max_members,s.id as clan_id
           from clan_roster_invites i
           join clan_rosters r on r.id=i.roster_id
           join servers s on s.id=r.server_id
          where i.token_hash=$1 for update`,
        [deps.hashInviteToken(rawToken)],
      )
      if (!invite || invite.status !== 'pending') {
        throw Object.assign(new Error('invitation_unavailable'), { status: 409 })
      }
      if (new Date(invite.expires_at).getTime() <= deps.now().getTime()) {
        await db.query("update clan_roster_invites set status='expired' where id=$1", [invite.id])
        return { invite, payment: null, expired: true }
      }
      const account = await one(db, 'select email from users where id=$1', [actor.id])
      if (!account || String(account.email).toLowerCase() !== String(invite.email).toLowerCase()) {
        throw Object.assign(new Error('invitation_belongs_to_another_email'), { status: 403 })
      }
      if (invite.invitee_id && String(invite.invitee_id) !== actor.id) {
        throw Object.assign(new Error('invitation_belongs_to_another_account'), { status: 403 })
      }
      // Serialize every acceptance that can affect either capacity. Locking
      // only the invite lets two different invitations both observe the same
      // final open slot and overfill the clan/roster.
      await db.query('select id from servers where id=$1 for update', [invite.server_id])
      await db.query('select id from clan_rosters where id=$1 for update', [invite.roster_id])
      if (await clanMemberCount(db, String(invite.server_id)) >= Math.max(1, Number(invite.clan_max_members) || 100)) {
        throw Object.assign(new Error('clan_is_full'), { status: 409 })
      }
      if ((await rosterMembers(db, String(invite.roster_id))).length >= Math.max(1, Number(invite.max_members) || 4)) {
        throw Object.assign(new Error('roster_is_full'), { status: 409 })
      }
      const alreadyMember = await one(db, 'select id from clan_members where server_id=$1 and user_id=$2', [invite.server_id, actor.id])
      let payment = { charged: 0, clanShare: 0, platformShare: 0 }
      if (!alreadyMember) {
        payment = await chargeClanJoin(db, {
          id: invite.clan_id,
          name: invite.clan_name,
          join_fee_tokens: invite.join_fee_tokens,
        }, actor.id, Number(invite.fee_tokens_snapshot))
        await addClanMembership(db, String(invite.server_id), actor.id)
      }
      await db.query(
        `insert into clan_roster_members (roster_id,user_id,member_role,added_by)
         values ($1,$2,$3,$4) on conflict (roster_id,user_id) do update set member_role=excluded.member_role`,
        [invite.roster_id, actor.id, invite.member_role, invite.invited_by],
      )
      await db.query(
        `update clan_roster_invites set status='accepted',invitee_id=$2,accepted_at=now() where id=$1`,
        [invite.id, actor.id],
      )
      await db.query(
        `update clan_applications set status='approved',reviewed_by=$3,reviewed_at=now(),updated_at=now()
          where server_id=$1 and applicant_id=$2 and status='pending'`,
        [invite.server_id, actor.id, invite.invited_by],
      )
      await notify(db, {
        userId: String(invite.invited_by),
        kind: 'clan_roster_invite_accepted',
        title: `${await profileName(db, actor.id)} joined ${invite.roster_name}`,
        body: `${invite.clan_name} roster invitation accepted.`,
        link: `/boards/${invite.server_id}`,
        relatedId: invite.id,
        actorId: actor.id,
      })
      return { invite, payment, expired: false }
    })
    if (result.expired) return res.status(409).json({ ok: false, error: 'invitation_expired' })
    return res.json({ ok: true, roster_id: result.invite.roster_id, clan_id: result.invite.server_id, payment: result.payment })
  }))

  router.patch('/organizer/tournaments/:tournamentId/clan-entry-mode', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const tournamentId = String(req.params.tournamentId || '')
    const mode = cleanText(req.body?.mode, 30).toLowerCase()
    if (!actor || !UUID_RE.test(tournamentId) || !new Set(['open', 'invited_only']).has(mode)) {
      return res.status(400).json({ ok: false, error: 'valid_clan_entry_mode_required' })
    }
    if (!await deps.isTournamentHost(pool, actor, tournamentId)) {
      return res.status(403).json({ ok: false, error: 'tournament_host_required' })
    }
    const updated = await one(
      pool,
      'update tournaments set clan_entry_mode=$2 where id=$1 returning clan_entry_mode',
      [tournamentId, mode],
    )
    if (!updated) return res.status(404).json({ ok: false, error: 'tournament_not_found' })
    return res.json({ ok: true, clan_entry_mode: updated.clan_entry_mode })
  }))

  router.post('/organizer/tournaments/:tournamentId/clan-invitations', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const tournamentId = String(req.params.tournamentId || '')
    const clanId = String(req.body?.clan_id || '')
    const sourceRosterId = cleanText(req.body?.source_clan_roster_id, 80) || null
    if (!actor || !UUID_RE.test(tournamentId) || !UUID_RE.test(clanId)) {
      return res.status(400).json({ ok: false, error: 'valid_tournament_and_clan_required' })
    }
    if (!await deps.isTournamentHost(pool, actor, tournamentId)) {
      return res.status(403).json({ ok: false, error: 'tournament_host_required' })
    }
    const tournament = await one(pool, 'select id,name,status from tournaments where id=$1', [tournamentId])
    if (!tournament) return res.status(404).json({ ok: false, error: 'tournament_not_found' })
    if (String(tournament.status) === 'closed') return res.status(409).json({ ok: false, error: 'tournament_not_open' })
    const clan = await one(pool, "select id,name,clan_tag from servers where id=$1 and kind='clan'", [clanId])
    if (!clan) return res.status(404).json({ ok: false, error: 'clan_not_found' })
    let sourceRoster: any | null = null
    if (sourceRosterId) {
      sourceRoster = await one(
        pool,
        "select id,name from clan_rosters where id=$1 and server_id=$2 and status='active'",
        [sourceRosterId, clanId],
      )
      if (!sourceRoster) return res.status(404).json({ ok: false, error: 'clan_roster_not_found' })
    }
    const invitation = await one(
      pool,
      `insert into tournament_clan_invitations
         (tournament_id,clan_id,source_clan_roster_id,status,invited_by)
       values ($1,$2,$3,'invited',$4)
       on conflict (tournament_id,clan_id) do update set
         source_clan_roster_id=excluded.source_clan_roster_id,
         status='invited',invited_by=excluded.invited_by,
         responded_by=null,responded_at=null,updated_at=now()
       returning *`,
      [tournamentId, clanId, sourceRosterId, actor.id],
    )
    const recipients = await clanRecruiterIds(pool, clanId)
    for (const userId of recipients) {
      await notify(pool, {
        userId,
        kind: 'tournament_clan_invite',
        title: `${tournament.name} invited ${clan.name}`,
        body: sourceRoster
          ? `The organizer selected ${sourceRoster.name}. Review it in the tournament Rosters tab.`
          : 'Choose one of your saved clan rosters in the tournament Rosters tab.',
        link: `/tournaments/${tournamentId}?section=rosters`,
        relatedId: invitation.id,
        actorId: actor.id,
      })
    }
    await deps.pushUsers(recipients, {
      title: `${tournament.name} clan invitation`,
      body: sourceRoster ? `${sourceRoster.name} was selected for ${clan.name}.` : `${clan.name} was invited to enter a roster.`,
      url: `/tournaments/${tournamentId}?section=rosters`,
      tag: `tournament-clan-invite-${invitation.id}`,
    }).catch(() => undefined)
    return res.status(201).json({
      ok: true,
      invitation: {
        ...invitation,
        clan_name: clan.name,
        clan_tag: clan.clan_tag,
        source_clan_roster_name: sourceRoster?.name || null,
      },
    })
  }))

  router.delete('/organizer/tournaments/:tournamentId/clan-invitations/:invitationId', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const tournamentId = String(req.params.tournamentId || '')
    const invitationId = String(req.params.invitationId || '')
    if (!actor || !UUID_RE.test(tournamentId) || !UUID_RE.test(invitationId)) {
      return res.status(400).json({ ok: false, error: 'valid_clan_invitation_required' })
    }
    if (!await deps.isTournamentHost(pool, actor, tournamentId)) {
      return res.status(403).json({ ok: false, error: 'tournament_host_required' })
    }
    const deleted = await one(
      pool,
      'delete from tournament_clan_invitations where id=$1 and tournament_id=$2 returning id',
      [invitationId, tournamentId],
    )
    if (!deleted) return res.status(404).json({ ok: false, error: 'clan_invitation_not_found' })
    return res.json({ ok: true, deleted_invitation_id: deleted.id })
  }))

  router.get('/organizer/tournaments/:tournamentId/rosters', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const tournamentId = String(req.params.tournamentId || '')
    if (!actor || !UUID_RE.test(tournamentId)) return res.status(400).json({ ok: false, error: 'valid_tournament_required' })
    const tournament = await one(pool, 'select * from tournaments where id=$1', [tournamentId])
    if (!tournament) return res.status(404).json({ ok: false, error: 'tournament_not_found' })
    const isHost = await deps.isTournamentHost(pool, actor, tournamentId)
    const invitationRows = await pool.query(
      `select i.*,s.name as clan_name,s.clan_tag,r.name as source_clan_roster_name
         from tournament_clan_invitations i
         join servers s on s.id=i.clan_id
         left join clan_rosters r on r.id=i.source_clan_roster_id
        where i.tournament_id=$1 order by i.updated_at desc`,
      [tournamentId],
    )
    const clanInvitations = []
    for (const invitation of invitationRows.rows) {
      if (isHost || await deps.isClanManager(pool, actor, String(invitation.clan_id))) {
        clanInvitations.push(invitation)
      }
    }
    const clanOptions: Array<{
      id: string
      name: string
      clan_tag: string | null
      rosters: Array<{ id: string; name: string; member_count: number }>
    }> = []
    if (isHost) {
      const clans = await pool.query(
        "select id,name,clan_tag from servers where kind='clan' order by lower(name) limit 250",
      )
      const rosterOptions = await pool.query(
        `select r.id,r.server_id,r.name,count(m.id)::int as member_count
           from clan_rosters r
           left join clan_roster_members m on m.roster_id=r.id
          where r.status='active'
          group by r.id,r.server_id,r.name
          order by lower(r.name)`,
      )
      for (const clan of clans.rows) {
        clanOptions.push({
          id: String(clan.id),
          name: String(clan.name),
          clan_tag: clan.clan_tag || null,
          rosters: rosterOptions.rows
            .filter((roster) => String(roster.server_id) === String(clan.id))
            .map((roster) => ({
              id: String(roster.id),
              name: String(roster.name),
              member_count: Number(roster.member_count || 0),
            })),
        })
      }
    }
    const rows = await pool.query(
      `select r.*,s.name as clan_name,s.clan_tag,p.username as captain_name
         from tournament_rosters r
         left join servers s on s.id=r.clan_id
         left join profiles p on p.id=r.captain_id
        where r.tournament_id=$1 and r.status <> 'withdrawn'
        order by r.created_at`,
      [tournamentId],
    )
    const rosters = []
    for (const roster of rows.rows) {
      const management = await canManageTournamentRoster(deps, pool, actor, roster)
      const clanManagerCanWithdraw = Boolean(
        roster.clan_id && await deps.isClanManager(pool, actor, String(roster.clan_id)),
      )
      const sources = management.allowed && !management.host
        ? await perkSources(pool, tournamentId, actor.id, String(roster.id))
        : []
      const artifactSources = management.allowed && !management.host
        ? await perkSources(pool, tournamentId, actor.id, String(roster.id), 'artifact_slot')
        : []
      const revisions = (isHost || management.allowed)
        ? (await pool.query(
          `select id,tournament_roster_id,version,action,actor_id,reason,
                  entitlement_source,entitlement_ref,created_at
             from tournament_roster_revisions where tournament_roster_id=$1 order by version desc`,
          [roster.id],
        )).rows
        : []
      rosters.push({
        ...roster,
        members: await tournamentMembers(pool, String(roster.id)),
        artifacts: await tournamentArtifacts(pool, String(roster.id)),
        revisions,
        can_manage: management.allowed,
        can_withdraw: management.host || clanManagerCanWithdraw,
        host_control: management.host,
        roster_changes_unlimited: sources.some((source) => source.unlimited),
        roster_changes_remaining: sources.reduce((total, source) => total + source.remaining, 0),
        artifact_slots_remaining: artifactSources.reduce((total, source) => total + source.remaining, 0),
      })
    }
    const packs = await pool.query(
      `select p.*,o.active as offer_active
         from tournament_perk_packs p
         left join creator_offers o on o.id=p.offer_id
        where p.tournament_id=$1 and p.active=true order by p.created_at`,
      [tournamentId],
    )
    const ownedArtifacts = await pool.query(
      `select a.id,a.name,a.image_url,a.kind
         from asset_ownership o join assets a on a.id=o.asset_id
        where o.user_id=$1 order by o.acquired_at desc`,
      [actor.id],
    )
    return res.json({
      ok: true,
      tournament,
      is_host: isHost,
      clan_entry_mode: String(tournament.clan_entry_mode || 'open') === 'invited_only' ? 'invited_only' : 'open',
      clan_invitations: clanInvitations,
      clan_options: clanOptions,
      rosters,
      packs: packs.rows,
      owned_artifacts: ownedArtifacts.rows,
    })
  }))

  router.post('/organizer/tournaments/:tournamentId/rosters', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const tournamentId = String(req.params.tournamentId || '')
    if (!actor || !UUID_RE.test(tournamentId)) return res.status(400).json({ ok: false, error: 'valid_tournament_required' })
    const tournament = await one(pool, 'select * from tournaments where id=$1', [tournamentId])
    if (!tournament || tournament.status === 'closed') return res.status(409).json({ ok: false, error: 'tournament_not_open' })
    const isHost = await deps.isTournamentHost(pool, actor, tournamentId)
    const sourceId = cleanText(req.body?.source_clan_roster_id, 80)
    let source: any | null = null
    let clanId = cleanText(req.body?.clan_id, 80) || null
    if (sourceId) {
      source = await one(pool, 'select * from clan_rosters where id=$1 and status=$2', [sourceId, 'active'])
      if (!source) return res.status(404).json({ ok: false, error: 'clan_roster_not_found' })
      clanId = String(source.server_id)
    }
    if (String(tournament.entry_scope || 'public') === 'clan') {
      const tournamentClanId = String(tournament.server_id || '')
      if (!UUID_RE.test(tournamentClanId)) {
        return res.status(409).json({ ok: false, error: 'clan_tournament_missing_host_clan' })
      }
      if (clanId && clanId !== tournamentClanId) {
        return res.status(403).json({ ok: false, error: 'clan_tournament_roster_must_match_host_clan' })
      }
      clanId = tournamentClanId
    } else if (String(tournament.entry_scope || 'public') === 'village') {
      const tournamentVillageId = String(tournament.village_id || '')
      if (!UUID_RE.test(tournamentVillageId)) {
        return res.status(409).json({ ok: false, error: 'village_tournament_missing_host_village' })
      }
      if (clanId) {
        const villageClan = await one(
          pool,
          'select 1 from village_clans where village_id=$1 and server_id=$2',
          [tournamentVillageId, clanId],
        )
        if (!villageClan) {
          return res.status(403).json({ ok: false, error: 'village_tournament_roster_must_belong_to_host_village' })
        }
      }
    }
    if (!isHost && clanId && String(tournament.clan_entry_mode || 'open') === 'invited_only') {
      const invitation = await one(
        pool,
        `select id from tournament_clan_invitations
          where tournament_id=$1 and clan_id=$2 and status in ('invited','accepted')`,
        [tournamentId, clanId],
      )
      if (!invitation) return res.status(403).json({ ok: false, error: 'tournament_clan_invitation_required' })
    }
    if (!isHost && (!clanId || !await deps.isClanManager(pool, actor, clanId))) {
      return res.status(403).json({ ok: false, error: 'tournament_host_or_clan_manager_required' })
    }
    const name = cleanText(req.body?.name || source?.name, 100)
    if (!name) return res.status(400).json({ ok: false, error: 'roster_name_required' })
    const created = await deps.withTransaction(async (db) => {
      const inserted = await db.query(
        `insert into tournament_rosters
           (tournament_id,clan_id,source_clan_roster_id,name,created_by)
         values ($1,$2,$3,$4,$5) returning *`,
        [tournamentId, clanId, source?.id || null, name, actor.id],
      )
      const roster = inserted.rows[0]
      let members: any[] = []
      if (source) {
        members = await rosterMembers(db, String(source.id))
      } else if (isHost && Array.isArray(req.body?.members)) {
        members = req.body.members.slice(0, 100)
      }
      let captainId: string | null = null
      for (const member of members) {
        const userId = String(member.user_id || member.id || member)
        if (!UUID_RE.test(userId) || !await one(db, 'select id from profiles where id=$1', [userId])) continue
        if (
          String(tournament.entry_scope || 'public') === 'clan' &&
          clanId &&
          !await userBelongsToClan(db, userId, clanId)
        ) {
          throw Object.assign(new Error('clan_tournament_member_must_belong_to_host_clan'), { status: 403 })
        }
        if (
          String(tournament.entry_scope || 'public') === 'village' &&
          !await userBelongsToVillage(db, userId, String(tournament.village_id || ''))
        ) {
          throw Object.assign(new Error('village_tournament_member_must_belong_to_host_village'), { status: 403 })
        }
        const role = memberRole(member.member_role || (captainId ? 'starter' : 'captain'))
        if (!captainId || role === 'captain') captainId = userId
        await db.query(
          `insert into tournament_roster_members
             (tournament_roster_id,user_id,member_role,source_clan_roster_member_id)
           values ($1,$2,$3,$4) on conflict (tournament_roster_id,user_id) do nothing`,
          [roster.id, userId, role, member.id && source ? member.id : null],
        )
      }
      await db.query('update tournament_rosters set captain_id=$2 where id=$1', [roster.id, captainId])
      const after = await tournamentMembers(db, String(roster.id))
      await db.query(
        `insert into tournament_roster_revisions
           (tournament_roster_id,version,action,actor_id,after_members,mutation_id)
         values ($1,1,'created',$2,$3,$4)`,
        [roster.id, actor.id, JSON.stringify(after), `create:${roster.id}`],
      )
      if (clanId) {
        await db.query(
          `update tournament_clan_invitations
              set status='accepted',source_clan_roster_id=coalesce($3,source_clan_roster_id),
                  responded_by=$4,responded_at=now(),updated_at=now()
            where tournament_id=$1 and clan_id=$2`,
          [tournamentId, clanId, source?.id || null, actor.id],
        )
      }
      return { ...roster, captain_id: captainId }
    })
    return res.status(201).json({ ok: true, roster: { ...created, members: await tournamentMembers(pool, created.id) } })
  }))

  async function mutateTournamentRoster(
    req: Request,
    res: Response,
    action: 'sync' | 'add_member' | 'remove_member',
  ): Promise<Response> {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    if (!actor || !UUID_RE.test(rosterId)) return res.status(400).json({ ok: false, error: 'valid_roster_required' })
    const mutationId = cleanText(req.body?.mutation_id || randomUUID(), 180)
    const reason = cleanText(req.body?.reason, 500)
    const result = await deps.withTransaction(async (db) => {
      const roster = await one(db, 'select * from tournament_rosters where id=$1 for update', [rosterId])
      if (!roster) throw Object.assign(new Error('tournament_roster_not_found'), { status: 404 })
      const management = await canManageTournamentRoster(deps, db, actor, roster)
      const removalUserId = action === 'remove_member'
        ? String(req.params.userId || req.body?.user_id || '')
        : ''
      const selfRemoval = action === 'remove_member' && removalUserId === actor.id
      if (!management.allowed && !selfRemoval) {
        throw Object.assign(new Error('roster_manager_required'), { status: 403 })
      }
      const replay = await one(db, 'select id from tournament_roster_revisions where mutation_id=$1', [mutationId])
      if (replay) return { roster, replayed: true }
      const before = await tournamentMembers(db, rosterId)
      if (selfRemoval && !before.some((member) => String(member.user_id) === actor.id)) {
        throw Object.assign(new Error('roster_membership_not_found'), { status: 404 })
      }
      let authorization: { source: string | null; ref: string | null }
      if (selfRemoval) {
        const tournament = await one(db, 'select status from tournaments where id=$1', [roster.tournament_id])
        if (!tournament || String(tournament.status) === 'closed') {
          throw Object.assign(new Error('closed_tournament_rosters_cannot_change'), { status: 409 })
        }
        authorization = { source: 'self_removal', ref: actor.id }
      } else {
        authorization = await authorizeRosterMutation(deps, db, actor, roster, management, reason, mutationId)
      }
      if (action === 'sync') {
        if (!roster.source_clan_roster_id) throw Object.assign(new Error('no_source_clan_roster'), { status: 409 })
        const sourceMembers = await rosterMembers(db, String(roster.source_clan_roster_id))
        await db.query('delete from tournament_roster_members where tournament_roster_id=$1', [rosterId])
        let captainId: string | null = null
        for (const member of sourceMembers) {
          if (!captainId || member.member_role === 'captain') captainId = String(member.user_id)
          await db.query(
            `insert into tournament_roster_members
               (tournament_roster_id,user_id,member_role,source_clan_roster_member_id)
             values ($1,$2,$3,$4)`,
            [rosterId, member.user_id, member.member_role, member.id],
          )
        }
        await db.query('update tournament_rosters set captain_id=$2 where id=$1', [rosterId, captainId])
      } else if (action === 'add_member') {
        const userId = String(req.body?.user_id || '')
        if (!UUID_RE.test(userId) || !await one(db, 'select id from profiles where id=$1', [userId])) {
          throw Object.assign(new Error('valid_player_required'), { status: 400 })
        }
        if (roster.clan_id && !management.host) {
          const clanMember = await one(db, 'select id from clan_members where server_id=$1 and user_id=$2', [roster.clan_id, userId])
          if (!clanMember) throw Object.assign(new Error('player_must_join_clan_first'), { status: 409 })
        }
        await db.query(
          `insert into tournament_roster_members (tournament_roster_id,user_id,member_role)
           values ($1,$2,$3) on conflict (tournament_roster_id,user_id) do update set member_role=excluded.member_role`,
          [rosterId, userId, memberRole(req.body?.member_role)],
        )
      } else {
        await db.query('delete from tournament_roster_members where tournament_roster_id=$1 and user_id=$2', [rosterId, removalUserId])
      }
      const after = await tournamentMembers(db, rosterId)
      const captain = after.find((member) => member.member_role === 'captain') || after[0] || null
      const version = Number(roster.version || 1) + 1
      const nextStatus = roster.status === 'approved' ? 'submitted' : roster.status
      const updated = await db.query(
        `update tournament_rosters
            set version=$2,status=$3,captain_id=$4,
                approved_at=case when $3='submitted' then null else approved_at end,
                approved_by=case when $3='submitted' then null else approved_by end,
                updated_at=now()
          where id=$1 returning *`,
        [rosterId, version, nextStatus, captain?.user_id || null],
      )
      await db.query(
        `insert into tournament_roster_revisions
           (tournament_roster_id,version,action,actor_id,reason,before_members,after_members,
            entitlement_source,entitlement_ref,mutation_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          rosterId,
          version,
          action,
          actor.id,
          reason || null,
          JSON.stringify(before),
          JSON.stringify(after),
          authorization.source,
          authorization.ref,
          mutationId,
        ],
      )
      await mirrorRosterEntrants(db, updated.rows[0])
      return { roster: updated.rows[0], replayed: false }
    })
    return res.json({ ok: true, replayed: result.replayed, roster: { ...result.roster, members: await tournamentMembers(pool, rosterId) } })
  }

  router.post('/organizer/tournament-rosters/:rosterId/sync', auth, asyncRoute((req, res) => mutateTournamentRoster(req, res, 'sync')))
  router.post('/organizer/tournament-rosters/:rosterId/members', auth, asyncRoute((req, res) => mutateTournamentRoster(req, res, 'add_member')))
  router.delete('/organizer/tournament-rosters/:rosterId/members/:userId', auth, asyncRoute((req, res) => mutateTournamentRoster(req, res, 'remove_member')))

  router.post('/organizer/tournament-rosters/:rosterId/withdraw', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    if (!actor || !UUID_RE.test(rosterId)) return res.status(400).json({ ok: false, error: 'valid_roster_required' })
    const reason = cleanText(req.body?.reason, 500)
    const mutationId = cleanText(req.body?.mutation_id || randomUUID(), 180)
    const result = await deps.withTransaction(async (db) => {
      const roster = await one(db, 'select * from tournament_rosters where id=$1 for update', [rosterId])
      if (!roster) throw Object.assign(new Error('tournament_roster_not_found'), { status: 404 })
      const replay = await one(db, 'select id from tournament_roster_revisions where mutation_id=$1', [mutationId])
      if (replay) return { roster, replayed: true }
      if (String(roster.status) === 'withdrawn') {
        throw Object.assign(new Error('roster_already_withdrawn'), { status: 409 })
      }
      const management = await canManageTournamentRoster(deps, db, actor, roster)
      if (!management.allowed) throw Object.assign(new Error('roster_manager_required'), { status: 403 })
      if (!management.host && (!roster.clan_id || !await deps.isClanManager(db, actor, String(roster.clan_id)))) {
        throw Object.assign(new Error('roster_manager_required'), { status: 403 })
      }
      const locked = Boolean(roster.locked_at) || ['submitted', 'approved', 'changes_requested', 'rejected'].includes(String(roster.status))
      if (management.host) {
        if (!reason) throw Object.assign(new Error('host_override_reason_required'), { status: 400 })
      } else if (locked) {
        throw Object.assign(new Error('locked_roster_withdrawal_requires_host'), { status: 409 })
      }

      const members = await tournamentMembers(db, rosterId)
      const version = Number(roster.version || 1) + 1
      const updated = await db.query(
        `update tournament_rosters
            set status='withdrawn',version=$2,updated_at=now()
          where id=$1 returning *`,
        [rosterId, version],
      )
      await db.query(
        `insert into tournament_roster_revisions
           (tournament_roster_id,version,action,actor_id,reason,before_members,after_members,
            entitlement_source,entitlement_ref,mutation_id)
         values ($1,$2,'withdrawn',$3,$4,$5,$5,$6,$7,$8)`,
        [
          rosterId,
          version,
          actor.id,
          reason || null,
          JSON.stringify(members),
          management.host ? 'host_override' : null,
          management.host ? actor.id : null,
          mutationId,
        ],
      )
      await db.query(
        `update tournament_entrants set status='withdrawn'
          where tournament_id=$1 and team_name=$2
            and (($3::text is null and team_server_id is null) or team_server_id::text=$3::text)`,
        [roster.tournament_id, roster.name, roster.clan_id || null],
      )
      return { roster: updated.rows[0], replayed: false }
    })
    return res.json({
      ok: true,
      replayed: result.replayed,
      roster: { ...result.roster, members: await tournamentMembers(pool, rosterId) },
    })
  }))

  router.post('/organizer/tournament-rosters/:rosterId/artifacts', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    const assetId = cleanText(req.body?.asset_id, 180)
    const reason = cleanText(req.body?.reason, 500)
    const mutationId = cleanText(req.body?.mutation_id || randomUUID(), 180)
    if (!actor || !UUID_RE.test(rosterId) || !assetId) {
      return res.status(400).json({ ok: false, error: 'valid_roster_and_artifact_required' })
    }
    const result = await deps.withTransaction(async (db) => {
      const roster = await one(db, 'select * from tournament_rosters where id=$1 for update', [rosterId])
      if (!roster) throw Object.assign(new Error('tournament_roster_not_found'), { status: 404 })
      const management = await canManageTournamentRoster(deps, db, actor, roster)
      if (!management.allowed) throw Object.assign(new Error('roster_manager_required'), { status: 403 })
      if (!await one(db, 'select id from assets where id=$1', [assetId])) {
        throw Object.assign(new Error('tournament_artifact_not_found'), { status: 404 })
      }
      if (!management.host && !await one(db, 'select id from asset_ownership where user_id=$1 and asset_id=$2', [actor.id, assetId])) {
        throw Object.assign(new Error('tournament_artifact_must_be_owned'), { status: 403 })
      }
      const replay = await one(db, 'select id from tournament_roster_revisions where mutation_id=$1', [mutationId])
      if (replay) return roster
      if (await one(db, 'select id from tournament_roster_artifacts where tournament_roster_id=$1 and asset_id=$2', [rosterId, assetId])) {
        throw Object.assign(new Error('tournament_artifact_already_attached'), { status: 409 })
      }
      const authorization = await authorizeArtifactAttachment(deps, db, actor, roster, management, reason, mutationId)
      await db.query(
        `insert into tournament_roster_artifacts
           (tournament_roster_id,asset_id,attached_by,entitlement_source,entitlement_ref,reason,mutation_id)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [rosterId, assetId, actor.id, authorization.source, authorization.ref, reason || null, mutationId],
      )
      const members = await tournamentMembers(db, rosterId)
      const version = Number(roster.version || 1) + 1
      const updated = await db.query(
        'update tournament_rosters set version=$2,updated_at=now() where id=$1 returning *',
        [rosterId, version],
      )
      await db.query(
        `insert into tournament_roster_revisions
           (tournament_roster_id,version,action,actor_id,reason,before_members,after_members,
            entitlement_source,entitlement_ref,mutation_id)
         values ($1,$2,'artifact_attached',$3,$4,$5,$5,$6,$7,$8)`,
        [rosterId, version, actor.id, reason || null, JSON.stringify(members), authorization.source, authorization.ref, mutationId],
      )
      return updated.rows[0]
    })
    return res.json({ ok: true, roster: { ...result, artifacts: await tournamentArtifacts(pool, rosterId) } })
  }))

  router.delete('/organizer/tournament-rosters/:rosterId/artifacts/:artifactId', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    const artifactId = String(req.params.artifactId || '')
    const reason = cleanText(req.body?.reason, 500)
    const mutationId = cleanText(req.body?.mutation_id || randomUUID(), 180)
    if (!actor || !UUID_RE.test(rosterId) || !UUID_RE.test(artifactId)) {
      return res.status(400).json({ ok: false, error: 'valid_roster_artifact_required' })
    }
    const result = await deps.withTransaction(async (db) => {
      const roster = await one(db, 'select * from tournament_rosters where id=$1 for update', [rosterId])
      if (!roster) throw Object.assign(new Error('tournament_roster_not_found'), { status: 404 })
      const management = await canManageTournamentRoster(deps, db, actor, roster)
      if (!management.allowed) throw Object.assign(new Error('roster_manager_required'), { status: 403 })
      const attachment = await one(db, 'select * from tournament_roster_artifacts where id=$1 and tournament_roster_id=$2', [artifactId, rosterId])
      if (!attachment) throw Object.assign(new Error('tournament_artifact_not_found'), { status: 404 })
      if (['submitted', 'approved'].includes(String(roster.status)) && !management.host) {
        throw Object.assign(new Error('locked_tournament_artifact_removal_requires_host'), { status: 409 })
      }
      if (['submitted', 'approved'].includes(String(roster.status)) && management.host && !reason) {
        throw Object.assign(new Error('host_override_reason_required'), { status: 400 })
      }
      const replay = await one(db, 'select id from tournament_roster_revisions where mutation_id=$1', [mutationId])
      if (replay) return roster
      await db.query('delete from tournament_roster_artifacts where id=$1', [artifactId])
      const members = await tournamentMembers(db, rosterId)
      const version = Number(roster.version || 1) + 1
      const updated = await db.query(
        'update tournament_rosters set version=$2,updated_at=now() where id=$1 returning *',
        [rosterId, version],
      )
      await db.query(
        `insert into tournament_roster_revisions
           (tournament_roster_id,version,action,actor_id,reason,before_members,after_members,
            entitlement_source,entitlement_ref,mutation_id)
         values ($1,$2,'artifact_removed',$3,$4,$5,$5,$6,$7,$8)`,
        [
          rosterId,
          version,
          actor.id,
          reason || null,
          JSON.stringify(members),
          management.host ? 'host_override' : null,
          management.host ? actor.id : null,
          mutationId,
        ],
      )
      return updated.rows[0]
    })
    return res.json({ ok: true, roster: { ...result, artifacts: await tournamentArtifacts(pool, rosterId) } })
  }))

  router.post('/organizer/tournament-rosters/:rosterId/submit', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    if (!actor || !UUID_RE.test(rosterId)) return res.status(400).json({ ok: false, error: 'valid_roster_required' })
    const updated = await deps.withTransaction(async (db) => {
      const roster = await one(db, 'select * from tournament_rosters where id=$1 for update', [rosterId])
      if (!roster) throw Object.assign(new Error('tournament_roster_not_found'), { status: 404 })
      const management = await canManageTournamentRoster(deps, db, actor, roster)
      if (!management.allowed) throw Object.assign(new Error('roster_manager_required'), { status: 403 })
      if (!['draft', 'changes_requested'].includes(String(roster.status))) {
        throw Object.assign(new Error(`roster_already_${roster.status}`), { status: 409 })
      }
      const members = await tournamentMembers(db, rosterId)
      if (members.length === 0) throw Object.assign(new Error('roster_needs_players'), { status: 409 })
      const version = Number(roster.version || 1) + 1
      const result = await db.query(
        `update tournament_rosters
            set status='submitted',version=$2,locked_at=coalesce(locked_at,now()),
                submitted_at=now(),change_request=null,updated_at=now()
          where id=$1 returning *`,
        [rosterId, version],
      )
      await db.query(
        `insert into tournament_roster_revisions
           (tournament_roster_id,version,action,actor_id,before_members,after_members,mutation_id)
         values ($1,$2,'submitted',$3,$4,$4,$5)`,
        [rosterId, version, actor.id, JSON.stringify(members), `submit:${rosterId}:${version}`],
      )
      await mirrorRosterEntrants(db, result.rows[0])
      return result.rows[0]
    })
    const tournament = await one(pool, 'select name,created_by from tournaments where id=$1', [updated.tournament_id])
    const admins = await pool.query('select user_id from tournament_admins where tournament_id=$1', [updated.tournament_id])
    const recipients = [...new Set([String(tournament?.created_by || ''), ...admins.rows.map((row) => String(row.user_id))].filter(Boolean))]
    for (const recipient of recipients) {
      await notify(pool, {
        userId: recipient,
        kind: 'tournament_roster_submitted',
        title: `${updated.name} submitted a roster`,
        body: `Review the locked lineup for ${tournament?.name || 'the tournament'}.`,
        link: `/tournaments/${updated.tournament_id}?section=rosters`,
        relatedId: rosterId,
        actorId: actor.id,
      })
    }
    await deps.pushUsers(recipients, {
      title: `${updated.name} submitted a roster`,
      body: `Review the locked lineup for ${tournament?.name || 'the tournament'}.`,
      url: `/tournaments/${updated.tournament_id}?section=rosters`,
      tag: `tournament-roster:${updated.tournament_id}`,
    }).catch(() => undefined)
    return res.json({ ok: true, roster: { ...updated, members: await tournamentMembers(pool, rosterId) } })
  }))

  router.post('/organizer/tournament-rosters/:rosterId/review', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const rosterId = String(req.params.rosterId || '')
    const decision = String(req.body?.decision || '')
    if (!actor || !['approve', 'request_changes', 'reject'].includes(decision)) {
      return res.status(400).json({ ok: false, error: 'valid_roster_review_required' })
    }
    const roster = await one(pool, 'select * from tournament_rosters where id=$1', [rosterId])
    if (!roster) return res.status(404).json({ ok: false, error: 'tournament_roster_not_found' })
    if (!await deps.isTournamentHost(pool, actor, String(roster.tournament_id))) {
      return res.status(403).json({ ok: false, error: 'tournament_host_required' })
    }
    if (roster.status !== 'submitted') return res.status(409).json({ ok: false, error: `roster_is_${roster.status}` })
    const reason = cleanText(req.body?.reason, 500)
    if (decision === 'request_changes' && !reason) {
      return res.status(400).json({ ok: false, error: 'change_request_reason_required' })
    }
    const status = decision === 'approve' ? 'approved' : decision === 'request_changes' ? 'changes_requested' : 'rejected'
    const updated = await deps.withTransaction(async (db) => {
      const locked = await one(db, 'select * from tournament_rosters where id=$1 for update', [rosterId])
      if (!locked || locked.status !== 'submitted') throw Object.assign(new Error('roster_reviewed_concurrently'), { status: 409 })
      const members = await tournamentMembers(db, rosterId)
      const version = Number(locked.version || 1) + 1
      const result = await db.query(
        `update tournament_rosters set status=$2,version=$3,change_request=$4,
                approved_at=case when $2='approved' then now() else null end,
                approved_by=case when $2='approved' then $5 else null end,
                updated_at=now()
          where id=$1 returning *`,
        [rosterId, status, version, reason || null, actor.id],
      )
      await db.query(
        `insert into tournament_roster_revisions
           (tournament_roster_id,version,action,actor_id,reason,before_members,after_members,mutation_id)
         values ($1,$2,$3,$4,$5,$6,$6,$7)`,
        [rosterId, version, status, actor.id, reason || null, JSON.stringify(members), `review:${rosterId}:${version}`],
      )
      if (status === 'approved') await mirrorRosterEntrants(db, result.rows[0])
      return result.rows[0]
    })
    const recipients = [...new Set((await tournamentMembers(pool, rosterId)).map((member) => String(member.user_id)))]
    for (const recipient of recipients) {
      await notify(pool, {
        userId: recipient,
        kind: 'tournament_roster_reviewed',
        title: status === 'approved' ? `${updated.name} roster approved` : status === 'changes_requested' ? `${updated.name} needs roster changes` : `${updated.name} roster rejected`,
        body: reason || null,
        link: `/tournaments/${updated.tournament_id}?section=rosters`,
        relatedId: rosterId,
        actorId: actor.id,
      })
    }
    await deps.pushUsers(recipients, {
      title: status === 'approved' ? `${updated.name} roster approved` : `${updated.name} roster reviewed`,
      body: reason || `Status: ${status.replace('_', ' ')}`,
      url: `/tournaments/${updated.tournament_id}?section=rosters`,
      tag: `tournament-roster:${rosterId}`,
    }).catch(() => undefined)
    return res.json({ ok: true, roster: { ...updated, members: await tournamentMembers(pool, rosterId) } })
  }))

  router.post('/organizer/tournaments/:tournamentId/packs', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const tournamentId = String(req.params.tournamentId || '')
    if (!actor || !await deps.isTournamentHost(pool, actor, tournamentId)) {
      return res.status(403).json({ ok: false, error: 'tournament_host_required' })
    }
    const tournament = await one(pool, 'select * from tournaments where id=$1', [tournamentId])
    if (!tournament || tournament.status === 'closed') return res.status(409).json({ ok: false, error: 'tournament_not_open' })
    const name = cleanText(req.body?.name, 120)
    const description = cleanText(req.body?.description, 1000)
    const priceCents = Math.max(0, Math.round(Number(req.body?.price_cents) || 0))
    const qualifyingAssetId = cleanText(req.body?.qualifying_asset_id, 180) || null
    const benefits = sanitizeTournamentPackBenefits(req.body?.benefits)
    if (!name || (!benefits.unlimited_roster_changes && benefits.roster_changes === 0 && benefits.artifact_slots === 0)) {
      return res.status(400).json({ ok: false, error: 'pack_name_and_benefit_required' })
    }
    if (priceCents > 0 && !deps.isAllowedPrice(priceCents)) {
      return res.status(400).json({ ok: false, error: 'invalid_price_tier' })
    }
    if (qualifyingAssetId && !await one(pool, 'select id from assets where id=$1', [qualifyingAssetId])) {
      return res.status(404).json({ ok: false, error: 'qualifying_artifact_not_found' })
    }
    const sellerTier = priceCents > 0 ? await deps.sellerTier(actor.id) : null
    if (priceCents > 0 && !sellerTier) {
      return res.status(403).json({ ok: false, error: 'seller_membership_required', minimum_tier: 'pro' })
    }
    const pack = await deps.withTransaction(async (db) => {
      let offerId: string | null = null
      if (priceCents > 0) {
        const offer = await db.query(
          `insert into creator_offers
             (seller_user_id,seller_type,offer_type,name,description,image_url,price_cents,
              billing_interval,cash_enabled,paid_sweeps_enabled,giftable)
           values ($1,'creator','tournament_pack',$2,$3,$4,$5,'one_time',true,true,true)
           returning *`,
          [actor.id, name, description, req.body?.image_url ? cleanText(req.body.image_url, 2000) : null, priceCents],
        )
        offerId = String(offer.rows[0].id)
      }
      const inserted = await db.query(
        `insert into tournament_perk_packs
           (tournament_id,organizer_id,offer_id,qualifying_asset_id,name,description,image_url,
            price_cents,benefits)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [
          tournamentId,
          actor.id,
          offerId,
          qualifyingAssetId,
          name,
          description,
          req.body?.image_url ? cleanText(req.body.image_url, 2000) : null,
          priceCents,
          JSON.stringify(benefits),
        ],
      )
      return inserted.rows[0]
    })
    return res.status(201).json({ ok: true, pack })
  }))

  router.post('/organizer/tournament-packs/:packId/grants', auth, asyncRoute(async (req, res) => {
    const actor = await deps.loadActor(req)
    const packId = String(req.params.packId || '')
    const pack = await one(pool, 'select * from tournament_perk_packs where id=$1', [packId])
    if (!actor || !pack || !await deps.isTournamentHost(pool, actor, String(pack.tournament_id))) {
      return res.status(403).json({ ok: false, error: 'tournament_host_required' })
    }
    const userId = cleanText(req.body?.user_id, 80) || null
    const rosterId = cleanText(req.body?.tournament_roster_id, 80) || null
    if ((!userId && !rosterId) || (userId && !UUID_RE.test(userId)) || (rosterId && !UUID_RE.test(rosterId))) {
      return res.status(400).json({ ok: false, error: 'grant_recipient_required' })
    }
    if (userId && !await one(pool, 'select id from profiles where id=$1', [userId])) {
      return res.status(404).json({ ok: false, error: 'player_not_found' })
    }
    if (rosterId && !await one(pool, 'select id from tournament_rosters where id=$1 and tournament_id=$2', [rosterId, pack.tournament_id])) {
      return res.status(404).json({ ok: false, error: 'tournament_roster_not_found' })
    }
    const existing = await one(
      pool,
      `select * from tournament_perk_grants
        where pack_id=$1 and status='active'
          and (($2::text is null and user_id is null) or user_id::text=$2::text)
          and (($3::text is null and tournament_roster_id is null) or tournament_roster_id::text=$3::text)`,
      [packId, userId, rosterId],
    )
    if (existing) return res.json({ ok: true, grant: existing, reused: true })
    const inserted = await pool.query(
      `insert into tournament_perk_grants
         (pack_id,user_id,tournament_roster_id,granted_by,note)
       values ($1,$2,$3,$4,$5) returning *`,
      [packId, userId, rosterId, actor.id, cleanText(req.body?.note, 500) || null],
    )
    if (userId) {
      await notify(pool, {
        userId,
        kind: 'tournament_perk_granted',
        title: `${pack.name} granted to you`,
        body: pack.description || 'This perk can be used during the tournament.',
        link: `/tournaments/${pack.tournament_id}?section=perks`,
        relatedId: packId,
        actorId: actor.id,
      })
    }
    return res.status(201).json({ ok: true, grant: inserted.rows[0] })
  }))
}
