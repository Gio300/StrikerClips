import {
  normalizeReelUsePrivacy,
  type ReelUseContext,
  type ReelUsePrivacy,
} from '../src/lib/reelPrivacy'

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> }

async function reelPrivacy(db: Queryable, ownerUserId: string): Promise<ReelUsePrivacy> {
  const result = await db.query('select reel_usage_privacy from profiles where id=$1', [ownerUserId])
  return normalizeReelUsePrivacy(result.rows[0]?.reel_usage_privacy)
}

async function follows(db: Queryable, followerId: string, followingId: string): Promise<boolean> {
  const result = await db.query(
    'select 1 from follows where follower_id=$1 and following_id=$2 limit 1',
    [followerId, followingId],
  )
  return result.rows.length > 0
}

async function followsFollower(db: Queryable, actorUserId: string, ownerUserId: string): Promise<boolean> {
  const result = await db.query(
    `select 1
       from follows actor_follow
       join follows owner_follow
         on owner_follow.follower_id=actor_follow.following_id
      where actor_follow.follower_id=$1
        and owner_follow.following_id=$2
      limit 1`,
    [actorUserId, ownerUserId],
  )
  return result.rows.length > 0
}

async function clanIdsForUser(db: Queryable, userId: string): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const query of [
    'select server_id from clan_members where user_id=$1',
    'select server_id from server_members where user_id=$1',
    'select id as server_id from servers where owner_id=$1',
  ]) {
    try {
      const result = await db.query(query, [userId])
      for (const row of result.rows) if (row.server_id) ids.add(String(row.server_id))
    } catch { /* older/slim schemas may omit one membership table */ }
  }
  return ids
}

function intersects(left: Set<string>, right: Set<string>): boolean {
  for (const value of left) if (right.has(value)) return true
  return false
}

async function sharesClan(db: Queryable, actorUserId: string, ownerUserId: string): Promise<boolean> {
  const [actorClans, ownerClans] = await Promise.all([
    clanIdsForUser(db, actorUserId),
    clanIdsForUser(db, ownerUserId),
  ])
  return intersects(actorClans, ownerClans)
}

async function isOfficerInOwnersClan(
  db: Queryable,
  actorUserId: string,
  ownerUserId: string,
): Promise<boolean> {
  const ownerClans = await clanIdsForUser(db, ownerUserId)
  if (ownerClans.size === 0) return false
  const managed = new Set<string>()
  try {
    const result = await db.query(
      `select server_id from clan_members
        where user_id=$1 and lower(coalesce(role,'member')) in ('owner','leader','officer','captain')`,
      [actorUserId],
    )
    for (const row of result.rows) if (row.server_id) managed.add(String(row.server_id))
  } catch { /* keep checking the canonical servers.owner_id path */ }
  try {
    const result = await db.query('select id as server_id from servers where owner_id=$1', [actorUserId])
    for (const row of result.rows) if (row.server_id) managed.add(String(row.server_id))
  } catch { /* slim schema */ }
  return intersects(managed, ownerClans)
}

/** Server-authoritative answer for another account reusing a player's footage. */
export async function canUsePlayerReels(
  db: Queryable,
  input: {
    ownerUserId: string
    actorUserId: string
    context: ReelUseContext
  },
): Promise<boolean> {
  const ownerUserId = String(input.ownerUserId || '')
  const actorUserId = String(input.actorUserId || '')
  if (!ownerUserId || !actorUserId) return false
  if (ownerUserId === actorUserId) return true

  const privacy = await reelPrivacy(db, ownerUserId)
  if (privacy === 'anyone') return true
  if (privacy === 'only_me') return false
  if (privacy === 'tournaments') return input.context === 'tournament'
  if (privacy === 'lives') return input.context === 'live'
  if (privacy === 'followers') return follows(db, actorUserId, ownerUserId)
  if (privacy === 'followers_of_followers') {
    return (await follows(db, actorUserId, ownerUserId))
      || followsFollower(db, actorUserId, ownerUserId)
  }
  if (privacy === 'clan_members') return sharesClan(db, actorUserId, ownerUserId)
  if (privacy === 'clan_officers') return isOfficerInOwnersClan(db, actorUserId, ownerUserId)
  return false
}
