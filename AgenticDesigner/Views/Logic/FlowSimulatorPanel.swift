//
//  FlowSimulatorPanel.swift
//  AgenticDesigner
//
//  Bottom console for the flow simulator: execution log, live variables,
//  and Success/Error choice buttons when a Firebase block pauses the run.
//

import SwiftUI

struct FlowSimulatorPanel: View {
    @ObservedObject var simulator: LogicSimulator

    var body: some View {
        HStack(spacing: 0) {
            executionLog
                .frame(maxWidth: .infinity)

            Divider()

            variablesPanel
                .frame(width: 220)
        }
        .frame(height: 150)
        .background(Color(nsColor: .windowBackgroundColor))
        .overlay(alignment: .top) {
            if let choice = simulator.awaitingChoice {
                choiceBar(choice)
            }
        }
    }

    // MARK: - Log

    private var executionLog: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(simulator.log) { entry in
                        HStack(spacing: 6) {
                            Image(systemName: entry.icon)
                                .font(.system(size: 9))
                                .foregroundStyle(entry.isError ? .red : .secondary)
                                .frame(width: 14)
                            Text(entry.message)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(entry.isError ? .red : .primary)
                                .textSelection(.enabled)
                        }
                        .id(entry.id)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
            }
            .onChange(of: simulator.log.count) { _ in
                if let last = simulator.log.last {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
        }
    }

    // MARK: - Variables

    private var variablesPanel: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Variables")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(.secondary)
                .padding(.bottom, 2)

            if simulator.variables.isEmpty {
                Text("(none yet)")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
            }

            ScrollView {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(simulator.variables.sorted(by: { $0.key < $1.key }), id: \.key) { key, value in
                        HStack(spacing: 4) {
                            Text(key)
                                .font(.system(size: 9, weight: .semibold, design: .monospaced))
                                .foregroundStyle(.blue)
                            Text("=")
                                .font(.system(size: 9))
                                .foregroundStyle(.tertiary)
                            Text(value.isEmpty ? "\"\"" : String(value.prefix(40)))
                                .font(.system(size: 9, design: .monospaced))
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(8)
    }

    // MARK: - Branch choice

    private func choiceBar(_ choice: LogicSimulator.BranchChoice) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "pause.circle.fill")
                .foregroundStyle(.orange)

            Text("\(choice.blockLabel):")
                .font(.system(size: 11, weight: .semibold))

            ForEach(choice.labels.indices, id: \.self) { index in
                Button {
                    simulator.choose(index)
                } label: {
                    Text(choice.labels[index])
                        .font(.system(size: 11, weight: .medium))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 3)
                }
                .buttonStyle(.borderedProminent)
                .tint(index == 0 ? .green : .red)
            }

            Spacer()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.thinMaterial)
    }
}
