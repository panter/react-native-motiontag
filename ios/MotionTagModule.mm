#import "MotionTagModule.h"

#import <React/RCTLog.h>
// Import the SDK before the Swift bridge so the bridge's reference to
// MotionTagDelegate (used as a protocol conformance on
// MotionTagDelegateImpl) is satisfied.
#import <MotionTagSDK/MotionTagSDK.h>
#import "RNMotionTag-Swift.h"
#import <RNMotionTagSpec/RNMotionTagSpec.h>

// Codegen protocol conformance lives here, not on the public @interface,
// so the pod's Swift module can be built without ingesting the C++ codegen
// header through the umbrella.
@interface MotionTagModule () <NativeMotionTagSpec>
@end

@implementation MotionTagModule {
    BOOL _hasListeners;
}

RCT_EXPORT_MODULE(MotionTag)

- (NSArray<NSString *> *)supportedEvents
{
    return @[@"MotionTagEvent"];
}

- (void)startObserving
{
    _hasListeners = YES;
    __weak __typeof(self) weakSelf = self;
    [MotionTagDelegateImpl.shared setEventCallback:^(NSDictionary<NSString *, id> *event) {
        __strong __typeof(weakSelf) strongSelf = weakSelf;
        if (strongSelf && strongSelf->_hasListeners) {
            [strongSelf sendEventWithName:@"MotionTagEvent" body:event];
        }
    }];
}

- (void)stopObserving
{
    _hasListeners = NO;
}

#pragma mark - NativeMotionTagSpec

- (void)start:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [MotionTagDelegateImpl.shared startTracking];
        resolve(nil);
    });
}

- (void)stop:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    dispatch_async(dispatch_get_main_queue(), ^{
        [MotionTagDelegateImpl.shared stopTracking];
        resolve(nil);
    });
}

- (void)setUserToken:(NSString *)jwt
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
    [MotionTagDelegateImpl.shared setUserToken:jwt];
    resolve(nil);
}

- (void)getUserToken:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    // MotionTag iOS SDK v6 does not expose a public getUserToken API.
    // Resolve to nil so JS callers can detect "not implemented on this platform".
    resolve([NSNull null]);
}

- (void)isTrackingActive:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    resolve(@([MotionTagDelegateImpl.shared isTrackingActive]));
}

- (void)isPowerSaveModeEnabled:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    // Android-only. Resolve false on iOS to match Flutter SDK parity.
    resolve(@NO);
}

- (void)isBatteryOptimizationsEnabled:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    // Android-only. Resolve false on iOS to match Flutter SDK parity.
    resolve(@NO);
}

- (void)getWifiOnlyDataTransfer:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    // Not exposed by the v6 iOS SDK; return false until v7 migration.
    resolve(@NO);
}

- (void)setWifiOnlyDataTransfer:(BOOL)wifiOnly
                        resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject
{
    reject(@"UNSUPPORTED", @"setWifiOnlyDataTransfer is not supported on iOS (MotionTag SDK v6).", nil);
}

- (void)clearData:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
    reject(@"UNSUPPORTED", @"clearData is not supported on iOS (MotionTag SDK v6).", nil);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeMotionTagSpecJSI>(params);
}

@end
