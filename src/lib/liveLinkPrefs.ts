/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * liveLinkPrefs — reading and writing a user's `autoLinkMode`.
 *
 * WHERE IT LIVES. `profiles.auto_link_mode` — a settings FIELD on the identity
 * row rather than a private `user_settings` table, and that is a deliberate
 * call: the link engine has to check BOTH people's preference before it links
 * them, so the other party's client must be able to read it. `profiles` is
 * already public-read / owner-write (TABLE_POLICY.profiles), which is exactly
 * the shape this needs. It is NOT in PRIVILEGE_COLS, so the owner may set it
 * through the generic API like any other profile field, and nobody else can.
 *
 * It leaks nothing interesting — "this person prefers to be asked before their
 * stream is linked" is the same class of fact as their handle.
 *
 * A localStorage mirror keeps the current user's own choice instant and keeps
 * the setting usable on the mock backend, but the profile row is the truth.
 */

import { supabase } from '@/lib/supabase'
import {
  DEFAULT_AUTO_LINK_MODE,
  normalizeAutoLinkMode,
  type AutoLinkMode,
} from '@/lib/liveLink'

const cacheKey = (userId: string) => `kc_autolinkmode:${userId}`

/** Last known value for this user, without waiting on the network. */
export function cachedAutoLinkMode(userId: string): AutoLinkMode {
  if (!userId) return DEFAULT_AUTO_LINK_MODE
  try {
    return normalizeAutoLinkMode(localStorage.getItem(cacheKey(userId)))
  } catch {
    return DEFAULT_AUTO_LINK_MODE
  }
}

function cache(userId: string, mode: AutoLinkMode): void {
  try {
    localStorage.setItem(cacheKey(userId), mode)
  } catch {
    /* private mode / quota — non-fatal, the profile row is the truth */
  }
}

/** Read one user's preference. Anything missing or unknown reads as 'auto'. */
export async function loadAutoLinkMode(userId: string): Promise<AutoLinkMode> {
  if (!userId) return DEFAULT_AUTO_LINK_MODE
  try {
    const { data } = await supabase
      .from('profiles')
      .select('auto_link_mode')
      .eq('id', userId)
      .maybeSingle()
    const row = data as any
    // A backend that predates the column returns undefined — fall back to the
    // local mirror so a setting the user just changed isn't silently lost.
    if (!row || row.auto_link_mode == null) return cachedAutoLinkMode(userId)
    const mode = normalizeAutoLinkMode(row.auto_link_mode)
    cache(userId, mode)
    return mode
  } catch {
    return cachedAutoLinkMode(userId)
  }
}

/**
 * Read the preference of many users at once — what the engine needs, since it
 * must honour BOTH sides of every pair. Anyone unreadable or unset is 'auto',
 * the product default: an unknown user must never become silently un-linkable.
 */
export async function loadAutoLinkModes(
  userIds: string[],
): Promise<Record<string, AutoLinkMode>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  const out: Record<string, AutoLinkMode> = {}
  for (const id of ids) out[id] = DEFAULT_AUTO_LINK_MODE
  if (ids.length === 0) return out
  try {
    const { data } = await supabase.from('profiles').select('id, auto_link_mode').in('id', ids)
    for (const row of ((data ?? []) as any[])) {
      if (!row?.id) continue
      if (row.auto_link_mode == null) {
        // Column not present on this backend — use whatever we cached locally.
        out[String(row.id)] = cachedAutoLinkMode(String(row.id))
        continue
      }
      out[String(row.id)] = normalizeAutoLinkMode(row.auto_link_mode)
    }
  } catch {
    // Unreadable: everybody keeps the default. Discovery must not break because
    // one optional column is missing.
  }
  return out
}

/** Persist the current user's choice. Owner-writable by policy. */
export async function saveAutoLinkMode(userId: string, mode: AutoLinkMode): Promise<boolean> {
  if (!userId) return false
  const next = normalizeAutoLinkMode(mode)
  cache(userId, next)
  try {
    const { error } = await supabase
      .from('profiles')
      .update({ auto_link_mode: next } as any)
      .eq('id', userId)
    return !error
  } catch {
    return false
  }
}
