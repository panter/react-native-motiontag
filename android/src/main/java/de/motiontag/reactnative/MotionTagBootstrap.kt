package de.motiontag.reactnative

import android.app.Application
import android.app.Notification
import de.motiontag.tracker.MotionTag

object MotionTagBootstrap {

  /**
   * Initialise the MotionTag SDK. Must be called from
   * [Application.onCreate] before React Native loads — Turbo Modules are
   * instantiated lazily on first JS access and cannot run pre-RN init
   * themselves.
   *
   * The host owns the foreground-service [Notification] (channel id, copy,
   * icon) — pass it in. Tracking will keep this notification visible for as
   * long as the SDK's foreground service is running.
   */
  @JvmStatic
  fun init(application: Application, notification: Notification) {
    MotionTag.getInstance().initialize(application, notification, MotionTagDelegateImpl)
  }
}
