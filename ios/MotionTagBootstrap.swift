import Foundation
import MotionTagSDK
import UIKit

@objc public class MotionTagBootstrap: NSObject {

    /// Initialise the MotionTag SDK. Must be called from `application(_:didFinishLaunchingWithOptions:)`
    /// before React Native starts up — Turbo Modules are instantiated lazily on first JS access
    /// and cannot run pre-RN init themselves.
    @MainActor
    @objc public static func bootstrap(launchOptions: [UIApplication.LaunchOptionsKey: Any]?) {
        MotionTagCore.sharedInstance.initialize(
            using: MotionTagDelegateImpl.shared,
            launchOptions: launchOptions
        )
    }

    /// Forward background URL session events so the SDK can finish background uploads on
    /// cold-launch wake-ups. Suspends until the SDK's pending events have been delivered.
    ///
    /// Prefer this over the completion-handler form: a host that owns other background URL
    /// sessions can `await` each SDK in turn from a single
    /// `application(_:handleEventsForBackgroundURLSession:) async` override, and UIKit invokes
    /// the underlying completion handler exactly once when that override returns.
    @MainActor
    public static func processBackgroundSessionEvents(identifier: String) async {
        await MotionTagCore.sharedInstance.processBackgroundSessionEvents(with: identifier)
    }

    /// Completion-handler form, for hosts that cannot use the `async` override — notably Expo:
    /// `ExpoAppDelegate` declares `application(_:handleEventsForBackgroundURLSession:completionHandler:)`
    /// in Swift, and Swift only synthesises the `async` spelling for Objective-C declarations.
    ///
    /// Unlike SDK v6, the SDK no longer receives the handler and can no longer decide whether an
    /// identifier is one of its own, so this calls `completionHandler` for *every* identifier.
    /// A host that owns other background URL sessions must therefore ensure the handler is
    /// invoked exactly once — chain them, don't call it from each.
    @MainActor
    @objc public static func processBackgroundSessionEvents(
        identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        Task { @MainActor in
            await processBackgroundSessionEvents(identifier: identifier)
            completionHandler()
        }
    }
}
