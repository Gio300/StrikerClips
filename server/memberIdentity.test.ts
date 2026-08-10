import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { makeDb } from './testHarness'
import { decideAliasPromotion, observeOwnedAlias } from './memberIdentity'

describe('member alias promotion', () => {
  it('waits for two independent member-owned sources', () => {
    expect(decideAliasPromotion([
      { sourceId: 'source-1', evidenceType: 'owned_hud', accountOwned: true, confidence: 0.96 },
    ], false)).toMatchObject({ status: 'candidate' })

    expect(decideAliasPromotion([
      { sourceId: 'source-1', evidenceType: 'owned_hud', accountOwned: true, confidence: 0.96 },
      { sourceId: 'source-2', evidenceType: 'owned_hud', accountOwned: true, confidence: 0.91 },
    ], false)).toMatchObject({ status: 'verified' })
  })

  it('does not count repeated frames from one upload as separate proof', () => {
    expect(decideAliasPromotion([
      { sourceId: 'same-source', evidenceType: 'owned_hud', accountOwned: true, confidence: 0.99 },
      { sourceId: 'same-source', evidenceType: 'owned_hud', accountOwned: true, confidence: 0.94 },
    ], false)).toMatchObject({ status: 'candidate' })
  })

  it('allows explicit account confirmation but never overrides an identity collision', () => {
    const proof = [{ sourceId: 'source-1', evidenceType: 'account_confirmation', accountOwned: true, confidence: 0.99 }]
    expect(decideAliasPromotion(proof, false)).toMatchObject({ status: 'verified' })
    expect(decideAliasPromotion(proof, true)).toMatchObject({ status: 'ambiguous' })
  })

  it('backfills unresolved combat evidence after a detected alias is confirmed', async () => {
    const db = makeDb()
    const ownerId = randomUUID()
    const victimId = randomUUID()
    const sourceId = randomUUID()
    const segmentId = randomUUID()
    const recordedAt = new Date().toISOString()
    await db.query(
      `insert into profiles (id,username) values ($1,'hammy-account'),($2,'opponent')`,
      [ownerId, victimId],
    )
    await db.query(
      `insert into media_sources
         (id,owner_id,provider,source_kind,source_url,source_fingerprint,status,recorded_at)
       values ($1,$2,'youtube','youtube_upload','https://youtu.be/hammy',$3,'complete',$4)`,
      [sourceId, ownerId, `hammy-source-${sourceId}`, recordedAt],
    )
    await db.query(
      `insert into match_segments
         (id,source_id,segment_index,segment_fingerprint,start_sec,end_sec,start_reason,end_reason,
          boundary_confidence)
       values ($1,$2,0,$3,0,120,'start','result',0.99)`,
      [segmentId, sourceId, `hammy-segment-${segmentId}`],
    )
    await db.query(
      `insert into match_member_observations
         (segment_id,detected_alias,normalized_alias,resolution_status,confidence,observed_at)
       values ($1,'HammyNew','hammynew','unresolved',0.99,$2)`,
      [segmentId, recordedAt],
    )
    await db.query(
      `insert into combat_events
         (source_id,segment_id,event_fingerprint,event_type,at_sec,match_clock_sec,killer_alias,
          victim_alias,victim_profile_id,verification_status,confidence)
       values ($1,$2,$3,'ko',20,182,'HammyNew','Opponent',$4,'candidate',0.96)`,
      [sourceId, segmentId, `hammy-ko-${segmentId}`, victimId],
    )

    const observed = await observeOwnedAlias(db, {
      profileId: ownerId,
      sourceId,
      segmentId,
      displayAlias: 'HammyNew',
      observedAt: recordedAt,
      confidence: 1,
      evidenceType: 'account_confirmation',
    })
    expect(observed.decision.status).toBe('verified')

    const event = (await db.query(
      `select killer_profile_id,verification_status from combat_events where source_id=$1`,
      [sourceId],
    )).rows[0]
    expect(String(event.killer_profile_id)).toBe(ownerId)
    expect(event.verification_status).toBe('single_camera')
    const member = (await db.query(
      `select resolved_profile_id,resolution_status from match_member_observations where segment_id=$1`,
      [segmentId],
    )).rows[0]
    expect(String(member.resolved_profile_id)).toBe(ownerId)
    expect(member.resolution_status).toBe('resolved')
  })
})
