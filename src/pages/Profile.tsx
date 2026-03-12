import { useEffect, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Profile as ProfileType, Reel } from '@/types/database'

export function Profile() {
  const { user, profile, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [reels, setReels] = useState<Reel[]>([])
  const [editing, setEditing] = useState(false)
  const [username, setUsername] = useState('')
  const [bio, setBio] = useState('')

  useEffect(() => {
    if (!user) {
      navigate('/login')
      return
    }
    setUsername(profile?.username ?? '')
    setBio(profile?.bio ?? '')
  }, [user, profile, navigate])

  useEffect(() => {
    if (!user) return
    async function fetch() {
      const { data } = await supabase
        .from('reels')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      setReels(data ?? [])
    }
    fetch()
  }, [user?.id])

  async function handleSave() {
    if (!user) return
    await supabase.from('profiles').update({ username, bio, updated_at: new Date().toISOString() }).eq('id', user.id)
    setEditing(false)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  if (authLoading || !user) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="rounded-xl border border-dark-border bg-dark-card p-6 mb-8">
        <div className="flex items-start gap-6">
          {profile?.avatar_url ? (
            <img src={profile.avatar_url} alt="" className="w-20 h-20 rounded-full" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-accent/20 flex items-center justify-center text-accent text-2xl font-bold">
              {username[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="flex-1">
            {editing ? (
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
                {bio && <p className="text-gray-400 mt-2">{bio}</p>}
                <button
                  onClick={() => setEditing(true)}
                  className="mt-4 text-accent hover:underline text-sm"
                >
                  Edit profile
                </button>
              </>
            )}
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="mt-6 text-gray-400 hover:text-red-400 text-sm"
        >
          Sign out
        </button>
      </div>
      <h2 className="text-lg font-semibold mb-4">My Reels</h2>
      <div className="space-y-4">
        {reels.map((reel) => (
          <Link
            key={reel.id}
            to={`/reels/${reel.id}`}
            className="block rounded-lg border border-dark-border bg-dark-card p-4 hover:border-accent/50 transition-colors"
          >
            <h3 className="font-medium">{reel.title}</h3>
            <p className="text-sm text-gray-400">{reel.clip_ids?.length ?? 0} clips</p>
          </Link>
        ))}
      </div>
      {reels.length === 0 && <p className="text-gray-400">No reels yet.</p>}
    </div>
  )
}
