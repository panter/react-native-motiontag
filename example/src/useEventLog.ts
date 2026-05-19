import { useEffect, useRef, useState } from 'react'
import MotionTag, { type MotionTagEvent } from '@panter/react-native-motiontag'

export type LogEntry = {
  id: number
  time: string
  type: MotionTagEvent['type']
  payload: string
}

const MAX_ENTRIES = 50

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return `${h}:${m}:${s}`
}

function payloadPreview(event: MotionTagEvent): string {
  const { type: _t, ...rest } = event as MotionTagEvent & { type: string }
  const keys = Object.keys(rest)
  if (keys.length === 0) return ''
  return JSON.stringify(rest)
}

export function useEventLog(): LogEntry[] {
  const buffer = useRef<LogEntry[]>([])
  const nextId = useRef(0)
  const [, force] = useState(0)

  useEffect(() => {
    const sub = MotionTag.addListener((event: MotionTagEvent) => {
      const entry: LogEntry = {
        id: nextId.current++,
        time: formatTime(new Date()),
        type: event.type,
        payload: payloadPreview(event),
      }
      const next = [entry, ...buffer.current]
      if (next.length > MAX_ENTRIES) next.length = MAX_ENTRIES
      buffer.current = next
      force((n) => n + 1)
    })
    return () => sub.remove()
  }, [])

  return buffer.current
}
