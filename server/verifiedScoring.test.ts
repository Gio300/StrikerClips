import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeDb } from './testHarness'
import {
  canonicalizeCombatEvidence,
  reconcileVerifiedMatchScoring,
  resultEvidenceCompatible,
  verifiedResultEvidence,
  type RawCombatEvidence,
  type RawResultEvidence,
} from './verifiedScoring'

function ko(overrides: Partial<RawCombatEvidence> = {}): RawCombatEvidence {
  return {
    id: 'event-a',
    sourceId: 'source-a',
    sourceOwnerId: 'killer',
    eventType: 'ko',
    killerProfileId: 'killer',
    victimProfileId: 'victim',
    matchClockSec: 182,
    confidence: 0.95,
    ...overrides,
  }
}

function result(overrides: Partial<RawResultEvidence> = {}): RawResultEvidence {
  return {
    id: 'result-a',
    sourceId: 'source-a',
    sourceOwnerId: 'winner',
    outcome: 'victory',
    scoreLine: '3-1',
    explicitEvidence: true,
    confidence: 0.96,
    ...overrides,
  }
}

describe('verified scoring evidence', () => {
  it('collapses the killer and victim camera reads into one KO', () => {
    const events = canonicalizeCombatEvidence([
      ko(),
      ko({ id: 'event-b', sourceId: 'source-b', sourceOwnerId: 'victim', matchClockSec: 179 }),
    ])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ killerProfileId: 'killer', victimProfileId: 'victim' })
    expect(events[0].rawEventIds).toEqual(['event-b', 'event-a'])
  })

  it('does not verify two uploads owned by the same player', () => {
    expect(canonicalizeCombatEvidence([
      ko(),
      ko({ id: 'event-b', sourceId: 'source-b', sourceOwnerId: 'killer' }),
    ])).toEqual([])
  })

  it('does not combine similar kills outside the clock tolerance', () => {
    expect(canonicalizeCombatEvidence([
      ko(),
      ko({ id: 'event-b', sourceId: 'source-b', sourceOwnerId: 'victim', matchClockSec: 170 }),
    ])).toEqual([])
  })

  it('requires explicit, independent, compatible result screens', () => {
    const winner = result()
    const loser = result({
      id: 'result-b',
      sourceId: 'source-b',
      sourceOwnerId: 'loser',
      outcome: 'defeat',
      scoreLine: '1-3',
    })
    expect(resultEvidenceCompatible(winner, loser)).toBe(true)
    expect(verifiedResultEvidence([winner, loser])).toEqual(new Set(['result-a', 'result-b']))
    expect(resultEvidenceCompatible(winner, { ...loser, sourceOwnerId: 'winner' })).toBe(false)
    expect(resultEvidenceCompatible(winner, { ...loser, explicitEvidence: false })).toBe(false)
  })

  it('credits one verified win to power once across two camera views', async () => {
    const db = makeDb()
    const winnerId = randomUUID()
    const loserId = randomUUID()
    const matchId = randomUUID()
    const winnerSource = randomUUID()
    const loserSource = randomUUID()
    const winnerSegment = randomUUID()
    const loserSegment = randomUUID()

    await db.query(
      `insert into profiles (id,username,power_level) values ($1,'winner',0),($2,'loser',0)`,
      [winnerId, loserId],
    )
    await db.query(
      `insert into match_groups (id,signature,sig_hash) values ($1,'verified match',$2)`,
      [matchId, `verified-${matchId}`],
    )
    await db.query(
      `insert into media_sources
         (id,owner_id,provider,source_kind,source_url,source_fingerprint,status)
       values
         ($1,$2,'tko','direct_upload','https://tko.cam/winner.mp4',$3,'complete'),
         ($4,$5,'tko','direct_upload','https://tko.cam/loser.mp4',$6,'complete')`,
      [winnerSource, winnerId, `winner-${matchId}`, loserSource, loserId, `loser-${matchId}`],
    )
    await db.query(
      `insert into match_segments
         (id,source_id,segment_index,segment_fingerprint,start_sec,end_sec,start_reason,end_reason,
          boundary_confidence,match_group_id)
       values
         ($1,$2,0,$3,0,120,'start','result',0.99,$4),
         ($5,$6,0,$7,0,120,'start','result',0.99,$4)`,
      [winnerSegment, winnerSource, `winner-segment-${matchId}`, matchId,
        loserSegment, loserSource, `loser-segment-${matchId}`],
    )
    await db.query(
      `insert into clip_records
         (player_id,match_id,source_id,segment_id,score_verification_status)
       values ($1,$2,$3,$4,'shadow'),($5,$2,$6,$7,'shadow')`,
      [winnerId, matchId, winnerSource, winnerSegment, loserId, loserSource, loserSegment],
    )
    await db.query(
      `insert into combat_events
         (source_id,segment_id,match_group_id,event_fingerprint,event_type,at_sec,match_clock_sec,
          killer_profile_id,victim_profile_id,verification_status,confidence)
       values
         ($1,$2,$3,$4,'ko',20,182,$5,$6,'single_camera',0.96),
         ($7,$8,$3,$9,'death',22,180,$5,$6,'single_camera',0.94)`,
      [winnerSource, winnerSegment, matchId, `winner-ko-${matchId}`, winnerId, loserId,
        loserSource, loserSegment, `loser-death-${matchId}`],
    )
    await db.query(
      `insert into match_result_observations
         (source_id,segment_id,match_group_id,owner_profile_id,outcome,kills,deaths,assists,
          score_line,at_sec,explicit_evidence,verification_status,confidence)
       values
         ($1,$2,$3,$4,'victory',3,1,0,'3-1',119,true,'single_camera',0.98),
         ($5,$6,$3,$7,'defeat',1,3,0,'1-3',119,true,'single_camera',0.98)`,
      [winnerSource, winnerSegment, matchId, winnerId, loserSource, loserSegment, loserId],
    )

    const first = await reconcileVerifiedMatchScoring(db, matchId)
    const second = await reconcileVerifiedMatchScoring(db, matchId)
    expect(first).toMatchObject({ combatEvents: 1, verifiedResults: 2 })
    expect(second).toMatchObject({ combatEvents: 1, verifiedResults: 2 })

    const powers = await db.query(
      `select id,power_level from profiles where id in ($1,$2)`,
      [winnerId, loserId],
    )
    const byId = new Map(powers.rows.map((row) => [String(row.id), Number(row.power_level)]))
    expect(byId.get(winnerId)).toBe(315)
    expect(byId.get(loserId)).toBe(0)
    expect((await db.query(
      `select count(*)::int as count from verified_combat_events where match_group_id=$1`,
      [matchId],
    )).rows[0].count).toBe(1)
  })
})
