import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { AuthGuard } from '@/components/AuthGuard'
import { useAuth } from '@/hooks/useAuth'
import { Landing } from '@/pages/Landing'
import { HomeMenu } from '@/pages/HomeMenu'
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
import { LiveDashboard } from '@/pages/LiveDashboard'
import { Broadcast } from '@/pages/Broadcast'
import { ProgramView } from '@/pages/ProgramView'
import { GoLive } from '@/pages/GoLive'
import { LiveWatch } from '@/pages/LiveWatch'
import { LiveStage } from '@/pages/LiveStage'
import { MyClips } from '@/pages/MyClips'
import { Videos } from '@/pages/Videos'
import { AI } from '@/pages/AI'
import { CreateHighlight } from '@/pages/CreateHighlight'
import { Terms } from '@/pages/Terms'
import { Privacy } from '@/pages/Privacy'
import { DataDeletion } from '@/pages/DataDeletion'
import { Legal } from '@/pages/Legal'
import { Help } from '@/pages/Help'
import { Marketing } from '@/pages/Marketing'
import { Rankings } from '@/pages/Rankings'
import { StatCheck } from '@/pages/StatCheck'
import { StatCheckRoom } from '@/pages/StatCheckRoom'
import { SubmitResult } from '@/pages/SubmitResult'
import { NotificationsPage } from '@/pages/Notifications'
import { Dashboard } from '@/pages/Dashboard'
import { AILabel } from '@/pages/AILabel'
import { Redeem } from '@/pages/Redeem'
import { Rewards } from '@/pages/Rewards'
import { Forge } from '@/pages/Forge'
import { ConquestMap } from '@/pages/ConquestMap'
import { Browser } from '@/pages/Browser'
import { Store } from '@/pages/Store'
import { Shop } from '@/pages/Shop'
import { Oracle } from '@/pages/Oracle'
import { Upgrade } from '@/pages/Upgrade'
import { Discover } from '@/pages/Discover'
import { Connect } from '@/pages/Connect'
import { Chat } from '@/pages/Chat'
import { ChatSpace, ClanChatRedirect } from '@/pages/ChatSpace'

// Signed-in visitors land on the dead-simple 5-button launcher (HomeMenu).
// Signed-out visitors keep the marketing Landing page.
function Home() {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? <HomeMenu /> : <Landing />
}

export default function App() {
  return (
    <Routes>
      {/* Full-bleed marketing pages (no app sidebar). */}
      <Route path="/marketing" element={<Marketing />} />
      <Route path="/download" element={<Marketing />} />

      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        {/* Sidebar mirrors of the launcher — open HomeMenu straight to a section. */}
        <Route path="video" element={<HomeMenu initialSection="video" />} />
        <Route path="clans" element={<HomeMenu initialSection="clans" />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="legal" element={<Legal />} />
        <Route path="help" element={<Help />} />
        <Route path="support" element={<Help />} />
        <Route path="terms" element={<Terms />} />
        <Route path="privacy" element={<Privacy />} />
        <Route path="data-deletion" element={<DataDeletion />} />
        <Route path="account/delete" element={<DataDeletion />} />
        <Route path="reels" element={<Reels />} />
        <Route path="videos" element={<Videos />} />
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
        <Route path="chat" element={<Chat />} />
        <Route path="chat/:spaceId" element={<ChatSpace />} />
        <Route path="clans/:serverId/chat" element={<ClanChatRedirect />} />
        <Route path="clans/discover" element={<ClanDiscovery />} />
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
        <Route path="live-dashboard" element={<LiveDashboard />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="program" element={<ProgramView />} />
        <Route path="program/:groupId" element={<ProgramView />} />
        <Route path="go-live" element={<AuthGuard><GoLive /></AuthGuard>} />
        <Route path="my-clips" element={<AuthGuard><MyClips /></AuthGuard>} />
        <Route path="ai" element={<AI />} />
        <Route path="discover" element={<Discover />} />
        <Route path="connect" element={<AuthGuard><Connect /></AuthGuard>} />
        <Route path="rankings" element={<Rankings />} />
        <Route path="stat-check" element={<StatCheck />} />
        <Route path="stat-check-room" element={<StatCheckRoom />} />
        <Route path="submit-result" element={<SubmitResult />} />
        <Route path="notifications" element={<AuthGuard><NotificationsPage /></AuthGuard>} />
        <Route path="dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
        <Route path="redeem" element={<AuthGuard><Redeem /></AuthGuard>} />
        <Route path="rewards" element={<AuthGuard><Rewards /></AuthGuard>} />
        <Route path="forge" element={<AuthGuard><Forge /></AuthGuard>} />
        <Route path="conquest" element={<ConquestMap />} />
        <Route path="store" element={<Store />} />
        <Route path="shop" element={<AuthGuard><Shop /></AuthGuard>} />
        <Route path="oracle" element={<Oracle />} />
        <Route path="upgrade" element={<Upgrade />} />
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
  )
}
