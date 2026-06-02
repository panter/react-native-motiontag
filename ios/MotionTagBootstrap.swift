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

    /// Forward background URL session events so the SDK can finish background uploads on
    /// cold-launch wake-ups. Call from `application(_:handleEventsForBackgroundURLSession:completionHandler:)`
    /// with every identifier, unconditionally — the SDK decides internally which sessions are its own
    /// (matches the MotionTag iOS guide and the official Flutter SDK's AppDelegate).
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
