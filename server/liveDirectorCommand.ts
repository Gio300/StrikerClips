export const LIVE_DIRECTOR_CONTEXT_TARGET = '__context__'

export type LiveDirectorAction =
  | 'add_players'
  | 'add_link'
  | 'remove_players'
  | 'stop_players'
  | 'restart_players'
  | 'stop_host'
  | 'restart_host'
  | 'end_show'
  | 'resume_show'
  | 'set_teams'
  | 'show_all'
  | 'focus_players'
  | 'set_auto'
  | 'replay'
  | 'slow_motion'
  | 'status'
  | 'unknown'

export type LiveDirectorIntent = {
  action: LiveDirectorAction
  targetNames?: string[]
  youtubeUrl?: string
  label?: string
  teamA?: string
  teamB?: string
  seconds?: number
  confirmed?: boolean
}

const ACTIONS = new Set<LiveDirectorAction>([
  'add_players',
  'add_link',
  'remove_players',
  'stop_players',
  'restart_players',
  'stop_host',
  'restart_host',
  'end_show',
  'resume_show',
  'set_teams',
  'show_all',
  'focus_players',
  'set_auto',
  'replay',
  'slow_motion',
  'status',
  'unknown',
])

function cleanTarget(raw: string): string {
  return raw
    .replace(/\b(?:to|into)\s+(?:it|the\s+(?:show|live|stream|broadcast))\s*$/i, '')
    .replace(/\b(?:on|in)\s+(?:the\s+)?(?:show|live|stream|broadcast)\s*$/i, '')
    .replace(/\b(?:camera|cam|angle|feed)\s*$/i, '')
    .trim()
}

function targets(raw: string): string[] {
  const cleaned = cleanTarget(raw)
  if (/^(?:this person|that person|them|him|her|this player|that player)$/i.test(cleaned)) {
    return [LIVE_DIRECTOR_CONTEXT_TARGET]
  }
  return cleaned
    .split(/\s*(?:,|\band\b|\bwith\b|\bplus\b)\s*/i)
    .map(cleanTarget)
    .filter(Boolean)
    .slice(0, 8)
}

function secondsFrom(raw: string, fallback: number): number {
  const m = raw.match(/\b(\d{1,2})\s*(?:seconds?|secs?|s)\b/i)
  return Math.max(2, Math.min(30, Number(m?.[1] || fallback)))
}

/**
 * Fast, deterministic commands stay free and instant. Anything this parser
 * does not recognize is sent to Gemini Pro, which must return the same narrow
 * intent shape before the server performs an action.
 */
export function parseLiveDirectorCommand(raw: string): LiveDirectorIntent | null {
  const text = raw.trim()
  const lower = text.toLowerCase()
  if (!lower) return null

  if (/\b(?:confirm|yes)[, ]+(?:end|stop)\s+(?:the\s+)?(?:show|live|stream|broadcast)\b/.test(lower)) {
    return { action: 'end_show', confirmed: true }
  }
  if (/\b(?:end|stop|close)\s+(?:the\s+)?(?:show|live|stream|broadcast)\b/.test(lower)) {
    return { action: 'end_show' }
  }
  if (/\b(?:resume|reopen|restart)\s+(?:the\s+)?(?:show|live|stream|broadcast)\b/.test(lower)) {
    return { action: 'resume_show' }
  }
  if (/\b(?:stop|pause|hide|turn off)\s+(?:my|the host|host)\s+(?:camera|cam|angle|feed)\b/.test(lower)) {
    return { action: 'stop_host' }
  }
  if (/\b(?:start|restart|resume|bring back|turn on)\s+(?:my|the host|host)\s+(?:camera|cam|angle|feed)\b/.test(lower)) {
    return { action: 'restart_host' }
  }

  const url = text.match(/https?:\/\/\S+/i)?.[0]
  if (url && /\badd\b/i.test(text)) {
    const beforeUrl = text.slice(0, text.toLowerCase().indexOf(url.toLowerCase()))
    const label = beforeUrl.replace(/^.*?\badd\b/i, '').replace(/\b(?:link|live|stream|camera|angle)\b/gi, '').trim()
    return { action: 'add_link', youtubeUrl: url, label: label || undefined }
  }

  const teamPair = text.match(/\b(?:the\s+)?(?:two\s+)?teams?\s+(?:are|is)\s+(.+?)\s+(?:vs\.?|versus|and)\s+(.+)$/i)
    || text.match(/\bteam\s*a\s+(?:is|=|to)\s+(.+?)\s+(?:and|,)?\s*team\s*b\s+(?:is|=|to)\s+(.+)$/i)
  if (teamPair) return { action: 'set_teams', teamA: teamPair[1].trim(), teamB: teamPair[2].trim() }

  if (/\b(?:auto|automatic)\s*(?:switch|director|mode|cameras?|angles?)\b|\blet tko direct\b/.test(lower)) {
    return { action: 'set_auto' }
  }
  if (/\b(?:show|put|use|display)\s+(?:all|every)(?:\s+(?:four|five|six|seven|eight|\d+))?\s+(?:cameras?|cams?|angles?|screens?|feeds?)\b|\b(?:four|five|six|seven|eight)-?up\b/.test(lower)) {
    return { action: 'show_all' }
  }
  if (/\b(?:replay|run)(?:\s+it|\s+that)?\s*(?:back)?\b|\bshow that again\b/.test(lower)) {
    return { action: 'replay', seconds: secondsFrom(text, 10) }
  }
  if (/\b(?:slow\s*mo(?:tion)?|slow it down)\b/.test(lower)) {
    return { action: 'slow_motion', seconds: secondsFrom(text, 8) }
  }

  const add = text.match(/^\s*(?:please\s+)?add\s+(.+)$/i)
  if (add) return { action: 'add_players', targetNames: targets(add[1]) }

  const remove = text.match(/^\s*(?:please\s+)?(?:remove|drop|take off)\s+(.+)$/i)
  if (remove) return { action: 'remove_players', targetNames: targets(remove[1]) }

  const stop = text.match(/^\s*(?:please\s+)?(?:stop|pause|hide|turn off)\s+(.+)$/i)
  if (stop) return { action: 'stop_players', targetNames: targets(stop[1]) }

  const restart = text.match(/^\s*(?:please\s+)?(?:restart|resume|bring back|turn on)\s+(.+)$/i)
  if (restart) return { action: 'restart_players', targetNames: targets(restart[1]) }

  const full = text.match(/^(?:please\s+)?(?:put|show|focus on|switch to|make)\s+(.+?)\s+(?:full\s*screen|the\s+main\s+(?:camera|screen)|main)\s*$/i)
  if (full) return { action: 'focus_players', targetNames: targets(full[1]) }

  const together = text.match(/^(?:please\s+)?(?:put|show|use|combine)\s+(.+?)\s+(?:together|side\s*by\s*side|on\s*screen)\s*$/i)
  if (together) return { action: 'focus_players', targetNames: targets(together[1]) }

  if (/\b(?:who|what)\s+(?:is|are)\s+(?:live|on)|\bshow status\b|\bwhat cameras?\b/.test(lower)) {
    return { action: 'status' }
  }

  return null
}

export function coerceLiveDirectorIntent(value: unknown): LiveDirectorIntent | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const action = String(raw.action || '') as LiveDirectorAction
  if (!ACTIONS.has(action)) return null
  const targetNames = Array.isArray(raw.targetNames)
    ? raw.targetNames.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : undefined
  const seconds = Number.isFinite(Number(raw.seconds))
    ? Math.max(2, Math.min(30, Number(raw.seconds)))
    : undefined
  return {
    action,
    targetNames,
    youtubeUrl: raw.youtubeUrl ? String(raw.youtubeUrl).trim() : undefined,
    label: raw.label ? String(raw.label).trim().slice(0, 80) : undefined,
    teamA: raw.teamA ? String(raw.teamA).trim().slice(0, 80) : undefined,
    teamB: raw.teamB ? String(raw.teamB).trim().slice(0, 80) : undefined,
    seconds,
    confirmed: raw.confirmed === true,
  }
}
