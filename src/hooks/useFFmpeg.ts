import { useState, useCallback } from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'

let ffmpegInstance: FFmpeg | null = null

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance
  const { FFmpeg } = await import('@ffmpeg/ffmpeg')
  const ffmpeg = new FFmpeg()
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
  })
  ffmpegInstance = ffmpeg
  return ffmpeg
}

export function useFFmpeg() {
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)

  const concatVideos = useCallback(async (files: File[]): Promise<Blob | null> => {
    if (files.length < 2) return null
    setLoading(true)
    setProgress(0)
    try {
      const ffmpeg = await getFFmpeg()
      ffmpeg.on('progress', ({ progress: p }) => setProgress(Math.round((p ?? 0) * 100)))

      const names = files.map((_, i) => `input${i}.mp4`)
      for (let i = 0; i < files.length; i++) {
        await ffmpeg.writeFile(names[i], await fetchFile(files[i]))
      }

      const listContent = names.map((n) => `file '${n}'`).join('\n')
      await ffmpeg.writeFile('list.txt', listContent)

      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', 'output.mp4'])

      const data = await ffmpeg.readFile('output.mp4')
      const blob = new Blob([data], { type: 'video/mp4' })

      for (const n of names) await ffmpeg.deleteFile(n)
      await ffmpeg.deleteFile('list.txt')
      await ffmpeg.deleteFile('output.mp4')

      return blob
    } catch (err) {
      console.error('FFmpeg error:', err)
      return null
    } finally {
      setLoading(false)
      setProgress(0)
    }
  }, [])

  return { concatVideos, loading, progress }
}
