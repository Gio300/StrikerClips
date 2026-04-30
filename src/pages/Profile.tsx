import { useEffect, useState } from 'react'
import { useNavigate, Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { BRAND } from '@/lib/brand'
import { InviteMenu } from '@/components/InviteMenu'
import { DonateButton } from '@/components/DonateButton'
import type {
  Reel,
  UserYoutubeLink,
  Profile,
  Activity,
  DmConversation,
  DmMessage,
  Poll,
  PollOption,
  PollVote,
} from '@/types/database'

const EMOJI_PICKER = ['👍', '❤️', '😂', '🔥', '👏', '💯', '🎉', '😮']

function ProfileContent() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const { userId } = useParams()
  const isOwnProfile = !userId || userId === user?.id

  const [activeTab, setActiveTab] = useState<'profile' | 'activity' | 'messages' | 'polls'>('profile')
  const [reels, setReels] = useState<Reel[]>([])
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

  const targetUserId = userId ? userId : user?.id

  useEffect(() => {
    if (!user && !userId) {
      navigate('/login')
      return
    }
    if (isOwnProfile) {
      setUsername(profile?.username ?? '')
      setBio(profile?.bio ?? '')
      setViewProfile(profile ?? null)
    }
  }, [user, profile, navigate, userId, isOwnProfile])

  useEffect(() => {
    if (!targetUserId) return
    async function load() {
      if (isOwnProfile) {
        setUsername(profile?.username ?? '')
        setBio(profile?.bio ?? '')
        setViewProfile(profile ?? null)
      } else {
        const { data } = await supabase.from('profiles').select('*').eq('id', targetUserId).single()
        setViewProfile(data ?? null)
        setUsername(data?.username ?? '')
        setBio(data?.bio ?? '')
      }
      const [reelsRes, linksRes, followersRes, followingRes, followRes] = await Promise.all([
        supabase.from('reels').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }),
        isOwnProfile ? supabase.from('user_youtube_links').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false }) : { data: [] },
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('following_id', targetUserId),
        supabase.from('follows').select('*', { count: 'exact', head: true }).eq('follower_id', targetUserId),
        user ? supabase.from('follows').select('id').eq('follower_id', user.id).eq('following_id', targetUserId).maybeSingle() : { data: null },
      ])
      setReels(reelsRes.data ?? [])
      if (isOwnProfile) setYoutubeLinks((linksRes as { data?: UserYoutubeLink[] }).data ?? [])
      setFollowersCount((followersRes as { count?: number }).count ?? 0)
      setFollowingCount((followingRes as { count?: number }).count ?? 0)
      setIsFollowing(!!(followRes as { data?: unknown }).data)
    }
    load()
  }, [targetUserId, isOwnProfile, user?.id, profile])

  async function toggleFollow() {
    if (!user || !targetUserId || targetUserId === user.id) return
    if (isFollowing) {
      await supabase.from('follows').delete().eq('follower_id', user.id).eq('following_id', targetUserId)
      setIsFollowing(false)
      setFollowersCount((c) => Math.max(0, c - 1))
    } else {
      await supabase.from('follows').insert({ follower_id: user.id, following_id: targetUserId })
      setIsFollowing(true)
      setFollowersCount((c) => c + 1)
    }
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
    await supabase.from('profiles').update({ username, bio, updated_at: new Date().toISOString() }).eq('id', user.id)
    setEditing(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  if (!viewProfile && targetUserId) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="rounded-xl border border-dark-border bg-dark-card p-6 mb-6">
        <div className="flex items-start gap-6">
          {viewProfile?.avatar_url ? (
            <img src={viewProfile.avatar_url} alt="" className="w-20 h-20 rounded-full" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center text-accent text-2xl font-bold">
              {username[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="flex-1">
            {editing && isOwnProfile ? (
              <>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white mb-2"
                  placeholder="Username"
                />
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white mb-2 resize-none"
                  placeholder="Bio"
                  rows={3}
                />
                <div className="flex gap-2">
                  <button onClick={handleSave} className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold">
                    Save
                  </button>
                  <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-lg border border-dark-border text-gray-400">
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <h1 className="text-xl font-bold">{username}</h1>
                {viewProfile?.power_level != null && viewProfile.power_level > 0 && (
                  <p className="text-accent text-sm mt-1">PL {viewProfile.power_level}</p>
                )}
                {bio && <p className="text-gray-400 mt-2">{bio}</p>}
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
                      <button
                        onClick={toggleFollow}
                        className={`px-4 py-2 rounded-lg text-sm font-medium ${
                          isFollowing ? 'border border-dark-border text-gray-400' : 'bg-accent text-dark'
                        }`}
                      >
                        {isFollowing ? 'Unfollow' : 'Follow'}
                      </button>
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
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {isOwnProfile && (
        <div className="flex gap-2 border-b border-dark-border mb-6">
          {(['profile', 'activity', 'messages', 'polls'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-t-lg text-sm font-medium capitalize ${
                activeTab === tab ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'profile' && (
        <ProfileTab
          isOwnProfile={isOwnProfile}
          reels={reels}
          youtubeLinks={youtubeLinks}
          newYoutubeUrl={newYoutubeUrl}
          setNewYoutubeUrl={setNewYoutubeUrl}
          addYoutubeLink={addYoutubeLink}
          removeYoutubeLink={removeYoutubeLink}
          addingLink={addingLink}
        />
      )}
      {activeTab === 'activity' && isOwnProfile && <ActivityTab userId={user!.id} />}
      {activeTab === 'messages' && isOwnProfile && <MessagesTab userId={user!.id} />}
      {activeTab === 'polls' && isOwnProfile && <PollsTab userId={user!.id} />}
    </div>
  )
}

function ProfileTab({
  isOwnProfile,
  reels,
  youtubeLinks,
  newYoutubeUrl,
  setNewYoutubeUrl,
  addYoutubeLink,
  removeYoutubeLink,
  addingLink,
}: {
  isOwnProfile: boolean
  reels: Reel[]
  youtubeLinks: UserYoutubeLink[]
  newYoutubeUrl: string
  setNewYoutubeUrl: (v: string) => void
  addYoutubeLink: (e: React.FormEvent) => void
  removeYoutubeLink: (id: string) => void
  addingLink: boolean
}) {
  return (
    <div>
      {isOwnProfile && (
        <div className="mb-8">
          <Link
            to="/highlight/create"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
          >
            Create a reel
          </Link>
        </div>
      )}

      {isOwnProfile && (
        <>
          <h2 className="text-lg font-semibold mb-4">My YouTube sources</h2>
          <p className="rounded-lg border border-chakra/20 bg-dark-card/50 p-3 text-sm text-gray-400 mb-4">
            <span className="text-chakra/90 font-medium">Next:</span> connect your YouTube account so {BRAND.name} can
            use the official API to work with <em>only your uploads</em> (no link scraping) for cloud renders and the
            public channel. Rolling out with the desktop app; for now, paste links or save them below.
          </p>
          <p className="text-gray-400 text-sm mb-4">Save YouTube URLs to quick-add when you build a reel.</p>
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
          <div className="space-y-2 mb-8">
            {youtubeLinks.map((link) => (
              <div key={link.id} className="flex items-center justify-between rounded-lg border border-dark-border bg-dark-card p-3">
                <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline truncate flex-1">
                  {link.url}
                </a>
                <button onClick={() => removeYoutubeLink(link.id)} className="text-red-400 hover:text-red-300 text-sm ml-2">
                  Remove
                </button>
              </div>
            ))}
            {youtubeLinks.length === 0 && <p className="text-gray-400 text-sm">No saved links yet.</p>}
          </div>
        </>
      )}

      <h2 className="text-lg font-semibold mb-4">{isOwnProfile ? 'My Reels' : 'Reels'}</h2>
      <div className="space-y-4">
        {reels.map((reel) => (
          <ReelCard key={reel.id} reel={reel} showEmoji={!!reel} />
        ))}
      </div>
      {reels.length === 0 && <p className="text-gray-400">No reels yet.</p>}
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

function ActivityTab({ userId }: { userId: string }) {
  const [activities, setActivities] = useState<(Activity & { profiles?: { username: string } })[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: following } = await supabase.from('follows').select('following_id').eq('follower_id', userId)
      const ids = following?.map((f) => f.following_id) ?? []
      ids.push(userId)
      const { data } = await supabase
        .from('activities')
        .select('*, profiles(username, power_level)')
        .in('user_id', ids)
        .order('created_at', { ascending: false })
        .limit(50)
      setActivities(data ?? [])
      setLoading(false)
    }
    load()
  }, [userId])

  if (loading) return <div className="animate-pulse text-gray-400">Loading activity...</div>

  return (
    <div className="space-y-4 max-h-[60vh] overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4">Activity Feed</h2>
      {activities.length === 0 ? (
        <p className="text-gray-400">No activity yet. Follow users to see their activity!</p>
      ) : (
        activities.map((a) => (
          <div key={a.id} className="rounded-lg border border-dark-border bg-dark-card p-4">
            <ActivityItem activity={a} />
          </div>
        ))
      )}
    </div>
  )
}

function ActivityItem({ activity }: { activity: Activity & { profiles?: { username: string; power_level?: number } } }) {
  const { type, profiles, target_id, target_meta, created_at } = activity
  const meta = target_meta as { title?: string; question?: string } | null
  const username = profiles?.username ?? 'Someone'
  const powerLevel = profiles?.power_level

  const time = new Date(created_at).toLocaleDateString()

  if (type === 'reel_created') {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{username}</span>
          <span className="text-gray-400 text-sm">created a reel</span>
        </div>
        {target_id && (
          <Link to={`/reels/${target_id}`} className="text-accent hover:underline mt-1 block">
            {meta?.title ?? 'View reel'}
          </Link>
        )}
        <p className="text-gray-500 text-xs mt-1">{time}</p>
      </div>
    )
  }
  if (type === 'follow') {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{username}</span>
          {powerLevel != null && powerLevel > 0 && <span className="text-accent text-sm">· PL {powerLevel}</span>}
          <span className="text-gray-400 text-sm">followed someone</span>
        </div>
        <p className="text-gray-500 text-xs mt-1">{time}</p>
      </div>
    )
  }
  if (type === 'reel_like') {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{username}</span>
          {powerLevel != null && powerLevel > 0 && <span className="text-accent text-sm">· PL {powerLevel}</span>}
          <span className="text-gray-400 text-sm">liked a reel</span>
        </div>
        {target_id && (
          <Link to={`/reels/${target_id}`} className="text-accent hover:underline mt-1 block">
            View reel
          </Link>
        )}
        <p className="text-gray-500 text-xs mt-1">{time}</p>
      </div>
    )
  }
  if (type === 'poll_created') {
    return (
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium">{username}</span>
          {powerLevel != null && powerLevel > 0 && <span className="text-accent text-sm">· PL {powerLevel}</span>}
          <span className="text-gray-400 text-sm">created a poll</span>
        </div>
        <p className="text-gray-500 text-xs mt-1">{time}</p>
      </div>
    )
  }
  return null
}

function MessagesTab({ userId }: { userId: string }) {
  const [conversations, setConversations] = useState<(DmConversation & { participants?: { user_id: string; profiles?: { username: string } }[] })[]>([])
  const [selectedConversation, setSelectedConversation] = useState<string | null>(null)
  const [messages, setMessages] = useState<(DmMessage & { profiles?: { username: string } })[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [newDmUsername, setNewDmUsername] = useState('')
  const [addToConvUsername, setAddToConvUsername] = useState('')
  const [creating, setCreating] = useState(false)
  const [addingToConv, setAddingToConv] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: parts } = await supabase
        .from('dm_participants')
        .select('conversation_id')
        .eq('user_id', userId)
      const convIds = [...new Set((parts ?? []).map((p) => p.conversation_id))]
      if (convIds.length === 0) {
        setConversations([])
        return
      }
      const { data: convs } = await supabase.from('dm_conversations').select('*').in('id', convIds)
      const convsWithParticipants = await Promise.all(
        (convs ?? []).map(async (c) => {
          const { data: p } = await supabase
            .from('dm_participants')
            .select('user_id, profiles(username, power_level)')
            .eq('conversation_id', c.id)
          return { ...c, participants: p ?? [] }
        })
      )
      setConversations(convsWithParticipants)
    }
    load()
  }, [userId])

  useEffect(() => {
    if (!selectedConversation) {
      setMessages([])
      return
    }
    async function load() {
      const { data } = await supabase
        .from('dm_messages')
        .select('*, profiles(username, power_level)')
        .eq('conversation_id', selectedConversation)
        .order('created_at', { ascending: true })
      setMessages(data ?? [])
    }
    load()
    const channel = supabase
      .channel(`dm:${selectedConversation}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${selectedConversation}` }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [selectedConversation])

  async function startConversation(e: React.FormEvent) {
    e.preventDefault()
    if (!newDmUsername.trim() || creating) return
    setCreating(true)
    const { data: target } = await supabase.from('profiles').select('id').ilike('username', newDmUsername.trim()).single()
    if (!target) {
      setCreating(false)
      return
    }
    const { data: existing } = await supabase
      .from('dm_participants')
      .select('conversation_id')
      .eq('user_id', userId)
    for (const p of existing ?? []) {
      const { data: other } = await supabase.from('dm_participants').select('user_id').eq('conversation_id', p.conversation_id).eq('user_id', target.id).single()
      if (other) {
        setSelectedConversation(p.conversation_id)
        setNewDmUsername('')
        setCreating(false)
        return
      }
    }
    const { data: conv } = await supabase.from('dm_conversations').insert({}).select().single()
    if (conv) {
      await supabase.from('dm_participants').insert([
        { conversation_id: conv.id, user_id: userId },
        { conversation_id: conv.id, user_id: target.id },
      ])
      setConversations((prev) => [...prev, { ...conv, participants: [] }])
      setSelectedConversation(conv.id)
    }
    setNewDmUsername('')
    setCreating(false)
  }

  const { profile } = useAuth()

  async function addPersonToConversation(e: React.FormEvent) {
    e.preventDefault()
    if (!addToConvUsername.trim() || !selectedConversation || addingToConv) return
    setAddingToConv(true)
    const { data: target } = await supabase.from('profiles').select('id').ilike('username', addToConvUsername.trim()).single()
    if (target) {
      await supabase.from('dm_participants').insert({ conversation_id: selectedConversation, user_id: target.id }).then(() => {
        setConversations((prev) => prev.map((c) => (c.id === selectedConversation ? { ...c, participants: [...(c.participants ?? []), { user_id: target.id, profiles: { username: addToConvUsername.trim() } }] } : c)))
      })
    }
    setAddToConvUsername('')
    setAddingToConv(false)
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    const content = newMessage.trim()
    if (!content || !selectedConversation) return
    setNewMessage('')
    await supabase.from('dm_messages').insert({ conversation_id: selectedConversation, user_id: userId, content })
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), conversation_id: selectedConversation, user_id: userId, content, created_at: new Date().toISOString(), profiles: { username: profile?.username } }])
  }

  return (
    <div className="flex gap-4">
      <div className="w-64 shrink-0 space-y-2">
        <form onSubmit={startConversation} className="flex gap-2">
          <input
            value={newDmUsername}
            onChange={(e) => setNewDmUsername(e.target.value)}
            placeholder="Username to message"
            className="flex-1 px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
          />
          <button type="submit" disabled={creating} className="px-3 py-2 rounded-lg bg-accent text-dark text-sm font-medium">
            New
          </button>
        </form>
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {conversations.map((c) => {
            const others = c.participants?.filter((p) => p.user_id !== userId) ?? []
            const name = others.length > 0
              ? others.map((o) => (o as { profiles?: { username: string } })?.profiles?.username ?? '?').join(', ')
              : 'Chat'
            return (
              <button
                key={c.id}
                onClick={() => setSelectedConversation(c.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm ${
                  selectedConversation === c.id ? 'bg-accent/20 text-accent' : 'bg-dark-border/30 text-gray-300 hover:bg-dark-border/50'
                }`}
              >
                {name}
              </button>
            )
          })}
        </div>
      </div>
      <div className="flex-1 flex flex-col min-h-64 rounded-lg border border-dark-border bg-dark-card">
        {selectedConversation ? (
          <>
            <div className="p-2 border-b border-dark-border flex items-center gap-2">
              <span className="text-sm text-gray-400">Add people:</span>
              <form onSubmit={addPersonToConversation} className="flex gap-2 flex-1">
                <input
                  value={addToConvUsername}
                  onChange={(e) => setAddToConvUsername(e.target.value)}
                  placeholder="Username"
                  className="flex-1 px-3 py-1.5 rounded bg-dark border border-dark-border text-white text-sm"
                />
                <button type="submit" disabled={addingToConv} className="px-2 py-1 rounded bg-accent/20 text-accent text-sm">
                  Add
                </button>
              </form>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.user_id === userId ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] px-3 py-2 rounded-lg ${m.user_id === userId ? 'bg-accent/20 text-accent' : 'bg-dark-border/30 text-gray-300'}`}>
                    <p className="text-xs text-gray-500">
                    {(m.profiles as { username?: string })?.username ?? 'Unknown'}
                    {(m.profiles as { power_level?: number })?.power_level != null && (m.profiles as { power_level?: number }).power_level! > 0 && (
                      <span className="text-accent ml-1">· PL {(m.profiles as { power_level?: number }).power_level}</span>
                    )}
                  </p>
                    <p>{m.content}</p>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={sendMessage} className="p-4 border-t border-dark-border flex gap-2">
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type a message..."
                className="flex-1 px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
              />
              <button type="submit" className="px-4 py-2 rounded-lg bg-accent text-dark font-medium">
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a conversation or start a new one
          </div>
        )}
      </div>
    </div>
  )
}

function PollsTab({ userId }: { userId: string }) {
  const { profile } = useAuth()
  const [polls, setPolls] = useState<(Poll & { poll_options?: PollOption[]; profiles?: { username: string; power_level?: number } })[]>([])
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState(['', ''])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('polls')
        .select('*, poll_options(*), profiles(username, power_level)')
        .order('created_at', { ascending: false })
        .limit(20)
      setPolls(data ?? [])
    }
    load()
  }, [])

  async function createPoll(e: React.FormEvent) {
    e.preventDefault()
    const opts = options.filter((o) => o.trim())
    if (!question.trim() || opts.length < 2 || creating) return
    setCreating(true)
    const { data: poll } = await supabase.from('polls').insert({ user_id: userId, question: question.trim() }).select().single()
    if (poll) {
      await supabase.from('poll_options').insert(opts.map((text, i) => ({ poll_id: poll.id, text: text.trim(), order: i })))
      setPolls((prev) => [{ ...poll, poll_options: opts.map((t, i) => ({ id: '', poll_id: poll.id, text: t.trim(), order: i })), profiles: { username: profile?.username ?? 'You' } }, ...prev])
      setQuestion('')
      setOptions(['', ''])
    }
    setCreating(false)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-4">Create Poll</h2>
        <form onSubmit={createPoll} className="space-y-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Poll question"
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
          />
          {options.map((opt, i) => (
            <input
              key={i}
              value={opt}
              onChange={(e) => {
                const next = [...options]
                next[i] = e.target.value
                setOptions(next)
              }}
              placeholder={`Option ${i + 1}`}
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            />
          ))}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOptions((o) => [...o, ''])} className="text-accent text-sm">
              + Add option
            </button>
            <button type="submit" disabled={creating} className="px-4 py-2 rounded-lg bg-accent text-dark font-medium">
              Create Poll
            </button>
          </div>
        </form>
      </div>
      <div>
        <h2 className="text-lg font-semibold mb-4">Polls</h2>
        <div className="space-y-4">
          {polls.map((poll) => (
            <PollCard key={poll.id} poll={poll} userId={userId} />
          ))}
        </div>
        {polls.length === 0 && <p className="text-gray-400">No polls yet.</p>}
      </div>
    </div>
  )
}

function PollCard({ poll, userId }: { poll: Poll & { poll_options?: PollOption[]; profiles?: { username: string; power_level?: number } }; userId: string }) {
  const [votes, setVotes] = useState<PollVote[]>([])
  const [myVote, setMyVote] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('poll_votes').select('*').eq('poll_id', poll.id)
      setVotes(data ?? [])
      const mine = (data ?? []).find((v) => v.user_id === userId)
      setMyVote(mine?.poll_option_id ?? null)
    }
    load()
  }, [poll.id, userId])

  async function vote(optionId: string) {
    if (myVote) {
      await supabase.from('poll_votes').delete().eq('poll_id', poll.id).eq('user_id', userId)
      setMyVote(null)
      setVotes((v) => v.filter((x) => !(x.poll_option_id === optionId && x.user_id === userId)))
    }
    await supabase.from('poll_votes').insert({ poll_id: poll.id, poll_option_id: optionId, user_id: userId })
    setMyVote(optionId)
    setVotes((v) => [...v, { id: '', poll_id: poll.id, poll_option_id: optionId, user_id: userId, created_at: '' }])
  }

  const opts = poll.poll_options ?? []
  const total = votes.length

  return (
    <div className="rounded-lg border border-dark-border bg-dark-card p-4">
      <p className="font-medium mb-2">{poll.question}</p>
      <p className="text-xs text-gray-500 mb-2">
        by {(poll.profiles as { username?: string })?.username ?? 'Unknown'}
        {(poll.profiles as { power_level?: number })?.power_level != null && (poll.profiles as { power_level?: number }).power_level! > 0 && (
          <span className="text-accent ml-1">· PL {(poll.profiles as { power_level?: number }).power_level}</span>
        )}
      </p>
      <div className="space-y-2">
        {opts.map((opt) => {
          const count = votes.filter((v) => v.poll_option_id === opt.id).length
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          return (
            <button
              key={opt.id}
              onClick={() => vote(opt.id)}
              className={`w-full text-left px-3 py-2 rounded-lg border ${
                myVote === opt.id ? 'border-accent bg-accent/10 text-accent' : 'border-dark-border text-gray-300'
              }`}
            >
              <div className="flex justify-between">
                <span>{opt.text}</span>
                <span className="text-sm text-gray-500">{pct}% ({count})</span>
              </div>
            </button>
          )
        })}
      </div>
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
