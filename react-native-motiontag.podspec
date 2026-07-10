require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "react-native-motiontag"
  s.module_name  = "RNMotionTag"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/panter/react-native-motiontag"
  s.license      = "MIT"
  s.authors      = "Jay Péclard"

  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "https://github.com/panter/react-native-motiontag.git", :tag => "#{s.version}" }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.requires_arc = true
  s.swift_versions = ["5.0"]

  s.dependency "MotionTagSDK", "~> 7.0.0"

  install_modules_dependencies(s)
end
