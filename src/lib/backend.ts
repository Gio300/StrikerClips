/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Lazy backend accessor for the economy modules (wallet / assets / predictions /
 * ledger / clans).
 *
 * WHY NOT just `import { supabase } from './supabase'`? Because those modules
 * are otherwise pure and are unit-tested without a DOM or a backend, and
 * `src/lib/supabase.ts` calls `createClient(url, key)` at module scope — which
 * throws when no Supabase env is configured. A static import would make merely
 * IMPORTING `predictions.ts` in a test depend on env vars being present.
 *
 * So the client is fetched on first use, inside the async server-path functions.
 * The local-mode helpers (the ones that take an explicit `storage`) never touch
 * this file, which is exactly the separation the tests rely on.
 *
 * Every helper here FAILS SOFT: if there is no backend (offline, or a build with
 * no creds) it returns a null client and the caller falls back to its cache.
 * That matters because these are read paths for balances and lockers — a network
 * blip must not look like "you own nothing".
 */

let clientPromise: Promise<any | null> | null = null

/** The Supabase-compatible client (real API shim, hosted client, or the mock). */
export async function backend(): Promise<any | null> {
  if (!clientPromise) {
    clientPromise = import('./supabase')
      .then((m) => m.supabase as any)
      .catch(() => null)
  }
  try {
    return await clientPromise
  } catch {
    return null
  }
}

/**
 * Call a trusted server function (POST /api/fn/:name).
 *
 * Returns null when the backend is unreachable or the call errored, so a caller
 * can distinguish "the server said no" (a `{ ok:false, reason }` payload) from
 * "we never reached the server" (null). Business refusals come back as 200 with
 * `ok:false` precisely so that distinction survives.
 */
export async function callFn<T = any>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    const sb = await backend()
    if (!sb?.functions?.invoke) return null
    const { data, error } = await sb.functions.invoke(name, { body })
    if (error) return null
    return (data ?? null) as T
  } catch {
    return null
  }
}
