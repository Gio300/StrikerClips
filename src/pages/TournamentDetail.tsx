import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

type Tournament = {
  id: string
  name: string
  description: string | null
  rules: string | null
  created_by: string | null
  created_at: string
}

type StatCheckSubmission = {
  id: string
  user_id: string
  video_url: string
  character_name: string | null
  description: string | null
  status: string
  created_at: string
  tournament_id: string | null
}

type TournamentResult = {
  id: string
  tournament_id: string
  winner_profile_id: string
  team_name: string | null
  submitted_by: string | null
  created_at: string
}

type TournamentAdmin = {
  id: string
  tournament_id: string
  user_id: string
}

export function TournamentDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [tournament, setTournament] = useState<Tournament | null>(null)
  const [submissions, setSubmissions] = useState<(StatCheckSubmission & { profiles?: { username: string } })[]>([])
  const [results, setResults] = useState<(TournamentResult & { winner_username?: string })[]>([])
  const [admins, setAdmins] = useState<(TournamentAdmin & { username?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState<'rules' | 'stat-check' | 'submit-result' | 'admins'>('rules')

  const isOwner = user?.id && tournament?.created_by === user.id
  const adminIds = new Set(admins.map((a) => a.user_id))
  const isAdmin = isOwner || (user?.id && adminIds.has(user.id))
  const canManage = isOwner || isAdmin

  useEffect(() => {
    if (!id) return
    async function load() {
      const { data: t } = await supabase.from('tournaments').select('*').eq('id', id).single()
      setTournament(t ?? null)
      if (!t) {
        setLoading(false)
        return
      }
      const [subRes, resRes, admRes] = await Promise.all([
        supabase.from('stat_check_submissions').select('*').eq('tournament_id', id).order('created_at', { ascending: false }),
        supabase.from('tournament_results').select('*').eq('tournament_id', id).order('created_at', { ascending: false }),
        supabase.from('tournament_admins').select('*').eq('tournament_id', id),
      ])
      setSubmissions(subRes.data ?? [])
      setResults(resRes.data ?? [])
      setAdmins(admRes.data ?? [])

      const winnerIds = [...new Set((resRes.data ?? []).map((r) => r.winner_profile_id))]
      const adminUserIds = [...new Set((admRes.data ?? []).map((a) => a.user_id))]
      const allUserIds = [...winnerIds, ...adminUserIds]
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, username').in('id', allUserIds)
        const profileMap = new Map((profiles ?? []).map((p) => [p.id, p.username]))
        setResults((prev) =>
          prev.map((r) => ({ ...r, winner_username: profileMap.get(r.winner_profile_id) ?? 'Unknown' }))
        )
        setAdmins((prev) =>
          prev.map((a) => ({ ...a, username: profileMap.get(a.user_id) ?? 'Unknown' }))
        )
      }

      const subUserIds = [...new Set((subRes.data ?? []).map((s) => s.user_id))]
      if (subUserIds.length > 0) {
        const { data: subProfiles } = await supabase.from('profiles').select('id, username').in('id', subUserIds)
        const subMap = new Map((subProfiles ?? []).map((p) => [p.id, p.username]))
        setSubmissions((prev) =>
          prev.map((s) => ({ ...s, profiles: { username: subMap.get(s.user_id) ?? 'Unknown' } }))
        )
      }
      setLoading(false)
    }
    load()
  }, [id])

  if (loading || !tournament) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        {loading ? (
          <div className="animate-pulse text-gray-400">Loading tournament...</div>
        ) : (
          <div className="text-gray-400">
            Tournament not found. <Link to="/tournaments" className="text-accent hover:underline">Back to tournaments</Link>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <Link to="/tournaments" className="text-accent hover:underline text-sm mb-4 inline-block">← Back to tournaments</Link>
      <h1 className="text-2xl font-bold mb-2">{tournament.name}</h1>
      {tournament.description && <p className="text-gray-400 mb-6">{tournament.description}</p>}

      <div className="flex flex-wrap gap-2 border-b border-dark-border mb-6">
        {(['rules', 'stat-check', 'submit-result', 'admins'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`px-4 py-2 rounded-t-lg text-sm font-medium capitalize ${
              activeSection === s ? 'bg-accent/10 text-accent border-b-2 border-accent' : 'text-gray-400 hover:text-white'
            }`}
          >
            {s === 'stat-check' ? 'Stat Check' : s === 'submit-result' ? 'Submit Result' : s}
          </button>
        ))}
      </div>

      {activeSection === 'rules' && (
        <div className="rounded-xl border border-dark-border bg-dark-card p-6">
          {tournament.rules ? (
            <pre className="whitespace-pre-wrap text-gray-300">{tournament.rules}</pre>
          ) : (
            <p className="text-gray-400">No rules specified.</p>
          )}
        </div>
      )}

      {activeSection === 'stat-check' && (
        <StatCheckSection
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          submissions={submissions}
          setSubmissions={setSubmissions}
          user={user}
          canManage={canManage}
        />
      )}

      {activeSection === 'submit-result' && (
        <SubmitResultSection
          tournamentId={tournament.id}
          tournamentName={tournament.name}
          results={results}
          setResults={setResults}
          user={user}
          canManage={canManage}
        />
      )}

      {activeSection === 'admins' && (
        <AdminsSection
          tournamentId={tournament.id}
          admins={admins}
          setAdmins={setAdmins}
          user={user}
          isOwner={isOwner}
        />
      )}
    </div>
  )
}

function StatCheckSection({
  tournamentId,
  tournamentName,
  submissions,
  setSubmissions,
  user,
  canManage,
}: {
  tournamentId: string
  tournamentName: string
  submissions: (StatCheckSubmission & { profiles?: { username: string } })[]
  setSubmissions: React.Dispatch<React.SetStateAction<(StatCheckSubmission & { profiles?: { username: string } })[]>>
  user: { id: string } | null
  canManage: boolean
}) {
  const [videoUrl, setVideoUrl] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !videoUrl.trim() || submitting) return
    setSubmitting(true)
    const { data } = await supabase
      .from('stat_check_submissions')
      .insert({
        user_id: user.id,
        video_url: videoUrl.trim(),
        character_name: characterName.trim() || null,
        description: description.trim() || null,
        tournament_id: tournamentId,
      })
      .select('*, profiles(username)')
      .single()
    setSubmitting(false)
    if (data) {
      setSubmissions((prev) => [data as StatCheckSubmission & { profiles?: { username: string } }, ...prev])
      setVideoUrl('')
      setCharacterName('')
      setDescription('')
    }
  }

  async function handleReview(id: string, status: 'approved' | 'rejected') {
    if (!user || !canManage) return
    await supabase
      .from('stat_check_submissions')
      .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: user.id })
      .eq('id', id)
    setSubmissions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)))
  }

  return (
    <div className="space-y-6">
      {user && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-dark-border bg-dark-card p-6">
          <h2 className="font-semibold mb-4">Submit Stat Check for {tournamentName}</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Video URL</label>
              <input
                type="url"
                value={videoUrl}
                onChange={(e) => setVideoUrl(e.target.value)}
                placeholder="https://youtube.com/watch?v=..."
                className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Character name (optional)</label>
              <input
                type="text"
                value={characterName}
                onChange={(e) => setCharacterName(e.target.value)}
                placeholder="e.g. Naruto"
                className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe the buffs shown..."
                rows={3}
                className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white resize-none"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 rounded-lg bg-accent text-dark font-medium disabled:opacity-50"
            >
              {submitting ? 'Submitting...' : 'Submit'}
            </button>
          </div>
        </form>
      )}

      <div>
        <h2 className="font-semibold mb-4">Submissions</h2>
        {submissions.length === 0 ? (
          <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">No submissions yet.</div>
        ) : (
          <div className="space-y-4">
            {submissions.map((s) => (
              <div key={s.id} className="rounded-lg border border-dark-border bg-dark-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-accent font-medium">{s.profiles?.username ?? 'Unknown'}</span>
                  <span
                    className={`text-sm px-2 py-0.5 rounded ${
                      s.status === 'approved' ? 'bg-green-500/20 text-green-400' : s.status === 'rejected' ? 'bg-red-500/20 text-red-400' : 'bg-gray-500/20 text-gray-400'
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <a href={s.video_url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline block truncate">
                  {s.video_url}
                </a>
                {s.character_name && <p className="text-sm text-gray-400 mt-1">Character: {s.character_name}</p>}
                {s.description && <p className="text-sm text-gray-400 mt-1">{s.description}</p>}
                <p className="text-xs text-gray-500 mt-2">{new Date(s.created_at).toLocaleString()}</p>
                {canManage && s.status === 'pending' && (
                  <div className="flex gap-2 mt-2">
                    <button
                      onClick={() => handleReview(s.id, 'approved')}
                      className="px-3 py-1 rounded text-sm bg-green-500/20 text-green-400 hover:bg-green-500/30"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleReview(s.id, 'rejected')}
                      className="px-3 py-1 rounded text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30"
                    >
                      Reject
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SubmitResultSection({
  tournamentId,
  tournamentName,
  results,
  setResults,
  user,
  canManage,
}: {
  tournamentId: string
  tournamentName: string
  results: (TournamentResult & { winner_username?: string })[]
  setResults: React.Dispatch<React.SetStateAction<(TournamentResult & { winner_username?: string })[]>>
  user: { id: string } | null
  canManage: boolean
}) {
  const [winnerSearch, setWinnerSearch] = useState('')
  const [teamName, setTeamName] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; username: string }[]>([])
  const [selectedWinner, setSelectedWinner] = useState<{ id: string; username: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!winnerSearch.trim() || winnerSearch.length < 2) {
      setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${winnerSearch}%`)
        .limit(10)
      setSearchResults(data ?? [])
    }, 200)
    return () => clearTimeout(t)
  }, [winnerSearch])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !canManage || !selectedWinner || submitting) return
    setSubmitting(true)
    const { data: res } = await supabase
      .from('tournament_results')
      .insert({
        tournament_id: tournamentId,
        winner_profile_id: selectedWinner.id,
        team_name: teamName.trim() || null,
        submitted_by: user.id,
      })
      .select()
      .single()
    if (res) {
      await supabase.from('trophies').insert({
        profile_id: selectedWinner.id,
        trophy_type: 'tournament_win',
        metadata: { tournament_id: tournamentId, tournament_name: tournamentName },
      })
      setResults((prev) => [{ ...res, winner_username: selectedWinner.username }, ...prev])
      setSelectedWinner(null)
      setWinnerSearch('')
      setTeamName('')
    }
    setSubmitting(false)
  }

  if (!canManage) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-6">
        <h2 className="font-semibold mb-4">Winners</h2>
        {results.length === 0 ? (
          <p className="text-gray-400">No results submitted yet.</p>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <Link to={`/profile/${r.winner_profile_id}`} className="text-accent hover:underline">
                  {r.winner_username ?? 'Unknown'}
                </Link>
                {r.team_name && <span className="text-gray-400 text-sm">({r.team_name})</span>}
                <span className="text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="rounded-xl border border-dark-border bg-dark-card p-6">
        <h2 className="font-semibold mb-4">Submit Result (Winner)</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Search winner by username</label>
            <input
              type="text"
              value={winnerSearch}
              onChange={(e) => {
                setWinnerSearch(e.target.value)
                setSelectedWinner(null)
              }}
              placeholder="Type username..."
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            />
            {searchResults.length > 0 && !selectedWinner && (
              <ul className="mt-1 border border-dark-border rounded-lg overflow-hidden">
                {searchResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedWinner(p)
                        setWinnerSearch(p.username)
                        setSearchResults([])
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-accent/10 text-accent"
                    >
                      {p.username}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {selectedWinner && (
              <p className="text-sm text-accent mt-1">Selected: {selectedWinner.username}</p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Team name (optional)</label>
            <input
              type="text"
              value={teamName}
              onChange={(e) => setTeamName(e.target.value)}
              placeholder="e.g. Team Ninja"
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            />
          </div>
          <button
            type="submit"
            disabled={!selectedWinner || submitting}
            className="px-4 py-2 rounded-lg bg-accent text-dark font-medium disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Result'}
          </button>
        </div>
      </form>

      <div>
        <h2 className="font-semibold mb-4">Winners</h2>
        {results.length === 0 ? (
          <p className="text-gray-400">No results yet.</p>
        ) : (
          <div className="space-y-2">
            {results.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-lg border border-dark-border bg-dark-card p-3">
                <Link to={`/profile/${r.winner_profile_id}`} className="text-accent hover:underline">
                  {r.winner_username ?? 'Unknown'}
                </Link>
                {r.team_name && <span className="text-gray-400 text-sm">({r.team_name})</span>}
                <span className="text-xs text-gray-500">{new Date(r.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AdminsSection({
  tournamentId,
  admins,
  setAdmins,
  user,
  isOwner,
}: {
  tournamentId: string
  admins: (TournamentAdmin & { username?: string })[]
  setAdmins: React.Dispatch<React.SetStateAction<(TournamentAdmin & { username?: string })[]>>
  user: { id: string } | null
  isOwner: boolean
}) {
  const [adminSearch, setAdminSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ id: string; username: string }[]>([])

  useEffect(() => {
    if (!adminSearch.trim() || adminSearch.length < 2) {
      setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, username')
        .ilike('username', `%${adminSearch}%`)
        .limit(10)
      setSearchResults(data ?? [])
    }, 200)
    return () => clearTimeout(t)
  }, [adminSearch])

  async function addAdmin(profileId: string, username: string) {
    if (!isOwner) return
    const { data } = await supabase
      .from('tournament_admins')
      .insert({ tournament_id: tournamentId, user_id: profileId })
      .select()
      .single()
    if (data) setAdmins((prev) => [...prev, { ...data, username }])
    setAdminSearch('')
    setSearchResults([])
  }

  async function removeAdmin(adminId: string) {
    if (!isOwner) return
    await supabase.from('tournament_admins').delete().eq('id', adminId)
    setAdmins((prev) => prev.filter((a) => a.id !== adminId))
  }

  if (!isOwner) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-6">
        <h2 className="font-semibold mb-4">Admins</h2>
        {admins.length === 0 ? (
          <p className="text-gray-400">No admins.</p>
        ) : (
          <ul className="space-y-2">
            {admins.map((a) => (
              <li key={a.id}>
                <Link to={`/profile/${a.user_id}`} className="text-accent hover:underline">
                  {a.username ?? 'Unknown'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-6">
      <h2 className="font-semibold mb-4">Manage Admins</h2>
      <div className="mb-4">
        <label className="block text-sm text-gray-400 mb-1">Add admin (search by username)</label>
        <input
          type="text"
          value={adminSearch}
          onChange={(e) => setAdminSearch(e.target.value)}
          placeholder="Type username..."
          className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
        />
        {searchResults.length > 0 && (
          <ul className="mt-1 border border-dark-border rounded-lg overflow-hidden">
            {searchResults
              .filter((p) => !admins.some((a) => a.user_id === p.id))
              .map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => addAdmin(p.id, p.username)}
                    className="w-full px-4 py-2 text-left hover:bg-accent/10 text-accent flex items-center justify-between"
                  >
                    {p.username}
                    <span className="text-xs">Add</span>
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-2">Current admins</h3>
        {admins.length === 0 ? (
          <p className="text-gray-400">No admins yet.</p>
        ) : (
          <ul className="space-y-2">
            {admins.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <Link to={`/profile/${a.user_id}`} className="text-accent hover:underline">
                  {a.username ?? 'Unknown'}
                </Link>
                <button
                  onClick={() => removeAdmin(a.id)}
                  className="text-red-400 hover:text-red-300 text-sm"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
