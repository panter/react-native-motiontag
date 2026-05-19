#import <React/RCTEventEmitter.h>

// Codegen protocol conformance (`NativeMotionTagSpec` from
// <RNMotionTagSpec/RNMotionTagSpec.h>) is added in the implementation
// file via a class extension. The codegen header is C++ and tainting
// the public umbrella with it would break Swift module imports for
// MotionTagBootstrap.swift / MotionTagDelegateImpl.swift in this pod.

@interface MotionTagModule : RCTEventEmitter

@end
