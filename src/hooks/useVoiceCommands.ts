import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Thin wrapper over the browser SpeechRecognition API (Web Speech). On-device,
 * no backend. Falls back gracefully where unsupported (older browsers / some
 * in-app webviews) — `supported` is false and callers show a type box instead.
 */

type RecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort?: () => void
  onresult: ((e: SpeechRecognitionResultEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionResultEventLike = {
  resultIndex: number
  results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>
}

function getCtor(): (new () => RecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

export function useVoiceCommands(onFinal: (transcript: string) => void) {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const recRef = useRef<RecognitionLike | null>(null)
  const onFinalRef = useRef(onFinal)
  onFinalRef.current = onFinal
  const supported = typeof window !== 'undefined' && !!getCtor()

  const stop = useCallback(() => {
    try { recRef.current?.stop() } catch { /* noop */ }
    setListening(false)
  }, [])

  const start = useCallback(() => {
    const Ctor = getCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = 'en-US'
    rec.continuous = false
    rec.interimResults = true
    rec.onresult = (e) => {
      let finalText = ''
      let interimText = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        const text = r[0]?.transcript ?? ''
        if (r.isFinal) finalText += text
        else interimText += text
      }
      setInterim(interimText)
      if (finalText) {
        setInterim('')
        onFinalRef.current(finalText.trim())
      }
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recRef.current = rec
    setInterim('')
    setListening(true)
    try { rec.start() } catch { setListening(false) }
  }, [])

  useEffect(() => () => { try { recRef.current?.abort?.() } catch { /* noop */ } }, [])

  return { supported, listening, interim, start, stop }
}

/** Speak a short confirmation (accessibility feedback). No-op if unsupported. */
export function speak(text: string) {
  try {
    if (typeof window === 'undefined' || !window.speechSynthesis) return
    const u = new SpeechSynthesisUtterance(text)
    u.rate = 1.05
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(u)
  } catch { /* noop */ }
}
