import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Server } from '@/types/database'

export function Boards() {
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetch() {
      const { data } = await supabase.from('servers').select('*').order('name')
      setServers(data ?? [])
      setLoading(false)
    }
    fetch()
  }, [])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading boards...</div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-bold">Community Boards</h1>
        <Link
          to="/boards/create"
          className="px-4 py-2 rounded-lg bg-accent text-dark font-semibold hover:shadow-glow transition-all"
        >
          Create Server
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {servers.map((server) => (
          <Link
            key={server.id}
            to={`/boards/${server.id}`}
            className="rounded-xl border border-dark-border bg-dark-card p-6 hover:border-accent/50 hover:shadow-glow transition-all flex items-center gap-4"
          >
            {server.icon_url ? (
              <img src={server.icon_url} alt="" className="w-12 h-12 rounded-xl" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center text-accent font-bold">
                {server.name[0]}
              </div>
            )}
            <div>
              <h2 className="font-semibold">{server.name}</h2>
            </div>
          </Link>
        ))}
      </div>
      {servers.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p>No community boards yet.</p>
        </div>
      )}
    </div>
  )
}
