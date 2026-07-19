/**
 * Demo clip gallery — so the connect + describe + tray experience is visible and
 * playable on-device before a real YouTube account is linked (which needs the
 * Google Client ID). These are real public YouTube video ids so the thumbnails
 * resolve; titles/opponents/dates are shaped so the "who I fought / when" search
 * actually returns sensible results in a demo.
 *
 * Shown only as an opt-in "See it with demo clips" in the finder; the moment a
 * real channel is connected, the real uploads replace these.
 */

import type { LibraryVideo } from './describeClip'

const DAY = 86_400_000

// now-relative so "yesterday", "last week" etc. always land correctly in the demo.
export function demoLibrary(now: number = Date.now()): LibraryVideo[] {
  return [
    { id: 'dPCS6ACHeQ0', title: 'Triple K.O. vs Rekt — ranked', description: 'ultimate finish, clutch kills against Rekt', publishedAt: now - DAY - 3 * 3600_000 },
    { id: 'IZcwiJrMwas', title: 'Flag run vs Auryn', description: 'scroll capture, flag objective vs auryn', publishedAt: now - 2 * DAY },
    { id: 'xU45LZvPkYg', title: 'Ultimate on Auryn — Pit', description: 'ougi ultimate against auryn in the pit', publishedAt: now - 5 * DAY },
    { id: 'tgNuaTIM_n4', title: 'Closing scoreboard — 8 K.O. game', description: 'match stats closing screen kills deaths', publishedAt: now - 6 * DAY },
    { id: '6kM_PgLUjSM', title: 'Clutch comeback vs Rekt', description: '1v3 clutch comeback against rekt', publishedAt: now - 8 * DAY },
    { id: 'dQw4w9WgXcQ', title: 'Opening scene — squad intro', description: 'opening cinematic intro before the match', publishedAt: now - 12 * DAY },
  ]
}
