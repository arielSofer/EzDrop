//
//  FirebaseConfigView.swift
//  AgenticDesigner
//
//  Modal sheet for configuring the project's Firebase settings:
//  credentials, auth methods, and Firestore collection templates.
//

import SwiftUI

struct FirebaseConfigView: View {
    @ObservedObject var logicViewModel: LogicViewModel
    @Environment(\.dismiss) private var dismiss

    @State private var config: FirebaseConfig = FirebaseConfig()
    @State private var newCollectionName: String = ""

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Firebase Configuration", systemImage: "flame.fill")
                    .font(.headline)
                    .foregroundStyle(.orange)
                Spacer()
            }
            .padding(16)

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Toggle("Enable Firebase for this project", isOn: $config.isEnabled)
                        .toggleStyle(.switch)

                    credentialsSection
                    Divider()
                    authSection
                    Divider()
                    collectionsSection
                }
                .padding(16)
            }

            Divider()

            HStack {
                Spacer()
                Button("Cancel") { dismiss() }
                Button("Save") {
                    logicViewModel.designViewModel?.project.firebaseConfig = config
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
            }
            .padding(12)
        }
        .frame(width: 480, height: 560)
        .onAppear {
            config = logicViewModel.designViewModel?.project.firebaseConfig ?? FirebaseConfig()
        }
    }

    // MARK: - Credentials

    private var credentialsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Project Credentials")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            configField("Project ID", text: $config.projectId, placeholder: "my-app-12345")
            configField("API Key", text: $config.apiKey, placeholder: "AIzaSy...")
            configField("Auth Domain", text: $config.authDomain, placeholder: "my-app-12345.firebaseapp.com")
            configField("Storage Bucket", text: $config.storageBucket, placeholder: "my-app-12345.appspot.com")
            configField("Sender ID", text: $config.messagingSenderId, placeholder: "123456789")
            configField("App ID", text: $config.appId, placeholder: "1:123:web:abc")
        }
    }

    private func configField(_ label: String, text: Binding<String>, placeholder: String) -> some View {
        HStack {
            Text(label)
                .font(.system(size: 11))
                .frame(width: 110, alignment: .trailing)
            TextField(placeholder, text: text)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 11, design: .monospaced))
        }
    }

    // MARK: - Auth

    private var authSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Authentication Methods")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            Toggle("Email / Password", isOn: $config.enableEmailAuth)
            Toggle("Google Sign-In", isOn: $config.enableGoogleAuth)
            Toggle("Apple Sign-In", isOn: $config.enableAppleAuth)
            Toggle("Anonymous Auth", isOn: $config.enableAnonymousAuth)
        }
        .toggleStyle(.checkbox)
        .font(.system(size: 12))
    }

    // MARK: - Collections

    private var collectionsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Firestore Collections")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)

            ForEach($config.defaultCollections) { $collection in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Image(systemName: "folder")
                            .font(.system(size: 11))
                            .foregroundStyle(.orange)
                        TextField("Collection name", text: $collection.name)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                        Spacer()
                        Button {
                            collection.fields.append(FirestoreFieldTemplate(name: "field"))
                        } label: {
                            Image(systemName: "plus.circle")
                                .font(.system(size: 11))
                        }
                        .buttonStyle(.plain)
                        .help("Add field")
                        Button {
                            config.defaultCollections.removeAll { $0.id == collection.id }
                        } label: {
                            Image(systemName: "trash")
                                .font(.system(size: 10))
                                .foregroundStyle(.red)
                        }
                        .buttonStyle(.plain)
                    }

                    ForEach($collection.fields) { $field in
                        HStack(spacing: 6) {
                            Text("├")
                                .foregroundStyle(.tertiary)
                            TextField("name", text: $field.name)
                                .textFieldStyle(.plain)
                                .font(.system(size: 11, design: .monospaced))
                                .frame(width: 120)
                            Picker("", selection: $field.type) {
                                ForEach(["string", "number", "boolean", "timestamp", "map", "array"], id: \.self) {
                                    Text($0).tag($0)
                                }
                            }
                            .labelsHidden()
                            .frame(width: 110)
                            Toggle("required", isOn: $field.isRequired)
                                .toggleStyle(.checkbox)
                                .font(.system(size: 9))
                            Spacer()
                            Button {
                                collection.fields.removeAll { $0.id == field.id }
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 9))
                                    .foregroundStyle(.tertiary)
                            }
                            .buttonStyle(.plain)
                        }
                        .padding(.leading, 12)
                    }
                }
                .padding(8)
                .background(Color(nsColor: .controlBackgroundColor).opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 8))
            }

            HStack {
                TextField("New collection name", text: $newCollectionName)
                    .textFieldStyle(.roundedBorder)
                    .font(.system(size: 11))
                Button("Add Collection") {
                    let name = newCollectionName.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !name.isEmpty else { return }
                    config.defaultCollections.append(FirestoreCollectionTemplate(name: name))
                    newCollectionName = ""
                }
            }
        }
    }
}
