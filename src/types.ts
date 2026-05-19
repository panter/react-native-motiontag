// Field names mirror the official MotionTag Flutter SDK so payloads are
// interchangeable. `errorCode`, `trackedFrom`, and `trackedTo` on
// `transmissionError` are RN-only extensions exposed by both native sides
// (e.g. lets JS branch on 401 directly).

export type MotionTagEvent =
  | { type: 'started' }
  | { type: 'stopped' }
  | {
      type: 'location'
      timestamp: number
      latitude: number
      longitude: number
      horizontalAccuracy: number
      speed: number
      altitude: number
      bearing: number
    }
  | { type: 'transmissionSuccess'; trackedFrom: number; trackedTo: number }
  | {
      type: 'transmissionError'
      error: string
      errorCode?: number
      trackedFrom?: number
      trackedTo?: number
    }
  | {
      type: 'authorization'
      status: 'granted' | 'denied' | 'restricted' | 'whenInUse'
      precise?: boolean
    }
  | { type: 'powerSaveModeChanged'; enabled: boolean }
  | { type: 'batteryOptimizationsChanged'; enabled: boolean }
  | { type: 'log'; message: string }
