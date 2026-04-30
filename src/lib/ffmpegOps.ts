import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null
let loadingPromise: Promise<FFmpeg> | null = null

export type ProgressFn = (pct: number) => void

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({
      coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
      wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
    })
    ffmpegInstance = ffmpeg
    return ffmpeg
  })()
  return loadingPromise
}

function attachProgress(ffmpeg: FFmpeg, onProgress?: ProgressFn) {
  if (!onProgress) return () => {}
  const handler = ({ progress }: { progress: number }) => {
    onProgress(Math.max(0, Math.min(100, Math.round((progress ?? 0) * 100))))
  }
  ffmpeg.on('progress', handler)
  return () => ffmpeg.off('progress', handler)
}

async function writeInputs(ffmpeg: FFmpeg, files: File[]): Promise<string[]> {
  const names = files.map((_, i) => `input${i}.mp4`)
  for (let i = 0; i < files.length; i++) {
    await ffmpeg.writeFile(names[i], await fetchFile(files[i]))
  }
  return names
}

async function readAndCleanup(ffmpeg: FFmpeg, output: string, inputs: string[], extras: string[] = []): Promise<Blob> {
  const data = await ffmpeg.readFile(output)
  const blob = new Blob([data], { type: 'video/mp4' })
  for (const n of inputs) {
    try { await ffmpeg.deleteFile(n) } catch { /* ignore */ }
  }
  for (const n of extras) {
    try { await ffmpeg.deleteFile(n) } catch { /* ignore */ }
  }
  try { await ffmpeg.deleteFile(output) } catch { /* ignore */ }
  return blob
}

const TARGET_W = 1280
const TARGET_H = 720
const TILE_W = 640
const TILE_H = 360
const FPS = 30

/**
 * Concatenate clips end-to-end. Re-encodes for codec/resolution/fps safety —
 * the old `-c copy` approach silently produced garbage when clips didn't match.
 */
export async function concatVideos(files: File[], onProgress?: ProgressFn): Promise<Blob | null> {
  if (files.length < 2) return null
  const ffmpeg = await getFFmpeg()
  const detach = attachProgress(ffmpeg, onProgress)
  try {
    const names = await writeInputs(ffmpeg, files)
    const inputArgs: string[] = []
    for (const n of names) inputArgs.push('-i', n)
    const filterParts: string[] = []
    for (let i = 0; i < names.length; i++) {
      filterParts.push(
        `[${i}:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v${i}];`
      )
      filterParts.push(`[${i}:a]aresample=async=1:first_pts=0[a${i}];`)
    }
    const concatPairs = names.map((_, i) => `[v${i}][a${i}]`).join('')
    const filter = `${filterParts.join('')}${concatPairs}concat=n=${names.length}:v=1:a=1[outv][outa]`
    await ffmpeg.exec([
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ])
    return await readAndCleanup(ffmpeg, 'output.mp4', names)
  } catch (err) {
    console.error('[ffmpeg] concat error:', err)
    return null
  } finally {
    detach()
  }
}

/**
 * 2x2 grid stack — perfect for "same fight, 4 player perspectives".
 * Truncates to the shortest clip's duration so all four stay in sync.
 */
export async function gridStack4(files: File[], onProgress?: ProgressFn): Promise<Blob | null> {
  if (files.length !== 4) return null
  const ffmpeg = await getFFmpeg()
  const detach = attachProgress(ffmpeg, onProgress)
  try {
    const names = await writeInputs(ffmpeg, files)
    const inputArgs: string[] = []
    for (const n of names) inputArgs.push('-i', n)
    const scaled: string[] = []
    for (let i = 0; i < 4; i++) {
      scaled.push(
        `[${i}:v]scale=${TILE_W}:${TILE_H}:force_original_aspect_ratio=decrease,pad=${TILE_W}:${TILE_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v${i}];`
      )
    }
    const filter =
      scaled.join('') +
      `[v0][v1][v2][v3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0:shortest=1[outv];` +
      `[0:a][1:a][2:a][3:a]amix=inputs=4:duration=shortest:dropout_transition=0[outa]`
    await ffmpeg.exec([
      ...inputArgs,
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ])
    return await readAndCleanup(ffmpeg, 'output.mp4', names)
  } catch (err) {
    console.error('[ffmpeg] gridStack4 error:', err)
    return null
  } finally {
    detach()
  }
}

/**
 * Side-by-side comparison — 2 clips horizontally.
 * Useful for "watch X's perspective vs Y's" replays.
 */
export async function sideBySide(files: File[], onProgress?: ProgressFn): Promise<Blob | null> {
  if (files.length !== 2) return null
  const ffmpeg = await getFFmpeg()
  const detach = attachProgress(ffmpeg, onProgress)
  try {
    const names = await writeInputs(ffmpeg, files)
    const filter =
      `[0:v]scale=${TILE_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TILE_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v0];` +
      `[1:v]scale=${TILE_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TILE_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[v1];` +
      `[v0][v1]hstack=inputs=2:shortest=1[outv];` +
      `[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=0[outa]`
    await ffmpeg.exec([
      '-i', names[0], '-i', names[1],
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '[outa]',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ])
    return await readAndCleanup(ffmpeg, 'output.mp4', names)
  } catch (err) {
    console.error('[ffmpeg] sideBySide error:', err)
    return null
  } finally {
    detach()
  }
}

/**
 * Picture-in-picture: main clip fullscreen, secondary clip in bottom-right corner.
 * Audio is taken from the main clip only.
 */
export async function pipOverlay(files: File[], onProgress?: ProgressFn): Promise<Blob | null> {
  if (files.length !== 2) return null
  const ffmpeg = await getFFmpeg()
  const detach = attachProgress(ffmpeg, onProgress)
  try {
    const names = await writeInputs(ffmpeg, files)
    const pipW = Math.round(TARGET_W / 4)
    const pipH = Math.round(TARGET_H / 4)
    const margin = 16
    const filter =
      `[0:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[main];` +
      `[1:v]scale=${pipW}:${pipH}:force_original_aspect_ratio=decrease,pad=${pipW}:${pipH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${FPS}[pip];` +
      `[main][pip]overlay=W-w-${margin}:H-h-${margin}:shortest=1[outv]`
    await ffmpeg.exec([
      '-i', names[0], '-i', names[1],
      '-filter_complex', filter,
      '-map', '[outv]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ])
    return await readAndCleanup(ffmpeg, 'output.mp4', names)
  } catch (err) {
    console.error('[ffmpeg] pipOverlay error:', err)
    return null
  } finally {
    detach()
  }
}

/**
 * Trim a single clip to a [start, end] window, re-encoded so the cut is frame-accurate.
 */
export async function trimClip(file: File, startSec: number, endSec: number, onProgress?: ProgressFn): Promise<Blob | null> {
  if (endSec <= startSec) return null
  const ffmpeg = await getFFmpeg()
  const detach = attachProgress(ffmpeg, onProgress)
  try {
    await ffmpeg.writeFile('input.mp4', await fetchFile(file))
    await ffmpeg.exec([
      '-i', 'input.mp4',
      '-ss', String(startSec),
      '-to', String(endSec),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      'output.mp4',
    ])
    return await readAndCleanup(ffmpeg, 'output.mp4', ['input.mp4'])
  } catch (err) {
    console.error('[ffmpeg] trim error:', err)
    return null
  } finally {
    detach()
  }
}
