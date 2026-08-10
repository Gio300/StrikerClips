import { useDeferredValue, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatTag } from '@/lib/identity'
import type { Server } from '@/types/database'

export function Boards() {
  const [servers, setServers] = useState<Server[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search.trim())

  useEffect(() => {
    let alive = true
    async function fetch() {
      setError('')
      let query = supabase
        .from('servers')
        .select('*')
        .eq('kind', 'clan')
        .order('name')
        .limit(50)
      if (deferredSearch) query = query.ilike('name', `%${deferredSearch}%`)
      const { data, error: loadError } = await query
      if (!alive) return
      setServers((data ?? []) as Server[])
      setError(loadError?.message || '')
      setLoading(false)
    }
    void fetch()
    return () => { alive = false }
  }, [deferredSearch])

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading boards...</div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Clans</h1>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Link
            to="/clans/discover"
            className="flex-1 rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-center text-sm font-semibold text-accent transition-all hover:border-accent/50 sm:flex-none sm:px-4"
          >
            Find a clan
          </Link>
          <Link
            to="/boards/create"
            className="flex-1 rounded-lg bg-accent px-3 py-2 text-center text-sm font-semibold text-dark transition-all hover:shadow-glow sm:flex-none sm:px-4"
          >
            Create a clan
          </Link>
        </div>
      </div>
      <label className="relative mb-6 block max-w-xl">
        <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
        <span className="sr-only">Search clans</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search clans by name"
          className="w-full rounded-lg border border-dark-border bg-dark py-2.5 pl-10 pr-3 text-sm text-white placeholder-gray-500 outline-none focus:border-accent"
        />
      </label>
      {error && (
        <p role="alert" className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Clans could not be loaded. Try again in a moment.
        </p>
      )}
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
              <h2 className="font-semibold">
                {server.clan_tag && (
                  <span className="text-accent mr-1">{formatTag(server.clan_tag)}</span>
                )}
                {server.name}
              </h2>
            </div>
          </Link>
        ))}
      </div>
      {!error && servers.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <p>{deferredSearch ? `No clans match “${deferredSearch}”.` : 'No clans have been created yet.'}</p>
        </div>
      )}
      {servers.length === 50 && (
        <p className="mt-6 text-center text-xs text-gray-500">Showing the first 50 clans. Search by name to narrow the list.</p>
      )}
    </div>
  )
}
