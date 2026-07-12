/* eslint-disable no-console */
/**
 * Retention / cost-discipline helpers for the KillCam upload worker.
 *
 * Policy:
 *  - The FINAL combined master is archived to an external drive BEFORE it is
 *    pushed to YouTube, so YouTube is never the only copy.
 *  - The archive step FAILS LOUDLY if the drive is missing or not writable —
 *    the worker aborts and never purges anything.
 *  - Raw user uploads (and the Supabase-hosted combined master) are TRANSIENT:
 *    once the master is confirmed on YouTube AND archived, they are deleted from
 *    Supabase Storage so our site serves zero video bytes.
 *
 * ARCHIVE_DIR is configurable (point it at the external drive today, a cold-
 * storage mount later), e.g. ARCHIVE_DIR="E:\\KillCamMasters".
 */
import { copyFile, mkdir, stat, access, writeFile, rm } from 'node:fs/promises'
import { join, parse } from 'node:path'
import process from 'node:process'
import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'videos'

export function resolveArchiveDir(): string {
  const dir = process.env.ARCHIVE_DIR?.trim()
  if (dir) return dir
  throw new Error(
    'ARCHIVE_DIR is not set. Refusing to publish — the final master must be archived off-YouTube first. ' +
      'Set ARCHIVE_DIR to a path on your external drive, e.g. ARCHIVE_DIR="E:\\\\KillCamMasters".',
  )
}

/**
 * Verify the archive destination is real and writable RIGHT NOW. Throws loudly
 * (external drive unplugged, path wrong, read-only) so the caller aborts before
 * touching YouTube or deleting sources.
 */
export async function ensureArchiveReady(): Promise<string> {
  const dir = resolveArchiveDir()
  const root = parse(dir).root
  if (!root) throw new Error(`ARCHIVE_DIR "${dir}" has no drive root — use an absolute path.`)

  // The drive itself must be mounted.
  try {
    await access(root)
  } catch {
    throw new Error(
      `Archive drive "${root}" not found — is the external drive plugged in? ` +
        `ARCHIVE_DIR=${dir}. Refusing to continue: YouTube must never be the only copy.`,
    )
  }

  await mkdir(dir, { recursive: true })

  // Prove we can actually write (catches read-only / full / permission issues).
  const probe = join(dir, `.killcam-write-probe-${process.pid}`)
  try {
    await writeFile(probe, 'ok')
  } catch (e) {
    throw new Error(
      `Archive dir "${dir}" is not writable (${e instanceof Error ? e.message : String(e)}). ` +
        `Refusing to continue: YouTube must never be the only copy.`,
    )
  } finally {
    await rm(probe, { force: true }).catch(() => {})
  }
  return dir
}

/** Copy the master to the archive and verify byte-for-byte size. Throws on any
 * mismatch so a truncated copy never counts as archived. */
export async function archiveMaster(finalPath: string, reelId: string, dir: string): Promise<string> {
  const dest = join(dir, `${reelId}.mp4`)
  await copyFile(finalPath, dest)
  const [src, out] = await Promise.all([stat(finalPath), stat(dest)])
  if (out.size === 0 || out.size !== src.size) {
    throw new Error(`archive verify failed for ${reelId}: dest=${out.size}B src=${src.size}B`)
  }
  console.log(`[retention] archived master → ${dest} (${out.size} bytes)`)
  return dest
}

/** Extract the object path inside the `videos` bucket from a public URL, or null
 * if the URL isn't one of our storage objects (e.g. an external URL). */
export function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  if (i === -1) return null
  return decodeURIComponent(url.slice(i + marker.length))
}

export interface PurgeClip {
  id: string
  url_or_path: string
  source_type: string
}

/**
 * Delete raw user uploads and the Supabase-hosted combined master from Storage.
 * Only call AFTER the master is archived AND confirmed on YouTube. Returns what
 * was purged for the audit row.
 */
export async function purgeReelSources(
  supabase: SupabaseClient,
  reel: { id: string; combined_video_url: string | null },
  clips: PurgeClip[],
): Promise<{ purgedClipIds: string[]; masterPath: string | null }> {
  const paths: string[] = []
  const purgedClipIds: string[] = []

  for (const c of clips) {
    if (c.source_type !== 'upload') continue // YouTube sources aren't ours to delete
    const p = storagePathFromPublicUrl(c.url_or_path)
    if (p) {
      paths.push(p)
      purgedClipIds.push(c.id)
    }
  }

  const masterPath = storagePathFromPublicUrl(reel.combined_video_url)
  if (masterPath) paths.push(masterPath)

  if (paths.length > 0) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths)
    if (error) throw new Error(`storage purge failed: ${error.message}`)
    console.log(`[retention] purged ${paths.length} object(s) from Supabase Storage`)
  }

  if (purgedClipIds.length > 0) {
    await supabase
      .from('clips')
      .update({ purged_at: new Date().toISOString() })
      .in('id', purgedClipIds)
  }

  return { purgedClipIds, masterPath }
}
