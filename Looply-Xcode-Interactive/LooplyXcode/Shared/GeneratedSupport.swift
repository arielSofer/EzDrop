import SwiftUI
import SQLite3

/// Native hour:minute wheels bound to two string state variables.
/// iOS shows wheels; watchOS uses its default crown-driven pickers.
struct GeneratedTimePicker: View {
    @Binding var hour: String
    @Binding var minute: String

    var body: some View {
        HStack(spacing: 2) {
            Picker("", selection: Binding(
                get: { Int(hour) ?? 6 },
                set: { hour = String($0) })) {
                ForEach(0..<24, id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
            }
            .labelsHidden()
            Text(":").font(.headline)
            Picker("", selection: Binding(
                get: { Int(minute) ?? 0 },
                set: { minute = String(format: "%02d", $0) })) {
                ForEach(0..<60, id: \.self) { Text(String(format: "%02d", $0)).tag($0) }
            }
            .labelsHidden()
        }
        #if os(iOS)
        .pickerStyle(.wheel)
        #endif
    }
}

/// String-level JSON-array append: deterministic formatting so string
/// matching (contains / replace) works reliably on the stored list.
enum GeneratedJSONList {
    static func appending(_ list: String, item: String) -> String {
        var trimmed = list.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.hasPrefix("[") { trimmed = "[]" }
        return trimmed == "[]" ? "[\(item)]" : String(trimmed.dropLast()) + ",\(item)]"
    }
}

/// Clean text rendering for number state: whole values print "47",
/// not "47.0"; fractional values keep their decimals.
enum GeneratedNumber {
    static func clean(_ value: Double) -> String {
        value.truncatingRemainder(dividingBy: 1) == 0
            ? String(Int(value)) : String(value)
    }
    static func clean(_ value: String) -> String { value }
}

enum GeneratedAssetMap {
    static let byPath: [String: String] = [:]
}

#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
#if canImport(WatchKit)
import WatchKit
#endif
#if canImport(AVFoundation)
import AVFoundation
#endif
#if canImport(UserNotifications)
import UserNotifications
#endif

enum GeneratedHaptics {
    static func play() {
        #if os(watchOS)
        WKInterfaceDevice.current().play(.click)
        #elseif os(iOS)
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        #endif
    }
}

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let r, g, b, a: UInt64
        switch cleaned.count {
        case 8: (r, g, b, a) = ((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff)
        case 6: (r, g, b, a) = ((value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff, 255)
        default: (r, g, b, a) = (17, 24, 39, 255)
        }
        self.init(.sRGB, red: Double(r) / 255, green: Double(g) / 255, blue: Double(b) / 255, opacity: Double(a) / 255)
    }
}



// Backs Image nodes targeted by a Set Image block: shows a remote
// URL once one is set, otherwise the gray placeholder the canvas
// itself falls back to for unresolved images.
struct DynamicRemoteImage: View {
    let source: String

    // Self-contained (doesn't depend on the conditionally-generated
    // GeneratedImage/GeneratedResources, since this view is always
    // emitted even for exports with no static image assets):
    // resolves a bundled resource name the same way GeneratedImage
    // does, for the common case of swapping between two *local*
    // images (e.g. Set Image pointed at another design asset).
    private static func bundledImage(named rawName: String) -> Image? {
        // A dynamic source may be an original design-time file path
        // (from a list item); map it to its bundled resource name.
        let name = GeneratedAssetMap.byPath[rawName] ?? rawName
        let bundle = Bundle.main.resourceURL
            .flatMap { url in Bundle.allBundles.first { $0.bundleURL.path.hasPrefix(url.path) && $0 != Bundle.main } }
            ?? Bundle.main
        guard let url = bundle.url(forResource: name, withExtension: nil) else { return nil }
        #if canImport(UIKit)
        return UIImage(contentsOfFile: url.path).map { Image(uiImage: $0) }
        #elseif canImport(AppKit)
        return NSImage(contentsOf: url).map { Image(nsImage: $0) }
        #else
        return nil
        #endif
    }

    var body: some View {
        if source.hasPrefix("http://") || source.hasPrefix("https://"), let url = URL(string: source) {
            AsyncImage(url: url) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.gray.opacity(0.2)
            }
        } else if let bundled = Self.bundledImage(named: source) {
            bundled.resizable().scaledToFill()
        } else {
            Color.gray.opacity(0.2)
        }
    }
}

enum GeneratedClipboard {
    static func copy(_ text: String) {
        #if os(iOS)
        UIPasteboard.general.string = text
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        #endif
    }
}

enum GeneratedSound {
    #if canImport(AVFoundation)
    private static var player: AVAudioPlayer?
    #endif

    static func play(_ file: String) {
        #if canImport(AVFoundation)
        let base = (file as NSString).deletingPathExtension
        let ext = (file as NSString).pathExtension
        guard let url = Bundle.main.url(forResource: base, withExtension: ext.isEmpty ? nil : ext)
            ?? GeneratedResourcesLookup.bundle?.url(forResource: base, withExtension: ext.isEmpty ? nil : ext)
        else {
            print("Play Sound: '\(file)' not found in the app's Resources.")
            return
        }
        player = try? AVAudioPlayer(contentsOf: url)
        player?.play()
        #endif
    }

    static func stop() {
        #if canImport(AVFoundation)
        player?.stop()
        stopRinging()
        #endif
    }

    #if canImport(AVFoundation)
    private static var ringEngine: AVAudioEngine?
    private static var ringTimer: Timer?
    #endif

    /// Looping synthesized alarm ring — no sound asset required.
    /// Styles: classic (double chirp), beep (fast high), pulse (slow low).
    static func startRinging(_ style: String, autoStop: Double = 0) {
        #if canImport(AVFoundation)
        stopRinging()
        if autoStop > 0 {
            // Preview mode: ring briefly, then stop on our own.
            DispatchQueue.main.asyncAfter(deadline: .now() + autoStop) { stopRinging() }
        }
        let frequency: Double
        let onDuration: Double
        let offDuration: Double
        switch style.lowercased() {
        case "beep":  frequency = 1318; onDuration = 0.12; offDuration = 0.12
        case "pulse": frequency = 659;  onDuration = 0.45; offDuration = 0.35
        default:      frequency = 880;  onDuration = 0.22; offDuration = 0.14
        }
        let engine = AVAudioEngine()
        let sampleRate = engine.outputNode.outputFormat(forBus: 0).sampleRate
        var phase: Double = 0
        let source = AVAudioSourceNode { _, _, frameCount, audioBufferList -> OSStatus in
            let ablPointer = UnsafeMutableAudioBufferListPointer(audioBufferList)
            let increment = 2.0 * Double.pi * frequency / sampleRate
            for frame in 0..<Int(frameCount) {
                let sample = Float(sin(phase)) * 0.6
                phase += increment
                if phase > 2.0 * Double.pi { phase -= 2.0 * Double.pi }
                for buffer in ablPointer {
                    buffer.mData?.assumingMemoryBound(to: Float.self)[frame] = sample
                }
            }
            return noErr
        }
        engine.attach(source)
        engine.connect(source, to: engine.mainMixerNode, format: nil)
        engine.mainMixerNode.outputVolume = 1
        try? engine.start()
        ringEngine = engine
        // Gate the tone on/off for the ring pattern.
        var isOn = true
        ringTimer = Timer.scheduledTimer(withTimeInterval: onDuration, repeats: true) { timer in
            isOn.toggle()
            ringEngine?.mainMixerNode.outputVolume = isOn ? 1 : 0
            timer.fireDate = Date().addingTimeInterval(isOn ? onDuration : offDuration)
        }
        #endif
    }

    static func stopRinging() {
        #if canImport(AVFoundation)
        ringTimer?.invalidate()
        ringTimer = nil
        ringEngine?.stop()
        ringEngine = nil
        #endif
    }
}

// Points sound lookups at the same resource bundle images use, when
// this export has one (see GeneratedResources in the image support
// file). Kept separate so sound-only exports don't need an image.
enum GeneratedResourcesLookup {
    static var bundle: Bundle? {
        #if canImport(UIKit)
        Bundle.main.resourceURL.flatMap { url in
            Bundle.allBundles.first { $0.bundleURL.path.hasPrefix(url.path) && $0 != Bundle.main }
        } ?? Bundle.main
        #else
        Bundle.main
        #endif
    }
}

enum GeneratedNotifications {
    static func schedule(title: String, body: String, seconds: Double) {
        #if canImport(UserNotifications)
        let content = UNMutableNotificationContent()
        content.title = title
        if !body.isEmpty { content.body = body }
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: max(1, seconds), repeats: false)
        let request = UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: trigger)
        UNUserNotificationCenter.current().add(request)
        #endif
    }

    /// A real alarm: daily calendar-triggered notification at hour:minute.
    /// Requests permission on first use; replaces any prior alarm.
    static func scheduleAt(title: String, body: String, hour: String, minute: String) {
        #if canImport(UserNotifications)
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            var comps = DateComponents()
            comps.hour = Int(hour) ?? 6
            comps.minute = Int(minute) ?? 0
            let content = UNMutableNotificationContent()
            content.title = title
            if !body.isEmpty { content.body = body }
            content.sound = .default
            let trigger = UNCalendarNotificationTrigger(dateMatching: comps, repeats: true)
            let request = UNNotificationRequest(identifier: "generated.alarm", content: content, trigger: trigger)
            center.removePendingNotificationRequests(withIdentifiers: ["generated.alarm"])
            center.add(request)
        }
        #endif
    }

    static func setBadge(_ count: Int) {
        #if os(iOS)
        UNUserNotificationCenter.current().setBadgeCount(count)
        #elseif canImport(AppKit)
        NSApp.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
        #endif
    }
}

enum GeneratedShare {
    static func present(text: String, urlString: String) {
        #if os(iOS)
        var items: [Any] = []
        if !text.isEmpty { items.append(text) }
        if let url = URL(string: urlString), !urlString.isEmpty { items.append(url) }
        guard !items.isEmpty,
              let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene,
              let root = scene.keyWindow?.rootViewController
        else { return }
        root.present(UIActivityViewController(activityItems: items, applicationActivities: nil), animated: true)
        #elseif canImport(AppKit)
        var items: [Any] = []
        if !text.isEmpty { items.append(text) }
        if let url = URL(string: urlString), !urlString.isEmpty { items.append(url) }
        guard !items.isEmpty else { return }
        NSSharingServicePicker(items: items).show(relativeTo: .zero, of: NSApp.keyWindow?.contentView ?? NSView(), preferredEdge: .minY)
        #endif
    }

    static func sendEmail(to: String, subject: String, body: String) {
        var components = URLComponents(string: "mailto:\(to)")
        components?.queryItems = [
            URLQueryItem(name: "subject", value: subject),
            URLQueryItem(name: "body", value: body)
        ]
        open(components?.url)
    }

    static func sendSMS(number: String, body: String) {
        open(URL(string: "sms:\(number)&body=\(body.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"))
    }

    static func launchMaps(query: String) {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? ""
        open(URL(string: "https://maps.apple.com/?q=\(encoded)"))
    }

    private static func open(_ url: URL?) {
        guard let url else { return }
        #if os(iOS)
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
        #elseif canImport(AppKit)
        NSWorkspace.shared.open(url)
        #endif
    }
}

enum GeneratedJSON {
    static func encode(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value)
        else { return "\"\(value)\"" }
        return String(data: data, encoding: .utf8) ?? "{}"
    }
}

// Runtime side of repeat-list bindings: parses the bound variable's
// JSON array, substitutes {{alias.field}} tokens per item, and
// resolves dot-paths into the "selected item" JSON a tapped cell
// stores in state.
enum GeneratedRepeat {
    static func items(from raw: String, filter: String = "", category: String = "") -> [Any] {
        let all: [Any]
        if let data = raw.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data),
           let array = parsed as? [Any] {
            all = array
        } else {
            all = raw.split(separator: "\n").map(String.init)
        }
        let searchNeedle = filter.trimmingCharacters(in: .whitespaces).lowercased()
        let categoryNeedle = category.trimmingCharacters(in: .whitespaces).lowercased()
        guard !searchNeedle.isEmpty || !categoryNeedle.isEmpty else { return all }
        return all.filter { item in
            if !searchNeedle.isEmpty, !matches(item, needle: searchNeedle) { return false }
            if !categoryNeedle.isEmpty, !matches(item, needle: categoryNeedle) { return false }
            return true
        }
    }

    private static func matches(_ item: Any, needle: String) -> Bool {
        if let dict = item as? [String: Any] { return dict.values.contains { matches($0, needle: needle) } }
        if let array = item as? [Any] { return array.contains { matches($0, needle: needle) } }
        return encode(item).lowercased().contains(needle)
    }

    static func encode(_ item: Any) -> String {
        if let string = item as? String { return string }
        if JSONSerialization.isValidJSONObject(item),
           let data = try? JSONSerialization.data(withJSONObject: item),
           let string = String(data: data, encoding: .utf8) {
            return string
        }
        return "\(item)"
    }

    static func substitute(_ text: String, alias: String, item: Any) -> String {
        guard text.contains("{{") else { return text }
        var result = ""
        var remainder = Substring(text)
        while let open = remainder.range(of: "{{") {
            result += String(remainder[remainder.startIndex..<open.lowerBound])
            remainder = remainder[open.upperBound...]
            guard let close = remainder.range(of: "}}") else {
                result += "{{" + String(remainder)
                return result
            }
            let token = remainder[remainder.startIndex..<close.lowerBound].trimmingCharacters(in: .whitespaces)
            remainder = remainder[close.upperBound...]
            if token == alias {
                result += encode(item)
            } else if token.hasPrefix(alias + ".") {
                result += resolvePath(String(token.dropFirst(alias.count + 1)), in: item)
            } else {
                result += "{{" + token + "}}"
            }
        }
        result += String(remainder)
        return result
    }

    // Reads "path.to.field" out of a JSON string (the selected-item
    // value a tapped cell stored in state).
    static func resolve(_ raw: String, _ path: String) -> String {
        guard let data = raw.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data) else { return raw }
        return resolvePath(path, in: parsed)
    }

    private static func resolvePath(_ path: String, in item: Any) -> String {
        var current = item
        for component in path.split(separator: ".") {
            let key = String(component)
            if let dict = current as? [String: Any], let next = dict[key] {
                current = next
            } else if let array = current as? [Any], let index = Int(key), array.indices.contains(index) {
                current = array[index]
            } else {
                return ""
            }
        }
        if let string = current as? String { return string }
        if let number = current as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue ? "true" : "false"
            }
            return number.stringValue
        }
        return encode(current)
    }
}

enum GeneratedDateFormat {
    static func format(_ input: String, pattern: String) -> String {
        let date = ISO8601DateFormatter().date(from: input) ?? Date()
        let formatter = DateFormatter()
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}

enum GeneratedPlatform {
    static func matches(_ raw: String) -> Bool {
        switch raw {
        case "appleWatch":
            #if os(watchOS)
            return true
            #else
            return false
            #endif
        case "iPad":
            #if os(iOS)
            return UIDevice.current.userInterfaceIdiom == .pad
            #else
            return false
            #endif
        default:
            #if os(iOS)
            return UIDevice.current.userInterfaceIdiom != .pad
            #elseif os(watchOS)
            return false
            #else
            return true
            #endif
        }
    }
}

// A tiny local SQLite database in the app's Documents folder for
// SQLite Query/Execute blocks — no external package needed since
// libsqlite3 ships with the OS.
enum GeneratedSQLite {
    private static var db: OpaquePointer?

    private static func open() -> OpaquePointer? {
        if let db { return db }
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("app.sqlite3")
        var handle: OpaquePointer?
        guard sqlite3_open(url.path, &handle) == SQLITE_OK else { return nil }
        db = handle
        return handle
    }

    static func execute(_ sql: String) -> Bool {
        guard let handle = open() else { return false }
        return sqlite3_exec(handle, sql, nil, nil, nil) == SQLITE_OK
    }

    static func query(_ sql: String) -> [[String: String]]? {
        guard let handle = open() else { return nil }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(statement) }

        var rows: [[String: String]] = []
        while sqlite3_step(statement) == SQLITE_ROW {
            var row: [String: String] = [:]
            for column in 0..<sqlite3_column_count(statement) {
                let name = String(cString: sqlite3_column_name(statement, column))
                if let text = sqlite3_column_text(statement, column) {
                    row[name] = String(cString: text)
                }
            }
            rows.append(row)
        }
        return rows
    }
}

