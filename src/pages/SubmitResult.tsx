import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { AuthGuard } from '@/components/AuthGuard'
import { AdSlot } from '@/components/AdSlot'

type MatchType = 'survival' | 'quick_match' | 'red_white' | 'ninja_world_league' | 'tournament'

async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function SubmitResult() {
  const { user } = useAuth()
  const [matchType, setMatchType] = useState<MatchType>('survival')
  const [screenshotUrl, setScreenshotUrl] = useState('')
  const [screenshotHash, setScreenshotHash] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [winnerId, setWinnerId] = useState('')
  const [loserIds, setLoserIds] = useState<string[]>([])
  const [profiles, setProfiles] = useState<{ id: string; username: string }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    supabase.from('profiles').select('id, username').order('username').then(({ data }) => setProfiles(data ?? []))
  }, [])

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    if (!file.type.startsWith('image/')) {
      setMessage({ type: 'error', text: 'Please select an image file (PNG, JPEG, or WebP)' })
      return
    }
    setUploading(true)
    setMessage(null)
    try {
      const path = `${user.id}/${crypto.randomUUID()}_${file.name}`
      const { error: uploadErr } = await supabase.storage.from('match-screenshots').upload(path, file, {
        contentType: file.type,
        upsert: false,
      })
      if (uploadErr) throw uploadErr
      const { data: urlData } = supabase.storage.from('match-screenshots').getPublicUrl(path)
      const hash = await sha256Hex(file)
      setScreenshotUrl(urlData.publicUrl)
      setScreenshotHash(hash)
      setSelectedFile(file)
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message })
    } finally {
      setUploading(false)
    }
  }

  function clearScreenshot() {
    setScreenshotUrl('')
    setScreenshotHash(null)
    setSelectedFile(null)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!user || !winnerId || submitting) return
    setSubmitting(true)
    setMessage(null)
    try {
      const { data: result, error: insertError } = await supabase
        .from('match_results')
        .insert({
          uploader_id: user.id,
          screenshot_url: screenshotUrl || null,
          screenshot_hash: screenshotHash || null,
          match_type: matchType,
          status: 'verified',
          verified_at: new Date().toISOString(),
          verified_by: user.id,
        })
        .select()
        .single()
      if (insertError) {
        if (insertError.code === '23505') {
          throw new Error('This screenshot was already submitted.')
        }
        throw insertError
      }
      if (!result) throw new Error('Failed to create result')
      await supabase.from('match_result_players').insert([
        { result_id: result.id, profile_id: winnerId, role: 'winner' },
        ...loserIds.map((id) => ({ result_id: result.id, profile_id: id, role: 'loser' })),
      ])
      setWinnerId('')
      setLoserIds([])
      setScreenshotUrl('')
      setScreenshotHash(null)
      setSelectedFile(null)
      setMessage({ type: 'success', text: 'Match result submitted!' })
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message })
    }
    setSubmitting(false)
  }

  return (
    <AuthGuard>
      <div className="p-8 max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Submit Match Result</h1>
        <p className="text-gray-400 mb-6">Upload a screenshot and tag winner/losers to update power ratings.</p>

        <AdSlot slotId="screenshots-submit-below" className="mb-6" />

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Match type</label>
            <select
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as MatchType)}
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
            >
              <option value="survival">Survival</option>
              <option value="quick_match">Quick Match</option>
              <option value="red_white">Red vs White</option>
              <option value="ninja_world_league">Ninja World League</option>
              <option value="tournament">Tournament</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Screenshot (optional)</label>
            <div className="space-y-2">
              <div className="flex gap-2">
                <label className="flex-1 cursor-pointer">
                  <span className="inline-block px-4 py-2 rounded-lg bg-dark-border/30 text-gray-400 hover:text-white hover:bg-dark-border/50 transition text-sm">
                    {uploading ? 'Uploading...' : 'Upload image'}
                  </span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/*"
                    onChange={handleFileSelect}
                    className="hidden"
                    disabled={uploading}
                  />
                </label>
                <input
                  type="url"
                  value={screenshotUrl}
                  onChange={(e) => {
                    setScreenshotUrl(e.target.value)
                    setScreenshotHash(null)
                    setSelectedFile(null)
                  }}
                  placeholder="Or paste URL..."
                  className="flex-1 px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
                />
              </div>
              {screenshotUrl && (
                <div className="flex items-center gap-2">
                  <img
                    src={screenshotUrl}
                    alt="Screenshot preview"
                    className="h-20 w-auto rounded border border-dark-border object-contain"
                  />
                  <button
                    type="button"
                    onClick={clearScreenshot}
                    className="text-sm text-gray-500 hover:text-red-400"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Winner *</label>
            <select
              value={winnerId}
              onChange={(e) => setWinnerId(e.target.value)}
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white"
              required
            >
              <option value="">Select winner</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.username}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Loser(s)</label>
            <select
              multiple
              value={loserIds}
              onChange={(e) => setLoserIds(Array.from(e.target.selectedOptions, (o) => o.value))}
              className="w-full px-4 py-2 rounded-lg bg-dark border border-dark-border text-white min-h-[80px]"
            >
              {profiles.filter((p) => p.id !== winnerId).map((p) => (
                <option key={p.id} value={p.id}>{p.username}</option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">Hold Ctrl/Cmd to select multiple</p>
          </div>
          {message && (
            <p className={message.type === 'success' ? 'text-green-400' : 'text-red-400'}>{message.text}</p>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 rounded-lg bg-accent text-dark font-medium disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit'}
          </button>
        </form>

        <div className="mt-8">
          <Link to="/rankings" className="text-accent hover:underline">View Rankings →</Link>
        </div>
      </div>
    </AuthGuard>
  )
}
