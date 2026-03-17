import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

type Tournament = {
  id: string
  name: string
  description: string | null
  status?: string
  created_at: string
  created_by: string | null
}

export function Tournaments() {
  const { user } = useAuth()
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('tournaments')
        .select('id, name, description, status, created_at, created_by')
        .order('created_at', { ascending: false })
      setTournaments(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !createName.trim() || creating) return
    setCreating(true)
    const { data } = await supabase
      .from('tournaments')
      .insert({
        name: createName.trim(),
        description: createDesc.trim() || null,
        created_by: user.id,
      })
      .select()
      .single()
    setCreating(false)
    if (data) {
      setTournaments((prev) => [data, ...prev])
      setShowCreate(false)
      setCreateName('')
      setCreateDesc('')
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-2">Tournaments</h1>
      <p className="text-gray-400 mb-6">
        Browse tournaments. Stat check and submit results inside each tournament.
      </p>

      {user && (
        <div className="mb-6">
          {!showCreate ? (
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 rounded-lg bg-accent text-dark font-medium hover:bg-accent/90"
            >
              Create Tournament
            </button>
          ) : (
            <form onSubmit={handleCreate} className="rounded-xl border border-dark-border bg-dark-card p-6">
              <h2 className="font-semibold mb-4">Create Tournament</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Name</label>
                  <input
                    type="text"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                    placeholder="Tournament name"
                    className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
                  <textarea
                    value={createDesc}
                    onChange={(e) => setCreateDesc(e.target.value)}
                    placeholder="Describe the tournament..."
                    rows={3}
                    className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white resize-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={creating}
                    className="px-4 py-2 rounded-lg bg-accent text-dark font-medium disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreate(false)
                      setCreateName('')
                      setCreateDesc('')
                    }}
                    className="px-4 py-2 rounded-lg border border-dark-border text-gray-400"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse text-gray-400">Loading tournaments...</div>
      ) : tournaments.length === 0 ? (
        <div className="rounded-xl border border-dark-border bg-dark-card p-8 text-center">
          <p className="text-gray-400 mb-4">No tournaments yet.</p>
          {user && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-accent hover:underline"
            >
              Create one
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {tournaments.map((t) => (
            <Link
              key={t.id}
              to={`/tournaments/${t.id}`}
              className="block rounded-xl border border-dark-border bg-dark-card p-6 hover:border-accent/50 transition-colors"
            >
              <h2 className="font-semibold text-lg">{t.name}</h2>
              {t.description && (
                <p className="text-gray-400 text-sm mt-1 line-clamp-2">{t.description}</p>
              )}
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                {t.status && (
                  <span className={`px-2 py-0.5 rounded ${t.status === 'closed' ? 'bg-gray-500/20' : 'bg-green-500/20 text-green-400'}`}>
                    {t.status}
                  </span>
                )}
                <span>{new Date(t.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
