import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AdSlot } from '@/components/AdSlot'

type Submission = {
  id: string
  user_id: string
  video_url: string
  character_name: string | null
  description: string | null
  status: string
  created_at: string
  profiles?: { username: string }
}

export function StatCheck() {
  const { user } = useAuth()
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [videoUrl, setVideoUrl] = useState('')
  const [characterName, setCharacterName] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      // #region agent log
      const { data, error } = await supabase
        .from('stat_check_submissions')
        .select('*, profiles(username)')
        .order('created_at', { ascending: false })
      if (error) {
        fetch('http://127.0.0.1:7308/ingest/8d921e9d-92c7-4815-8e32-88bd8715ba82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8792d5'},body:JSON.stringify({sessionId:'8792d5',location:'StatCheck.tsx:fetch',message:'stat_check_submissions select error',data:{table:'stat_check_submissions',op:'select',code:error.code,message:error.message},timestamp:Date.now(),hypothesisId:'A'})}).catch(()=>{});
      }
      // #endregion
      setSubmissions(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !videoUrl.trim() || submitting) return
    setSubmitting(true)
    const { error: insertErr } = await supabase.from('stat_check_submissions').insert({
      user_id: user.id,
      video_url: videoUrl.trim(),
      character_name: characterName.trim() || null,
      description: description.trim() || null,
    })
    // #region agent log
    if (insertErr) {
      fetch('http://127.0.0.1:7308/ingest/8d921e9d-92c7-4815-8e32-88bd8715ba82',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'8792d5'},body:JSON.stringify({sessionId:'8792d5',location:'StatCheck.tsx:handleSubmit',message:'stat_check_submissions insert error',data:{table:'stat_check_submissions',op:'insert',code:insertErr.code,message:insertErr.message},timestamp:Date.now(),hypothesisId:'B'})}).catch(()=>{});
    }
    // #endregion
    setVideoUrl('')
    setCharacterName('')
    setDescription('')
    const { data } = await supabase
      .from('stat_check_submissions')
      .select('*, profiles(username)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (data) setSubmissions((prev) => [data, ...prev])
    setSubmitting(false)
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Stat Check</h1>
      <p className="text-gray-400 mb-6">
        Submit videos showing character buffs. The community can verify if someone is stacking buffs (cheating).
      </p>

      <AdSlot slotId="stat-check-hero-below" className="mb-6" />

      {user && (
        <form onSubmit={handleSubmit} className="rounded-xl border border-dark-border bg-dark-card p-6 mb-8">
          <h2 className="font-semibold mb-4">Submit a Stat Check</h2>
          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">Video URL (YouTube or Supabase storage)</label>
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

      <h2 className="font-semibold mb-4">Submissions</h2>
      {loading ? (
        <div className="animate-pulse text-gray-400">Loading...</div>
      ) : submissions.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-12 text-center text-gray-400">
          No submissions yet.
        </div>
      ) : (
        <div className="space-y-4">
          {submissions.map((s, i) => (
            <div key={s.id}>
              {i > 0 && i % 5 === 0 && <AdSlot slotId="stat-check-between" className="my-6" />}
              <div className="rounded-lg border border-dark-border bg-dark-card p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-accent font-medium">{(s.profiles as { username?: string })?.username ?? 'Unknown'}</span>
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
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
