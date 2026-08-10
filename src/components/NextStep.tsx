import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { isYouTubeLinked } from '@/lib/youtubeLink'
import { loadLibrary } from '@/lib/youtubeConnect'
import { useLeagueTheme } from '@/components/LeagueThemeProvider'
import { kingLadderDisplayName } from '@/lib/displayBrand'

/**
 * NextStep — a single, guiding "here's your next logical move" card.
 *
 * New users shouldn't have to hunt. This looks at where they actually are —
 * connected YouTube? made a clip? in a clan? — and surfaces the ONE next step,
 * with a button that takes them straight there. It's not a forced wizard: it
 * shows one nudge, is dismissible, and disappears once they're set up (so
 * players who just want to roam aren't nagged).
 */
interface Step { id: string; emoji: string; title: string; blurb: string; cta: string; to: string }

const DISMISS_KEY = 'kc_nextstep_dismissed'

function isDismissed(id: string): boolean {
  try { return (JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[]).includes(id) } catch { return false }
}
function dismiss(id: string) {
  try {
    const cur = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]') as string[]
    if (!cur.includes(id)) localStorage.setItem(DISMISS_KEY, JSON.stringify([...cur, id]))
  } catch { /* ignore */ }
}

export function NextStep() {
  const { user } = useAuth()
  const { display } = useLeagueTheme()
  const brandName = display.productName
  const ladderName = kingLadderDisplayName(display)
  const [step, setStep] = useState<Step | null>(null)

  useEffect(() => {
    let alive = true
    if (!user) { setStep(null); return }
    ;(async () => {
      // 1) Connect YouTube — the front door to everything (clips, live, auto-merge).
      const linked = await isYouTubeLinked(user.id)
      if (!alive) return
      if (!linked) {
        return setStep({ id: 'connect', emoji: '📺', title: 'Connect your YouTube', blurb: `Link your channel once — then ${brandName} can pull your clips and auto-merge your matches.`, cta: 'Connect', to: '/highlight/create' })
      }
      // 2) Make your first clip.
      let hasClips = loadLibrary(user.id).length > 0
      if (!hasClips) {
        try {
          const { data } = await supabase.from('clip_records').select('id').eq('player_id', user.id).limit(1)
          hasClips = (data?.length ?? 0) > 0
        } catch { /* ignore */ }
      }
      if (!alive) return
      if (!hasClips) {
        return setStep({ id: 'clip', emoji: '🎬', title: 'Make your first clip', blurb: 'Turn your gameplay into a multi-angle highlight. Paste a link or describe the moment.', cta: 'Create', to: '/highlight/create' })
      }
      // 3) Join or found a clan (Conquest + clan battles need one).
      let inClan = false
      try {
        const { data } = await supabase.from('clan_members').select('server_id').eq('user_id', user.id).limit(1)
        inClan = (data?.length ?? 0) > 0
      } catch { /* ignore */ }
      if (!alive) return
      if (!inClan) {
        return setStep({ id: 'clan', emoji: '🏯', title: 'Join or found a clan', blurb: 'Clans take land in Shinobi Conquest. Pick a village on the map or join an existing clan.', cta: 'Find a clan', to: '/clans' })
      }
      // 4) Enter the King ladder.
      setStep({ id: 'ladder', emoji: '👑', title: `Enter the ${ladderName}`, blurb: 'Get auto-matched, climb the ranks, and fight toward the crown. It never ends.', cta: 'Enter', to: '/king' })
    })()
    return () => { alive = false }
  }, [brandName, ladderName, user])

  if (!user || !step || isDismissed(step.id)) return null

  return (
    <div className="rounded-xl border border-accent/40 bg-gradient-to-br from-accent/10 via-dark-card to-dark-card p-4 flex items-start gap-3">
      <div className="text-2xl leading-none">{step.emoji}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest text-accent font-bold">Next step</span>
        </div>
        <h3 className="font-semibold text-white mt-0.5">{step.title}</h3>
        <p className="text-sm text-gray-400 mt-0.5">{step.blurb}</p>
        <div className="mt-3 flex items-center gap-3">
          <Link to={step.to} className="px-4 py-2 rounded-lg bg-accent text-dark text-sm font-semibold hover:shadow-glow">
            {step.cta} →
          </Link>
          <button
            type="button"
            onClick={() => { dismiss(step.id); setStep(null) }}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  )
}

export default NextStep
