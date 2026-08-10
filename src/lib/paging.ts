export type ExtraRowPage<T> = {
  items: T[]
  hasMore: boolean
}

/**
 * Lists request pageSize + 1 rows. The extra row answers "is there another
 * page?" without a second count query, and is never rendered on the phone.
 */
export function splitExtraRowPage<T>(rows: readonly T[] | null | undefined, pageSize: number): ExtraRowPage<T> {
  const size = Math.max(1, Math.floor(pageSize))
  const safeRows = rows ?? []
  return {
    items: safeRows.slice(0, size),
    hasMore: safeRows.length > size,
  }
}

/** Append a page without duplicating a row if data shifted between requests. */
export function appendUniqueById<T extends { id: string }>(current: readonly T[], page: readonly T[]): T[] {
  const ids = new Set(current.map((row) => row.id))
  return [...current, ...page.filter((row) => !ids.has(row.id))]
}
