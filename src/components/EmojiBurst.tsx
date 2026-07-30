import { useEffect, useRef, useState } from 'react'
import { playUnlockBlip } from '@/lib/unlockSound'

/**
 * EmojiBurst — when a chat line is just emoji, we don't render plain text; we
 * render this: a brief particle "explode" that flings a few copies of the emoji
 * outward, then settles into the resting emoji sitting in the chat line. A short
 * WebAudio "unlock" blip fires as it lands.
 *
 * Pure frontend, zero deps: inline <style> @keyframes (injected once) + the tiny
 * WebAudio helper in lib/unlockSound.ts. Concurrent bursts are capped so a flood
 * of emoji never turns into a fireworks storm — over the cap, the emoji simply
 * appears at rest with no burst or sound.
 */

const MAX_CONCURRENT = 6
let activeBursts = 0

// Inject the keyframes exactly once for the whole app.
const STYLE_ID = 'tko-emoji-burst-style'
function ensureStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
@keyframes tko-burst-settle {
  0%   { transform: scale(0.2) rotate(-12deg); opacity: 0; }
  45%  { transform: scale(1.35) rotate(6deg); opacity: 1; }
  70%  { transform: scale(0.92) rotate(-3deg); }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}
@keyframes tko-burst-particle {
  0%   { transform: translate(0,0) scale(0.9); opacity: 0.95; }
  100% { transform: translate(var(--tko-dx), var(--tko-dy)) scale(0.35); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .tko-burst-main { animation: none !important; }
  .tko-burst-particle { display: none !important; }
}
`
  document.head.appendChild(el)
}

// Six particles flung around a circle.
const PARTICLES = Array.from({ length: 6 }, (_, i) => {
  const angle = (i / 6) * Math.PI * 2
  const dist = 22 + (i % 2) * 8
  return { dx: `${Math.cos(angle) * dist}px`, dy: `${Math.sin(angle) * dist}px`, delay: i * 12 }
})

export function EmojiBurst({ emoji }: { emoji: string }) {
  // Whether THIS instance won a burst slot (vs. over the cap -> render at rest).
  const [bursting, setBursting] = useState(false)
  const held = useRef(false)

  useEffect(() => {
    ensureStyle()
    if (activeBursts >= MAX_CONCURRENT) return
    activeBursts += 1
    held.current = true
    setBursting(true)
    // Blip as it lands (after the fling, into the settle).
    const soundTimer = window.setTimeout(() => playUnlockBlip(), 260)
    const doneTimer = window.setTimeout(() => {
      if (held.current) { activeBursts = Math.max(0, activeBursts - 1); held.current = false }
      setBursting(false)
    }, 900)
    return () => {
      window.clearTimeout(soundTimer)
      window.clearTimeout(doneTimer)
      if (held.current) { activeBursts = Math.max(0, activeBursts - 1); held.current = false }
    }
    // Burst once on mount — the message identity never changes for a row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <span className="relative inline-flex items-center justify-center align-middle" style={{ width: '1.6em', height: '1.6em' }} aria-label={emoji}>
      {bursting &&
        PARTICLES.map((p, i) => (
          <span
            key={i}
            aria-hidden
            className="tko-burst-particle pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-base leading-none"
            style={{
              animation: `tko-burst-particle 700ms cubic-bezier(0.22,1,0.36,1) ${p.delay}ms both`,
              ...({ '--tko-dx': p.dx, '--tko-dy': p.dy } as React.CSSProperties),
            }}
          >
            {emoji}
          </span>
        ))}
      <span
        className={bursting ? 'tko-burst-main text-xl leading-none' : 'text-xl leading-none'}
        style={bursting ? { animation: 'tko-burst-settle 620ms cubic-bezier(0.22,1,0.36,1) both' } : undefined}
      >
        {emoji}
      </span>
    </span>
  )
}

export default EmojiBurst
