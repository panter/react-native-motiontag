package de.motiontag.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter
import de.motiontag.tracker.MotionTag

class MotionTagModule(reactContext: ReactApplicationContext) :
  NativeMotionTagSpec(reactContext) {

  private val motionTag: MotionTag by lazy { MotionTag.getInstance() }

  override fun getName(): String = NAME

  override fun initialize() {
    super.initialize()
    MotionTagDelegateImpl.eventCallback = { event ->
      reactApplicationContext
        .getJSModule(RCTDeviceEventEmitter::class.java)
        .emit("MotionTagEvent", event)
    }
  }

  override fun invalidate() {
    MotionTagDelegateImpl.eventCallback = null
    super.invalidate()
  }

  override fun start(promise: Promise) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      try {
        motionTag.start()
        promise.resolve(null)
      } catch (e: Throwable) {
        promise.reject("E_START", e)
      }
    }
  }

  override fun stop(promise: Promise) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      try {
        motionTag.stop()
        promise.resolve(null)
      } catch (e: Throwable) {
        promise.reject("E_STOP", e)
      }
    }
  }

  override fun setUserToken(jwt: String, promise: Promise) {
    motionTag.userToken = jwt
    promise.resolve(null)
  }

  override fun getUserToken(promise: Promise) {
    promise.resolve(motionTag.userToken)
  }

  override fun isTrackingActive(promise: Promise) {
    promise.resolve(motionTag.isTrackingActive)
  }

  override fun isPowerSaveModeEnabled(promise: Promise) {
    promise.resolve(motionTag.isPowerSaveModeEnabled)
  }

  override fun isBatteryOptimizationsEnabled(promise: Promise) {
    promise.resolve(motionTag.isBatteryOptimizationsEnabled)
  }

  override fun getWifiOnlyDataTransfer(promise: Promise) {
    promise.resolve(motionTag.wifiOnlyDataTransfer)
  }

  override fun setWifiOnlyDataTransfer(wifiOnly: Boolean, promise: Promise) {
    motionTag.wifiOnlyDataTransfer = wifiOnly
    promise.resolve(null)
  }

  override fun clearData(promise: Promise) {
    try {
      motionTag.clearData {
        promise.resolve(null)
      }
    } catch (e: Throwable) {
      promise.reject("E_CLEAR", e)
    }
  }

  override fun addListener(eventName: String) {
    // RCTDeviceEventEmitter manages subscriptions; no-op on the native side.
  }

  override fun removeListeners(count: Double) {
    // RCTDeviceEventEmitter manages subscriptions; no-op on the native side.
  }

  companion object {
    const val NAME = "MotionTag"
  }
}
