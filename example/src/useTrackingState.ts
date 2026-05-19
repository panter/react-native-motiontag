import { useEffect, useState } from 'react'
import MotionTag, { type MotionTagEvent } from '@panter/react-native-motiontag'

export function useTrackingState(): {
  active: boolean
  refresh: () => Promise<void>
} {
  const [active, setActive] = useState(false)

  const refresh = async () => {
    try {
      setActive(await MotionTag.isTrackingActive())
    } catch {
      // ignore — native side may not be ready yet
    }
  }

  useEffect(() => {
    void refresh()
    const sub = MotionTag.addListener((event: MotionTagEvent) => {
      if (event.type === 'started') setActive(true)
      else if (event.type === 'stopped') setActive(false)
    })
    return () => sub.remove()
  }, [])

  return { active, refresh }
}
