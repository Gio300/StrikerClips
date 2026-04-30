import { supabase } from '@/lib/supabase'
import type { NotificationKind, Notification } from '@/types/database'

/**
 * notify — fire a notification to a user. Best-effort: errors are swallowed
 * (with a console warning) so a notification failure never blocks the
 * primary action that triggered it.
 *
 * The actor_id is filled in automatically from the current session.
 */
export async function notify(input: {
  userId: string
  kind: NotificationKind | string
  title: string
  body?: string | null
  link?: string | null
  relatedId?: string | null
}): Promise<void> {
  // Don't notify yourself for things you triggered yourself — common case
  // when an admin reviews their own submission, or a creator decides on
  // their own row. Callers can override by passing a non-self target.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  if (user.id === input.userId) return
  const payload = {
    user_id: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    link: input.link ?? null,
    related_id: input.relatedId ?? null,
    actor_id: user.id,
  }
  const { error } = await supabase.from('notifications').insert(payload)
  if (error) {
    // Notifications failing should never block the calling flow. Log and move on.
    // eslint-disable-next-line no-console
    console.warn('notify() failed:', error.message, payload)
  }
}

/**
 * notifyMany — fan a single notification out to a list of recipients.
 * Useful for "all admins" / "all entrants" style fan-outs.
 */
export async function notifyMany(
  userIds: string[],
  args: Omit<Parameters<typeof notify>[0], 'userId'>,
): Promise<void> {
  await Promise.all(userIds.map((uid) => notify({ ...args, userId: uid })))
}

export type FetchOptions = { onlyUnread?: boolean; limit?: number }

/** Pull recent notifications for the current user. */
export async function fetchMyNotifications(
  opts: FetchOptions = {},
): Promise<Notification[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  let q = supabase
    .from('notifications')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)
  if (opts.onlyUnread) q = q.is('read_at', null)
  const { data } = await q
  return (data ?? []) as Notification[]
}

export async function markRead(id: string): Promise<void> {
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
}

export async function markAllRead(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)
}
