//
//  LocalModelTranslator.swift
//  AgenticDesigner
//
//  Paragraph translation through the user's LOCAL models (Ollama, LM Studio,
//  Hugging Face Transformers, or any OpenAI-compatible server) — no cloud
//  calls. Model
//  discovery tries Ollama's /api/tags first, then the OpenAI-style
//  /v1/models; chat goes through /v1/chat/completions, which both runtimes
//  serve.
//

import Foundation
import Combine

@MainActor
final class LocalModelTranslator: ObservableObject {

    static let helsinkiModel = "Helsinki-NLP/opus-mt-en-he"

    @Published var endpoint: String {
        didSet { UserDefaults.standard.set(endpoint, forKey: Self.endpointKey) }
    }
    @Published var selectedModel: String {
        didSet { UserDefaults.standard.set(selectedModel, forKey: Self.modelKey) }
    }
    @Published var targetLanguage: String {
        didSet { UserDefaults.standard.set(targetLanguage, forKey: Self.languageKey) }
    }
    @Published private(set) var availableModels: [String] = []
    // Number of in-flight requests — batch mode runs several in parallel.
    @Published private(set) var activeTranslations = 0
    @Published private(set) var lastError: String?

    private var helsinkiWorker: Process?

    var isTranslating: Bool { activeTranslations > 0 }

    static let commonLanguages = ["Hebrew", "English", "Arabic", "French", "German", "Spanish", "Russian", "Chinese", "Japanese"]

    // A cold local model may stream nothing for minutes while loading
    // weights — the shared session's 60s idle timeout kills it first.
    private static let session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 600
        config.timeoutIntervalForResource = 1200
        return URLSession(configuration: config)
    }()

    private static let endpointKey = "localTranslatorEndpoint"
    private static let modelKey = "localTranslatorModel"
    private static let languageKey = "localTranslatorLanguage"

    init() {
        endpoint = UserDefaults.standard.string(forKey: Self.endpointKey) ?? "http://127.0.0.1:11434"
        selectedModel = UserDefaults.standard.string(forKey: Self.modelKey) ?? ""
        targetLanguage = UserDefaults.standard.string(forKey: Self.languageKey) ?? "Hebrew"
    }

    deinit {
        helsinkiWorker?.terminate()
    }

    // MARK: - Model discovery

    func refreshModels() async {
        lastError = nil
        // Ollama native listing first — it includes every pulled model.
        var discovered = await fetchOllamaTags()
        if discovered == nil {
            discovered = await fetchOpenAIModels()
        }
        if let models = discovered {
            availableModels = Array(Set(models + [Self.helsinkiModel])).sorted()
            if selectedModel.isEmpty || !availableModels.contains(selectedModel) {
                selectedModel = availableModels.first ?? ""
            }
        } else {
            availableModels = [Self.helsinkiModel]
            if selectedModel.isEmpty || !availableModels.contains(selectedModel) {
                selectedModel = Self.helsinkiModel
            }
            lastError = "No Ollama/LM Studio server at \(endpoint). The Helsinki model is still available."
        }
    }

    private func fetchOllamaTags() async -> [String]? {
        guard let url = URL(string: "\(endpoint)/api/tags") else { return nil }
        guard let (data, response) = try? await Self.session.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = parsed["models"] as? [[String: Any]]
        else { return nil }
        return models.compactMap { $0["name"] as? String }
    }

    private func fetchOpenAIModels() async -> [String]? {
        guard let url = URL(string: "\(endpoint)/v1/models") else { return nil }
        guard let (data, response) = try? await Self.session.data(from: url),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let models = parsed["data"] as? [[String: Any]]
        else { return nil }
        return models.compactMap { $0["id"] as? String }
    }

    // MARK: - Translation

    func translate(_ text: String, to language: String? = nil, model: String? = nil) async throws -> String {
        let useModel = model ?? selectedModel
        guard !useModel.isEmpty else {
            throw LocalTranslatorError.noModel
        }
        let useLanguage = language ?? targetLanguage

        activeTranslations += 1
        defer { activeTranslations -= 1 }

        if useModel == Self.helsinkiModel {
            guard useLanguage.caseInsensitiveCompare("Hebrew") == .orderedSame else {
                throw LocalTranslatorError.unsupportedLanguage(model: useModel, language: useLanguage)
            }
            return try await translateWithHelsinki(text)
        }

        guard let url = URL(string: "\(endpoint)/v1/chat/completions") else {
            throw LocalTranslatorError.badEndpoint(endpoint)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Non-streaming: no bytes arrive until the answer is DONE, so this
        // idle timeout must cover the whole generation. A throttled GPU can
        // push a long paragraph past 300s — timing out then abandons a
        // generation ollama keeps running, which steals GPU from the next
        // paragraph and cascades. Cap tokens instead of racing the clock.
        request.timeoutInterval = 600
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": useModel,
            "stream": false,
            "max_tokens": 1600,
            "temperature": 0.2,
            "messages": [
                [
                    "role": "system",
                    "content": "You are a professional translator. Translate the user's text into \(useLanguage). Preserve the meaning and tone. Keep mathematical symbols, notation and formulas EXACTLY as they appear - never convert them to LaTeX or rewrite them. The text may contain placeholder tokens like ⟦0⟧ or ⟦1⟧ — keep every token EXACTLY as written, at the position where its content belongs in the translated sentence; never translate, drop, or renumber them. Output ONLY the translation — no explanations, no quotes, no notes."
                ],
                ["role": "user", "content": text]
            ]
        ])

        let (data, response) = try await Self.session.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else {
            let body = String(data: data.prefix(300), encoding: .utf8) ?? ""
            throw LocalTranslatorError.serverError(body)
        }
        guard let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let choices = parsed["choices"] as? [[String: Any]],
              let message = choices.first?["message"] as? [String: Any],
              let content = message["content"] as? String
        else {
            throw LocalTranslatorError.badResponse
        }
        let translated = Self.stripReasoning(content).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !translated.isEmpty else { throw LocalTranslatorError.badResponse }
        return translated
    }

    private func translateWithHelsinki(_ text: String) async throws -> String {
        try await ensureHelsinkiWorker()
        guard let url = URL(string: "http://127.0.0.1:17841/translate") else {
            throw LocalTranslatorError.badResponse
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 1200
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["text": text])

        let (data, response) = try await Self.session.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw LocalTranslatorError.badResponse }
        guard (200..<300).contains(status), let translated = payload["translation"] as? String else {
            throw LocalTranslatorError.helsinkiWorker(payload["error"] as? String ?? "Unexpected worker response")
        }
        let result = translated.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !result.isEmpty else { throw LocalTranslatorError.badResponse }
        return result
    }

    private func ensureHelsinkiWorker() async throws {
        let healthURL = URL(string: "http://127.0.0.1:17841/health")!
        if (try? await Self.session.data(from: healthURL)) != nil { return }

        if helsinkiWorker == nil || helsinkiWorker?.isRunning == false {
            guard let scriptURL = Bundle.main.url(forResource: "helsinki_translation_server", withExtension: "py", subdirectory: "Resources")
                    ?? Bundle.main.url(forResource: "helsinki_translation_server", withExtension: "py")
            else { throw LocalTranslatorError.helsinkiWorker("Bundled translation worker is missing.") }

            let configuredPython = UserDefaults.standard.string(forKey: "helsinkiTranslatorPython")
            let candidates = [configuredPython, "/Users/ariel/.agenticdesigner/pdf-translate-venv/bin/python", "/opt/homebrew/bin/python3", "/usr/bin/python3"]
                .compactMap { $0 }
            guard let python = candidates.first(where: { FileManager.default.isExecutableFile(atPath: $0) }) else {
                throw LocalTranslatorError.helsinkiWorker("Python 3 is required for the Helsinki model.")
            }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: python)
            process.arguments = [scriptURL.path]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            do {
                try process.run()
                helsinkiWorker = process
            } catch {
                throw LocalTranslatorError.helsinkiWorker(error.localizedDescription)
            }
        }

        for _ in 0..<40 {
            try await Task.sleep(nanoseconds: 100_000_000)
            if let (_, response) = try? await Self.session.data(from: healthURL),
               (response as? HTTPURLResponse)?.statusCode == 200 { return }
            if helsinkiWorker?.isRunning == false { break }
        }
        throw LocalTranslatorError.helsinkiWorker("Could not start the local worker. Install transformers, torch, and sentencepiece in the configured Python environment.")
    }

    // Reasoning models (qwen3 etc.) may wrap deliberation in <think> tags —
    // keep only the final answer.
    private static func stripReasoning(_ text: String) -> String {
        guard let close = text.range(of: "</think>") else { return text }
        return String(text[close.upperBound...])
    }

    // Right-to-left detection drives the replacement's text alignment and
    // font choice (Hebrew/Arabic glyph coverage).
    static func isRightToLeft(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            (0x0590...0x08FF).contains(Int(scalar.value)) // Hebrew, Arabic + extensions
        }
    }
}

enum LocalTranslatorError: LocalizedError {
    case noModel
    case badEndpoint(String)
    case serverError(String)
    case badResponse
    case unsupportedLanguage(model: String, language: String)
    case helsinkiWorker(String)

    var errorDescription: String? {
        switch self {
        case .noModel: return "No local model selected — open the Translate tool settings and pick one."
        case .badEndpoint(let endpoint): return "Invalid endpoint: \(endpoint)"
        case .serverError(let body): return "Local model server error: \(body)"
        case .badResponse: return "The local model returned an unexpected response."
        case .unsupportedLanguage(let model, let language): return "\(model) only supports English to Hebrew, not \(language)."
        case .helsinkiWorker(let message): return "Helsinki translator error: \(message)"
        }
    }
}
