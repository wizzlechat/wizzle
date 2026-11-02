import ExpoModulesCore
import Speech

public class WizzlePrivacyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WizzlePrivacy")

    // Each named Documents folder leaves iCloud and Finder backups and is unreadable while the phone is locked.
    AsyncFunction("protectFolders") { (names: [String]) throws in
      let documents = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
      for name in names where !name.isEmpty && !name.contains("/") && name != "." && name != ".." {
        try protectFolder(documents.appendingPathComponent(name, isDirectory: true))
      }
    }

    // The supported identifier for lang, matched the way expo-speech-recognition matches it, only if it runs on the device.
    Function("onDeviceSpeechLocale") { (lang: String) -> String? in
      let supported = SFSpeechRecognizer.supportedLocales()
      for identifier in [lang, lang.replacingOccurrences(of: "_", with: "-")] where supported.contains(where: { $0.identifier == identifier }) {
        let onDevice = SFSpeechRecognizer(locale: Locale(identifier: identifier))?.supportsOnDeviceRecognition ?? false
        return onDevice ? identifier : nil
      }
      return nil
    }
  }
}

// Exclusion on the folder covers its contents; new items inherit the folder's protection, existing ones get it here.
private func protectFolder(_ folder: URL) throws {
  let files = FileManager.default
  try files.createDirectory(at: folder, withIntermediateDirectories: true)
  var url = folder
  var values = URLResourceValues()
  values.isExcludedFromBackup = true
  try url.setResourceValues(values)
  let complete: [FileAttributeKey: Any] = [.protectionKey: FileProtectionType.complete]
  try files.setAttributes(complete, ofItemAtPath: folder.path)
  guard let walker = files.enumerator(at: folder, includingPropertiesForKeys: nil) else { return }
  for case let item as URL in walker {
    try files.setAttributes(complete, ofItemAtPath: item.path)
  }
}
