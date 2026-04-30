import { useEffect, useState } from 'react'
import {
  getByokKey,
  setByokKey,
  clearByok,
  getTTS,
  type TTSVoice,
  type BYOKProvider,
} from '@/lib/localAi'

/**
 * AI settings panel — bring-your-own-key for cloud TTS / LLM, plus voice
 * preview. Lives on the /ai page.
 *
 * Storage is `localStorage` only. Keys never leave the user's browser
 * unless they actively use that provider.
 */
export function AISettings() {
  const [elevenlabsKey, setElevenlabsKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [voices, setVoices] = useState<TTSVoice[]>([])
  const [voice, setVoice] = useState<string>('')
  const [previewText, setPreviewText] = useState('Squad locked in. Game on.')
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    setElevenlabsKey(getByokKey('elevenlabs'))
    setOpenaiKey(getByokKey('openai'))
  }, [])

  // Web Speech voices populate async — list event fires when they arrive.
  useEffect(() => {
    let cancelled = false
    function load() {
      getTTS().voices().then((v) => {
        if (cancelled) return
        setVoices(v)
        if (!voice && v[0]) setVoice(v[0].id)
      })
    }
    load()
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = load
    }
    return () => {
      cancelled = true
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null
      }
    }
  }, [voice])

  function saveByok(provider: BYOKProvider, val: string) {
    setByokKey(provider, val.trim())
  }

  async function previewVoice() {
    setPreviewing(true)
    try {
      const tts = getTTS()
      if (tts.speak) await tts.speak({ text: previewText, voice })
      else await tts.synthesize({ text: previewText, voice })
    } finally {
      setPreviewing(false)
    }
  }

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-5 space-y-6">
      <div>
        <h2 className="font-semibold text-lg mb-1">AI settings</h2>
        <p className="text-sm text-gray-400">
          Bring your own keys to unlock premium voices and bigger LLM commentary. Keys live in
          your browser only — they never hit our servers. Free defaults work without any of this.
        </p>
      </div>

      {/* TTS section */}
      <div className="border-t border-dark-border pt-4">
        <h3 className="font-medium mb-1">Voice (TTS)</h3>
        <p className="text-xs text-gray-500 mb-3">
          The web build uses your device's built-in voice. The desktop install will ship with
          Piper for fully-local, free-to-commercial voices. Add an ElevenLabs free key here for
          better voices when the desktop app's online.
        </p>

        {voices.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
            <label className="block">
              <span className="text-xs text-gray-400">Active voice</span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
              >
                {voices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} — {v.language}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-gray-400">Preview text</span>
              <input
                type="text"
                value={previewText}
                onChange={(e) => setPreviewText(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm"
                placeholder="Squad locked in. Game on."
              />
            </label>
          </div>
        ) : (
          <p className="text-xs text-gray-500 mb-4">No TTS voices detected in this browser.</p>
        )}

        <button
          type="button"
          onClick={previewVoice}
          disabled={previewing || voices.length === 0}
          className="px-4 py-1.5 rounded bg-accent text-dark text-sm font-semibold disabled:opacity-40"
        >
          {previewing ? 'Speaking…' : 'Preview voice'}
        </button>
      </div>

      {/* ElevenLabs */}
      <KeyField
        provider="elevenlabs"
        label="ElevenLabs API key"
        helper="Free tier ~10,000 chars/mo, non-commercial use. Watermarked. The desktop app uses Piper by default; this is an opt-in upgrade for browser playback."
        link="https://elevenlabs.io/app/speech-synthesis"
        placeholder="sk_..."
        value={elevenlabsKey}
        onChange={setElevenlabsKey}
        onSave={(v) => saveByok('elevenlabs', v)}
        onClear={() => { clearByok('elevenlabs'); setElevenlabsKey('') }}
      />

      {/* OpenAI */}
      <KeyField
        provider="openai"
        label="OpenAI API key"
        helper="Optional — the desktop installer ships Llama 3.2 1B locally for free. This unlocks bigger / smarter commentary on the web app at your own cost."
        link="https://platform.openai.com/api-keys"
        placeholder="sk-..."
        value={openaiKey}
        onChange={setOpenaiKey}
        onSave={(v) => saveByok('openai', v)}
        onClear={() => { clearByok('openai'); setOpenaiKey('') }}
      />

      <p className="text-[11px] text-gray-500 leading-relaxed border-t border-dark-border pt-3">
        Reminder: ReelOne never reads or transmits these keys. They live in this browser's
        localStorage. Clear your browser data to wipe them, or use the "Forget" button on each.
      </p>
    </div>
  )
}

function KeyField({
  provider,
  label,
  helper,
  link,
  placeholder,
  value,
  onChange,
  onSave,
  onClear,
}: {
  provider: BYOKProvider
  label: string
  helper: string
  link: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onSave: (v: string) => void
  onClear: () => void
}) {
  const [show, setShow] = useState(false)
  const [saved, setSaved] = useState(false)

  return (
    <div className="border-t border-dark-border pt-4">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <label htmlFor={`byok-${provider}`} className="font-medium">
          {label}
        </label>
        <a
          href={link}
          target="_blank"
          rel="noopener"
          className="text-xs text-accent hover:underline"
        >
          Get a key →
        </a>
      </div>
      <p className="text-xs text-gray-500 mb-3">{helper}</p>
      <div className="flex flex-wrap gap-2">
        <input
          id={`byok-${provider}`}
          type={show ? 'text' : 'password'}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => { onChange(e.target.value); setSaved(false) }}
          placeholder={placeholder}
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-dark border border-dark-border text-white text-sm font-mono"
        />
        <button
          type="button"
          onClick={() => setShow((v) => !v)}
          className="px-3 py-2 rounded border border-dark-border text-gray-300 text-sm hover:border-accent/50"
        >
          {show ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          onClick={() => { onSave(value); setSaved(true); window.setTimeout(() => setSaved(false), 1500) }}
          className="px-3 py-2 rounded bg-accent text-dark text-sm font-semibold"
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>
        {value && (
          <button
            type="button"
            onClick={onClear}
            className="px-3 py-2 rounded border border-kunai/40 text-kunai text-sm hover:bg-kunai/10"
          >
            Forget
          </button>
        )}
      </div>
    </div>
  )
}
