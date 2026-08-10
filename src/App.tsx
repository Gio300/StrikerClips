import { useCallback, useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Splash } from '@/components/Splash'
import { AuthGuard } from '@/components/AuthGuard'
import { useAuth } from '@/hooks/useAuth'
import { fetchMemberLeague, setActiveLeagueSlug } from '@/lib/leagueConfig'
import { domainLeagueSlug, signedOutLandingPath } from '@/lib/leagueDomain'
import { HomeMenu } from '@/pages/HomeMenu'
import { LeagueGateway } from '@/pages/LeagueGateway'
import { LeagueStudio } from '@/pages/LeagueStudio'
import LeaguePlans from '@/pages/LeaguePlans'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { Reels } from '@/pages/Reels'
import { ReelDetail } from '@/pages/ReelDetail'
import { Matches } from '@/pages/Matches'
import { CreateMatch } from '@/pages/CreateMatch'
import { CreateServer } from '@/pages/CreateServer'
import { MatchDetail } from '@/pages/MatchDetail'
import { Boards } from '@/pages/Boards'
import { BoardDetail } from '@/pages/BoardDetail'
import { ClanDiscovery } from '@/pages/ClanDiscovery'
import { Profile } from '@/pages/Profile'
import { ProfileTrophies } from '@/pages/ProfileTrophies'
import { Tournaments } from '@/pages/Tournaments'
import { TournamentDetail } from '@/pages/TournamentDetail'
import { TkoKing } from '@/pages/TkoKing'
import { TkoKingBoard } from '@/pages/TkoKingBoard'
import { Live } from '@/pages/Live'
import { LiveHub } from '@/pages/LiveHub'
import { Director } from '@/pages/Director'
import { Host } from '@/pages/Host'
import { ProgramView } from '@/pages/ProgramView'
import { LiveWatch } from '@/pages/LiveWatch'
import { LiveStage } from '@/pages/LiveStage'
import { MyClips } from '@/pages/MyClips'
import { Videos } from '@/pages/Videos'
import { ProducedVideo } from '@/pages/ProducedVideo'
import { AI } from '@/pages/AI'
import { CreateHighlight } from '@/pages/CreateHighlight'
import { Terms } from '@/pages/Terms'
import { Privacy } from '@/pages/Privacy'
import { DataDeletion } from '@/pages/DataDeletion'
import { Legal } from '@/pages/Legal'
import { Help } from '@/pages/Help'
import { Marketing } from '@/pages/Marketing'
import { CreateHub } from '@/pages/CreateHub'
import { StatCheck } from '@/pages/StatCheck'
import { StatCheckRoom } from '@/pages/StatCheckRoom'
import { NotificationsPage } from '@/pages/Notifications'
import { LiveInvites } from '@/pages/LiveInvites'
import { Dashboard } from '@/pages/Dashboard'
import { CreatorDashboard } from '@/pages/CreatorDashboard'
import { AILabel } from '@/pages/AILabel'
import { Redeem } from '@/pages/Redeem'
import { Rewards } from '@/pages/Rewards'
import { Forge } from '@/pages/Forge'
import { ConquestMap } from '@/pages/ConquestMap'
import { Browser } from '@/pages/Browser'
import { Store } from '@/pages/Store'
import { Shop } from '@/pages/Shop'
import { PhysicalMerch } from '@/pages/PhysicalMerch'
import { Oracle } from '@/pages/Oracle'
import { Upgrade } from '@/pages/Upgrade'
import { StoreUnavailable } from '@/pages/StoreUnavailable'
import { Discover } from '@/pages/Discover'
import { Connect } from '@/pages/Connect'
import { SettingsPage } from '@/pages/Settings'
import { ReelPrivacySettings } from '@/pages/ReelPrivacy'
import { ChatSpace, ClanChatRedirect } from '@/pages/ChatSpace'
import { Messages } from '@/pages/Messages'
import { UpdateBanner } from '@/components/UpdateBanner'
import { SessionTransferReceiver } from '@/components/SessionTransferReceiver'
import { OnboardingHomeGate } from '@/components/OnboardingHomeGate'
import { ForgotPassword } from '@/pages/ForgotPassword'
import { ResetPassword } from '@/pages/ResetPassword'
import { SessionBridge } from '@/pages/SessionBridge'
import { RosterInvite } from '@/pages/RosterInvite'
import { ClanManager } from '@/pages/ClanManager'
import { VillageDashboard } from '@/pages/VillageDashboard'
import { Setup } from '@/pages/Setup'
import { CODE_REDEMPTION_ENABLED, IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'

// ALL leagues live on the TKO.cam app (wire-in plan Step 1):
//   • Signed-out visitors at `/` on tko.cam/localhost are sent to the league
//     GATEWAY — browse leagues, or "Make a league" → pricing → Studio.
//   • On a LEAGUE'S OWN DOMAIN the app IS the league (operator 2026-08-02):
//     signed-out visitors get the league-branded LOGIN/SIGNUP, never TKO's
//     league-growth gateway. /leagues, /make-a-league, /marketing stay
//     reachable by direct URL, just never the default landing there.
//   • Signed-in visitors land straight in THEIR league: we resolve their
//     league membership, record its slug for the league theme provider
//     (Step 2 keys the app's skin off it), and show the launcher (HomeMenu).
function Home() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to={signedOutLandingPath(domainLeagueSlug())} replace />
  return <MemberLeagueHome />
}

function MemberLeagueHome() {
  const { user } = useAuth()
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let alive = true
    // Fail-soft: unaffiliated users (or no backend) stay in the TKO house league.
    fetchMemberLeague(userId).then((league) => {
      if (alive && league) setActiveLeagueSlug(league.slug)
    })
    return () => { alive = false }
  }, [userId])
  if (!userId) return null
  return (
    <OnboardingHomeGate userId={userId}>
      <HomeMenu />
    </OnboardingHomeGate>
  )
}

function SetupAfterSplash() {
  const [splashComplete, setSplashComplete] = useState(false)
  const finishSplash = useCallback(() => setSplashComplete(true), [])

  return (
    <>
      <Splash onComplete={finishSplash} />
      {splashComplete ? <Setup /> : null}
    </>
  )
}

export default function App() {
  return (
    <>
    {/* Update detection belongs above the route tree. Full-bleed routes such as
        /studio and /leagues must not be able to opt out of receiving builds. */}
    <UpdateBanner />
    <SessionTransferReceiver />
    <Routes>
      {/* Full-bleed marketing pages (no app sidebar). */}
      <Route path="/marketing" element={<Marketing />} />
      <Route path="/download" element={<Navigate to="/marketing" replace />} />

      {/* Full-bleed league gateway + white-label Studio (no app sidebar).
          Mirrored in the server's SPA-shell allowlist (server/index.ts). */}
      <Route path="/leagues" element={<LeagueGateway view="browse" />} />
      <Route path="/make-a-league" element={<LeagueGateway view="pricing" />} />
      {/* Plan select + Stripe Checkout for league OWNERS (src/lib/leaguePlans.ts).
          Deliberately outside AuthGuard: a signed-out prospect must be able to
          read the plans and leave an Enterprise lead. Buying prompts signup. */}
      <Route path="/league-plans" element={IS_MOBILE_STORE_BUILD ? <StoreUnavailable /> : <LeaguePlans />} />
      <Route path="/studio" element={<LeagueStudio />} />

      {/* Chat-centric account setup is deliberately full-bleed. Keeping it
          outside Layout prevents the legacy tour and YouTube gate from stacking
          over Ask TKO while the same server-backed setup is in progress. */}
      <Route path="/setup" element={<AuthGuard><SetupAfterSplash /></AuthGuard>} />

      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="create" element={<CreateHub />} />
        {/* Sidebar mirrors of the launcher — open HomeMenu straight to a section. */}
        <Route path="video" element={<HomeMenu initialSection="video" />} />
        <Route path="clans" element={<HomeMenu initialSection="clans" />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="session-bridge" element={<SessionBridge />} />
        <Route path="roster-invite" element={<RosterInvite />} />
        <Route path="legal" element={<Legal />} />
        <Route path="help" element={<Help />} />
        <Route path="support" element={<Help />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="data-deletion" element={<DataDeletion />} />
        <Route path="account/delete" element={<DataDeletion />} />
        <Route path="reels" element={<Reels />} />
        <Route path="videos" element={<Videos />} />
        {/* One produced multi-angle upload — the PUBLIC per-video page a share
            link points at. Readable signed-out, like tournaments/:id. */}
        <Route path="produced/:youtubeId" element={<ProducedVideo />} />
        <Route path="reels/:id" element={<ReelDetail />} />
        <Route path="reels/create" element={<AuthGuard><CreateHighlight /></AuthGuard>} />
        <Route path="highlight/create" element={<AuthGuard><CreateHighlight /></AuthGuard>} />
        <Route path="matches" element={<Matches />} />
        <Route path="matches/create" element={<AuthGuard><CreateMatch /></AuthGuard>} />
        <Route path="matches/:id" element={<MatchDetail />} />
        <Route path="tournaments" element={<Tournaments />} />
        <Route path="tournaments/:id" element={<TournamentDetail />} />
        <Route path="king" element={<TkoKing />} />
        <Route path="king/board" element={<TkoKingBoard />} />
        <Route path="boards" element={<Boards />} />
        <Route path="chat" element={<Navigate to="/messages" replace />} />
        <Route path="chat/:spaceId" element={<ChatSpace />} />
        <Route path="messages" element={<AuthGuard><Messages /></AuthGuard>} />
        <Route path="clans/:serverId/chat" element={<ClanChatRedirect />} />
        <Route path="clans/:serverId/manage" element={<AuthGuard><ClanManager /></AuthGuard>} />
        <Route path="clans/discover" element={<ClanDiscovery />} />
        <Route path="villages/:villageId" element={<AuthGuard><VillageDashboard /></AuthGuard>} />
        <Route path="live" element={<LiveHub />} />
        <Route path="watch" element={<LiveWatch />} />
        <Route path="watch/:id" element={<LiveWatch />} />
        {/* Linked multi-angle stage: a saved live_groups link, or an ad-hoc
            `?s=streamId,streamId` combination for signed-out viewers. */}
        <Route path="live-stage/:id" element={<LiveStage />} />
        <Route path="live-stage" element={<LiveStage />} />
        <Route path="live-streams" element={<Live />} />
        <Route path="director" element={<Director />} />
        <Route path="host" element={<AuthGuard><Host /></AuthGuard>} />
        {/* ONE DOOR: the old standalone live entries (Broadcast Studio dashboard,
            broadcast view, and the raw Go Live page) are retired as separate
            doors — every live entry now funnels through the single LiveHub menu
            at /live, which routes to the matching focused config screen. */}
        <Route path="live-dashboard" element={<Navigate to="/live?do=multi" replace />} />
        <Route path="broadcast" element={<Navigate to="/live" replace />} />
        <Route path="program" element={<ProgramView />} />
        <Route path="program/:groupId" element={<ProgramView />} />
        <Route path="go-live" element={<Navigate to="/live?do=golive" replace />} />
        <Route path="my-clips" element={<AuthGuard><MyClips /></AuthGuard>} />
        <Route path="ai" element={<AI />} />
        <Route path="discover" element={<Discover />} />
        <Route path="connect" element={<AuthGuard><Connect /></AuthGuard>} />
        <Route path="settings" element={<AuthGuard><SettingsPage /></AuthGuard>} />
        <Route path="privacy-settings" element={<AuthGuard><ReelPrivacySettings /></AuthGuard>} />
        {/* The old public leaderboard + screenshot result form are retired.
            Keep redirects so cached links and installed PWAs land somewhere
            useful instead of reopening the unsafe submission experience. */}
        <Route path="rankings" element={<Navigate to="/profile" replace />} />
        <Route path="stat-check" element={<StatCheck />} />
        <Route path="stat-check-room" element={<StatCheckRoom />} />
        <Route path="submit-result" element={<Navigate to="/profile" replace />} />
        <Route path="notifications" element={<AuthGuard><NotificationsPage /></AuthGuard>} />
        <Route path="live-invites" element={<AuthGuard><LiveInvites /></AuthGuard>} />
        <Route path="dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
        <Route path="creator" element={<AuthGuard><CreatorDashboard /></AuthGuard>} />
        <Route
          path="redeem"
          element={CODE_REDEMPTION_ENABLED ? <AuthGuard><Redeem /></AuthGuard> : <StoreUnavailable />}
        />
        <Route path="rewards" element={<AuthGuard><Rewards /></AuthGuard>} />
        <Route path="forge" element={<AuthGuard><Forge /></AuthGuard>} />
        <Route path="conquest" element={<ConquestMap />} />
        <Route path="store" element={IS_MOBILE_STORE_BUILD ? <StoreUnavailable /> : <Store />} />
        <Route
          path="shop"
          element={IS_MOBILE_STORE_BUILD ? <StoreUnavailable /> : <AuthGuard><Shop /></AuthGuard>}
        />
        <Route path="forge/physical" element={<AuthGuard><PhysicalMerch /></AuthGuard>} />
        <Route path="physical" element={<AuthGuard><PhysicalMerch /></AuthGuard>} />
        <Route path="oracle" element={<Oracle />} />
        <Route path="upgrade" element={IS_MOBILE_STORE_BUILD ? <StoreUnavailable /> : <Upgrade />} />
        <Route path="browser" element={<Browser />} />
        <Route path="ai/label" element={<AuthGuard><AILabel /></AuthGuard>} />
        <Route path="boards/create" element={<AuthGuard><CreateServer /></AuthGuard>} />
        <Route path="boards/:serverId/:channelId?" element={<BoardDetail />} />
        <Route path="profile" element={<Profile />} />
        <Route path="profile/:userId" element={<Profile />} />
        <Route path="profile/:userId/trophies" element={<ProfileTrophies />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
