/**
 * ACCOUNT DELETION — the client half.
 *
 * Google Play (since 2024) and Apple (Guideline 5.1.1(v)) both require that an
 * app which creates accounts can DELETE them from inside the app, not only by
 * emailing support. This calls the server endpoint that hard-deletes the row,
 * then tears down the local session.
 *
 * Transport: `functions.invoke('delete-account')` → POST /api/fn/delete-account
 * on the real backend, which is also reachable as DELETE /api/account. Going
 * through the shim means the mock backend answers too, so the flow is clickable
 * in local UI builds (it just doesn't erase a database that isn't there).
 *
 * The backend client is passed IN rather than imported here, so this module has
 * no import-time side effects (it never constructs a Supabase client) and every
 * helper below is unit-testable outside a browser.
 */

import { writeAuthToken } from './authTokenStorage'

/** The slice of the backend client this module actually uses. */
export type AccountClient = {
  functions: { invoke: (name: string, opts?: { body?: unknown }) => Promise<{ data: unknown; error: { message?: string } | null }> }
  auth: { signOut: () => Promise<unknown> }
}

/** Confirmation word the UI makes the user type. Case-sensitive on purpose. */
export const DELETE_CONFIRM_WORD = 'DELETE'

/** Is the typed confirmation exactly right? Pure — trims surrounding space only. */
export function isDeleteConfirmed(typed: string | null | undefined): boolean {
  return String(typed ?? '').trim() === DELETE_CONFIRM_WORD
}

export type DeleteAccountResult =
  | { ok: true; clansTransferred: number; clansDisbanded: number }
  | { ok: false; error: string }

/** Shape of the server's reply, narrowed defensively. */
type DeletePayload = {
  ok?: boolean
  error?: string
  clans?: { transferred?: number; disbanded?: number }
}

/**
 * Interpret the server's reply. Pure, so the success/failure branches are
 * testable without a network or a client.
 */
export function parseDeleteResponse(data: unknown, error: { message?: string } | null): DeleteAccountResult {
  if (error) return { ok: false, error: error.message || 'Could not delete your account.' }
  const payload = (data ?? {}) as DeletePayload
  if (payload.ok === false) return { ok: false, error: payload.error || 'Could not delete your account.' }
  return {
    ok: true,
    clansTransferred: Number(payload.clans?.transferred ?? 0),
    clansDisbanded: Number(payload.clans?.disbanded ?? 0),
  }
}

/**
 * Delete the signed-in account, then sign out locally.
 *
 * Always signs out on success — the JWT is dead the moment the row is gone, and
 * leaving it in localStorage would strand the app in a 401 loop.
 */
export async function deleteAccount(client: AccountClient): Promise<DeleteAccountResult> {
  try {
    const { data, error } = await client.functions.invoke('delete-account', { body: {} })
    const result = parseDeleteResponse(data, error)
    if (!result.ok) return result
    try { await client.auth.signOut() } catch { /* the session is gone either way */ }
    // Belt and braces: drop the raw token the real shim keeps, in case signOut
    // above failed against a backend that no longer recognises us.
    await writeAuthToken(null)
    return result
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}
