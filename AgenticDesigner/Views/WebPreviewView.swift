//
//  WebPreviewView.swift
//  AgenticDesigner
//
//  Live web preview — the real exported HTML running in a WKWebView, the
//  Lovable-style "see the actual app" pane. Renders the current page via
//  WebExporter and offers Save (a deployable .html) / Copy HTML.
//

import SwiftUI
import WebKit
import AppKit
import UniformTypeIdentifiers

struct WebPreviewView: View {
    @ObservedObject var viewModel: ProjectViewModel
    @Environment(\.dismiss) private var dismiss

    private var html: String {
        let page = viewModel.project.pages[viewModel.currentPageIndex]
        let screens = page.nodes.filter { $0.type == .Frame }
        return WebExporter.html(
            for: screens,
            appName: viewModel.project.name,
            flows: page.logicFlows,
            globalVariables: viewModel.project.globalVariables,
            supabase: viewModel.project.supabaseConfig
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Label("Web Preview", systemImage: "globe")
                    .font(.headline)
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(html, forType: .string)
                } label: { Label("Copy HTML", systemImage: "doc.on.doc") }
                Button {
                    saveHTML()
                } label: { Label("Save .html", systemImage: "square.and.arrow.down") }
                    .buttonStyle(.borderedProminent)
                Button("Close") { dismiss() }
            }
            .padding(12)
            Divider()
            WebView(html: html)
        }
        .frame(width: 1000, height: 720)
    }

    private func saveHTML() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.html]
        panel.nameFieldStringValue = viewModel.project.name.replacingOccurrences(of: " ", with: "-") + ".html"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        try? html.data(using: .utf8)?.write(to: url)
    }
}

private struct WebView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> WKWebView {
        let webView = WKWebView()
        webView.setValue(false, forKey: "drawsBackground")
        webView.loadHTMLString(html, baseURL: nil)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        webView.loadHTMLString(html, baseURL: nil)
    }
}
