package de.motiontag.reactnative

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import de.motiontag.tracker.AutoStartEvent
import de.motiontag.tracker.AutoStopEvent
import de.motiontag.tracker.BatteryOptimizationsChangedEvent
import de.motiontag.tracker.Event
import de.motiontag.tracker.LocationEvent
import de.motiontag.tracker.MotionTag
import de.motiontag.tracker.PowerSaveModeChangedEvent
import de.motiontag.tracker.TransmissionEvent

private const val LOG_TAG = "MotionTag-Tracking"

object MotionTagDelegateImpl : MotionTag.Callback {

  /**
   * Set by [MotionTagModule] when it initializes. Receives a structured
   * `WritableMap` payload for each event. May be null between native init
   * (in [MotionTagBootstrap.init], called from MainApplication.onCreate)
   * and React Native bringing up the MotionTag module — events that fire
   * in that window are dropped (only the diagnostic log line goes to logcat).
   */
  @Volatile
  var eventCallback: ((WritableMap) -> Unit)? = null

  private fun emit(event: WritableMap, log: String) {
    Log.d(LOG_TAG, log)
    eventCallback?.invoke(event)
    val logEvent = Arguments.createMap().apply {
      putString("type", "log")
      putString("message", log)
    }
    eventCallback?.invoke(logEvent)
  }

  private fun emitLog(log: String) {
    Log.d(LOG_TAG, log)
    val logEvent = Arguments.createMap().apply {
      putString("type", "log")
      putString("message", log)
    }
    eventCallback?.invoke(logEvent)
  }

  override fun onEvent(event: Event) {
    when (event) {
      is AutoStartEvent -> emit(
        Arguments.createMap().apply { putString("type", "started") },
        "SDK AutoStart: $event"
      )
      is AutoStopEvent -> emit(
        Arguments.createMap().apply { putString("type", "stopped") },
        "SDK AutoStop: $event"
      )
      is LocationEvent -> {
        val location = event.location
        val payload = Arguments.createMap().apply {
          putString("type", "location")
          putDouble("timestamp", location.time.toDouble())
          putDouble("latitude", location.latitude)
          putDouble("longitude", location.longitude)
          putDouble("horizontalAccuracy", location.accuracy.toDouble())
          putDouble("speed", location.speed.toDouble())
          putDouble("altitude", location.altitude)
          putDouble("bearing", location.bearing.toDouble())
        }
        emit(payload, "SDK Location: $event")
      }
      is TransmissionEvent.Success -> {
        val payload = Arguments.createMap().apply {
          putString("type", "transmissionSuccess")
          putDouble("trackedFrom", event.trackedFrom.toDouble())
          putDouble("trackedTo", event.trackedTo.toDouble())
        }
        emit(payload, "SDK Transmission Success: $event")
      }
      is TransmissionEvent.Error -> {
        // v7 SDK Error reports timestamp + errorCode + errorMessage only;
        // there is no trackedFrom/trackedTo window like Success has.
        val payload = Arguments.createMap().apply {
          putString("type", "transmissionError")
          putString("error", event.errorMessage ?: "Unknown")
          putInt("errorCode", event.errorCode)
        }
        emit(payload, "SDK Transmission Error: $event")
        if (event.errorCode == 401) {
          emitLog("SDK Error - Deactivate Tracking due to Unauthorized token")
          MotionTag.getInstance().stop()
        }
      }
      is BatteryOptimizationsChangedEvent -> {
        val payload = Arguments.createMap().apply {
          putString("type", "batteryOptimizationsChanged")
          putBoolean("enabled", event.isEnabled)
        }
        emit(payload, "SDK Battery Optimizations Changed: $event")
      }
      is PowerSaveModeChangedEvent -> {
        val payload = Arguments.createMap().apply {
          putString("type", "powerSaveModeChanged")
          putBoolean("enabled", event.isEnabled)
        }
        emit(payload, "SDK Power Save Mode Changed: $event")
      }
      else -> emitLog("Other issue $event")
    }
  }
}
