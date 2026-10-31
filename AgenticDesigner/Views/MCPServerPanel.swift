//
//  MCPServerPanel.swift
//  AgenticDesigner
//
//  Settings sheet for the embedded MCP server: on/off, port, connect
//  instructions for external agents, exposed tools, and a live call log.
//

import SwiftUI
import AppKit

struct MCPServerPanel: View {
    @ObservedObject var controller: MCPServerController
    @Environment(\.dismiss) private var dismiss

    @State private var portText: String = ""
    @State private var copiedField: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            Divider()

            serverControls

            if let error = controller.lastError {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if controller.isRunning {
                connectInstructions
            }

            toolList

            callLog
        }
        .padding(16)
        .frame(width: 520, height: 560)
        .onAppear {
            portText = String(controller.port)
        }
    }

    private var header: some View {
        HStack {
            Label("MCP Server", systemImage: "point.3.connected.trianglepath.dotted")
                .font(.headline)

            Spacer()

            Button("Done") { dismiss() }
                .keyboardShortcut(.defaultAction)
        }
    }

    private var serverControls: some View {
        HStack(spacing: 12) {
            Toggle(isOn: Binding(
                get: { controller.isRunning },
                set: { controller.setEnabled($0) }
            )) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(controller.isRunning ? Color.green : Color.gray)
                        .frame(width: 8, height: 8)
                    Text(controller.isRunning ? "Running" : "Stopped")
                        .font(.system(size: 12, weight: .semibold))
                }
            }
            .toggleStyle(.switch)

            Spacer()

            Text("Port")
                .font(.caption)
                .foregroundStyle(.secondary)

            TextField("8765", text: $portText)
                .textFieldStyle(.roundedBorder)
                .frame(width: 70)
                .disabled(controller.isRunning)
                .onSubmit(applyPort)
                .onChange(of: portText) { _ in applyPort() }
        }
    }

    private var connectInstructions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Connect an agent")
                .font(.system(size: 12, weight: .semibold))

            copyRow(label: "Endpoint", value: controller.endpointURL, key: "endpoint")
            copyRow(label: "Claude Code", value: controller.claudeCodeCommand, key: "command")

            Text("External agents on this Mac (Claude Code, Claude Desktop, any MCP client) can now inspect and edit this project. The server is reachable from this machine only.")
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .background(Color(nsColor: .controlBackgroundColor))
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private func copyRow(label: String, value: String, key: String) -> some View {
        HStack(spacing: 8) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 76, alignment: .leading)

            Text(value)
                .font(.system(size: 11, design: .monospaced))
                .lineLimit(1)
                .truncationMode(.middle)
                .textSelection(.enabled)

            Spacer()

            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(value, forType: .string)
                copiedField = key
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                    if copiedField == key { copiedField = nil }
                }
            } label: {
                Image(systemName: copiedField == key ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11))
            }
            .buttonStyle(.plain)
            .help("Copy")
        }
    }

    private var toolList: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Exposed tools")
                .font(.system(size: 12, weight: .semibold))

            ForEach(controller.makeTools(), id: \.name) { tool in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "wrench.and.screwdriver")
                        .font(.system(size: 9))
                        .foregroundStyle(.blue)
                    Text(tool.name)
                        .font(.system(size: 11, design: .monospaced))
                }
            }
        }
    }

    private var callLog: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Activity")
                .font(.system(size: 12, weight: .semibold))

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 3) {
                        if controller.callLog.isEmpty {
                            Text("No MCP activity yet.")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }

                        ForEach(controller.callLog) { entry in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(entry.date, style: .time)
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(.secondary)
                                Text(entry.message)
                                    .font(.system(size: 10, design: .monospaced))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            .id(entry.id)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                }
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .onChange(of: controller.callLog.count) { _ in
                    if let last = controller.callLog.last {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private func applyPort() {
        guard let value = Int(portText), (1024...65535).contains(value) else { return }
        controller.port = UInt16(value)
    }
}
