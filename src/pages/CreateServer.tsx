import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export function CreateServer() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) {
      setError('Enter a name')
      return
    }
    setLoading(true)
    const { data: server, error: serverErr } = await supabase
      .from('servers')
      .insert({ name: name.trim() })
      .select('id')
      .single()
    if (serverErr) {
      setError(serverErr.message)
      setLoading(false)
      return
    }
    await supabase.from('channels').insert({ server_id: server.id, name: 'general', type: 'text' })
    navigate(`/boards/${server.id}`)
    setLoading(false)
  }

  return (
    <div className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-6">Create Server</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Server name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white focus:outline-none focus:border-accent"
            placeholder="My Community"
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create'}
        </button>
      </form>
    </div>
  )
}
