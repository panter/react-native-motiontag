import Foundation
import MotionTagSDK
import UIKit

@objc public class MotionTagBootstrap: NSObject {

    /// Initialise the MotionTag SDK. Must be called from `application(_:didFinishLaunchingWithOptions:)`
    /// before React Native starts up — Turbo Modules are instantiated lazily on first JS access
    /// and cannot run pre-RN init themselves.
    @objc public static func bootstrap(launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        MotionTagCore.sharedInstance.initialize(
            using: MotionTagDelegateImpl.shared,
            launchOption: launchOptions
        )
    }

    /// Whether the given background URL session belongs to the MotionTag SDK. Use this in
    /// `application(_:handleEventsForBackgroundURLSession:completionHandler:)` to decide whether
    /// to forward the event to `processBackgroundSessionEvents(identifier:completionHandler:)` or
    /// to the host's other background-session owners (e.g. Expo modules, Firebase) — each session's
    /// completion handler must be called exactly once, by exactly one owner.
    @objc public static func handlesBackgroundURLSession(identifier: String) -> Bool {
        return identifier.hasPrefix("com.motion-tag.") || identifier.hasPrefix("com.motiontag.")
    }

    /// Forward background URL session events so the SDK can finish background uploads on
    /// cold-launch wake-ups. Call from `application(_:handleEventsForBackgroundURLSession:completionHandler:)`.
    @objc public static func processBackgroundSessionEvents(
        identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        MotionTagCore.sharedInstance.processBackgroundSessionEvents(
            with: identifier,
            completionHandler: completionHandler
        )
    }
}
