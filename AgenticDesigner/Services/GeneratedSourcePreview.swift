//
//  GeneratedSourcePreview.swift
//  AgenticDesigner
//
//  Code Mode's engine: the Swift that WOULD ship, before any export. It runs
//  the real LogicExporter (the same code path as export_ios_source) into a
//  throwaway directory and reads the tree back as strings — so the panel can
//  never drift from what the exporter actually produces. Read-only by design:
//  the design document stays the single source of truth.
//

import Foundation
import SwiftUI

struct GeneratedSourceFile: Identifiable, Hashable {
    let relativePath: String
    let content: String
    /// True when this file's content comes from a Code Mode hand-edit
    /// (project.sourceOverrides) rather than pure generation.
    var isOverridden: Bool = false

    var id: String { relativePath }
    var fileName: String { (relativePath as NSString).lastPathComponent }
    var directory: String {
        let dir = (relativePath as NSString).deletingLastPathComponent
        return dir.isEmpty ? "Root" : dir
    }
    var lineCount: Int { content.reduce(into: 1) { if $1 == "\n" { $0 += 1 } } }
}

enum GeneratedSourcePreview {

    /// Generates the full export source tree in a temp directory and returns
    /// every text file. The directory is deleted before returning.
    static func generate(project: DesignProject, flows: [LogicFlow], currentPageId: UUID?) throws -> [GeneratedSourceFile] {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("AgenticDesigner-CodeMode-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)

        let root = try LogicExporter.exportSwiftUISource(
            project: project, flows: flows, currentPageId: currentPageId, to: temp
        )

        let textExtensions: Set<String> = [
            "swift", "plist", "entitlements", "storekit", "rules", "md", "xcprivacy", "json"
        ]
        var files: [GeneratedSourceFile] = []
        let enumerator = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: [.isRegularFileKey]
        )
        let overriddenNames = Set(project.sourceOverrides?.keys ?? [String: String]().keys)
        while let url = enumerator?.nextObject() as? URL {
            guard (try? url.resourceValues(forKeys: [.isRegularFileKey]))?.isRegularFile == true else { continue }
            guard textExtensions.contains(url.pathExtension.lowercased()) else { continue }
            guard let content = try? String(contentsOf: url, encoding: .utf8) else { continue }
            let relative = url.standardizedFileURL.path
                .replacingOccurrences(of: root.standardizedFileURL.path + "/", with: "")
            files.append(GeneratedSourceFile(
                relativePath: relative,
                content: content,
                isOverridden: url.pathExtension == "swift" && overriddenNames.contains(url.lastPathComponent)
            ))
        }
        // Swift sources first (that's what people came to read), then the rest,
        // each alphabetically by path.
        return files.sorted {
            let aSwift = $0.relativePath.hasSuffix(".swift")
            let bSwift = $1.relativePath.hasSuffix(".swift")
            if aSwift != bSwift { return aSwift }
            return $0.relativePath < $1.relativePath
        }
    }

    /// Best-effort "open the file for the screen I'm looking at": matches the
    /// current page's name against generated screen-view file names, then falls
    /// back to the most interesting code — a screen, the root view — never
    /// Package.swift or a README.
    static func defaultSelection(in files: [GeneratedSourceFile], pageName: String) -> GeneratedSourceFile? {
        let compact = pageName
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .joined()
            .lowercased()
        if !compact.isEmpty,
           let match = files.first(where: {
               $0.fileName.hasSuffix(".swift") && $0.fileName.lowercased().contains(compact)
           }) {
            return match
        }
        return files.first { $0.relativePath.contains("/Screens/") }
            ?? files.first { $0.fileName == "RootView.swift" }
            ?? files.first { $0.fileName.hasSuffix(".swift") && $0.fileName != "Package.swift" }
            ?? files.first
    }
}

// MARK: - Recompile (typecheck)

struct CodeDiagnostic: Identifiable, Hashable {
    let id = UUID()
    let fileName: String
    let line: Int
    let column: Int
    let severity: String   // "error" | "warning"
    let message: String
}

extension GeneratedSourcePreview {

    struct TypecheckResult {
        let success: Bool
        let diagnostics: [CodeDiagnostic]
        let checkedFileCount: Int
    }

    /// The Recompile button's engine: exports the current design + overrides to
    /// a temp directory and runs the REAL iOS-simulator swiftc in -typecheck
    /// mode over every generated .swift — the same compiler contract as
    /// SimulatorRunner, minus linking. Returns parsed per-file diagnostics.
    static func typecheck(project: DesignProject, flows: [LogicFlow], currentPageId: UUID?) throws -> TypecheckResult {
        let temp = FileManager.default.temporaryDirectory
            .appendingPathComponent("AgenticDesigner-Typecheck-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: temp) }
        try FileManager.default.createDirectory(at: temp, withIntermediateDirectories: true)

        let root = try LogicExporter.exportSwiftUISource(
            project: project, flows: flows, currentPageId: currentPageId, to: temp
        )
        let sourcesDir = root.appendingPathComponent("Sources", isDirectory: true)
        var sourceFiles: [String] = []
        if let enumerator = FileManager.default.enumerator(at: sourcesDir, includingPropertiesForKeys: nil) {
            for case let url as URL in enumerator where url.pathExtension == "swift" {
                sourceFiles.append(url.path)
            }
        }
        guard !sourceFiles.isEmpty else {
            throw GitSyncError.message("No generated Swift sources to compile.")
        }

        #if arch(arm64)
        let arch = "arm64"
        #else
        let arch = "x86_64"
        #endif
        let (status, output) = runCompiler(
            "/usr/bin/xcrun",
            ["-sdk", "iphonesimulator", "swiftc", "-typecheck",
             "-target", "\(arch)-apple-ios17.0-simulator",
             "-parse-as-library"]
            + sourceFiles.sorted(),
            developerDir: developerDir()
        )

        // swiftc diagnostics: /path/File.swift:12:5: error: message
        let pattern = try! NSRegularExpression(pattern: "^(.+?\\.swift):(\\d+):(\\d+): (error|warning): (.+)$")
        var diagnostics: [CodeDiagnostic] = []
        for lineText in output.components(separatedBy: "\n") {
            let range = NSRange(lineText.startIndex..., in: lineText)
            guard let match = pattern.firstMatch(in: lineText, range: range),
                  let pathRange = Range(match.range(at: 1), in: lineText),
                  let lineRange = Range(match.range(at: 2), in: lineText),
                  let columnRange = Range(match.range(at: 3), in: lineText),
                  let severityRange = Range(match.range(at: 4), in: lineText),
                  let messageRange = Range(match.range(at: 5), in: lineText) else { continue }
            diagnostics.append(CodeDiagnostic(
                fileName: (String(lineText[pathRange]) as NSString).lastPathComponent,
                line: Int(lineText[lineRange]) ?? 0,
                column: Int(lineText[columnRange]) ?? 0,
                severity: String(lineText[severityRange]),
                message: String(lineText[messageRange])
            ))
        }
        // A crash/misconfiguration with no parseable diagnostics still has to
        // surface — otherwise a failed compile reads as "Build OK".
        if status != 0 && diagnostics.isEmpty {
            diagnostics.append(CodeDiagnostic(
                fileName: "swiftc", line: 0, column: 0, severity: "error",
                message: String(output.suffix(400))
            ))
        }
        return TypecheckResult(
            success: status == 0,
            diagnostics: diagnostics,
            checkedFileCount: sourceFiles.count
        )
    }

    private static func developerDir() -> String {
        let simulatorPlatform = "/Platforms/iPhoneSimulator.platform"
        let (status, output) = runCompiler("/usr/bin/xcode-select", ["-p"], developerDir: nil)
        if status == 0 {
            let path = output.trimmingCharacters(in: .whitespacesAndNewlines)
            if FileManager.default.fileExists(atPath: path + simulatorPlatform) { return path }
        }
        return "/Applications/Xcode.app/Contents/Developer"
    }

    private static func runCompiler(_ executable: String, _ arguments: [String], developerDir: String?) -> (status: Int32, output: String) {
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
        do {
            try process.run()
        } catch {
            return (1, "Failed to launch \(executable): \(error.localizedDescription)")
        }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (process.terminationStatus, String(data: data, encoding: .utf8) ?? "")
    }
}

// MARK: - Syntax highlighting

/// Lightweight regex-based Swift highlighter on the CodeTheme dark palette.
/// Order matters: literals and keywords first, strings and comments last so
/// they override what they contain. Non-Swift files render plain — a README
/// full of pink "for"s reads as noise, not code.
enum SwiftCodeHighlighter {

    private static let keywords = [
        "import", "struct", "class", "enum", "extension", "protocol", "func", "var", "let",
        "if", "else", "guard", "switch", "case", "default", "for", "while", "repeat", "in",
        "return", "break", "continue", "throw", "throws", "rethrows", "try", "catch", "defer",
        "init", "deinit", "self", "Self", "super", "static", "final", "private", "public",
        "internal", "fileprivate", "open", "override", "mutating", "nonmutating", "lazy",
        "weak", "unowned", "some", "any", "async", "await", "actor", "nil", "true", "false",
        "where", "as", "is", "typealias", "associatedtype", "do", "@State", "@Binding",
        "@Published", "@ObservedObject", "@StateObject", "@EnvironmentObject", "@Environment",
        "@MainActor", "@ViewBuilder", "@main", "@escaping", "@discardableResult"
    ]

    private static let rules: [(NSRegularExpression, NSColor)] = {
        func regex(_ pattern: String) -> NSRegularExpression {
            try! NSRegularExpression(pattern: pattern, options: [])
        }
        let keywordPattern = "(?<![A-Za-z0-9_@])(" + keywords
            .map { NSRegularExpression.escapedPattern(for: $0) }
            .joined(separator: "|") + ")(?![A-Za-z0-9_])"
        return [
            (regex("(?<![A-Za-z0-9_])[0-9]+(?:\\.[0-9]+)?"), CodeTheme.number),
            (regex("(?<![A-Za-z0-9_])[A-Z][A-Za-z0-9_]*"), CodeTheme.typeName),
            (regex(keywordPattern), CodeTheme.keyword),
            (regex("\"(?:[^\"\\\\\\n]|\\\\.)*\""), CodeTheme.string),
            (regex("//[^\\n]*"), CodeTheme.comment),
        ]
    }()

    /// Files past this size render plain — highlighting is O(file · rules) and
    /// the payoff on a huge generated file is nil.
    private static let highlightLimit = 150_000

    /// Live refresh re-evaluates the view body often; cache by file + content
    /// so unchanged files never pay the regex pass twice.
    private static let cache = NSCache<NSString, NSAttributedString>()

    static func attributedCode(_ code: String, isSwift: Bool, cacheKey: String) -> NSAttributedString {
        let key = "\(cacheKey)#\(isSwift)#\(code.hashValue)" as NSString
        if let cached = cache.object(forKey: key) { return cached }

        let attributed = NSMutableAttributedString(string: code, attributes: [
            .font: CodeTheme.font,
            .foregroundColor: CodeTheme.plainText
        ])
        applyColorPass(to: attributed, code: code, isSwift: isSwift)
        cache.setObject(attributed, forKey: key)
        return attributed
    }

    /// In-place re-highlight while the user types: only attributes change, so
    /// the selection, caret and scroll position all survive.
    static func rehighlight(_ storage: NSTextStorage, isSwift: Bool) {
        let code = storage.string
        let full = NSRange(location: 0, length: (code as NSString).length)
        storage.beginEditing()
        storage.setAttributes([.font: CodeTheme.font, .foregroundColor: CodeTheme.plainText], range: full)
        applyColorPass(to: storage, code: code, isSwift: isSwift)
        storage.endEditing()
    }

    private static func applyColorPass(to attributed: NSMutableAttributedString, code: String, isSwift: Bool) {
        guard isSwift, code.count <= highlightLimit else { return }
        let full = NSRange(location: 0, length: (code as NSString).length)
        for (regex, color) in rules {
            regex.enumerateMatches(in: code, options: [], range: full) { match, _, _ in
                guard let range = match?.range else { return }
                attributed.addAttribute(.foregroundColor, value: color, range: range)
            }
        }
    }
}
