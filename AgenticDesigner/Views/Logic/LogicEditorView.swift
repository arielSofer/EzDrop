//
//  LogicEditorView.swift
//  AgenticDesigner
//
//  Center area of Logic Mode: flow toolbar (flow picker, validation badge,
//  Firebase/API config, export) above the block canvas. The palette and
//  block inspector are swapped in by EditorView on either side.
//

import SwiftUI
import AppKit
import Combine

struct LogicEditorView: View {
    @ObservedObject var logicViewModel: LogicViewModel
    @ObservedObject var designViewModel: ProjectViewModel
    // Shared with EditorView and the MCP server so remote agents drive the
    // same running-app preview the user sees.
    @ObservedObject var simulator: LogicSimulator

    @State private var showIssuesPopover = false
    @State private var showSimulatorPanel = false
    @State private var exportMessage: String?
    @State private var isRunningInSimulator = false
    @State private var selectedRunTarget: RunTarget = .iPhone

    private enum RunTarget: String, CaseIterable, Identifiable {
        case iPhone = "iPhone"
        case iPad = "iPad"
        case appleWatch = "Apple Watch"
        case mac = "Mac"

        var id: String { rawValue }
        var icon: String {
            switch self {
            case .iPhone: return "iphone"
            case .iPad: return "ipad"
            case .appleWatch: return "applewatch"
            case .mac: return "macbook"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            flowToolbar

            Divider()

            LogicCanvasView(
                logicViewModel: logicViewModel,
                designViewModel: designViewModel
            )

            if showSimulatorPanel {
                Divider()
                FlowSimulatorPanel(simulator: simulator)
            }
        }
        .onAppear {
            simulator.logicViewModel = logicViewModel
            simulator.designViewModel = designViewModel
        }
        .sheet(isPresented: $logicViewModel.showFirebaseConfig) {
            FirebaseConfigView(logicViewModel: logicViewModel)
        }
        .sheet(isPresented: $logicViewModel.showAPIManager) {
            APIEndpointManagerView(logicViewModel: logicViewModel)
        }
    }

    // MARK: - Toolbar

    private var flowToolbar: some View {
        HStack(spacing: 10) {
            Image(systemName: "bolt.fill")
                .foregroundStyle(.yellow)
                .font(.system(size: 12))

            Picker("Flow", selection: Binding(
                get: { logicViewModel.currentFlowId },
                set: { logicViewModel.currentFlowId = $0; logicViewModel.validate() }
            )) {
                ForEach(logicViewModel.flows) { flow in
                    Text(flow.name).tag(Optional(flow.id))
                }
            }
            .labelsHidden()
            .frame(width: 160)

            Button {
                logicViewModel.createFlow(name: "Flow \(logicViewModel.flows.count + 1)")
            } label: {
                Image(systemName: "plus.circle")
            }
            .buttonStyle(.plain)
            .help("New Flow")

            Button {
                if let id = logicViewModel.currentFlowId {
                    logicViewModel.deleteFlow(id: id)
                }
            } label: {
                Image(systemName: "minus.circle")
            }
            .buttonStyle(.plain)
            .help("Delete Current Flow")

            Divider().frame(height: 16)

            issuesBadge

            Divider().frame(height: 16)

            // Interactive app preview (iOS-Simulator style)
            Button {
                logicViewModel.showAppPreview = true
            } label: {
                Label("Preview", systemImage: "iphone")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.blue)
            }
            .buttonStyle(.plain)
            .help("Open the interactive app preview — tap buttons, type in inputs, watch flows run")

            // Simulator controls
            Button {
                showSimulatorPanel = true
                simulator.run()
            } label: {
                Label("Run", systemImage: "play.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.green)
            }
            .buttonStyle(.plain)
            .disabled(simulator.isRunning)
            .help("Simulate this flow — blocks light up as they execute")

            if simulator.isRunning {
                Button {
                    simulator.stop()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(.red)
                }
                .buttonStyle(.plain)
            }

            if simulator.hasUIChanges {
                Button {
                    simulator.resetUI()
                } label: {
                    Label("Reset UI", systemImage: "arrow.uturn.backward")
                        .font(.system(size: 11))
                }
                .buttonStyle(.plain)
                .help("Restore the designed screen to its pre-run state")
            }

            if showSimulatorPanel && !simulator.isRunning {
                Button {
                    showSimulatorPanel = false
                } label: {
                    Image(systemName: "chevron.down.square")
                        .font(.system(size: 11))
                }
                .buttonStyle(.plain)
                .help("Hide simulator console")
            }

            Spacer()

            Menu {
                ForEach(FlowTemplateLibrary.all) { template in
                    Button {
                        logicViewModel.insertTemplate(template)
                    } label: {
                        Label(template.name, systemImage: template.icon)
                    }
                    .help(template.description)
                }
            } label: {
                Label("Templates", systemImage: "square.stack.3d.up")
                    .font(.system(size: 11))
            }
            .menuStyle(.borderlessButton)
            .fixedSize()
            .help("Insert a ready-made flow (sign up, login, Firestore, Supabase, REST...)")

            Button {
                logicViewModel.showFirebaseConfig = true
            } label: {
                Label("Firebase", systemImage: "flame")
                    .font(.system(size: 11))
            }
            .help("Configure Firebase")

            Button {
                logicViewModel.showAPIManager = true
            } label: {
                Label("API", systemImage: "network")
                    .font(.system(size: 11))
            }
            .help("Manage API Endpoints")

            Divider().frame(height: 16)

            Button {
                exportBlueprint()
            } label: {
                Label("Export", systemImage: "square.and.arrow.up")
                    .font(.system(size: 11, weight: .semibold))
            }
            .help("Export Logic Blueprint JSON")

            Menu {
                ForEach(RunTarget.allCases) { target in
                    Button {
                        selectedRunTarget = target
                        run(target: target)
                    } label: {
                        Label(target.rawValue, systemImage: target.icon)
                    }
                }
            } label: {
                Label(isRunningInSimulator ? "Building…" : "Run", systemImage: "play.fill")
                    .font(.system(size: 11, weight: .semibold))
            }
            .menuStyle(.borderlessButton)
            .disabled(isRunningInSimulator)
            .help("Choose a platform and run it in its simulator")

            if let exportMessage {
                Text(exportMessage)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    @ViewBuilder
    private var issuesBadge: some View {
        let issues = logicViewModel.validationIssues
        let errorCount = issues.filter { $0.severity == .error }.count

        if issues.isEmpty {
            Label("Valid", systemImage: "checkmark.circle")
                .font(.system(size: 11))
                .foregroundStyle(.green)
        } else {
            Button {
                showIssuesPopover.toggle()
            } label: {
                Label("\(issues.count) issue\(issues.count == 1 ? "" : "s")", systemImage: "exclamationmark.triangle")
                    .font(.system(size: 11))
                    .foregroundStyle(errorCount > 0 ? .red : .orange)
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showIssuesPopover) {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(issues) { issue in
                        HStack(spacing: 6) {
                            Image(systemName: issue.severity == .error ? "xmark.circle.fill" : "exclamationmark.triangle.fill")
                                .foregroundStyle(issue.severity == .error ? .red : .orange)
                                .font(.system(size: 10))
                            Text(issue.message)
                                .font(.system(size: 11))
                        }
                        .onTapGesture {
                            logicViewModel.selectedBlockId = issue.blockId
                            showIssuesPopover = false
                        }
                    }
                }
                .padding(12)
                .frame(width: 320)
            }
        }
    }

    // MARK: - Export

    private func exportBlueprint() {
        let result = LogicExporter.exportWithSavePanel(
            project: designViewModel.project,
            flows: logicViewModel.flows,
            currentPageId: designViewModel.currentPage.id
        )
        exportMessage = result
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            exportMessage = nil
        }
    }

    // Exports the current project, compiles it into an iOS .app, and
    // launches it in the Simulator. The export happens on the main actor
    // (it reads live view-model state); the slow compile/install runs in
    // a detached task so the editor stays responsive.
    private func run(target: RunTarget) {
        if target == .appleWatch {
            runWatchSimulator()
            return
        }
        guard target == .iPhone || target == .iPad else {
            exportXcodeProject(for: target)
            return
        }

        isRunningInSimulator = true
        exportMessage = "Exporting…"

        let appName = LogicExporter.exportAppName(project: designViewModel.project)
        let exportRoot: URL
        do {
            let workDir = FileManager.default.temporaryDirectory
                .appendingPathComponent("AgenticDesignerSimulatorRun", isDirectory: true)
            try FileManager.default.createDirectory(at: workDir, withIntermediateDirectories: true)
            exportRoot = try LogicExporter.exportSwiftUISource(
                project: designViewModel.project,
                flows: logicViewModel.flows,
                currentPageId: designViewModel.currentPage.id,
                to: workDir
            )
        } catch {
            print("📱 AgenticDesigner export failed: \(error.localizedDescription)")
            exportMessage = "Export failed: \(error.localizedDescription)"
            isRunningInSimulator = false
            return
        }

        Task.detached {
            do {
                let runnerTarget: SimulatorRunner.Target = target == .iPad ? .iPad : .iPhone
                let result = try SimulatorRunner.buildAndLaunch(exportRoot: exportRoot, appName: appName, target: runnerTarget) { message in
                    Task { @MainActor in exportMessage = message }
                }
                await MainActor.run {
                    exportMessage = "Running on \(result.deviceName)"
                    isRunningInSimulator = false
                }
            } catch {
                print("📱 AgenticDesigner run failed: \(error.localizedDescription)")
                await MainActor.run {
                    exportMessage = "Run failed: \(error.localizedDescription)"
                    isRunningInSimulator = false
                }
            }
        }
    }

    private func runWatchSimulator() {
        isRunningInSimulator = true
        exportMessage = "Exporting Apple Watch project…"

        // A watch-shaped canvas page is not enough to make a watch target:
        // the project platform setting controls whether the exporter emits
        // the native watchOS target. Selecting Watch in Run opts the project
        // into that target automatically.
        if !designViewModel.project.platformSettings.enabledPlatforms.contains(.appleWatch) {
            designViewModel.snapshot()
            designViewModel.project.platformSettings.enabledPlatforms.append(.appleWatch)
            designViewModel.objectWillChange.send()
        }

        let appName = LogicExporter.exportAppName(project: designViewModel.project)
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("AgenticDesignerAppleWatchRun", isDirectory: true)

        let projectRoot: URL
        do {
            projectRoot = try LogicExporter.exportXcodeProject(
                project: designViewModel.project,
                flows: logicViewModel.flows,
                currentPageId: designViewModel.currentPage.id,
                to: directory
            )
        } catch {
            exportMessage = "Watch export failed: \(error.localizedDescription)"
            isRunningInSimulator = false
            return
        }

        Task.detached {
            do {
                let result = try SimulatorRunner.buildAndLaunchWatch(projectRoot: projectRoot, appName: appName) { message in
                    Task { @MainActor in exportMessage = message }
                }
                await MainActor.run {
                    exportMessage = "Running Apple Watch on \(result.deviceName)"
                    isRunningInSimulator = false
                }
            } catch {
                await MainActor.run {
                    exportMessage = "Watch run failed: \(error.localizedDescription)"
                    isRunningInSimulator = false
                }
            }
        }
    }

    /// Watch and Mac need real Xcode targets. Export and open the project so
    /// the user can select the generated Watch App or Mac target and run it
    /// on the matching Apple simulator.
    private func exportXcodeProject(for target: RunTarget) {
        guard target == .appleWatch else {
            exportMessage = "Mac target export is not available yet"
            return
        }
        exportMessage = "Exporting \(target.rawValue) project…"
        do {
            let directory = FileManager.default.temporaryDirectory
                .appendingPathComponent("AgenticDesigner\(target.rawValue.replacingOccurrences(of: " ", with: ""))Run", isDirectory: true)
            let root = try LogicExporter.exportXcodeProject(
                project: designViewModel.project,
                flows: logicViewModel.flows,
                currentPageId: designViewModel.currentPage.id,
                to: directory
            )
            let projectURL = root.appendingPathComponent("\(LogicExporter.exportAppName(project: designViewModel.project)).xcodeproj")
            NSWorkspace.shared.open(projectURL)
            exportMessage = "Opened Xcode — choose the \(target.rawValue) scheme"
        } catch {
            exportMessage = "Export failed: \(error.localizedDescription)"
        }
    }
}
