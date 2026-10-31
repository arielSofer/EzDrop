//
//  SimulatorControl.swift
//  AgenticDesigner
//
//  Drives the REAL iOS Simulator (not the in-app preview): screenshots it via
//  `simctl`, and taps / types into it by mapping normalized device coordinates
//  to the Simulator window on screen and posting synthetic CGEvents. Tapping
//  and typing require Accessibility permission for this app
//  (System Settings ▸ Privacy & Security ▸ Accessibility).
//

import Foundation
import CoreGraphics
import AppKit
import ApplicationServices

nonisolated enum SimulatorControl {
    struct ControlError: LocalizedError {
        let message: String
        var errorDescription: String? { message }
    }

    // MARK: - Device discovery

    static func developerDir() throws -> String {
        if let out = try? run("/usr/bin/xcode-select", ["-p"]) {
            let p = out.trimmingCharacters(in: .whitespacesAndNewlines)
            if FileManager.default.fileExists(atPath: p + "/Platforms/iPhoneSimulator.platform") { return p }
        }
        let fallback = "/Applications/Xcode.app/Contents/Developer"
        if FileManager.default.fileExists(atPath: fallback + "/Platforms/iPhoneSimulator.platform") { return fallback }
        throw ControlError(message: "Xcode not found. Install the full Xcode app to control the simulator.")
    }

    static func bootedUDID() throws -> String {
        let dev = try developerDir()
        let json = try run("/usr/bin/xcrun", ["simctl", "list", "devices", "booted", "--json"], developerDir: dev)
        guard let data = json.data(using: .utf8),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let devices = root["devices"] as? [String: [[String: Any]]] else {
            throw ControlError(message: "Could not query booted simulators.")
        }
        for (_, list) in devices {
            for device in list where (device["state"] as? String) == "Booted" {
                if let udid = device["udid"] as? String { return udid }
            }
        }
        throw ControlError(message: "No booted simulator. Launch the app first with run_in_simulator.")
    }

    // MARK: - Screenshot

    /// PNG data of the currently booted simulator's screen.
    static func screenshotPNG() throws -> Data {
        let dev = try developerDir()
        let udid = try bootedUDID()
        let tmp = FileManager.default.temporaryDirectory
            .appendingPathComponent("emberSimShot-\(UUID().uuidString).png")
        _ = try run("/usr/bin/xcrun", ["simctl", "io", udid, "screenshot", tmp.path], developerDir: dev)
        defer { try? FileManager.default.removeItem(at: tmp) }
        return try Data(contentsOf: tmp)
    }

    // MARK: - Coordinate mapping

    /// On-screen rect (points, top-left origin) occupied by the device screen
    /// inside the Simulator window — the device aspect-fit within the window
    /// below its title bar.
    private static func deviceScreenRect(deviceAspect: CGFloat) throws -> CGRect {
        guard let infoList = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else {
            throw ControlError(message: "Could not read the window list.")
        }
        var best: CGRect?
        var bestArea: CGFloat = 0
        for info in infoList {
            guard let owner = info[kCGWindowOwnerName as String] as? String, owner == "Simulator",
                  let boundsDict = info[kCGWindowBounds as String] as? [String: Any],
                  let x = (boundsDict["X"] as? NSNumber)?.doubleValue,
                  let y = (boundsDict["Y"] as? NSNumber)?.doubleValue,
                  let width = (boundsDict["Width"] as? NSNumber)?.doubleValue,
                  let height = (boundsDict["Height"] as? NSNumber)?.doubleValue else { continue }
            let bounds = CGRect(x: x, y: y, width: width, height: height)
            let area = bounds.width * bounds.height
            if area > bestArea, bounds.width > 100, bounds.height > 100 {
                bestArea = area; best = bounds
            }
        }
        guard let win = best else {
            throw ControlError(message: "Simulator window not found. Make sure the Simulator app is open and visible on screen.")
        }
        // The window frame includes a title bar (~28pt) at the top; the device
        // screen fills the remaining area, aspect-fit and centered.
        let titleBar: CGFloat = 28
        let availX = win.minX, availY = win.minY + titleBar
        let availW = win.width, availH = win.height - titleBar
        let availAspect = availW / availH
        if availAspect > deviceAspect {
            let h = availH, w = h * deviceAspect
            return CGRect(x: availX + (availW - w) / 2, y: availY, width: w, height: h)
        } else {
            let w = availW, h = w / deviceAspect
            return CGRect(x: availX, y: availY + (availH - h) / 2, width: w, height: h)
        }
    }

    // MARK: - Tap

    /// Throws (and shows the system prompt on first call) unless this app has
    /// Accessibility permission — required to post synthetic taps/keystrokes.
    private static func requireAccessibility() throws {
        let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        if !AXIsProcessTrustedWithOptions(options) {
            throw ControlError(message: "Accessibility permission is required to tap/type the real simulator. A system prompt was just shown — enable “AgenticDesigner” in System Settings ▸ Privacy & Security ▸ Accessibility, then retry. (simulator_screenshot works without it.)")
        }
    }

    /// Tap at a normalized position (0…1 of the device screen, top-left origin).
    static func tap(normX: CGFloat, normY: CGFloat) throws {
        try requireAccessibility()
        let png = try screenshotPNG()
        guard let rep = NSBitmapImageRep(data: png), rep.pixelsHigh > 0 else {
            throw ControlError(message: "Could not read the screenshot for sizing.")
        }
        let aspect = CGFloat(rep.pixelsWide) / CGFloat(rep.pixelsHigh)
        let rect = try deviceScreenRect(deviceAspect: aspect)
        let point = CGPoint(
            x: rect.minX + min(max(normX, 0), 1) * rect.width,
            y: rect.minY + min(max(normY, 0), 1) * rect.height
        )
        activateSimulator()
        let src = CGEventSource(stateID: .combinedSessionState)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
        usleep(40_000)
        CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    }

    // MARK: - Type

    /// Type text into the simulator's currently focused field.
    static func typeText(_ text: String) throws {
        try requireAccessibility()
        _ = try bootedUDID()
        activateSimulator()
        let src = CGEventSource(stateID: .combinedSessionState)
        for character in text {
            let utf16 = Array(String(character).utf16)
            let down = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: true)
            down?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            down?.post(tap: .cghidEventTap)
            let up = CGEvent(keyboardEventSource: src, virtualKey: 0, keyDown: false)
            up?.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
            up?.post(tap: .cghidEventTap)
            usleep(16_000)
        }
    }

    private static func activateSimulator() {
        NSWorkspace.shared.runningApplications
            .first { $0.localizedName == "Simulator" }?
            .activate(options: [])
        usleep(150_000)
    }

    // MARK: - Process helper

    @discardableResult
    private static func run(_ executable: String, _ arguments: [String], developerDir: String? = nil) throws -> String {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        if let developerDir {
            var environment = ProcessInfo.processInfo.environment
            environment["DEVELOPER_DIR"] = developerDir
            process.environment = environment
        }
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        try process.run()
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let output = String(data: data, encoding: .utf8) ?? ""
        guard process.terminationStatus == 0 else {
            throw ControlError(message: "\(URL(fileURLWithPath: executable).lastPathComponent) failed: \(output)")
        }
        return output
    }
}
