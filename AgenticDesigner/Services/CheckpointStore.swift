//
//  CheckpointStore.swift
//  AgenticDesigner
//
//  Persisted project checkpoints — the "iterate fearlessly" loop. A snapshot
//  is written automatically before every agent generation (and on demand),
//  so any AI change can be rolled back even after the app restarts. The
//  in-memory undo stack covers small edits; this covers "the agent redid my
//  whole screen and I want yesterday's version back."
//

import Foundation

struct ProjectCheckpoint: Identifiable {
    let id: URL
    let label: String
    let date: Date
    var url: URL { id }
}

enum CheckpointStore {

    static let maxCheckpointsPerProject = 40

    private static var root: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return base.appendingPathComponent("AgenticDesigner/Checkpoints", isDirectory: true)
    }

    private static func directory(for projectName: String) -> URL {
        let safe = projectName.replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
        return root.appendingPathComponent(safe.isEmpty ? "Untitled" : safe, isDirectory: true)
    }

    // MARK: - Save

    @discardableResult
    static func save(_ project: DesignProject, label: String) -> ProjectCheckpoint? {
        let dir = directory(for: project.name)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            let data = try encoder.encode(project)

            let stamp = ISO8601DateFormatter().string(from: Date())
                .replacingOccurrences(of: ":", with: "-")
            let safeLabel = label
                .replacingOccurrences(of: "/", with: "-")
                .prefix(60)
            let url = dir.appendingPathComponent("\(stamp)__\(safeLabel).json")
            try data.write(to: url)
            prune(dir: dir)
            // Same snapshot, real history: when git sync is on, every checkpoint
            // is also a commit in the project's repo (background, non-blocking).
            GitSyncService.recordCheckpoint(project: project, label: String(safeLabel))
            return ProjectCheckpoint(id: url, label: String(safeLabel), date: Date())
        } catch {
            print("⚠️ Checkpoint save failed: \(error)")
            return nil
        }
    }

    // MARK: - List / load

    static func list(projectName: String) -> [ProjectCheckpoint] {
        let dir = directory(for: projectName)
        guard let urls = try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey]
        ) else { return [] }
        return urls
            .filter { $0.pathExtension == "json" }
            .compactMap { url in
                let name = url.deletingPathExtension().lastPathComponent
                let parts = name.components(separatedBy: "__")
                let date = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?
                    .contentModificationDate ?? .distantPast
                return ProjectCheckpoint(id: url, label: parts.count > 1 ? parts[1] : name, date: date)
            }
            .sorted { $0.date > $1.date }
    }

    static func load(_ checkpoint: ProjectCheckpoint) throws -> DesignProject {
        let data = try Data(contentsOf: checkpoint.url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(DesignProject.self, from: data)
    }

    private static func prune(dir: URL) {
        let checkpoints = (try? FileManager.default.contentsOfDirectory(
            at: dir, includingPropertiesForKeys: [.contentModificationDateKey]
        ))?.filter { $0.pathExtension == "json" }
            .sorted { a, b in
                let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
                let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
                return da > db
            } ?? []
        for stale in checkpoints.dropFirst(maxCheckpointsPerProject) {
            try? FileManager.default.removeItem(at: stale)
        }
    }
}
