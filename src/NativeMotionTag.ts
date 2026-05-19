import { type TurboModule, TurboModuleRegistry } from 'react-native'

export interface Spec extends TurboModule {
  start(): Promise<void>
  stop(): Promise<void>

  setUserToken(jwt: string): Promise<void>
  getUserToken(): Promise<string | null>

  isTrackingActive(): Promise<boolean>
  isPowerSaveModeEnabled(): Promise<boolean>
  isBatteryOptimizationsEnabled(): Promise<boolean>

  getWifiOnlyDataTransfer(): Promise<boolean>
  setWifiOnlyDataTransfer(wifiOnly: boolean): Promise<void>

  clearData(): Promise<void>

  addListener(eventName: string): void
  removeListeners(count: number): void
}

export default TurboModuleRegistry.getEnforcing<Spec>('MotionTag')
