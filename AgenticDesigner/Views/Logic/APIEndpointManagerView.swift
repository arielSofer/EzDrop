//
//  APIEndpointManagerView.swift
//  AgenticDesigner
//
//  Modal sheet for managing reusable API endpoint definitions, with a
//  live Test button to discover the response shape.
//

import SwiftUI

struct APIEndpointManagerView: View {
    @ObservedObject var logicViewModel: LogicViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var endpoints: [APIEndpointConfig] = []
    @State private var selectedEndpointId: UUID?
    @State private var testResult: String?
    @State private var isTesting = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("API Endpoints", systemImage: "network")
                    .font(.headline)
                    .foregroundStyle(.purple)
                Spacer()
                Button {
                    let endpoint = APIEndpointConfig(name: "New Endpoint")
                    endpoints.append(endpoint)
                    selectedEndpointId = endpoint.id
                } label: {
                    Label("Add", systemImage: "plus")
                }
            }
            .padding(16)

            Divider()

            HSplitView {
                endpointList
                    .frame(minWidth: 180, maxWidth: 220)

                endpointDetail
                    .frame(minWidth: 320, maxWidth: .infinity)
            }

            Divider()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    logicViewModel.designViewModel?.project.apiEndpoints = endpoints
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding(12)
        }
        .frame(width: 640, height: 520)
        .onAppear {
            endpoints = logicViewModel.designViewModel?.project.apiEndpoints ?? []
            selectedEndpointId = endpoints.first?.id
        }
    }

    // MARK: - List

    private var endpointList: some View {
        List(selection: $selectedEndpointId) {
            ForEach(endpoints) { endpoint in
                HStack(spacing: 6) {
                    Text(endpoint.method.rawValue)
                        .font(.system(size: 8, weight: .bold, design: .monospaced))
                        .padding(.horizontal, 4)
                        .padding(.vertical, 1)
                        .background(methodColor(endpoint.method).opacity(0.2))
                        .foregroundStyle(methodColor(endpoint.method))
                        .clipShape(RoundedRectangle(cornerRadius: 3))

                    Text(endpoint.name)
                        .font(.system(size: 11))
                        .lineLimit(1)
                }
                .tag(endpoint.id)
                .contextMenu {
                    Button("Delete", role: .destructive) {
                        endpoints.removeAll { $0.id == endpoint.id }
                    }
                }
            }
        }
        .listStyle(.sidebar)
    }

    private func methodColor(_ method: HTTPMethod) -> Color {
        switch method {
        case .get: return .green
        case .post: return .blue
        case .put: return .orange
        case .patch: return .purple
        case .delete: return .red
        }
    }

    // MARK: - Detail

    @ViewBuilder
    private var endpointDetail: some View {
        if let index = endpoints.firstIndex(where: { $0.id == selectedEndpointId }) {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    detailField("Name") {
                        TextField("Get User Profile", text: $endpoints[index].name)
                    }
                    detailField("Base URL") {
                        TextField("https://api.example.com", text: $endpoints[index].baseURL)
                            .font(.system(size: 11, design: .monospaced))
                    }
                    detailField("Path") {
                        TextField("/users/{userId}", text: $endpoints[index].path)
                            .font(.system(size: 11, design: .monospaced))
                    }
                    detailField("Method") {
                        Picker("", selection: $endpoints[index].method) {
                            ForEach(HTTPMethod.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .labelsHidden()
                        .pickerStyle(.segmented)
                    }
                    detailField("Authentication") {
                        Picker("", selection: $endpoints[index].authentication) {
                            ForEach(APIAuthentication.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                        }
                        .labelsHidden()
                    }

                    headersEditor(index: index)

                    detailField("Body Template (JSON, {{var}} placeholders)") {
                        TextField("{\"name\": \"{{userName}}\"}", text: Binding(
                            get: { endpoints[index].bodyTemplate ?? "" },
                            set: { endpoints[index].bodyTemplate = $0.isEmpty ? nil : $0 }
                        ), axis: .vertical)
                        .font(.system(size: 11, design: .monospaced))
                        .lineLimit(3...6)
                    }

                    testSection(index: index)
                }
                .padding(14)
                .textFieldStyle(.roundedBorder)
            }
        } else {
            VStack {
                Spacer()
                Text("Select or add an endpoint")
                    .foregroundStyle(.secondary)
                    .font(.caption)
                Spacer()
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func detailField<C: View>(_ label: String, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(.secondary)
            content()
        }
    }

    private func headersEditor(index: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Headers")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
                Spacer()
                Button {
                    endpoints[index].headers.append(HTTPHeaderField())
                } label: {
                    Image(systemName: "plus.circle").font(.system(size: 10))
                }
                .buttonStyle(.plain)
            }

            ForEach($endpoints[index].headers) { $header in
                HStack(spacing: 6) {
                    TextField("Header", text: $header.key)
                        .font(.system(size: 10, design: .monospaced))
                    TextField("Value", text: $header.value)
                        .font(.system(size: 10, design: .monospaced))
                    Button {
                        endpoints[index].headers.removeAll { $0.id == header.id }
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - Test

    private func testSection(index: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                testEndpoint(endpoints[index])
            } label: {
                Label(isTesting ? "Testing..." : "Test Request", systemImage: "play.circle")
                    .font(.system(size: 11))
            }
            .disabled(isTesting || endpoints[index].baseURL.isEmpty)

            if let testResult {
                ScrollView {
                    Text(testResult)
                        .font(.system(size: 9, design: .monospaced))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                .frame(height: 100)
                .padding(6)
                .background(Color(nsColor: .textBackgroundColor))
                .clipShape(RoundedRectangle(cornerRadius: 6))
            }
        }
    }

    private func testEndpoint(_ endpoint: APIEndpointConfig) {
        // Sends the request as configured (placeholders left as-is) so the
        // user can discover the real response shape for mapping.
        guard let url = URL(string: endpoint.fullURL) else {
            testResult = "Invalid URL: \(endpoint.fullURL)"
            return
        }

        isTesting = true
        testResult = nil

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        for header in endpoint.headers {
            request.setValue(header.value, forHTTPHeaderField: header.key)
        }
        if let body = endpoint.bodyTemplate, endpoint.method != .get {
            request.httpBody = Data(body.utf8)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        Task {
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                let bodyText = String(data: data.prefix(4000), encoding: .utf8) ?? "<binary>"
                await MainActor.run {
                    testResult = "HTTP \(status)\n\(bodyText)"
                    isTesting = false
                }
            } catch {
                await MainActor.run {
                    testResult = "Request failed: \(error.localizedDescription)"
                    isTesting = false
                }
            }
        }
    }
}
