import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Reel } from '@/types/database'

export function CreateMatch() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [reels, setReels] = useState<Reel[]>([])
  const [selectedReelIds, setSelectedReelIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from('reels').select('*').order('created_at', { ascending: false })
      setReels(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [])

  function toggleReel(id: string) {
    setSelectedReelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Enter a name')
      return
    }
    setSaving(true)
    const { data, error: err } = await supabase
      .from('matches')
      .insert({ name: name.trim(), description: description.trim() || null, reel_ids: selectedReelIds })
      .select('id')
      .single()
    setSaving(false)
    if (err) {
      setError(err.message)
      return
    }
    navigate(`/matches/${data.id}`)
  }

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Match</h1>
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            placeholder="Weekend Finals"
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent resize-none"
            placeholder="Optional description"
            rows={3}
          />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-2">Select reels</label>
          {loading ? (
            <p className="text-gray-400">Loading reels...</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-auto">
              {reels.map((reel) => (
                <label key={reel.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-dark-border/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedReelIds.includes(reel.id)}
                    onChange={() => toggleReel(reel.id)}
                    className="rounded border-dark-border"
                  />
                  <span className="truncate">{reel.title}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={saving}
          className="w-full py-3 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {saving ? 'Creating...' : 'Create Match'}
        </button>
      </form>
    </div>
  )
}
