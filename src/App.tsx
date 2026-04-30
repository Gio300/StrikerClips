import { Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { AuthGuard } from '@/components/AuthGuard'
import { Landing } from '@/pages/Landing'
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
import { Profile } from '@/pages/Profile'
import { ProfileTrophies } from '@/pages/ProfileTrophies'
import { Tournaments } from '@/pages/Tournaments'
import { TournamentDetail } from '@/pages/TournamentDetail'
import { Live } from '@/pages/Live'
import { AI } from '@/pages/AI'
import { CreateHighlight } from '@/pages/CreateHighlight'
import { Terms } from '@/pages/Terms'
import { Marketing } from '@/pages/Marketing'
import { Rankings } from '@/pages/Rankings'
import { StatCheck } from '@/pages/StatCheck'
import { SubmitResult } from '@/pages/SubmitResult'
import { NotificationsPage } from '@/pages/Notifications'
import { Dashboard } from '@/pages/Dashboard'
import { AILabel } from '@/pages/AILabel'

export default function App() {
  return (
    <Routes>
      {/* Full-bleed marketing pages (no app sidebar). */}
      <Route path="/marketing" element={<Marketing />} />
      <Route path="/download" element={<Marketing />} />

      <Route path="/" element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="terms" element={<Terms />} />
        <Route path="reels" element={<Reels />} />
        <Route path="reels/:id" element={<ReelDetail />} />
        <Route path="reels/create" element={<AuthGuard><CreateHighlight /></AuthGuard>} />
        <Route path="highlight/create" element={<AuthGuard><CreateHighlight /></AuthGuard>} />
        <Route path="matches" element={<Matches />} />
        <Route path="matches/create" element={<AuthGuard><CreateMatch /></AuthGuard>} />
        <Route path="matches/:id" element={<MatchDetail />} />
        <Route path="tournaments" element={<Tournaments />} />
        <Route path="tournaments/:id" element={<TournamentDetail />} />
        <Route path="boards" element={<Boards />} />
        <Route path="live" element={<Live />} />
        <Route path="ai" element={<AI />} />
        <Route path="rankings" element={<Rankings />} />
        <Route path="stat-check" element={<StatCheck />} />
        <Route path="submit-result" element={<SubmitResult />} />
        <Route path="notifications" element={<AuthGuard><NotificationsPage /></AuthGuard>} />
        <Route path="dashboard" element={<AuthGuard><Dashboard /></AuthGuard>} />
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
