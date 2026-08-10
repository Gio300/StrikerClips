import { useEffect, useState } from 'react'
import { loadAutoLinkMode, saveAutoLinkMode, cachedAutoLinkMode } from '@/lib/liveLinkPrefs'
import { AUTO_LINK_MODES, AUTO_LINK_MODE_COPY, type AutoLinkMode } from '@/lib/liveLink'
import {
  cachedAutoDetectLive,
  loadAutoDetectLive,
  saveAutoDetectLive,
} from '@/lib/autoLivePrefs'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'

/**
 * Live-link settings — "when someone I'm matched with is live too".
 *
 * Auto is the default and stays the default: the whole point of the feature is
 * that people don't have to arrange anything. But it is a preference, and this
 * is where it's changed, in the same words the notification uses.
 *
 * The engine checks BOTH people's setting and takes the stricter one, which is
 * spelled out below so nobody is surprised when a link doesn't form.
 */
export function LiveLinkSettings({ userId }: { userId: string }) {
  const { league } = useLeagueTheme()
  const brandName = league?.name || 'TKO'
  const [mode, setMode] = useState<AutoLinkMode>(() => cachedAutoLinkMode(userId))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [autoDetect, setAutoDetect] = useState(() => cachedAutoDetectLive(userId))
  const [savingDetection, setSavingDetection] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadAutoLinkMode(userId).then((m) => {
      if (!cancelled) setMode(m)
    })
    loadAutoDetectLive(userId).then((enabled) => {
      if (!cancelled) setAutoDetect(enabled)
    })
    return () => {
      cancelled = true
    }
  }, [userId])

  async function pick(next: AutoLinkMode) {
    if (next === mode || saving) return
    const prev = mode
    setMode(next)
    setSaving(true)
    setSaved(false)
    const ok = await saveAutoLinkMode(userId, next)
    setSaving(false)
    if (ok) {
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } else {
      setMode(prev)
    }
  }

  async function toggleDetection() {
    if (savingDetection) return
    const previous = autoDetect
    const next = !previous
    setAutoDetect(next)
    setSavingDetection(true)
    const ok = await saveAutoDetectLive(userId, next)
    setSavingDetection(false)
    if (!ok) setAutoDetect(previous)
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4">
      <div className="flex items-start justify-between gap-4 border-b border-dark-border pb-4 mb-4">
        <div>
          <h3 className="font-semibold text-white">Automatically show me when I go live</h3>
          <p className="text-sm text-gray-400 mt-1">
            {brandName} watches your connected YouTube channel and adds an eligible broadcast to Live.
            This is on by default, so you do not need to open {brandName} first.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoDetect}
          aria-label="Automatically detect my live streams"
          disabled={savingDetection}
          onClick={toggleDetection}
          className={`relative mt-1 h-7 w-12 shrink-0 rounded-full border transition-colors ${
            autoDetect ? 'border-accent bg-accent' : 'border-dark-border bg-black/40'
          } disabled:opacity-50`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
              autoDetect ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">When someone you're matched with is live too</h3>
          <p className="text-sm text-gray-400 mt-1">
            If you and an opponent, clanmate or fellow entrant are live at the same time, {brandName} can
            put your streams on one screen so viewers see every angle.
          </p>
        </div>
        {saved && <span className="text-xs text-leaf shrink-0 mt-1">Saved</span>}
      </div>

      <div className="mt-4 space-y-2">
        {AUTO_LINK_MODES.map((m) => {
          const copy = AUTO_LINK_MODE_COPY[m]
          const active = mode === m
          return (
            <label
              key={m}
              className={`flex gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                active ? 'border-accent bg-accent/5' : 'border-dark-border hover:border-accent/40'
              }`}
            >
              <input
                type="radio"
                name="auto-link-mode"
                checked={active}
                disabled={saving}
                onChange={() => pick(m)}
                className="accent-accent mt-1 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-white">
                  {copy.label}
                  {m === 'auto' && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-gray-500">
                      Default
                    </span>
                  )}
                </span>
                <span className="block text-xs text-gray-400 mt-0.5">{copy.help}</span>
              </span>
            </label>
          )
        })}
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Both people have to be happy with it — if either of you has chosen "ask me first" or
        "never", that's what happens. You can always join a shared stage by hand, and you can pull
        your stream out of one from the notification.
      </p>
    </div>
  )
}
