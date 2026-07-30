import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useCameraStream — self-add your own camera/mic to the broadcast via
 * `navigator.mediaDevices.getUserMedia`. This is the "Go on camera" path for a
 * host or player who isn't running OBS.
 *
 *   • start()      — prompt for camera + mic, keep the MediaStream live.
 *   • stop()       — stop every track and drop the stream.
 *   • toggleCam()  — enable/disable the video track ("camera off = voice only").
 *   • toggleMic()  — enable/disable the audio track (mute/unmute).
 *
 * Tracks are toggled via `track.enabled` (not stop/re-acquire) so flipping the
 * camera off keeps the mic hot and doesn't re-trigger the permission prompt.
 * The stream is cleaned up on unmount.
 */
export interface CameraStreamApi {
  stream: MediaStream | null
  /** True once a stream is live (the user granted access). */
  active: boolean
  camOn: boolean
  micOn: boolean
  starting: boolean
  error: string | null
  start: () => Promise<void>
  stop: () => void
  toggleCam: () => void
  toggleMic: () => void
}

function humanizeMediaError(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera/mic permission was blocked. Allow access and try again.'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera or mic found on this device.'
  }
  if (name === 'NotReadableError') {
    return 'Your camera is already in use by another app.'
  }
  const msg = err instanceof Error ? err.message : String(err)
  return msg || 'Could not start the camera.'
}

export function useCameraStream(): CameraStreamApi {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [camOn, setCamOn] = useState(true)
  const [micOn, setMicOn] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => { try { t.stop() } catch { /* ignore */ } })
    streamRef.current = null
    setStream(null)
    setError(null)
  }, [])

  const start = useCallback(async () => {
    setError(null)
    const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined
    if (!md?.getUserMedia) {
      setError('Camera/mic aren\'t available in this browser.')
      return
    }
    setStarting(true)
    try {
      const s = await md.getUserMedia({ video: true, audio: true })
      streamRef.current = s
      // Apply the current toggle state to the fresh tracks.
      s.getVideoTracks().forEach((t) => { t.enabled = camOn })
      s.getAudioTracks().forEach((t) => { t.enabled = micOn })
      setStream(s)
    } catch (err) {
      setError(humanizeMediaError(err))
    } finally {
      setStarting(false)
    }
  }, [camOn, micOn])

  const toggleCam = useCallback(() => {
    setCamOn((v) => {
      const next = !v
      streamRef.current?.getVideoTracks().forEach((t) => { t.enabled = next })
      return next
    })
  }, [])

  const toggleMic = useCallback(() => {
    setMicOn((v) => {
      const next = !v
      streamRef.current?.getAudioTracks().forEach((t) => { t.enabled = next })
      return next
    })
  }, [])

  // Clean up the stream when the component using the hook unmounts.
  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => { try { t.stop() } catch { /* ignore */ } })
  }, [])

  return {
    stream,
    active: !!stream,
    camOn,
    micOn,
    starting,
    error,
    start,
    stop,
    toggleCam,
    toggleMic,
  }
}
