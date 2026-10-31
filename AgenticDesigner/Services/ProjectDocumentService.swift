//
//  ProjectDocumentService.swift
//  AgenticDesigner
//
//  Save and open full AgenticDesigner projects as JSON documents.
//

import Foundation
import AppKit
import UniformTypeIdentifiers

enum ProjectDocumentService {
    static let fileExtension = "agenticdesign"

    static func save(project: DesignProject, to url: URL? = nil) throws -> URL {
        let destination = try url ?? saveURL(defaultName: project.name)
        return try write(project: project, to: destination)
    }

    static func save(project: DesignProject, path: String?) throws -> URL {
        let destination: URL
        if let path, !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            destination = URL(fileURLWithPath: NSString(string: path).expandingTildeInPath)
        } else {
            destination = try defaultSaveURL(for: project.name)
        }
        return try write(project: project, to: destination)
    }

    static func load(from path: String) throws -> (project: DesignProject, url: URL) {
        let url = URL(fileURLWithPath: NSString(string: path).expandingTildeInPath)
        return try load(from: url)
    }

    static func load(from url: URL) throws -> (project: DesignProject, url: URL) {
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return (try decoder.decode(DesignProject.self, from: data), url)
    }

    private static func write(project: DesignProject, to url: URL) throws -> URL {
        let destination = url.pathExtension.isEmpty ? url.appendingPathExtension(fileExtension) : url
        try FileManager.default.createDirectory(
            at: destination.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(project)
        try data.write(to: destination, options: [.atomic])
        return destination
    }

    static func open() throws -> (project: DesignProject, url: URL) {
        let panel = NSOpenPanel()
        panel.title = "Open AgenticDesigner Project"
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        panel.allowedContentTypes = supportedTypes

        guard panel.runModal() == .OK, let url = panel.url else {
            throw ProjectDocumentError.cancelled
        }

        return try load(from: url)
    }

    private static func saveURL(defaultName: String) throws -> URL {
        let panel = NSSavePanel()
        panel.title = "Save AgenticDesigner Project"
        panel.nameFieldStringValue = sanitizedFileName(defaultName)
        panel.allowedContentTypes = supportedTypes
        panel.canCreateDirectories = true

        guard panel.runModal() == .OK, let url = panel.url else {
            throw ProjectDocumentError.cancelled
        }

        if url.pathExtension.isEmpty {
            return url.appendingPathExtension(fileExtension)
        }
        return url
    }

    private static func defaultSaveURL(for projectName: String) throws -> URL {
        let base = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        return base
            .appendingPathComponent("AgenticDesigner", isDirectory: true)
            .appendingPathComponent("SavedProjects", isDirectory: true)
            .appendingPathComponent(sanitizedFileName(projectName))
    }

    private static var supportedTypes: [UTType] {
        var types: [UTType] = [.json]
        if let projectType = UTType(filenameExtension: fileExtension) {
            types.insert(projectType, at: 0)
        }
        return types
    }

    private static func sanitizedFileName(_ name: String) -> String {
        let base = name
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "/", with: "-")
        let safeBase = base.isEmpty ? "Untitled Project" : base
        return safeBase.hasSuffix(".\(fileExtension)") ? safeBase : "\(safeBase).\(fileExtension)"
    }
}

enum ProjectDocumentError: LocalizedError {
    case cancelled

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Cancelled"
        }
    }
}
