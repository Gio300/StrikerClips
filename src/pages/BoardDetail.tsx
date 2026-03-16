import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import type { Server, Channel, Message } from '@/types/database'

export function BoardDetail() {
  const { serverId, channelId } = useParams()
  const { user } = useAuth()
  const [server, setServer] = useState<Server | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [messages, setMessages] = useState<(Message & { profiles?: { username: string } })[]>([])
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!serverId) return
    async function fetch() {
      const { data: serverData } = await supabase.from('servers').select('*').eq('id', serverId).single()
      setServer(serverData)
      const { data: channelsData } = await supabase
        .from('channels')
        .select('*')
        .eq('server_id', serverId)
        .order('name')
      setChannels(channelsData ?? [])
      const first = (channelsData ?? [])[0]
      setActiveChannel(channelId ? (channelsData ?? []).find((c) => c.id === channelId) ?? first : first)
      setLoading(false)
    }
    fetch()
  }, [serverId, channelId])

  useEffect(() => {
    if (!activeChannel) return
    async function fetchMessages() {
      const { data } = await supabase
        .from('messages')
        .select('*, profiles(username, power_level)')
        .eq('channel_id', activeChannel.id)
        .order('created_at', { ascending: true })
      setMessages(data ?? [])
    }
    fetchMessages()

    const sub = supabase
      .channel(`messages:${activeChannel.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `channel_id=eq.${activeChannel.id}` }, fetchMessages)
      .subscribe()

    return () => {
      sub.unsubscribe()
    }
  }, [activeChannel?.id])

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !activeChannel || !newMessage.trim()) return
    await supabase.from('messages').insert({
      channel_id: activeChannel.id,
      user_id: user.id,
      content: newMessage.trim(),
    })
    setNewMessage('')
  }

  if (loading || !server) {
    return (
      <div className="p-8 flex items-center justify-center">
        <div className="animate-pulse text-accent">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-0px)]">
      <div className="w-56 border-r border-dark-border bg-dark-card flex flex-col">
        <div className="p-4 border-b border-dark-border">
          <h1 className="font-semibold truncate">{server.name}</h1>
        </div>
        <nav className="flex-1 p-2 overflow-auto">
          {channels.map((ch) => (
            <button
              key={ch.id}
              onClick={() => setActiveChannel(ch)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                activeChannel?.id === ch.id ? 'bg-accent/10 text-accent' : 'text-gray-400 hover:text-white hover:bg-dark-border/50'
              }`}
            >
              # {ch.name}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex-1 flex flex-col">
        {activeChannel ? (
          <>
            <div className="p-4 border-b border-dark-border">
              <h2 className="font-medium"># {activeChannel.name}</h2>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {messages.map((msg) => (
                <div key={msg.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <span className="text-accent text-sm font-medium">
                      {(msg.profiles as { username?: string })?.username?.[0] ?? '?'}
                    </span>
                  </div>
                  <div>
                    <span className="text-accent text-sm font-medium">
                      {(msg.profiles as { username?: string })?.username ?? 'Unknown'}
                      {(msg.profiles as { power_level?: number })?.power_level != null && (msg.profiles as { power_level?: number }).power_level! > 0 && (
                        <span className="text-gray-500 font-normal ml-1">· PL {(msg.profiles as { power_level?: number }).power_level}</span>
                      )}
                    </span>
                    <span className="text-gray-500 text-sm ml-2">
                      {new Date(msg.created_at).toLocaleTimeString()}
                    </span>
                    <p className="text-gray-300 mt-0.5">{msg.content}</p>
                  </div>
                </div>
              ))}
            </div>
            {user && (
              <form onSubmit={sendMessage} className="p-4 border-t border-dark-border">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Message # general"
                  className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white placeholder-gray-500 focus:outline-none focus:border-accent"
                />
              </form>
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a channel
          </div>
        )}
      </div>
    </div>
  )
}
