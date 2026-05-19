import CoreLocation
import Foundation
import MotionTagSDK

public typealias MotionTagEventCallback = ([String: Any]) -> Void

@objc public class MotionTagDelegateImpl: NSObject, MotionTagDelegate {

    @objc public static let shared = MotionTagDelegateImpl()

    private let motionTag = MotionTagCore.sharedInstance
    public var eventCallback: MotionTagEventCallback?

    private override init() {}

    @objc public func setUserToken(_ jwt: String) {
        motionTag.userToken = jwt
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

    public func trackingStatusChanged(_ isTracking: Bool) {
        emit(
            ["type": isTracking ? "started" : "stopped"],
            log: "SDK TrackingStatusChanged: \(isTracking)"
        )
    }

    public func locationAuthorizationStatusDidChange(_ status: CLAuthorizationStatus, precise: Bool) {
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
            ["type": "authorization", "status": statusString, "precise": precise],
            log: "SDK CLAuthorizationStatus: \(status.rawValue) precise: \(precise)"
        )
    }

    public func motionActivityAuthorized(_ authorized: Bool) {
        emitLog("SDK MotionActivityAuthorized: \(authorized)")
    }

    public func didTrackLocation(_ location: CLLocation) {
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

    public func dataUploadWithTracked(from startDate: Date, to endDate: Date, didCompleteWithError error: Error?) {
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
