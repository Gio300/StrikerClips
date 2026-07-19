import { useCallback, useEffect, useState } from 'react'
import {
  readTray,
  addToTray,
  removeFromTray,
  clearTray,
  subscribeTray,
  type TrayItem,
  type TraySource,
} from '@/lib/clipTray'

/**
 * Live view of the shared Clip Tray. Any surface that mounts this re-renders
 * when a clip is stashed or pulled from anywhere else in the app.
 */
export function useClipTray() {
  const [items, setItems] = useState<TrayItem[]>(() => readTray())

  useEffect(() => subscribeTray(() => setItems(readTray())), [])

  const add = useCallback(
    (input: { url: string; title?: string; source?: TraySource; fromHost?: string }) => {
      setItems(addToTray(input))
    },
    [],
  )
  const remove = useCallback((id: string) => setItems(removeFromTray(id)), [])
  const clear = useCallback(() => { clearTray(); setItems([]) }, [])

  return { items, add, remove, clear, count: items.length }
}
