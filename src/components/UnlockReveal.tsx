import { useEffect, useState } from 'react'

/**
 * UnlockReveal — the "you opened a power box" moment.
 *
 * A full-screen reward reveal: a crate shakes with building anticipation, then
 * bursts into a shining flare and presents what the player unlocked. Used for
 * every redeem (codes, artifacts) and for connecting YouTube, so unlocking
 * anything in TKO feels like a video-game drop.
 *
 * Usage: render when `open` is true; call `onClose` when the user taps to
 * dismiss. Purely in-memory + CSS — no libraries, no storage.
 */
export default function UnlockReveal({
  open,
  title,
  subtitle,
  emoji = '🎁',
  accent = '#00e5ff',
  onClose,
}: {
  open: boolean
  title: string
  subtitle?: string
  emoji?: string
  accent?: string
  onClose?: () => void
}) {
  // phase: 'shake' (crate rattling) -> 'burst' (flare) -> 'reveal' (prize)
  const [phase, setPhase] = useState<'shake' | 'burst' | 'reveal'>('shake')

  useEffect(() => {
    if (!open) return
    setPhase('shake')
    const t1 = setTimeout(() => setPhase('burst'), 1300)
    const t2 = setTimeout(() => setPhase('reveal'), 1750)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [open])

  if (!open) return null

  return (
    <div
      onClick={phase === 'reveal' ? onClose : undefined}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      style={{ cursor: phase === 'reveal' ? 'pointer' : 'default' }}
    >
      <style>{`
        @keyframes tko-shake {
          0%,100% { transform: translate(0,0) rotate(0deg); }
          15% { transform: translate(-6px,2px) rotate(-4deg); }
          30% { transform: translate(6px,-2px) rotate(4deg); }
          45% { transform: translate(-8px,3px) rotate(-6deg); }
          60% { transform: translate(8px,-3px) rotate(6deg); }
          75% { transform: translate(-10px,4px) rotate(-8deg); }
          90% { transform: translate(10px,-4px) rotate(8deg); }
        }
        @keyframes tko-flare {
          0% { opacity: 0; transform: scale(0.2); }
          40% { opacity: 1; }
          100% { opacity: 0; transform: scale(2.6); }
        }
        @keyframes tko-pop {
          0% { transform: scale(0.4); opacity: 0; }
          60% { transform: scale(1.15); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes tko-shine {
          0% { background-position: -150% 0; }
          100% { background-position: 250% 0; }
        }
        @keyframes tko-spark {
          0% { transform: translate(0,0) scale(1); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; }
        }
      `}</style>

      {/* CRATE — shaking, building anticipation */}
      {phase === 'shake' && (
        <div
          className="text-8xl select-none"
          style={{ animation: 'tko-shake 0.5s ease-in-out infinite', filter: `drop-shadow(0 0 24px ${accent})` }}
        >
          📦
        </div>
      )}

      {/* BURST — radial flare + sparks */}
      {phase === 'burst' && (
        <>
          <div
            className="absolute rounded-full"
            style={{
              width: 320, height: 320,
              background: `radial-gradient(circle, ${accent} 0%, rgba(255,255,255,0.9) 25%, transparent 70%)`,
              animation: 'tko-flare 0.5s ease-out forwards',
            }}
          />
          {Array.from({ length: 14 }).map((_, i) => {
            const ang = (i / 14) * Math.PI * 2
            return (
              <span
                key={i}
                className="absolute h-2 w-2 rounded-full"
                style={{
                  background: i % 2 ? accent : '#ff8a1e',
                  ['--dx' as string]: `${Math.cos(ang) * 180}px`,
                  ['--dy' as string]: `${Math.sin(ang) * 180}px`,
                  animation: 'tko-spark 0.6s ease-out forwards',
                }}
              />
            )
          })}
        </>
      )}

      {/* REVEAL — the prize */}
      {phase === 'reveal' && (
        <div className="flex flex-col items-center px-8 text-center" style={{ animation: 'tko-pop 0.45s cubic-bezier(0.2,1.4,0.4,1) forwards' }}>
          <div className="text-7xl" style={{ filter: `drop-shadow(0 0 28px ${accent})` }}>{emoji}</div>
          <div
            className="mt-4 text-3xl font-extrabold tracking-wide"
            style={{
              color: 'white',
              backgroundImage: `linear-gradient(100deg, transparent 20%, ${accent} 45%, #fff 50%, ${accent} 55%, transparent 80%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              backgroundSize: '250% 100%',
              animation: 'tko-shine 1.6s linear infinite',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {title}
          </div>
          {subtitle && <div className="mt-2 max-w-xs text-sm text-gray-300">{subtitle}</div>}
          <button
            className="mt-7 rounded-full px-6 py-2 text-sm font-semibold text-dark"
            style={{ background: accent, boxShadow: `0 0 22px ${accent}` }}
            onClick={onClose}
          >
            Let's go
          </button>
        </div>
      )}
    </div>
  )
}
