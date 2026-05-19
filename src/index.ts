import { type EventSubscription, NativeEventEmitter, NativeModules } from 'react-native'

import NativeMotionTag from './NativeMotionTag'
import type { MotionTagEvent } from './types'

const emitter = new NativeEventEmitter(NativeModules.MotionTag)

export const MotionTag = {
  start: () => NativeMotionTag.start(),
  stop: () => NativeMotionTag.stop(),

  setUserToken: (jwt: string) => NativeMotionTag.setUserToken(jwt),
  getUserToken: () => NativeMotionTag.getUserToken(),

  isTrackingActive: () => NativeMotionTag.isTrackingActive(),
  isPowerSaveModeEnabled: () => NativeMotionTag.isPowerSaveModeEnabled(),
  isBatteryOptimizationsEnabled: () => NativeMotionTag.isBatteryOptimizationsEnabled(),

  getWifiOnlyDataTransfer: () => NativeMotionTag.getWifiOnlyDataTransfer(),
  setWifiOnlyDataTransfer: (wifiOnly: boolean) =>
    NativeMotionTag.setWifiOnlyDataTransfer(wifiOnly),

  clearData: () => NativeMotionTag.clearData(),

  addListener: (cb: (event: MotionTagEvent) => void): EventSubscription =>
    emitter.addListener('MotionTagEvent', cb),
}

export type { MotionTagEvent } from './types'
export default MotionTag
