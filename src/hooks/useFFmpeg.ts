import { useState, useCallback } from 'react'
import {
  concatVideos as opConcat,
  gridStack4 as opGrid,
  sideBySide as opSideBySide,
  pipOverlay as opPip,
  trimClip as opTrim,
} from '@/lib/ffmpegOps'

export type ReelLayout = 'concat' | 'grid' | 'side-by-side' | 'pip' | 'action' | 'ultra'

const MIN_FILES: Record<ReelLayout, number> = {
  concat: 2,
  grid: 4,
  'side-by-side': 2,
  pip: 2,
  action: 2,
  ultra: 2,
}

const MAX_FILES: Record<ReelLayout, number> = {
  concat: 8,
  grid: 4,
  'side-by-side': 2,
  pip: 2,
  action: 8,
  ultra: 8,
}

const TOTAL_BYTES_LIMIT = 200 * 1024 * 1024 // 200 MB combined cap to keep the browser tab alive.

export function layoutLimits(layout: ReelLayout): { min: number; max: number } {
  return { min: MIN_FILES[layout], max: MAX_FILES[layout] }
}

export function useFFmpeg() {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState<string>('')

  const runLayout = useCallback(async (layout: ReelLayout, files: File[]): Promise<Blob | null> => {
    const { min, max } = layoutLimits(layout)
    if (files.length < min || files.length > max) return null

    const total = files.reduce((sum, f) => sum + f.size, 0)
    if (total > TOTAL_BYTES_LIMIT) {
      console.warn(`[useFFmpeg] aborting: ${(total / 1024 / 1024).toFixed(1)} MB exceeds 200 MB browser cap`)
      return null
    }

    setLoading(true)
    setProgress(0)
    setStage(
      layout === 'concat' ? 'Stitching clips'
      : layout === 'grid' ? 'Building 2x2 grid'
      : layout === 'side-by-side' ? 'Building split-screen'
      : layout === 'action' ? 'Stitching action cuts'
      : layout === 'ultra' ? 'Stitching director cut'
      : 'Building picture-in-picture'
    )

    try {
      const onProgress = (pct: number) => setProgress(pct)
      let blob: Blob | null = null
      switch (layout) {
        case 'concat':
          blob = await opConcat(files, onProgress)
          break
        case 'grid':
          blob = await opGrid(files, onProgress)
          break
        case 'side-by-side':
          blob = await opSideBySide(files, onProgress)
          break
        case 'pip':
          blob = await opPip(files, onProgress)
          break
        case 'action':
          // For uploaded files, action mode falls back to concat — switching is
          // a playback-time concept that only makes sense for synced YouTube
          // angles. Files are baked into a single MP4 anyway, so concat is the
          // closest meaningful render.
          blob = await opConcat(files, onProgress)
          break
        case 'ultra':
          // Same reasoning as 'action': ultra is a playback-time director cut
          // across synced YouTube angles. For uploaded files we bake to concat
          // so the reel is still saveable; the dynamic layout dance only fires
          // for YouTube reels.
          blob = await opConcat(files, onProgress)
          break
      }
      return blob
    } finally {
      setLoading(false)
      setProgress(0)
      setStage('')
    }
  }, [])

  /** Back-compat shim: existing pages call concatVideos. */
  const concatVideos = useCallback((files: File[]) => runLayout('concat', files), [runLayout])

  const trim = useCallback(async (file: File, startSec: number, endSec: number): Promise<Blob | null> => {
    setLoading(true)
    setProgress(0)
    setStage('Trimming')
    try {
      return await opTrim(file, startSec, endSec, (pct) => setProgress(pct))
    } finally {
      setLoading(false)
      setProgress(0)
      setStage('')
    }
  }, [])

  return { concatVideos, runLayout, trim, loading, progress, stage }
}
