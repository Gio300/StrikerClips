/**
 * chatAuthors — a per-room memo for MESSAGE AUTHOR IDENTITY.
 *
 * WHY. Every chat surface hydrates a batch of raw rows by reading `profiles`
 * for their `user_id`s, and the same function serves both the opening backfill
 * and the incremental poll. That is correct, and it was costing a SECOND
 * request on every single tick: a room with any traffic at all re-read the
 * identity of the same handful of speakers every 5 seconds, forever. Two
 * requests per open panel per tick against a 5-connection pool is the load that
 * takes the site down exactly when a crowd shows up.
 *
 * Author identity is very nearly static — a username or avatar changes maybe
 * once in a session, and a chat line rendering the name it had when the panel
 * opened is not a defect. So it is cached for the life of the room and only ids
 * the cache has never seen are fetched. In a busy room where everyone speaking
 * has already spoken, that is ZERO profile requests per tick.
 *
 * ABSENCE IS CACHED TOO, and that is the half people forget. A `user_id` with
 * no profile row — a deleted account, a bot line, a slim backend — would
 * otherwise be "missing" on every tick and re-requested forever, which is the
 * very cost this module exists to remove. `fill` is therefore told what was
 * ASKED as well as what was FOUND, and remembers the difference as
 * known-absent.
 *
 * Pure and DOM-free like the rest of the chat core (chatMessages.ts,
 * chatPresence.ts, chatUnread.ts): the caller owns the fetch, this owns the
 * memory. Held per room in a ref and dropped when the room changes, so a room
 * switch re-reads identities rather than pinning them for the tab's lifetime.
 */

/**
 * A memo of resolved authors for one room. `T` is whatever shape the surface
 * renders — the four surfaces genuinely differ (the stream and tournament
 * chats want a username and avatar, ChatSpace also wants the equipped artifact
 * tag, DMs want the whole SocialProfile), and this module deliberately does not
 * care which.
 */
export interface AuthorCache<T> {
  /**
   * The subset of `ids` this cache cannot answer — exactly the set worth
   * fetching. Deduped, nulls dropped, and empty when everyone is already known
   * (which is the common case on a busy room, and the point of all this).
   */
  missing(ids: readonly (string | null | undefined)[]): string[]
  /**
   * Record a resolved batch. `asked` is the id list that was requested and
   * `found` what came back; every asked id absent from `found` is remembered as
   * known-absent so it is never requested again for this room.
   */
  fill(asked: readonly string[], found: ReadonlyMap<string, T>): void
  /**
   * The cached author: the value when known, `null` when known-absent, and
   * `undefined` when this room has never resolved that id.
   */
  get(id: string | null | undefined): T | null | undefined
  /** How many ids this room has resolved either way. Diagnostics and tests. */
  size(): number
}

/** A fresh, empty author memo. One per room. */
export function createAuthorCache<T>(): AuthorCache<T> {
  const known = new Map<string, T | null>()
  return {
    missing(ids) {
      const out: string[] = []
      const seen = new Set<string>()
      for (const id of ids) {
        if (!id || seen.has(id) || known.has(id)) continue
        seen.add(id)
        out.push(id)
      }
      return out
    },
    fill(asked, found) {
      for (const [id, value] of found) known.set(id, value)
      // Everything we asked for and did not get is absent, not unknown.
      for (const id of asked) if (!found.has(id)) known.set(id, null)
    },
    get(id) {
      if (!id) return undefined
      return known.get(id)
    },
    size() {
      return known.size
    },
  }
}
