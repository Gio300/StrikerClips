import { useEffect, useState } from 'react'
import { useNavigate, Link, useParams, useSearchParams } from 'react-router-dom'
import { Camera } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { useEntitlements } from '@/hooks/useEntitlements'
import { useWallet } from '@/hooks/useWallet'
import { prettyClip } from '@/lib/clipLabel'
import { InviteMenu } from '@/components/InviteMenu'
import { DonateButton } from '@/components/DonateButton'
import { FollowControl } from '@/components/FollowControl'
import { BlockControl } from '@/components/BlockControl'
import { ProfileReportControl } from '@/components/ProfileReportControl'
import { LiveLinkSettings } from '@/components/LiveLinkSettings'
import { WinningsLedger } from '@/components/WinningsLedger'
import { LiveSessionsStrip } from '@/components/LiveSessionsStrip'
import { PlayerProducedVideos } from '@/components/PlayerProducedVideos'
import { AutoMergeStatus } from '@/components/AutoMergeStatus'
import { CollapsibleSection } from '@/components/CollapsibleSection'
import { ProfileTagBadge } from '@/components/TagBadge'
import { ArtifactTagsPanel } from '@/components/ArtifactTagsPanel'
import { MyClanRostersPanel } from '@/components/MyClanRostersPanel'
import { UpgradeNudge } from '@/components/UpgradeNudge'
import { DeleteAccountPanel } from '@/components/DeleteAccountPanel'
import { ManageSubscriptionPanel } from '@/components/ManageSubscriptionPanel'
import { DirectMessages } from '@/components/social/DirectMessages'
import { ProfileCreatorTab } from '@/components/ProfileCreatorTab'
import { SocialFeed } from '@/components/social/SocialFeed'
import { AvailabilityHint, Avatar } from '@/components/ui'
import { AvatarPicker } from '@/components/AvatarPicker'
import { useIdentityAvailability } from '@/hooks/useIdentityAvailability'
import { IS_MOBILE_STORE_BUILD } from '@/lib/storeBuild'
import { buildTrophyCloset, trophyCountLabel, type ShinobiDefeatRow } from '@/lib/tkoKing'
import { appendUniqueById, splitExtraRowPage } from '@/lib/paging'
import type {
  Reel,
  UserYoutubeLink,
  Profile,
} from '@/types/database'

const EMOJI_PICKER = ['👍', '❤️', '😂', '🔥', '👏', '💯', '🎉', '😮']
const PROFILE_REEL_PAGE_SIZE = 24

// 'clips' is its own tab (operator 2026-08-07: "under the me/profile they need
// to have their clips there.. so they can look up their clips more easily").
// It existed already, but only inside 'about' -- below Live settings and above
// Billing on an 800-line page, which is not somewhere anyone goes looking for
// their own videos. A person's clips are the thing they open their profile FOR.
type ProfileSection = 'wall' | 'clips' | 'feed' | 'messages' | 'about' | 'stats'

export function profileSectionLabel(section: ProfileSection): string {
  switch (section) {
    case 'wall': return 'Wall'
    case 'clips': return 'Clips'
    case 'feed': return 'News Feed'
    case 'messages': return 'Messages'
    case 'about': return 'About'
    case 'stats': return 'Stats'
  }
}

function profileSectionFromParam(value: string | null, isOwnProfile: boolean): ProfileSection {
  const normalized: ProfileSection =
    value === 'messages'
      ? 'messages'
      : value === 'feed' || value === 'activity'
        ? 'feed'
        : value === 'clips' || value === 'videos' || value === 'reels'
          ? 'clips'
        : value === 'about' || value === 'polls' || value === 'profile'
          ? 'about'
          : value === 'stats' || value === 'creator'
            ? 'stats'
            : 'wall'
  if (!isOwnProfile && (normalized === 'feed' || normalized === 'messages')) return 'wall'
  return normalized
}

// Compact tokens + sweeps balance with a link to the Store. Subtle by design.
function WalletChip() {
  const { tokens, sweeps } = useWallet()
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-dark-border bg-dark-card px-2.5 py-1">
        <span className="font-semibold text-accent">{tokens.toLocaleString()}</span>
        <span className="text-xs text-gray-500">Tokens</span>
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-lg border border-dark-border bg-dark-card px-2.5 py-1">
        <span className="font-semibold text-leaf">{sweeps.toLocaleString()}</span>
        <span className="text-xs text-gray-500">Give Points</span>
      </span>
      {!IS_MOBILE_STORE_BUILD && (
        <Link to="/store" className="text-accent hover:underline text-xs">Store</Link>
      )}
    </div>
  )
}

function ProfileContent() {
  const { user, profile, loading: authLoading } = useAuth()
  const { isPremium } = useEntitlements()
  const navigate = useNavigate()
  const { userId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const isOwnProfile = !userId || userId === user?.id

  const tabParam = searchParams.get('tab')
  const dmParam = searchParams.get('dm')
  const dmTargetParam = searchParams.get('to')
  const [activeTab, setActiveTab] = useState<ProfileSection>(
    profileSectionFromParam(tabParam, isOwnProfile),
  )

  // Keep the active tab in sync with the URL — the Message button navigates to
  // /profile?tab=messages, and without this the component (already mounted from
  // the other user's profile) would stay on the Profile tab and the DM wouldn't
  // open.
  useEffect(() => {
    setActiveTab(profileSectionFromParam(tabParam, isOwnProfile))
  }, [isOwnProfile, tabParam])

  function selectTab(tab: ProfileSection) {
    setActiveTab(tab)
    const next = new URLSearchParams(searchParams)
    next.set('tab', tab)
    next.delete('dm')
    next.delete('to')
    setSearchParams(next, { replace: true })
  }
  const [reels, setReels] = useState<Reel[]>([])
  const [hasMoreReels, setHasMoreReels] = useState(false)
  const [loadingMoreReels, setLoadingMoreReels] = useState(false)
  const [youtubeLinks, setYoutubeLinks] = useState<UserYoutubeLink[]>([])
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')
  const [newYoutubeUrl, setNewYoutubeUrl] = useState('')
  const [addingLink, setAddingLink] = useState(false)
  const [viewProfile, setViewProfile] = useState<Profile | null>(null)
  const [followersCount, setFollowersCount] = useState(0)
  const [followingCount, setFollowingCount] = useState(0)
  const [isFollowing, setIsFollowing] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [profileLoaded, setProfileLoaded] = useState(false)

  const targetUserId = userId ? userId : user?.id

  // Renaming yourself re-claims a platform-unique handle, so it goes through the
  // same availability check as signup. `excludeId` is your own profile row —
  // without it, re-saving your current username would report itself as taken.
  const usernameCheck = useIdentityAvailability('username', username, {
    excludeId: user?.id,
  })

  useEffect(() => {
    // Never redirect while auth is still resolving — a signed-in user must not
    // be bounced to /login just because `user` hasn't hydrated yet.
    if (authLoading) return
    if (!user && !userId) {
      navigate('/login')
      return
    }
    if (isOwnProfile) {
      setUsername(profile?.username ?? '')
      setBio(profile?.bio ?? '')
      setViewProfile(profile ?? null)
    }
  }, [user, profile, navigate, userId, isOwnProfile, authLoading])

  useEffect(() => {
    if (!targetUserId) return
    async function load() {
      setNotFound(false)
      setProfileLoaded(false)
      setReels([])
      setHasMoreReels(false)
      try {
        if (isOwnProfile) {
          setUsername(profile?.username ?? '')
          setBio(profile?.bio ?? '')
          setViewProfile(profile ?? null)
        } else {
          const { data } = await supabase.from('profiles').select('*').eq('id', targetUserId!).single()
          if (!data) { setNotFound(true); return }
          setViewProfile(data)
          setUsername(data?.username ?? '')
          setBio(data?.bio ?? '')
        }
        const [reelsRes, linksRes, followersRes, followingRes, followRes] = await Promise.all([
          supabase
            .from('reels')
            .select('*')
            .eq('user_id', targetUserId!)
            .order('created_at', { ascending: false })
            .range(0, PROFILE_REEL_PAGE_SIZE),
          isOwnProfile ? supabase.from('user_youtube_links').select('*').eq('user_id', targetUserId!).order('created_at', { ascending: false }) : { data: [] },
          supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', targetUserId!),
          supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetUserId!),
          user ? supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', targetUserId!).maybeSingle() : { data: null },
        ])
        const reelPage = splitExtraRowPage((reelsRes.data ?? []) as Reel[], PROFILE_REEL_PAGE_SIZE)
        setReels(reelPage.items)
        setHasMoreReels(reelPage.hasMore)
        if (isOwnProfile) setYoutubeLinks((linksRes as { data?: UserYoutubeLink[] }).data ?? [])
        setFollowersCount((followersRes as { count?: number }).count ?? 0)
        setFollowingCount((followingRes as { count?: number }).count ?? 0)
        setIsFollowing(!!(followRes as { data?: unknown }).data)
      } catch {
        // A deep-link to a nonexistent user throws on `.single()`; show not-found.
        if (!isOwnProfile) setNotFound(true)
      } finally {
        setProfileLoaded(true)
      }
    }
    load()
  }, [targetUserId, isOwnProfile, user?.id, profile])

  async function loadMoreReels() {
    if (!targetUserId || loadingMoreReels || !hasMoreReels) return
    setLoadingMoreReels(true)
    const offset = reels.length
    const { data } = await supabase
      .from('reels')
      .select('*')
      .eq('user_id', targetUserId)
      .order('created_at', { ascending: false })
      .range(offset, offset + PROFILE_REEL_PAGE_SIZE)
    const page = splitExtraRowPage((data ?? []) as Reel[], PROFILE_REEL_PAGE_SIZE)
    setReels((current) => appendUniqueById(current, page.items))
    setHasMoreReels(page.hasMore)
    setLoadingMoreReels(false)
  }

  // FollowControl owns the `follows` write + notification + prefs; we just
  // sync local UI state (button label + follower count) from its callback.
  function handleFollowChange(next: boolean) {
    setIsFollowing(next)
    setFollowersCount((c) => (next ? c + 1 : Math.max(0, c - 1)))
  }

  async function addYoutubeLink(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !newYoutubeUrl.trim()) return
    const url = newYoutubeUrl.trim()
    if (!/youtube\.com|youtu\.be/.test(url)) return
    setAddingLink(true)
    const { data } = await supabase.from('user_youtube_links').insert({ user_id: user.id, url }).select().single()
    setAddingLink(false)
    if (data) {
      setYoutubeLinks((prev) => [data, ...prev])
      setNewYoutubeUrl('')
    }
  }

  async function removeYoutubeLink(id: string) {
    await supabase.from('user_youtube_links').delete().eq('id', id)
    setYoutubeLinks((prev) => prev.filter((l) => l.id !== id))
  }

  async function handleSave() {
    if (!user) return
    // Never write a username that's invalid or already claimed.
    if (usernameCheck.blocked) return
    await supabase
      .from('profiles')
      .update({ username: usernameCheck.value, bio, updated_at: new Date().toISOString() })
      .eq('id', user.id)
    setEditing(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  // A signed-in user's profile hydrates just after the session does (and power
  // sync can make that read take a moment). Never flash "User not found" for
  // the account that just finished signup; only a resolved *other-user* lookup
  // can establish that the target does not exist.
  if (notFound || (!isOwnProfile && profileLoaded && !viewProfile && targetUserId)) {
    return (
      <div className="p-8 flex flex-col items-center justify-center text-center gap-3 py-20">
        <p className="text-gray-300">User not found.</p>
        <p className="text-sm text-gray-500">This profile doesn't exist or is no longer available.</p>
        <Link to="/" className="mt-2 px-4 py-2 rounded-lg bg-accent text-dark font-semibold">Back to home</Link>
      </div>
    )
  }
  if (!viewProfile && targetUserId) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto">
      <div className="rounded-xl border border-dark-border bg-dark-card p-6 mb-6">
        <div className="flex items-start gap-6">
          {isOwnProfile ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="relative shrink-0 rounded-full focus:outline-none"
              aria-label="Change profile photo"
              title="Change profile photo"
            >
              <Avatar
                src={viewProfile?.avatar_url}
                name={username || viewProfile?.username}
                seed={viewProfile?.id ?? targetUserId}
                size={80}
              />
              <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border-2 border-dark-card bg-accent text-dark">
                <Camera className="h-4 w-4" aria-hidden />
              </span>
            </button>
          ) : (
            <Avatar
              src={viewProfile?.avatar_url}
              name={username || viewProfile?.username}
              seed={viewProfile?.id ?? targetUserId}
              size={80}
            />
          )}
          <div className="flex-1">
            {editing && isOwnProfile ? (
              <>
                {user && (
                  <div className="mb-3">
                    <AvatarPicker
                      userId={user.id}
                      username={username}
                      currentUrl={viewProfile?.avatar_url ?? null}
                      onChange={(next) =>
                        setViewProfile((p) => (p ? { ...p, avatar_url: next } : p))
                      }
                    />
                  </div>
                )}
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
                  placeholder="Username"
                />
                <div className="mb-2">
                  <AvailabilityHint
                    state={usernameCheck}
                    onPick={setUsername}
                    hint="3–20 characters — letters, numbers and underscores."
                  />
                </div>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white mb-2 resize-none"
                  placeholder="Bio"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={usernameCheck.blocked}
                    className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-dark-border text-gray-400">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold flex items-center gap-2 flex-wrap">
                  <span>{username}</span>
                  <ProfileTagBadge user={viewProfile} />
                </h1>
                {viewProfile?.power_level != null && viewProfile.power_level > 0 && (
                  <p className="text-accent text-sm mt-1">PL {viewProfile.power_level}</p>
                )}
                {viewProfile?.game_tag && (
                  <p className="mt-1 text-sm text-gray-300">
                    <span className="text-gray-500">Gamer tag</span>{' '}
                    <span className="font-medium text-white">{viewProfile.game_tag}</span>
                  </p>
                )}
                {bio && <p data-user-content className="text-gray-400 mt-2">{bio}</p>}
                <div className="flex items-center gap-4 mt-2 text-sm text-gray-400">
                  <span>{followersCount} followers</span>
                  <span>{followingCount} following</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-4">
                  {targetUserId && (
                    <Link
                      to={`/profile/${targetUserId}/trophies`}
                      className="text-accent hover:underline text-sm"
                    >
                      Trophies earned
                    </Link>
                  )}
                  {isOwnProfile ? (
                    <>
                      {/* The upgrade path must be findable from the profile
                          (operator 2026-08-02) — a real button, not a nudge. */}
                      {!IS_MOBILE_STORE_BUILD && (
                        <Link
                          to="/upgrade"
                          className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-bold hover:shadow-glow"
                        >
                          Upgrade account
                        </Link>
                      )}
                      <button
                        onClick={() => setEditing(true)}
                        className="text-accent hover:underline text-sm"
                      >
                        Edit profile
                      </button>
                      <button
                        onClick={handleSignOut}
                        className="text-gray-400 hover:text-red-400 text-sm"
                      >
                        Sign out
                      </button>
                    </>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      {user && targetUserId && (
                        <FollowControl
                          followerId={user.id}
                          targetId={targetUserId}
                          targetUsername={viewProfile?.username}
                          isFollowing={isFollowing}
                          onFollowChange={handleFollowChange}
                        />
                      )}
                      {user && targetUserId && (
                        <button
                          type="button"
                          onClick={() => navigate(`/profile?tab=messages&to=${encodeURIComponent(targetUserId)}`)}
                          className="px-4 py-2 rounded-lg border border-accent text-accent text-sm font-medium hover:bg-accent/10"
                        >
                          Message
                        </button>
                      )}
                      {viewProfile && (
                        <DonateButton
                          creatorId={viewProfile.id}
                          creatorUsername={viewProfile.username}
                        />
                      )}
                      {viewProfile && (
                        <InviteMenu
                          targetUserId={viewProfile.id}
                          targetUsername={viewProfile.username}
                          label="Invite"
                        />
                      )}
                      {/* Direct reporting stays beside the other profile safety control. */}
                      {user && targetUserId && (
                        <ProfileReportControl
                          viewerId={user.id}
                          profileId={targetUserId}
                        />
                      )}
                      {/* Unfollow-first, then a block that says what it costs. */}
                      {user && targetUserId && (
                        <BlockControl
                          userId={user.id}
                          targetId={targetUserId}
                          targetUsername={viewProfile?.username}
                          isFollowing={isFollowing}
                          onUnfollowed={() => handleFollowChange(false)}
                        />
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Is this player live right now? (unified live_sessions indicator) */}
      {targetUserId && <LiveSessionsStrip hostId={targetUserId} />}

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-dark-border">
          {(isOwnProfile
            ? (['wall', 'clips', 'feed', 'messages', 'about', 'stats'] as const)
            : (['wall', 'clips', 'about', 'stats'] as const)
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => selectTab(tab)}
              className={`shrink-0 rounded-t-lg px-4 py-2 text-sm font-medium ${
                activeTab === tab ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-white'
              }`}
            >
              {profileSectionLabel(tab)}
            </button>
          ))}
      </div>

      {activeTab === 'wall' && targetUserId && (
        <SocialFeed
          mode="wall"
          viewerId={user?.id ?? null}
          profileId={targetUserId}
          composerProfile={isOwnProfile ? viewProfile : null}
        />
      )}

      {activeTab === 'stats' && targetUserId && (
        <ProfileCreatorTab
          userId={targetUserId}
          isOwnProfile={isOwnProfile}
          isPremium={isPremium}
          powerLevel={viewProfile?.power_level ?? 0}
        />
      )}

      {activeTab === 'feed' && isOwnProfile && user && (
        <SocialFeed mode="feed" viewerId={user.id} composerProfile={viewProfile} />
      )}

      {activeTab === 'messages' && isOwnProfile && user && (
        <DirectMessages
          userId={user.id}
          initialConversationId={dmParam}
          targetUserId={dmTargetParam}
        />
      )}

      {activeTab === 'about' && targetUserId && (
        <ShinobiTrophyCloset userId={targetUserId} isOwnProfile={isOwnProfile} />
      )}

      {activeTab === 'about' && isOwnProfile && (
        <UpgradeNudge
          className="mb-6"
          title="Go Pro"
          message="Multi-angle director cuts, the live studio, no ads, and more — starting at $4.99/mo."
          cta="See tiers"
        />
      )}

      {activeTab === 'about' && isOwnProfile && <WalletChip />}

      {activeTab === 'about' && isOwnProfile && user && <WinningsLedger userId={user.id} />}

      {/* Artifact tags — buy / equip the pill you show off next to your name. */}
      {activeTab === 'about' && isOwnProfile && (
        <>
          <MyClanRostersPanel />
          <ArtifactTagsPanel />
        </>
      )}

      {activeTab === 'about' && (
        <AboutTab
          isOwnProfile={isOwnProfile}
          reels={reels}
          youtubeLinks={youtubeLinks}
          newYoutubeUrl={newYoutubeUrl}
          setNewYoutubeUrl={setNewYoutubeUrl}
          addYoutubeLink={addYoutubeLink}
          removeYoutubeLink={removeYoutubeLink}
          addingLink={addingLink}
          hasMoreReels={hasMoreReels}
          loadingMoreReels={loadingMoreReels}
          loadMoreReels={loadMoreReels}
        />
      )}

      {/* Auto-merge unlock status — own profile only (YouTube connected + a paid
          tier turns cross-player auto-merge ON). */}
      {activeTab === 'about' && isOwnProfile && (
        <AutoMergeStatus className="mt-8" />
      )}

      {/* "My Clips" — produced multi-angle videos this player appears in
          (clip_records with a youtube_id). Public, so it shows on any profile. */}
      {activeTab === 'clips' && targetUserId && (
        <PlayerProducedVideos playerId={targetUserId} isOwn={isOwnProfile} />
      )}

      {/* Settings — how your stream is (or isn't) linked to other people's. */}
      {isOwnProfile && activeTab === 'about' && user && (
        <div id="live-link-settings" className="mt-10 pt-6 border-t border-dark-border">
          <h2 className="text-lg font-bold mb-3">Live settings</h2>
          <LiveLinkSettings userId={user.id} />
        </div>
      )}

      {/* Billing — the paid subscriber's way OUT, in the account area where a
          person actually looks for it. Cancelling has to be as easy as
          subscribing was (FTC negative-option rule / state ARL statutes), so it
          lives here as well as on /upgrade. */}
      {!IS_MOBILE_STORE_BUILD && isOwnProfile && activeTab === 'about' && (
        <div id="subscription" className="mt-10 pt-6 border-t border-dark-border">
          <h2 className="text-lg font-bold mb-3">Billing</h2>
          <ManageSubscriptionPanel returnTo="/profile" />
        </div>
      )}

      {/* Account settings — in-app deletion (Play / App Store requirement). */}
      {isOwnProfile && activeTab === 'about' && (
        <div id="delete-account" className="mt-10 pt-6 border-t border-dark-border">
          <DeleteAccountPanel />
        </div>
      )}
    </div>
  )
}

function AboutTab({
  isOwnProfile,
  reels,
  youtubeLinks,
  newYoutubeUrl,
  setNewYoutubeUrl,
  addYoutubeLink,
  removeYoutubeLink,
  addingLink,
  hasMoreReels,
  loadingMoreReels,
  loadMoreReels,
}: {
  isOwnProfile: boolean
  reels: Reel[]
  youtubeLinks: UserYoutubeLink[]
  newYoutubeUrl: string
  setNewYoutubeUrl: (v: string) => void
  addYoutubeLink: (e: React.FormEvent) => void
  removeYoutubeLink: (id: string) => void
  addingLink: boolean
  hasMoreReels: boolean
  loadingMoreReels: boolean
  loadMoreReels: () => void
}) {
  return (
    <div>
      {isOwnProfile && (
        <div className="mb-8 flex flex-wrap gap-3">
          <Link
            to="/highlight/create"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
          >
            Create a reel
          </Link>
          {/* Clip-poster (the in-app browser) now lives under "Me". */}
          <Link
            to="/browser"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg border border-accent text-accent font-semibold hover:bg-accent/10 transition-all"
          >
            Post a clip
          </Link>
        </div>
      )}

      {isOwnProfile && (
        <div className="mb-8">
          <CollapsibleSection id="profile-sources" label="Sources" count={youtubeLinks.length}>
          <p className="rounded-lg border border-chakra/20 bg-dark-card/50 p-3 text-sm text-gray-400 mb-4">
            Your connected channel is managed in{' '}
            <Link to="/settings#youtube" className="font-medium text-chakra/90 hover:underline">
              YouTube settings
            </Link>
            . Save individual video links here only when you want them ready to quick-add to a reel.
          </p>
          <form onSubmit={addYoutubeLink} className="flex gap-2 mb-4">
            <input
              type="url"
              value={newYoutubeUrl}
              onChange={(e) => setNewYoutubeUrl(e.target.value)}
              placeholder="https://youtube.com/watch?v=..."
              className="flex-1 px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            />
            <button type="submit" disabled={addingLink || !newYoutubeUrl.trim()} className="px-4 py-2 rounded-lg border border-accent text-accent hover:bg-accent/10 disabled:opacity-50">
              {addingLink ? 'Adding...' : 'Add'}
            </button>
          </form>
          <div className="space-y-2">
            {youtubeLinks.map((link) => (
              <div key={link.id} className="flex items-center justify-between rounded-lg border border-dark-border bg-dark-card p-3">
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 truncate flex-1 min-w-0">
                  <span className="text-leaf text-xs shrink-0">✓ saved</span>
                  <span className="text-accent hover:underline truncate">{prettyClip(link.url, link.title)}</span>
                </a>
                <button onClick={() => removeYoutubeLink(link.id)} className="text-red-400 hover:text-red-300 text-sm ml-2">
                  Remove
                </button>
              </div>
            ))}
            {youtubeLinks.length === 0 && <p className="text-gray-400 text-sm">No saved links yet.</p>}
          </div>
          </CollapsibleSection>
        </div>
      )}

      <h2 className="text-lg font-semibold mb-4">{isOwnProfile ? 'My Reels' : 'Reels'}</h2>
      <div className="space-y-4">
        {reels.map((reel) => (
          <ReelCard key={reel.id} reel={reel} showEmoji={!!reel} />
        ))}
      </div>
      {reels.length === 0 && <p className="text-gray-400">No reels yet.</p>}
      {hasMoreReels && (
        <button
          type="button"
          onClick={loadMoreReels}
          disabled={loadingMoreReels}
          className="mt-5 w-full rounded-lg border border-dark-border px-4 py-3 text-sm font-semibold text-gray-200 hover:border-accent/50 disabled:opacity-50"
        >
          {loadingMoreReels ? 'Loading more reels...' : 'Load more reels'}
        </button>
      )}
    </div>
  )
}

function ReelCard({ reel, showEmoji }: { reel: Reel; showEmoji: boolean }) {
  const [reactions, setReactions] = useState<{ emoji: string; count: number; userVoted: boolean }[]>([])
  const { user } = useAuth()

  useEffect(() => {
    if (!showEmoji) return
    async function load() {
      const { data } = await supabase
        .from('reel_reactions')
        .select('emoji, user_id')
        .eq('reel_id', reel.id)
      const agg = new Map<string, { count: number; userVoted: boolean }>()
      for (const r of data ?? []) {
        const cur = agg.get(r.emoji) ?? { count: 0, userVoted: false }
        cur.count++
        if (r.user_id === user?.id) cur.userVoted = true
        agg.set(r.emoji, cur)
      }
      setReactions([...agg.entries()].map(([emoji, v]) => ({ emoji, ...v })))
    }
    load()
  }, [reel.id, user?.id, showEmoji])

  async function addReaction(emoji: string) {
    if (!user) return
    const existing = reactions.find((r) => r.emoji === emoji && r.userVoted)
    if (existing) {
      await supabase.from('reel_reactions').delete().eq('reel_id', reel.id).eq('user_id', user.id).eq('emoji', emoji)
      setReactions((prev) =>
        prev.map((r) =>
          r.emoji === emoji ? { ...r, count: r.count - 1, userVoted: false } : r
        ).filter((r) => r.count > 0)
      )
    } else {
      await supabase.from('reel_reactions').insert({ reel_id: reel.id, user_id: user.id, emoji })
      setReactions((prev) => {
        const found = prev.find((r) => r.emoji === emoji)
        if (found) return prev.map((r) => (r.emoji === emoji ? { ...r, count: r.count + 1, userVoted: true } : r))
        return [...prev, { emoji, count: 1, userVoted: true }]
      })
    }
  }

  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-4 hover:border-accent/50 transition-colors">
      <Link to={`/reels/${reel.id}`} className="block">
        <h3 className="font-medium">{reel.title}</h3>
        <p className="text-sm text-gray-400">{reel.clip_ids?.length ?? 0} clips</p>
      </Link>
      {showEmoji && (
        <div className="flex flex-wrap gap-2 mt-2">
          {reactions.map((r) => (
            <button
              key={r.emoji}
              onClick={() => addReaction(r.emoji)}
              className={`px-2 py-1 rounded text-sm ${r.userVoted ? 'bg-accent/20 text-accent' : 'bg-dark-border/30 text-gray-400'}`}
            >
              {r.emoji} {r.count}
            </button>
          ))}
          {EMOJI_PICKER.map((e) => (
            <button
              key={e}
              onClick={() => addReaction(e)}
              className="px-2 py-1 rounded text-sm bg-dark-border/30 text-gray-400 hover:bg-accent/20 hover:text-accent"
            >
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
//  Shinobi Trophy Closet — each defeated opponent becomes a "Shinobi" entry
//  (their avatar + a "times beaten" count, shown as "coming soon" for now).
//  Reads `shinobi_defeats` (db/schema.sql — TKO KING); logic in src/lib/tkoKing.ts.
// ─────────────────────────────────────────────────────────────────────────

function ShinobiTrophyCloset({ userId, isOwnProfile }: { userId: string; isOwnProfile: boolean }) {
  const [rows, setRows] = useState<ShinobiDefeatRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('shinobi_defeats')
        .select('opponent_id, beat_count')
        .eq('user_id', userId)
      const defeats = (data ?? []) as { opponent_id: string; beat_count: number | null }[]
      const oppIds = [...new Set(defeats.map((d) => d.opponent_id))]
      const nameMap = new Map<string, { username: string; avatar_url: string | null }>()
      if (oppIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, username, avatar_url').in('id', oppIds)
        for (const p of profs ?? []) nameMap.set(p.id, { username: p.username, avatar_url: p.avatar_url })
      }
      if (cancelled) return
      setRows(
        defeats.map((d) => ({
          opponent_id: d.opponent_id,
          beat_count: d.beat_count,
          opponent_username: nameMap.get(d.opponent_id)?.username ?? null,
          opponent_avatar_url: nameMap.get(d.opponent_id)?.avatar_url ?? null,
        })),
      )
      setLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [userId])

  const closet = buildTrophyCloset(rows)
  // Hide entirely until loaded; on other people's profiles hide when empty.
  if (!loaded) return null
  if (closet.length === 0 && !isOwnProfile) return null

  return (
    <div className="mb-6">
      <CollapsibleSection id={`shinobi-closet-${userId}`} label="Trophy Closet" count={closet.length}>
        <p className="text-xs text-gray-500 mb-3">
          Every Shinobi {isOwnProfile ? 'you have' : 'they have'} beaten, collected here. Per-opponent tallies are{' '}
          <span className="text-accent">coming soon</span>.
        </p>
        {closet.length === 0 ? (
          <p className="text-sm text-gray-500">No Shinobi yet — win a TKO King battle to start your closet.</p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
            {closet.map((t) => (
              <Link
                key={t.opponentId}
                to={`/profile/${t.opponentId}`}
                className="rounded-xl border border-dark-border bg-dark-card p-3 text-center hover:border-accent/50 transition-colors"
              >
                <div className="flex justify-center">
                  <Avatar src={t.avatarUrl} name={t.username} seed={t.opponentId} size={48} />
                </div>
                <p className="text-xs text-gray-200 mt-2 truncate">@{t.username}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">beaten · {trophyCountLabel(t)}</p>
              </Link>
            ))}
          </div>
        )}
      </CollapsibleSection>
    </div>
  )
}

export function Profile() {
  const { user, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const { userId } = useParams()

  useEffect(() => {
    if (!authLoading && !user && !userId) {
      navigate('/login')
    }
  }, [user, authLoading, navigate, userId])

  if (authLoading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }
  if (!user && !userId) {
    return null
  }

  return <ProfileContent />
}
