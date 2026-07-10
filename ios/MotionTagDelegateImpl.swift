import CoreLocation
import Foundation
import MotionTagSDK

public typealias MotionTagEventCallback = ([String: Any]) -> Void

/// `MotionTagDelegate` is `@MainActor` and refines `Sendable`, so this type must be main-actor
/// isolated — a plain `NSObject` holding a mutable `eventCallback` is not `Sendable`. Every
/// `@objc` entry point below must therefore be called from the main queue.
@objc @MainActor public class MotionTagDelegateImpl: NSObject, MotionTagDelegate {

    @objc public static let shared = MotionTagDelegateImpl()

    /// `var`, not `let`: `MotionTag` is not class-constrained, so the compiler treats a write
    /// through the existential as a mutation of the binding. The conforming type is a reference
    /// type (`start()`/`stop()` are non-mutating yet change SDK state), so writes still land on
    /// the shared instance rather than on a copy.
    private var motionTag = MotionTagCore.sharedInstance
    public var eventCallback: MotionTagEventCallback?

    private override init() {}

    @objc public func setUserToken(_ jwt: String) {
        motionTag.userToken = jwt
    }

    @objc public func getUserToken() -> String? {
        return motionTag.userToken
    }

    @objc public func startTracking() {
        motionTag.start()
    }

    @objc public func stopTracking() {
        motionTag.stop()
    }

    @objc public func isTrackingActive() -> Bool {
        return motionTag.isTrackingActive
    }

    @objc public func getWifiOnlyDataTransfer() -> Bool {
        return motionTag.wifiOnlyDataTransfer
    }

    @objc public func setWifiOnlyDataTransfer(_ wifiOnly: Bool) {
        motionTag.wifiOnlyDataTransfer = wifiOnly
    }

    /// Returns the number of cleared records, which the JS contract discards.
    @discardableResult
    @objc public func clearData() -> Int {
        return motionTag.clearData()
    }

    @objc public func setEventCallback(_ callback: @escaping MotionTagEventCallback) {
        eventCallback = callback
    }

    private func emit(_ event: [String: Any], log: String) {
        eventCallback?(event)
        eventCallback?(["type": "log", "message": log])
    }

    private func emitLog(_ message: String) {
        eventCallback?(["type": "log", "message": message])
    }

    // MARK: - MotionTagDelegate

    public func trackingDidChange(isTracking: Bool) {
        emit(
            ["type": isTracking ? "started" : "stopped"],
            log: "SDK TrackingStatusChanged: \(isTracking)"
        )
    }

    public func locationAuthorizationDidChange(status: CLAuthorizationStatus, isPrecise: Bool) {
        let statusString: String
        switch status {
        case .authorizedAlways: statusString = "granted"
        case .authorizedWhenInUse: statusString = "whenInUse"
        case .denied: statusString = "denied"
        case .restricted: statusString = "restricted"
        case .notDetermined: statusString = "denied"
        @unknown default: statusString = "denied"
        }
        emit(
            ["type": "authorization", "status": statusString, "precise": isPrecise],
            log: "SDK CLAuthorizationStatus: \(status.rawValue) precise: \(isPrecise)"
        )
    }

    public func motionActivityAuthorizationDidChange(isAuthorized: Bool) {
        emitLog("SDK MotionActivityAuthorized: \(isAuthorized)")
    }

    public func didUpdateLocation(_ location: CLLocation) {
        emit(
            [
                "type": "location",
                "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
                "latitude": location.coordinate.latitude,
                "longitude": location.coordinate.longitude,
                "horizontalAccuracy": location.horizontalAccuracy,
                "speed": location.speed,
                "altitude": location.altitude,
                "bearing": location.course,
            ],
            log: "SDK Location: \(location)"
        )
    }

    public func dataUploadDidComplete(from startDate: Date, to endDate: Date, error: Error?) {
        let trackedFromMs = startDate.timeIntervalSince1970 * 1000
        let trackedToMs = endDate.timeIntervalSince1970 * 1000

        if let error = error as NSError? {
            emit(
                [
                    "type": "transmissionError",
                    "error": error.localizedDescription,
                    "errorCode": error.code,
                    "trackedFrom": trackedFromMs,
                    "trackedTo": trackedToMs,
                ],
                log: "SDK Transmission Error - startDate: \(startDate), endDate: \(endDate) \(error.localizedDescription)"
            )
            if error.code == 401 {
                emitLog("SDK Error - Deactivate Tracking due to Unauthorized token")
                stopTracking()
            }
        } else {
            emit(
                [
                    "type": "transmissionSuccess",
                    "trackedFrom": trackedFromMs,
                    "trackedTo": trackedToMs,
                ],
                log: "SDK Transmission Success - startDate: \(startDate), endDate: \(endDate)"
            )
        }
    }
}
