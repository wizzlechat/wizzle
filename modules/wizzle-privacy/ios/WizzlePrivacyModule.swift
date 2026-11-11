import AVFoundation
import ExpoModulesCore
import Speech

public class WizzlePrivacyModule: Module {
  private let reader = Reader()

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

    // Reads text aloud with the phone's own voices; settles when it ends, is stopped or the next one starts.
    AsyncFunction("speak") { (text: String, promise: Promise) in
      reader.speak(text, promise)
    }.runOnQueue(.main)

    AsyncFunction("stopSpeaking") {
      reader.stop()
    }.runOnQueue(.main)

    OnAppEntersBackground {
      reader.stop()
    }
  }
}

// One utterance at a time in the playback category, so it plays with the Silent switch on.
private final class Reader: NSObject, AVSpeechSynthesizerDelegate {
  private let synthesizer = AVSpeechSynthesizer()
  private var utterance: AVSpeechUtterance?
  private var promise: Promise?

  override init() {
    super.init()
    synthesizer.usesApplicationAudioSession = true
    synthesizer.delegate = self
  }

  func speak(_ text: String, _ next: Promise) {
    settle()
    synthesizer.stopSpeaking(at: .immediate)
    do {
      let session = AVAudioSession.sharedInstance()
      try session.setCategory(.playback)
      try session.setActive(true)
    } catch {
      next.reject(error)
      return
    }
    let spoken = AVSpeechUtterance(string: text)
    spoken.voice = bestVoice()
    utterance = spoken
    promise = next
    synthesizer.speak(spoken)
  }

  // The session is released once the synthesizer reports the cancel.
  func stop() {
    settle()
    synthesizer.stopSpeaking(at: .immediate)
  }

  private func settle() {
    promise?.resolve()
    promise = nil
  }

  private func ended(_ done: AVSpeechUtterance) {
    guard done === utterance else { return }
    utterance = nil
    settle()
    // Audio another app paused for this one resumes.
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    DispatchQueue.main.async { self.ended(utterance) }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    DispatchQueue.main.async { self.ended(utterance) }
  }
}

// The best installed voice for the phone's language: premium, then enhanced, then default, novelty voices left out.
private func bestVoice() -> AVSpeechSynthesisVoice? {
  let language = AVSpeechSynthesisVoice.currentLanguageCode()
  let base = language.split(separator: "-").first.map(String.init) ?? language
  let preferred = AVSpeechSynthesisVoice(language: language)
  let voices = AVSpeechSynthesisVoice.speechVoices().filter { !isNovelty($0) }
  let exact = voices.filter { $0.language == language }
  let candidates = exact.isEmpty ? voices.filter { $0.language == base || $0.language.hasPrefix(base + "-") } : exact
  return candidates.max { rank($0, preferred) < rank($1, preferred) } ?? preferred
}

// Quality first; on a tie the system's own voice for the language wins.
private func rank(_ voice: AVSpeechSynthesisVoice, _ preferred: AVSpeechSynthesisVoice?) -> Int {
  let quality: Int
  switch voice.quality {
  case .premium: quality = 3
  case .enhanced: quality = 2
  default: quality = 1
  }
  return quality * 2 + (voice.identifier == preferred?.identifier ? 1 : 0)
}

private func isNovelty(_ voice: AVSpeechSynthesisVoice) -> Bool {
  if #available(iOS 17.0, *) { return voice.voiceTraits.contains(.isNoveltyVoice) }
  return false
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
