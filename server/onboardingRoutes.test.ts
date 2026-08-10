/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from './app'
import { makeDb } from './testHarness'
import { parseOnboardingText, type OnboardingVideoMetadata } from './onboardingRoutes'

const VIDEO: OnboardingVideoMetadata = {
  videoUrl: 'https://www.youtube.com/watch?v=e2eplay01',
  videoId: 'e2eplay01',
  videoTitle: 'Full Shinobi Striker match',
  thumbnailUrl: 'https://i.ytimg.com/vi/e2eplay01/hqdefault.jpg',
  channelId: 'UCabcdefghijklmnopqrstuv',
  channelUrl: 'https://www.youtube.com/@OnboardingPlayer',
  channelTitle: 'Onboarding Player',
}

describe('chat-centric onboarding routes', () => {
  let pool: any
  let app: any
  let resolvedVideo: OnboardingVideoMetadata
  let pushes: Array<Record<string, any>>

  beforeEach(() => {
    pool = makeDb()
    resolvedVideo = VIDEO
    pushes = []
    app = createApp(pool, {
      resolveOnboardingVideo: async () => resolvedVideo,
      sendOnboardingPush: async (userIds, payload) => {
        const applications = await pool.query('select id from clan_applications')
        pushes.push({ userIds, payload, committedApplicationCount: applications.rows.length })
      },
    })
  })

  async function signup(username: string) {
    const response = await request(app).post('/api/auth/signup').send({
      email: `${username.toLowerCase()}@tko.test`,
      password: 'password123',
      username,
      age_consent_13_plus: true,
    })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return {
      id: String(response.body.user.id),
      token: String(response.body.token),
      auth: { authorization: `Bearer ${response.body.token}` },
    }
  }

  it('requires authentication on every onboarding surface', async () => {
    expect((await request(app).get('/api/onboarding')).status).toBe(401)
    expect((await request(app).get('/api/onboarding/disputes')).status).toBe(401)
    expect((await request(app).post('/api/onboarding/turn').send({ text: 'solo', revision: 0 })).status).toBe(401)
    expect((await request(app).post('/api/onboarding/video').send({ url: VIDEO.videoUrl, revision: 0 })).status).toBe(401)
    expect((await request(app).post('/api/onboarding/defer').send({ revision: 0 })).status).toBe(401)
    expect((await request(app).post('/api/onboarding/actions/confirm-selected').send({ revision: 0 })).status).toBe(401)
  })

  it('understands natural solo/member language without treating "on my own" as clan ownership', () => {
    expect(parseOnboardingText("I'm on my own with no crew").lane).toBe('solo')
    expect(parseOnboardingText("People call me BrowserNova. I'm on my own with no clan.")).toMatchObject({
      lane: 'solo',
      facts: { game_tag: 'BrowserNova' },
    })
    expect(parseOnboardingText('I belong to Hidden Rain [HR]').lane).toBe('member')
    expect(parseOnboardingText('I belong to Hidden Rain [HR]').facts).toMatchObject({ clan_name: 'Hidden Rain', clan_tag: 'HR' })
  })

  it('lets explicit solo language veto bad model clan facts before any clan write', async () => {
    const modelClanNames = ['with no', 'solo', 'a clan', 'a crew']
    const messages = [
      "People call me BrowserNova. I'm on my own with no clan.",
      'Call me LoneWolf. I play solo.',
      "My handle is RainFree. I don't have a clan.",
      "I'm known as RogueLeaf. I'm not in a crew.",
    ]
    for (const [index, text] of messages.entries()) {
      const player = await signup(`SoloVeto${index}`)
      const badClanName = modelClanNames[index]
      const appWithBadFact = createApp(pool, {
        interpretOnboardingText: async () => ({
          lane: 'leader', roles: ['leader'], facts: { clan_name: badClanName },
        }),
      })
      const turn = await request(appWithBadFact).post('/api/onboarding/turn').set(player.auth)
        .send({ text, revision: 0 })

      expect(turn.status, JSON.stringify(turn.body)).toBe(200)
      expect(turn.body.state).toMatchObject({ status: 'complete', lane: 'solo' })
      expect(turn.body.state.facts.clan_name).toBeUndefined()
      expect(turn.body.actions.some((action: any) => (
        ['create_clan', 'create_roster', 'apply_clan', 'claim_clan'].includes(action.kind)
      ))).toBe(false)
    }

    expect((await pool.query("select count(*)::int as count from servers where kind='clan'")).rows[0].count).toBe(0)
    expect((await pool.query('select count(*)::int as count from clan_rosters')).rows[0].count).toBe(0)
  })

  it('does not consume an ambiguous or model-outage turn as a gamer tag or clan name', async () => {
    const player = await signup('AmbiguousPlayer')
    const role = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: "I'm in a clan", revision: 0,
    })
    expect(role.body.state).toMatchObject({ revision: 1, lane: 'member', current_step: 'identity' })

    const ambiguous = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: "I don't know", revision: 1,
    })
    expect(ambiguous.status, JSON.stringify(ambiguous.body)).toBe(200)
    expect(ambiguous.body.state).toMatchObject({ revision: 1, current_step: 'identity' })
    expect(ambiguous.body.actions).toEqual([])
    expect((await pool.query('select game_tag from profiles where id=$1', [player.id])).rows[0].game_tag).toBeNull()
  })

  it('uses the language interpreter on a turn and passes the active lane and step', async () => {
    const calls: any[] = []
    const interpretedApp = createApp(pool, {
      interpretOnboardingText: async (text, facts, context) => {
        calls.push({ text, facts, context })
        return { lane: 'solo', roles: ['solo'], facts: { game_tag: 'RainNinja' } }
      },
    })
    const response = await request(interpretedApp).post('/api/auth/signup').send({
      email: 'interpreted@tko.test', password: 'password123', username: 'InterpreterAccount', age_consent_13_plus: true,
    })
    const turn = await request(interpretedApp).post('/api/onboarding/turn')
      .set({ authorization: `Bearer ${response.body.token}` })
      .send({ text: 'Around here they call me RainNinja', revision: 0 })
    expect(turn.status, JSON.stringify(turn.body)).toBe(200)
    expect(turn.body.state).toMatchObject({ status: 'complete', lane: 'solo', facts: { game_tag: 'RainNinja' } })
    expect(calls).toEqual([expect.objectContaining({
      text: 'Around here they call me RainNinja',
      context: { lane: null, current_step: 'identity' },
    })])
  })

  it('keeps an explicit natural handle when the model supplies the clan but disagrees with the handle', async () => {
    const owner = await signup('CanaryCrewOwner')
    const clan = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Canary Crew','CC',$1,'clan',true,100) returning id`,
      [owner.id],
    )).rows[0]
    await pool.query("insert into clan_members (server_id,user_id,role) values ($1,$2,'leader')", [clan.id, owner.id])

    const interpretedApp = createApp(pool, {
      interpretOnboardingText: async () => ({
        lane: 'member',
        roles: ['member'],
        facts: { clan_name: 'Canary Crew', clan_tag: 'CC', game_tag: 'ModelGuess' },
      }),
    })
    const signupResponse = await request(interpretedApp).post('/api/auth/signup').send({
      email: 'mistguest@tko.test', password: 'password123', username: 'MistGuestAccount', age_consent_13_plus: true,
    })
    const playerId = String(signupResponse.body.user.id)
    const auth = { authorization: `Bearer ${signupResponse.body.token}` }
    const text = 'People call me MistGuest. Canary Crew is the crew I belong to.'
    const turn = await request(interpretedApp).post('/api/onboarding/turn').set(auth).send({ text, revision: 0 })

    expect(turn.status, JSON.stringify(turn.body)).toBe(200)
    expect(turn.body.state).toMatchObject({
      status: 'complete', lane: 'member',
      facts: { game_tag: 'MistGuest', clan_name: 'Canary Crew', clan_application_status: 'pending' },
    })
    expect(turn.body.actions).toContainEqual(expect.objectContaining({
      kind: 'update_identity', status: 'done', payload: expect.objectContaining({ game_tag: 'MistGuest' }),
    }))
    expect((await pool.query('select game_tag from profiles where id=$1', [playerId])).rows)
      .toEqual([{ game_tag: 'MistGuest' }])
    expect((await pool.query(
      'select status from clan_applications where server_id=$1 and applicant_id=$2', [clan.id, playerId],
    )).rows).toEqual([{ status: 'pending' }])
  })

  it('persists a solo identity and claimed gameplay channel into normal app tables idempotently', async () => {
    const player = await signup('SoloAccount')
    const initial = await request(app).get('/api/onboarding').set(player.auth)
    expect(initial.status).toBe(200)
    expect(initial.body).toMatchObject({
      state: { status: 'new', current_step: 'identity', revision: 0, lane: null },
      actions: [],
    })
    expect(typeof initial.body.prompt).toBe('string')

    const turn = await request(app)
      .post('/api/onboarding/turn')
      .set(player.auth)
      .send({
        text: "I'm SoloOne, I play solo on PlayStation and play Shinobi Striker.",
        revision: 0,
      })
    expect(turn.status, JSON.stringify(turn.body)).toBe(200)
    expect(turn.body.state).toMatchObject({ status: 'complete', current_step: 'complete', revision: 1, lane: 'solo' })
    expect(turn.body.actions).toContainEqual(expect.objectContaining({ kind: 'update_identity', status: 'done' }))

    const video = await request(app)
      .post('/api/onboarding/video')
      .set(player.auth)
      .send({ url: 'https://youtu.be/e2eplay01', revision: 1 })
    expect(video.status, JSON.stringify(video.body)).toBe(200)
    expect(video.body.state).toMatchObject({ status: 'complete', current_step: 'complete', revision: 2 })
    expect(video.body.actions).toContainEqual(expect.objectContaining({ kind: 'connect_youtube', status: 'proposed' }))

    const confirmed = await request(app)
      .post('/api/onboarding/actions/confirm-selected')
      .set(player.auth)
      .send({ revision: 2 })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.state).toMatchObject({ status: 'complete', current_step: 'complete', revision: 3 })
    expect(confirmed.body.actions.every((action: any) => action.status === 'done')).toBe(true)

    expect((await pool.query('select game_tag from profiles where id=$1', [player.id])).rows[0].game_tag).toBe('SoloOne')
    expect((await pool.query(
      `select display_alias,status,is_primary from player_aliases where profile_id=$1`,
      [player.id],
    )).rows).toEqual([expect.objectContaining({ display_alias: 'SoloOne', status: 'candidate', is_primary: false })])
    expect((await pool.query(
      'select url,channel_id,claim_status from user_youtube_links where user_id=$1',
      [player.id],
    )).rows).toEqual([expect.objectContaining({ channel_id: VIDEO.channelId, claim_status: 'claimed' })])
    // The onboarding sample is intentionally outside the scoring pipeline.
    expect((await pool.query('select id from media_sources where owner_id=$1', [player.id])).rows).toEqual([])
    expect((await pool.query('select status,media_source_id from onboarding_video_reports where user_id=$1', [player.id])).rows)
      .toEqual([expect.objectContaining({ status: 'connected' })])
    expect((await pool.query('select count(*)::int as count from media_analysis_jobs')).rows[0].count).toBe(0)

    const replay = await request(app)
      .post(`/api/onboarding/actions/${confirmed.body.actions[0].id}/confirm`)
      .set(player.auth)
      .send({ revision: 3 })
    expect(replay.status).toBe(200)
    expect((await pool.query('select count(*)::int as count from player_aliases where profile_id=$1', [player.id])).rows[0].count).toBe(1)
    expect((await pool.query('select count(*)::int as count from user_youtube_links where user_id=$1', [player.id])).rows[0].count).toBe(1)

    const stale = await request(app).post('/api/onboarding/defer').set(player.auth).send({ revision: 3 })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ error: 'revision_conflict', state: { revision: 4 } })
    expect(Array.isArray(stale.body.actions)).toBe(true)
  })

  it('keeps a clan member on the clan-name step after confirming their gamer tag', async () => {
    const player = await signup('ClanStepAccount')

    const memberLane = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: "I'm in a clan",
      revision: 0,
    })
    expect(memberLane.status, JSON.stringify(memberLane.body)).toBe(200)
    expect(memberLane.body.state).toMatchObject({
      status: 'active', current_step: 'identity', revision: 1, lane: 'member',
    })

    const gamerTag = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: 'ClanStepPlayer',
      revision: 1,
    })
    expect(gamerTag.status, JSON.stringify(gamerTag.body)).toBe(200)
    expect(gamerTag.body.state).toMatchObject({
      status: 'active', current_step: 'clan', revision: 2, lane: 'member',
    })
    expect(gamerTag.body.prompt).toBe("What's your clan's exact name or tag?")
    const identityAction = gamerTag.body.actions.find((action: any) => action.kind === 'update_identity')
    expect(identityAction).toMatchObject({ status: 'done' })

    const confirmed = await request(app)
      .post('/api/onboarding/actions/confirm-selected')
      .set(player.auth)
      .send({ revision: 2, action_ids: [identityAction.id] })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.state).toMatchObject({
      status: 'active', current_step: 'clan', revision: 3, lane: 'member',
    })
    expect(confirmed.body.prompt).toBe("What's your clan's exact name or tag?")
  })

  it('creates a leader clan, both memberships, chat, and a saved roster visible through organizer reads', async () => {
    const player = await signup('KageAccount')
    const turn = await request(app)
      .post('/api/onboarding/turn')
      .set(player.auth)
      .send({
        text: "I'm KageOne, I run Hidden Blood [HB], I play Shinobi Striker on PlayStation and want to build our roster.",
        revision: 0,
      })
    expect(turn.status, JSON.stringify(turn.body)).toBe(200)
    expect(turn.body.state).toMatchObject({ status: 'complete', current_step: 'complete', lane: 'leader', revision: 1 })
    expect(turn.body.actions.map((action: any) => action.kind)).toEqual(expect.arrayContaining([
      'update_identity', 'create_clan', 'create_roster',
    ]))
    expect(turn.body.actions.filter((action: any) => ['update_identity', 'create_clan', 'create_roster'].includes(action.kind)))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'update_identity', status: 'done' }),
        expect.objectContaining({ kind: 'create_clan', status: 'done' }),
        expect.objectContaining({ kind: 'create_roster', status: 'done' }),
      ]))

    const confirmed = await request(app)
      .post('/api/onboarding/actions/confirm-selected')
      .set(player.auth)
      .send({ revision: 1 })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.actions.every((action: any) => action.status === 'done')).toBe(true)

    const clan = (await pool.query("select * from servers where owner_id=$1 and kind='clan'", [player.id])).rows[0]
    expect(clan).toMatchObject({ name: 'Hidden Blood', clan_tag: 'HB' })
    expect((await pool.query('select role from clan_members where server_id=$1 and user_id=$2', [clan.id, player.id])).rows)
      .toEqual([{ role: 'leader' }])
    expect((await pool.query('select role from server_members where server_id=$1 and user_id=$2', [clan.id, player.id])).rows)
      .toEqual([{ role: 'leader' }])
    expect((await pool.query("select name from channels where server_id=$1 and name='general'", [clan.id])).rows)
      .toEqual([{ name: 'general' }])
    expect((await pool.query("select id from chat_spaces where clan_id=$1 and kind='clan'", [clan.id])).rows).toHaveLength(1)

    const normalClans = await request(app).get('/api/organizer/clans/mine').set(player.auth)
    expect(normalClans.status, JSON.stringify(normalClans.body)).toBe(200)
    expect(normalClans.body.clans).toContainEqual(expect.objectContaining({ id: clan.id, name: 'Hidden Blood' }))
    const normalRosters = await request(app).get('/api/organizer/clan-rosters/mine').set(player.auth)
    expect(normalRosters.status, JSON.stringify(normalRosters.body)).toBe(200)
    expect(normalRosters.body.rosters).toContainEqual(expect.objectContaining({
      server_id: clan.id,
      members: [expect.objectContaining({ user_id: player.id, member_role: 'captain' })],
    }))

    const countsBefore = {
      clans: (await pool.query("select count(*)::int as count from servers where owner_id=$1 and kind='clan'", [player.id])).rows[0].count,
      rosters: (await pool.query('select count(*)::int as count from clan_rosters where server_id=$1', [clan.id])).rows[0].count,
    }
    const replay = await request(app)
      .post('/api/onboarding/actions/confirm-selected')
      .set(player.auth)
      .send({ revision: 2 })
    expect(replay.status).toBe(200)
    expect((await pool.query("select count(*)::int as count from servers where owner_id=$1 and kind='clan'", [player.id])).rows[0].count).toBe(countsBefore.clans)
    expect((await pool.query('select count(*)::int as count from clan_rosters where server_id=$1', [clan.id])).rows[0].count).toBe(countsBefore.rosters)
  })

  it('uses conversation state for bare answers and supersedes corrected singleton proposals', async () => {
    const player = await signup('CorrectionAccount')
    const role = await request(app).post('/api/onboarding/turn').set(player.auth)
      .send({ text: 'I run a clan', revision: 0 })
    expect(role.body.state).toMatchObject({ lane: 'leader', revision: 1 })

    const tag = await request(app).post('/api/onboarding/turn').set(player.auth)
      .send({ text: 'FirstKage', revision: 1 })
    expect(tag.body.state.facts.game_tag).toBe('FirstKage')

    const clan = await request(app).post('/api/onboarding/turn').set(player.auth)
      .send({ text: 'Old Blood', revision: 2 })
    expect(clan.body.state.facts.clan_name).toBe('Old Blood')

    const corrected = await request(app).post('/api/onboarding/turn').set(player.auth)
      .send({
        text: 'Actually, my gamer tag is FinalKage and my clan is New Blood [NB].',
        revision: 3,
      })
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200)
    expect(corrected.body.state).toMatchObject({ status: 'complete', current_step: 'complete' })
    expect(corrected.body.actions).toContainEqual(expect.objectContaining({
      kind: 'update_identity', status: 'done', payload: expect.objectContaining({ game_tag: 'FinalKage' }),
    }))
    expect(corrected.body.actions).toContainEqual(expect.objectContaining({
      kind: 'create_clan', status: 'done', payload: expect.objectContaining({ name: 'New Blood' }),
    }))

    const confirmed = await request(app).post('/api/onboarding/actions/confirm-selected').set(player.auth)
      .send({ revision: 4 })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect((await pool.query('select username,game_tag from profiles where id=$1', [player.id])).rows[0])
      .toEqual({ username: 'FinalKage', game_tag: 'FinalKage' })
    expect((await pool.query("select name from servers where owner_id=$1 and kind='clan'", [player.id])).rows)
      .toEqual([{ name: 'New Blood' }])
    expect((await pool.query('select count(*)::int as count from clan_rosters')).rows[0].count).toBe(1)
  })

  it('corrects confirmed gamer tags and YouTube channels without duplicate scoring aliases', async () => {
    const player = await signup('MutableIdentity')
    const turn = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: "I'm FirstTag, I play solo on PlayStation.",
      revision: 0,
    })
    const video = await request(app).post('/api/onboarding/video').set(player.auth).send({
      url: VIDEO.videoUrl,
      revision: turn.body.state.revision,
    })
    const initial = await request(app).post('/api/onboarding/actions/confirm-selected').set(player.auth).send({
      revision: video.body.state.revision,
    })
    expect(initial.body.state).toMatchObject({ status: 'complete', revision: 3 })

    const correction = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: 'Actually, my gamer tag is FinalTag.',
      revision: 3,
    })
    expect(correction.status, JSON.stringify(correction.body)).toBe(200)
    const identityCorrection = correction.body.actions.find((action: any) => (
      action.kind === 'update_identity' && action.status === 'done' && action.payload.game_tag === 'FinalTag'
    ))
    expect(identityCorrection).toMatchObject({ payload: { game_tag: 'FinalTag' } })
    const identityConfirmed = await request(app)
      .post(`/api/onboarding/actions/${identityCorrection.id}/confirm`)
      .set(player.auth)
      .send({ revision: 4 })
    expect(identityConfirmed.body.state).toMatchObject({ status: 'complete', revision: 5 })
    expect((await pool.query(
      'select display_alias,status from player_aliases where profile_id=$1 order by created_at',
      [player.id],
    )).rows).toEqual([{ display_alias: 'FinalTag', status: 'candidate' }])

    resolvedVideo = {
      ...VIDEO,
      videoUrl: 'https://www.youtube.com/watch?v=correct02',
      videoId: 'correct02',
      channelId: 'UCbbbbbbbbbbbbbbbbbbbbbb',
      channelUrl: 'https://www.youtube.com/@CorrectedChannel',
      channelTitle: 'Corrected Channel',
    }
    const channelCorrection = await request(app).post('/api/onboarding/video').set(player.auth).send({
      url: resolvedVideo.videoUrl,
      revision: 5,
    })
    const channelAction = channelCorrection.body.actions.find((action: any) => (
      action.kind === 'connect_youtube' && action.status === 'proposed'
    ))
    expect(channelAction).toBeTruthy()
    const channelConfirmed = await request(app)
      .post(`/api/onboarding/actions/${channelAction.id}/confirm`)
      .set(player.auth)
      .send({ revision: 6 })
    expect(channelConfirmed.body.state).toMatchObject({ status: 'complete', revision: 7 })
    expect((await pool.query(
      'select url,channel_id,claim_status from user_youtube_links where user_id=$1',
      [player.id],
    )).rows).toEqual([expect.objectContaining({
      url: resolvedVideo.channelUrl,
      channel_id: resolvedVideo.channelId,
      claim_status: 'claimed',
    })])
    expect((await pool.query(
      'select video_id,status from onboarding_video_reports where user_id=$1 order by created_at',
      [player.id],
    )).rows).toEqual(expect.arrayContaining([
      { video_id: VIDEO.videoId, status: 'superseded' },
      { video_id: resolvedVideo.videoId, status: 'connected' },
    ]))
    expect((await pool.query('select id from media_sources where owner_id=$1', [player.id])).rows).toEqual([])

    const conflictingOwner = await signup('CorrectionConflictOwner')
    resolvedVideo = {
      ...VIDEO,
      videoUrl: 'https://www.youtube.com/watch?v=conflict03',
      videoId: 'conflict03',
      channelId: 'UCcccccccccccccccccccccc',
      channelUrl: 'https://www.youtube.com/@ClaimedElsewhere',
      channelTitle: 'Claimed Elsewhere',
    }
    await pool.query(
      `insert into user_youtube_links
         (user_id,url,title,channel_id,claim_status,claim_method,claimed_at)
       values ($1,$2,$3,$4,'claimed','onboarding_video',now())`,
      [conflictingOwner.id, resolvedVideo.channelUrl, resolvedVideo.channelTitle, resolvedVideo.channelId],
    )
    const disputedVideo = await request(app).post('/api/onboarding/video').set(player.auth).send({
      url: resolvedVideo.videoUrl, revision: 7,
    })
    const disputedAction = disputedVideo.body.actions.find((action: any) => (
      action.kind === 'connect_youtube' && action.status === 'proposed'
    ))
    const disputed = await request(app)
      .post(`/api/onboarding/actions/${disputedAction.id}/confirm`)
      .set(player.auth)
      .send({ revision: 8 })
    expect(disputed.body.state).toMatchObject({
      status: 'complete', current_step: 'complete',
      facts: { youtube_claim_status: 'disputed' },
    })
    expect((await pool.query(
      'select channel_id from user_youtube_links where user_id=$1',
      [player.id],
    )).rows).toEqual([{ channel_id: 'UCbbbbbbbbbbbbbbbbbbbbbb' }])
    expect((await pool.query('select count(*)::int as count from player_aliases where profile_id=$1', [player.id])).rows[0].count).toBe(1)
  })

  it('does not delete an already-created clan when the player later changes their lane to solo', async () => {
    const player = await signup('LaneChange')
    const leader = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: "I'm LaneKage, I run Old Village [OV] and want a roster.",
      revision: 0,
    })
    expect(leader.body.actions.map((action: any) => action.kind)).toEqual(expect.arrayContaining([
      'create_clan', 'create_roster',
    ]))
    const solo = await request(app).post('/api/onboarding/turn').set(player.auth)
      .send({ text: 'Play solo instead', revision: 1 })
    expect(solo.status, JSON.stringify(solo.body)).toBe(200)
    expect(solo.body.state.lane).toBe('solo')
    expect(solo.body.state.facts.clan_name).toBeUndefined()
    expect(solo.body.actions.filter((action: any) => action.status !== 'done')).toEqual([])
    expect((await pool.query("select count(*)::int as count from servers where kind='clan'", [])).rows[0].count).toBe(1)
  })

  it('treats unchecked actions as declined, can re-propose them, and rejects unknown actions without burning revision', async () => {
    const target = await signup('FollowTarget')
    const player = await signup('SelectivePlayer')
    const turn = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: "I'm SelectOne, I play solo. Follow @FollowTarget",
      revision: 0,
    })
    const identity = turn.body.actions.find((action: any) => action.kind === 'update_identity')
    expect(turn.body.actions).toContainEqual(expect.objectContaining({ kind: 'follow_player', status: 'proposed' }))

    const partial = await request(app).post('/api/onboarding/actions/confirm-selected').set(player.auth).send({
      revision: 1,
      action_ids: [identity.id],
    })
    expect(partial.status, JSON.stringify(partial.body)).toBe(200)
    expect(partial.body.actions.find((action: any) => action.kind === 'follow_player')).toMatchObject({
      status: 'done',
      result: { skipped: true },
    })
    expect((await pool.query('select id from follows where follower_id=$1 and following_id=$2', [player.id, target.id])).rows).toEqual([])

    const proposedAgain = await request(app).post('/api/onboarding/turn').set(player.auth).send({
      text: 'Follow @FollowTarget',
      revision: 2,
    })
    expect(proposedAgain.body.actions.find((action: any) => action.kind === 'follow_player').status).toBe('proposed')

    const before = proposedAgain.body.state.revision
    const missing = await request(app)
      .post('/api/onboarding/actions/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/confirm')
      .set(player.auth)
      .send({ revision: before })
    expect(missing.status).toBe(404)
    expect(missing.body.error).toBe('onboarding_action_not_found')
    const after = await request(app).get('/api/onboarding').set(player.auth)
    expect(after.body.state.revision).toBe(before)
  })

  it('opens a dispute instead of stealing a legacy same-URL YouTube connection', async () => {
    const owner = await signup('LegacyChannelOwner')
    const challenger = await signup('ChannelChallenger')
    await pool.query(
      `insert into user_youtube_links (user_id,url,title)
       values ($1,$2,'Legacy channel')`,
      [owner.id, VIDEO.channelUrl],
    )
    const turn = await request(app).post('/api/onboarding/turn').set(challenger.auth).send({
      text: "I'm ChannelChallenger, I play solo.",
      revision: 0,
    })
    const video = await request(app).post('/api/onboarding/video').set(challenger.auth).send({
      url: VIDEO.videoUrl,
      revision: turn.body.state.revision,
    })
    const confirmed = await request(app).post('/api/onboarding/actions/confirm-selected').set(challenger.auth).send({
      revision: video.body.state.revision,
    })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.state).toMatchObject({ status: 'complete', current_step: 'complete' })
    expect(confirmed.body.state.facts.youtube_claim_status).toBe('disputed')
    expect((await pool.query('select id from user_youtube_links where user_id=$1', [challenger.id])).rows).toEqual([])
    expect((await pool.query(
      "select current_owner_id,challenger_id,status from identity_claim_disputes where kind='youtube_channel'",
    )).rows).toEqual([{ current_owner_id: owner.id, challenger_id: challenger.id, status: 'open' }])
    expect((await pool.query(
      "select kind from notifications where user_id=$1 and kind='identity_claim_dispute'",
      [owner.id],
    )).rows).toEqual([{ kind: 'identity_claim_dispute' }])

    const challengerView = await request(app).get('/api/onboarding/disputes').set(challenger.auth)
    expect(challengerView.body.disputes).toEqual([expect.objectContaining({
      kind: 'youtube_channel', viewer_role: 'challenger', can_resolve: false,
    })])
    const ownerView = await request(app).get('/api/onboarding/disputes').set(owner.auth)
    const dispute = ownerView.body.disputes[0]
    expect(dispute).toMatchObject({ viewer_role: 'current_owner', can_resolve: true, status: 'open' })

    const intruder = await signup('DisputeIntruder')
    const forbidden = await request(app)
      .post(`/api/onboarding/disputes/${dispute.id}/resolve`)
      .set(intruder.auth)
      .send({ decision: 'reject' })
    expect(forbidden.status).toBe(403)

    const rejected = await request(app)
      .post(`/api/onboarding/disputes/${dispute.id}/resolve`)
      .set(owner.auth)
      .send({ decision: 'reject', note: 'This is still my channel.' })
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(200)
    expect(rejected.body.dispute).toMatchObject({ status: 'rejected', can_resolve: false })
    expect((await request(app).get('/api/onboarding').set(challenger.auth)).body.state)
      .toMatchObject({ status: 'complete', current_step: 'complete', facts: { youtube_claim_status: 'rejected' } })
    const replay = await request(app)
      .post(`/api/onboarding/disputes/${dispute.id}/resolve`)
      .set(owner.auth)
      .send({ decision: 'approve' })
    expect(replay.status).toBe(409)
  })

  it('lets the current owner atomically approve a YouTube ownership transfer', async () => {
    const owner = await signup('TransferOwner')
    const challenger = await signup('TransferChallenger')
    await pool.query(
      `insert into user_youtube_links (user_id,url,title,channel_id)
       values ($1,$2,'Owner channel',$3)`,
      [owner.id, VIDEO.channelUrl, VIDEO.channelId],
    )
    const turn = await request(app).post('/api/onboarding/turn').set(challenger.auth).send({
      text: "I'm TransferTag, I play solo.", revision: 0,
    })
    const video = await request(app).post('/api/onboarding/video').set(challenger.auth).send({
      url: VIDEO.videoUrl, revision: turn.body.state.revision,
    })
    const confirmation = await request(app).post('/api/onboarding/actions/confirm-selected').set(challenger.auth).send({
      revision: video.body.state.revision,
    })
    expect(confirmation.body.state).toMatchObject({ status: 'complete', current_step: 'complete' })
    const disputeId = confirmation.body.state.facts.youtube_dispute_id

    const approved = await request(app)
      .post(`/api/onboarding/disputes/${disputeId}/resolve`)
      .set(owner.auth)
      .send({ decision: 'approve', note: 'Approved transfer.' })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect(approved.body.dispute.status).toBe('transferred')
    expect((await pool.query('select id from user_youtube_links where user_id=$1', [owner.id])).rows).toEqual([])
    expect((await pool.query(
      'select channel_id,claim_status,claim_method from user_youtube_links where user_id=$1',
      [challenger.id],
    )).rows).toEqual([{
      channel_id: VIDEO.channelId,
      claim_status: 'claimed',
      claim_method: 'ownership_transfer',
    }])
    expect((await request(app).get('/api/onboarding').set(challenger.auth)).body.state)
      .toMatchObject({ status: 'complete', current_step: 'complete', facts: { youtube_claim_status: 'claimed' } })
  })

  it('lets a host admin approve a clan claim while preserving leadership history', async () => {
    const owner = await signup('VillageOwner')
    const challenger = await signup('VillageChallenger')
    const admin = await signup('VillageAdmin')
    const adminRow = (await pool.query('select user_metadata from users where id=$1', [admin.id])).rows[0]
    const adminMetadata = typeof adminRow.user_metadata === 'string'
      ? JSON.parse(adminRow.user_metadata)
      : adminRow.user_metadata
    adminMetadata.tko_host = true
    await pool.query('update users set user_metadata=$2::jsonb where id=$1', [admin.id, JSON.stringify(adminMetadata)])
    const clan = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Hidden Leaf','HL',$1,'clan',true,100) returning id`,
      [owner.id],
    )).rows[0]
    await pool.query("insert into clan_members (server_id,user_id,role) values ($1,$2,'leader')", [clan.id, owner.id])
    await pool.query("insert into server_members (server_id,user_id,role) values ($1,$2,'leader')", [clan.id, owner.id])

    const turn = await request(app).post('/api/onboarding/turn').set(challenger.auth).send({
      text: "I'm NewKage, I run Hidden Leaf [HL] on PlayStation.", revision: 0,
    })
    const confirmation = await request(app).post('/api/onboarding/actions/confirm-selected').set(challenger.auth).send({
      revision: turn.body.state.revision,
    })
    expect(confirmation.body.state).toMatchObject({ status: 'complete', current_step: 'complete' })
    const disputeId = confirmation.body.state.facts.clan_dispute_id
    const adminView = await request(app).get('/api/onboarding/disputes').set(admin.auth)
    expect(adminView.body.disputes).toContainEqual(expect.objectContaining({
      id: disputeId, viewer_role: 'admin', can_resolve: true,
    }))

    const approved = await request(app)
      .post(`/api/onboarding/disputes/${disputeId}/resolve`)
      .set(admin.auth)
      .send({ decision: 'approve', note: 'Ownership verified.' })
    expect(approved.status, JSON.stringify(approved.body)).toBe(200)
    expect((await pool.query('select owner_id from servers where id=$1', [clan.id])).rows)
      .toEqual([{ owner_id: challenger.id }])
    expect((await pool.query('select user_id,role from clan_members where server_id=$1 order by user_id', [clan.id])).rows)
      .toEqual(expect.arrayContaining([
        { user_id: owner.id, role: 'member' },
        { user_id: challenger.id, role: 'leader' },
      ]))
    expect((await request(app).get('/api/onboarding').set(challenger.auth)).body.state.facts)
      .toMatchObject({ clan_id: clan.id, clan_claim_status: 'owned' })
  })

  it('sends a member application into the existing clan dashboard and notifies leadership', async () => {
    const owner = await signup('ClanOwner')
    const member = await signup('NewMember')
    const inserted = await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Hidden Mist','HM',$1,'clan',true,100) returning id`,
      [owner.id],
    )
    const serverId = String(inserted.rows[0].id)
    await pool.query("insert into clan_members (server_id,user_id,role) values ($1,$2,'leader')", [serverId, owner.id])
    await pool.query("insert into server_members (server_id,user_id,role) values ($1,$2,'leader')", [serverId, owner.id])

    const turn = await request(app)
      .post('/api/onboarding/turn')
      .set(member.auth)
      .send({ text: "I'm MistNinja, member of Hidden Mist [HM], on PlayStation.", revision: 0 })
    expect(turn.status, JSON.stringify(turn.body)).toBe(200)
    expect(turn.body.state).toMatchObject({ lane: 'member', revision: 1 })
    expect(turn.body.actions).toContainEqual(expect.objectContaining({
      kind: 'apply_clan', status: 'done', result: expect.objectContaining({ status: 'pending' }),
    }))

    const confirmed = await request(app)
      .post('/api/onboarding/actions/confirm-selected')
      .set(member.auth)
      .send({ revision: 1 })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.state.status).toBe('complete')
    expect(confirmed.body.state.facts).toMatchObject({ clan_application_status: 'pending' })
    const application = (await pool.query(
      'select * from clan_applications where server_id=$1 and applicant_id=$2',
      [serverId, member.id],
    )).rows[0]
    expect(application).toMatchObject({ status: 'pending', message: 'Sent during guided setup.' })

    const mine = await request(app).get('/api/organizer/clan-applications/mine').set(member.auth)
    expect(mine.status).toBe(200)
    expect(mine.body.applications).toContainEqual(expect.objectContaining({ id: application.id, clan_name: 'Hidden Mist' }))
    const dashboard = await request(app).get(`/api/organizer/clans/${serverId}/dashboard`).set(owner.auth)
    expect(dashboard.status, JSON.stringify(dashboard.body)).toBe(200)
    expect(dashboard.body.applications).toContainEqual(expect.objectContaining({ id: application.id, username: 'MistNinja' }))
    expect((await pool.query(
      "select related_id from notifications where user_id=$1 and kind='clan_application_received'",
      [owner.id],
    )).rows).toEqual([{ related_id: application.id }])
    expect(pushes).toEqual([expect.objectContaining({
      userIds: [owner.id],
      committedApplicationCount: 1,
      payload: expect.objectContaining({
        title: 'MistNinja applied to Hidden Mist',
        url: `/boards/${serverId}`,
        tag: `clan-application:${serverId}`,
      }),
    })])
  })

  it('does not auto-apply to a paid, closed, or full clan', async () => {
    const owner = await signup('GuardedClanOwner')
    const cases = [
      { name: 'Paid Clan', tag: 'PAY', recruiting: true, fee: 25, max: 100, expected: 'requires 25 Tokens' },
      { name: 'Closed Clan', tag: 'CLS', recruiting: false, fee: 0, max: 100, expected: 'not accepting applications' },
      { name: 'Full Clan', tag: 'FUL', recruiting: true, fee: 0, max: 1, expected: 'currently full' },
    ]
    for (const item of cases) {
      const clan = (await pool.query(
        `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,join_fee_tokens,max_members)
         values ($1,$2,$3,'clan',$4,$5,$6) returning id`,
        [item.name, item.tag, owner.id, item.recruiting, item.fee, item.max],
      )).rows[0]
      await pool.query("insert into clan_members (server_id,user_id,role) values ($1,$2,'leader')", [clan.id, owner.id])
      const player = await signup(`Guarded${item.tag}`)
      const turn = await request(app).post('/api/onboarding/turn').set(player.auth).send({
        text: `My gamer tag is ${item.tag}Ninja and I belong to ${item.name} [${item.tag}]`, revision: 0,
      })
      expect(turn.status, JSON.stringify(turn.body)).toBe(200)
      expect(turn.body.state.status).toBe('active')
      expect(turn.body.prompt).toContain(item.expected)
      expect((await pool.query(
        'select id from clan_applications where server_id=$1 and applicant_id=$2',
        [clan.id, player.id],
      )).rows).toEqual([])
    }
  })

  it('withdraws a prior pending application when the player corrects the clan', async () => {
    const owner = await signup('CorrectionClanOwner')
    const clanA = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('First Clan','FC',$1,'clan',true,100) returning id`, [owner.id],
    )).rows[0]
    const clanB = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Second Clan','SC',$1,'clan',true,100) returning id`, [owner.id],
    )).rows[0]
    const member = await signup('CorrectingMember')
    const first = await request(app).post('/api/onboarding/turn').set(member.auth).send({
      text: 'My gamer tag is CorrectingMember and I belong to First Clan [FC]', revision: 0,
    })
    expect(first.body.state).toMatchObject({ status: 'complete', facts: { clan_application_status: 'pending' } })
    const corrected = await request(app).post('/api/onboarding/turn').set(member.auth).send({
      text: 'Actually, I belong to Second Clan [SC]', revision: 1,
    })
    expect(corrected.status, JSON.stringify(corrected.body)).toBe(200)
    expect(corrected.body.state).toMatchObject({
      status: 'complete', facts: { clan_id: clanB.id, clan_application_status: 'pending' },
    })
    expect((await pool.query(
      'select server_id,status from clan_applications where applicant_id=$1 order by server_id', [member.id],
    )).rows).toEqual(expect.arrayContaining([
      { server_id: clanA.id, status: 'withdrawn' },
      { server_id: clanB.id, status: 'pending' },
    ]))
  })

  it('refuses an exact name and tag that identify two different clans', async () => {
    const owner = await signup('SplitIdentityOwner')
    const first = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Hidden Mist','HM',$1,'clan',true,100) returning id`, [owner.id],
    )).rows[0]
    const second = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Hidden Leaf','HL',$1,'clan',true,100) returning id`, [owner.id],
    )).rows[0]
    const member = await signup('SplitIdentityMember')
    const turn = await request(app).post('/api/onboarding/turn').set(member.auth).send({
      text: 'My gamer tag is SplitNinja and I belong to Hidden Mist [HL]', revision: 0,
    })
    expect(turn.status, JSON.stringify(turn.body)).toBe(200)
    expect(turn.body.state).toMatchObject({ status: 'active', facts: { clan_identity_conflict: true } })
    expect(turn.body.prompt).toContain('different existing clans')
    expect((await pool.query(
      'select id from clan_applications where applicant_id=$1 and server_id in ($2,$3)',
      [member.id, first.id, second.id],
    )).rows).toEqual([])
  })

  it('proposes an off-by-default bounded clanmate follow and applies it only after confirmation', async () => {
    const owner = await signup('ScaleKage')
    const clan = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Scale Clan','SC',$1,'clan',true,100) returning id`,
      [owner.id],
    )).rows[0]
    await pool.query("insert into clan_members (server_id,user_id,role) values ($1,$2,'leader')", [clan.id, owner.id])
    await pool.query("insert into server_members (server_id,user_id,role) values ($1,$2,'leader')", [clan.id, owner.id])

    const clanmates: string[] = []
    for (let index = 0; index < 27; index += 1) {
      const id = randomUUID()
      clanmates.push(id)
      await pool.query(
        `insert into users (id,email,password_hash,user_metadata) values ($1,$2,'test','{}'::jsonb)`,
        [id, `scale-${index}@tko.test`],
      )
      await pool.query('insert into profiles (id,username) values ($1,$2)', [id, `ScaleMate${index}`])
      await pool.query("insert into clan_members (server_id,user_id,role) values ($1,$2,'member')", [clan.id, id])
    }
    await pool.query('insert into follows (follower_id,following_id) values ($1,$2)', [owner.id, clanmates[0]])
    await pool.query('insert into blocks (blocker_id,blocked_id) values ($1,$2)', [owner.id, clanmates[1]])

    const turn = await request(app)
      .post('/api/onboarding/turn')
      .set(owner.auth)
      .send({ text: "I'm ScaleKage, I run Scale Clan [SC] on PlayStation.", revision: 0 })
    expect(turn.status, JSON.stringify(turn.body)).toBe(200)
    const followAction = turn.body.actions.find((action: any) => action.kind === 'follow_clanmates')
    expect(followAction).toMatchObject({
      status: 'proposed',
      label: 'Follow 24 Scale Clan clanmates (of 25)',
      payload: { eligible_count: 25, batch_count: 24, cap: 24 },
    })
    expect((await pool.query('select count(*)::int as n from follows where follower_id=$1', [owner.id])).rows[0].n).toBe(1)

    const confirmed = await request(app)
      .post(`/api/onboarding/actions/${followAction.id}/confirm`)
      .set(owner.auth)
      .send({ revision: turn.body.state.revision })
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200)
    expect(confirmed.body.actions.find((action: any) => action.id === followAction.id)).toMatchObject({
      status: 'done',
      result: {
        total_clanmates: 26,
        eligible_count: 25,
        already_following_count: 1,
        followed_count: 24,
        remaining_count: 1,
        capped: true,
        cap: 24,
      },
    })
    const followsAfter = (await pool.query(
      'select following_id from follows where follower_id=$1 order by following_id',
      [owner.id],
    )).rows.map((row: any) => String(row.following_id))
    expect(followsAfter).toHaveLength(25)
    expect(followsAfter).not.toContain(clanmates[1])
    expect(followsAfter).not.toContain(owner.id)

    const replay = await request(app)
      .post(`/api/onboarding/actions/${followAction.id}/confirm`)
      .set(owner.auth)
      .send({ revision: confirmed.body.state.revision })
    expect(replay.status, JSON.stringify(replay.body)).toBe(200)
    expect((await pool.query('select count(*)::int as n from follows where follower_id=$1', [owner.id])).rows[0].n).toBe(25)
  })

  it('returns only the signed-in player’s actual tournament handoff without auto-entry', async () => {
    const player = await signup('TournamentPlayer')
    const other = await signup('OtherOrganizer')
    const clan = (await pool.query(
      `insert into servers (name,clan_tag,owner_id,kind,is_recruiting,max_members)
       values ('Tournament Clan','TC',$1,'clan',true,100) returning id`,
      [player.id],
    )).rows[0]
    await pool.query("insert into clan_members (server_id,user_id,role) values ($1,$2,'leader')", [clan.id, player.id])

    const invited = (await pool.query(
      `insert into tournaments (name,created_by,status,entry_scope,clan_entry_mode,start_at)
       values ('Clan Invitational',$1,'open','public','invited_only',now()) returning id`,
      [other.id],
    )).rows[0]
    await pool.query(
      `insert into tournament_clan_invitations (tournament_id,clan_id,status,invited_by)
       values ($1,$2,'invited',$3)`,
      [invited.id, clan.id, other.id],
    )
    const direct = (await pool.query(
      `insert into tournaments (name,created_by,status,entry_scope,clan_entry_mode,start_at)
       values ('Direct Invite',$1,'open','public','open',now()) returning id`,
      [other.id],
    )).rows[0]
    await pool.query(
      `insert into tournament_entrants (tournament_id,user_id,status,invited_by)
       values ($1,$2,'pending',$3)`,
      [direct.id, player.id, other.id],
    )
    const publicOpen = (await pool.query(
      `insert into tournaments (name,created_by,status,entry_scope,clan_entry_mode,start_at)
       values ('Open Bracket',$1,'open','public','open',now()) returning id`,
      [other.id],
    )).rows[0]
    const hidden = (await pool.query(
      `insert into tournaments (name,created_by,status,entry_scope,clan_entry_mode,start_at)
       values ('Private Other Clan',$1,'open','clan','open',now()) returning id`,
      [other.id],
    )).rows[0]

    const onboarding = await request(app).get('/api/onboarding').set(player.auth)
    expect(onboarding.status, JSON.stringify(onboarding.body)).toBe(200)
    expect(onboarding.body.tournaments.clan_invitations).toContainEqual(expect.objectContaining({
      tournament_id: invited.id,
      tournament_name: 'Clan Invitational',
      clan_id: clan.id,
      link: `/tournaments/${invited.id}?section=rosters`,
    }))
    expect(onboarding.body.tournaments.entries).toContainEqual(expect.objectContaining({
      tournament_id: direct.id,
      tournament_name: 'Direct Invite',
      entrant_status: 'pending',
      invited: true,
    }))
    expect(onboarding.body.tournaments.open_tournaments).toContainEqual(expect.objectContaining({
      tournament_id: publicOpen.id,
      tournament_name: 'Open Bracket',
    }))
    expect(onboarding.body.tournaments.open_tournaments).not.toContainEqual(expect.objectContaining({
      tournament_id: hidden.id,
    }))
    expect((await pool.query('select count(*)::int as n from tournament_entrants where user_id=$1', [player.id])).rows[0].n).toBe(1)
  })
})
