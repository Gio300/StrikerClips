import { useEffect, useState } from 'react'
import { Check, LoaderCircle, ShieldCheck } from 'lucide-react'
import {
  DEFAULT_REEL_USE_PRIVACY,
  REEL_USE_PRIVACY_OPTIONS,
  type ReelUsePrivacy,
} from '@/lib/reelPrivacy'
import { loadReelUsePrivacy, saveReelUsePrivacy } from '@/lib/reelPrivacyApi'

export function ReelPrivacySettings() {
  const [value, setValue] = useState<ReelUsePrivacy>(DEFAULT_REEL_USE_PRIVACY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<ReelUsePrivacy | null>(null)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void loadReelUsePrivacy()
      .then((current) => { if (active) setValue(current) })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load privacy.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  async function choose(next: ReelUsePrivacy) {
    if (loading || saving || next === value) return
    const previous = value
    setValue(next)
    setSaving(next)
    setSaved(false)
    setError('')
    try {
      setValue(await saveReelUsePrivacy(next))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2200)
    } catch (reason) {
      setValue(previous)
      setError(reason instanceof Error ? reason.message : 'Could not save privacy.')
    } finally {
      setSaving(null)
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-6 flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <ShieldCheck size={22} aria-hidden />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-white">Privacy</h1>
          <p className="mt-1 text-sm text-gray-400">Choose who can use your reels and footage inside TKO.</p>
        </div>
      </header>

      <fieldset disabled={loading || saving != null} className="overflow-hidden rounded-xl border border-dark-border bg-dark-card">
        <legend className="sr-only">Who can use my reels?</legend>
        <div className="border-b border-dark-border px-4 py-4">
          <h2 className="font-semibold text-white">Who can use my reels?</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">
            Followers of followers is the default. Your choice applies to multi-angle reels, tournament media, and live-show angles.
          </p>
        </div>

        <div className="divide-y divide-dark-border">
          {REEL_USE_PRIVACY_OPTIONS.map((option) => {
            const selected = value === option.value
            const pending = saving === option.value
            return (
              <label
                key={option.value}
                className={`flex min-h-[4.25rem] cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
                  selected ? 'bg-accent/10' : 'hover:bg-dark-elevated'
                } ${loading || saving ? 'cursor-wait opacity-70' : ''}`}
              >
                <input
                  type="radio"
                  name="reel-use-privacy"
                  value={option.value}
                  checked={selected}
                  onChange={() => void choose(option.value)}
                  className="sr-only"
                />
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                  selected ? 'border-accent bg-accent text-dark' : 'border-gray-600 text-transparent'
                }`}>
                  {pending ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-white">
                    {option.label}
                    {option.value === DEFAULT_REEL_USE_PRIVACY && (
                      <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-accent">Default</span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs leading-5 text-gray-500">{option.description}</span>
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {loading && <p className="mt-3 text-sm text-gray-500">Loading your privacy choice…</p>}
      {saved && <p className="mt-3 flex items-center gap-1.5 text-sm text-leaf"><Check size={15} /> Saved</p>}
      {error && <p className="mt-3 text-sm text-kunai">{error}</p>}

      <p className="mt-6 text-xs leading-5 text-gray-500">
        This controls reuse inside TKO. It does not change a video’s visibility on YouTube; use YouTube Studio for that.
      </p>
    </main>
  )
}
