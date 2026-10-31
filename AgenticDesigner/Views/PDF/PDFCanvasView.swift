//
//  PDFCanvasView.swift
//  AgenticDesigner
//
//  The PDF Editor's center canvas: PDFKit's own PDFView (native rendering,
//  scrolling, zooming, text selection) wrapped for SwiftUI, with a custom
//  NSView subclass layered underneath that turns mouse gestures into
//  tool-specific edits — draw a rect for a shape/highlight, click for a
//  comment, drag a freehand path for ink/signature — routed through
//  PDFEditorViewModel so every edit is undo-tracked the same way an MCP
//  call would make it.
//

import SwiftUI
import PDFKit
import AppKit
import UniformTypeIdentifiers

struct PDFCanvasView: View {
    @ObservedObject var viewModel: PDFEditorViewModel

    var body: some View {
        ZStack {
            if viewModel.document != nil {
                PDFCanvasRepresentable(viewModel: viewModel)
            } else {
                emptyState
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor))
    }

    private var emptyState: some View {
        VStack(spacing: 14) {
            Image(systemName: "doc.richtext")
                .font(.system(size: 40))
                .foregroundStyle(.secondary)
            Text("No PDF open")
                .font(.headline)
            HStack(spacing: 10) {
                Button("New PDF") { viewModel.newDocument() }
                Button("Open…") { viewModel.openWithPanel() }
            }
        }
    }
}

// MARK: - NSViewRepresentable bridge

struct PDFCanvasRepresentable: NSViewRepresentable {
    @ObservedObject var viewModel: PDFEditorViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator(viewModel: viewModel)
    }

    func makeNSView(context: Context) -> PDFEditorNSView {
        let view = PDFEditorNSView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.backgroundColor = .underPageBackgroundColor
        view.coordinator = context.coordinator
        view.document = viewModel.document
        context.coordinator.pdfView = view

        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.selectionDidChange),
            name: .PDFViewSelectionChanged,
            object: view
        )
        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.pageDidChange),
            name: .PDFViewPageChanged,
            object: view
        )
        return view
    }

    func updateNSView(_ nsView: PDFEditorNSView, context: Context) {
        if nsView.document !== viewModel.document {
            nsView.document = viewModel.document
        }
        if let page = viewModel.currentPage, nsView.currentPage !== page {
            nsView.go(to: page)
        }
        nsView.toolMode = viewModel.toolMode
        context.coordinator.viewModel = viewModel
    }

    @MainActor
    final class Coordinator: NSObject {
        var viewModel: PDFEditorViewModel
        weak var pdfView: PDFEditorNSView?

        init(viewModel: PDFEditorViewModel) {
            self.viewModel = viewModel
        }

        @objc func selectionDidChange() {
            // Text-selection tool state lives on PDFView itself; nothing to
            // mirror into the view model unless a future tool needs it.
        }

        @objc func pageDidChange() {
            guard let pdfView, let document = viewModel.document,
                  let page = pdfView.currentPage
            else { return }
            let index = document.index(for: page)
            if index != NSNotFound, index != viewModel.currentPageIndex {
                viewModel.currentPageIndex = index
            }
        }
    }
}

// MARK: - Custom PDFView subclass: tool-driven mouse handling

final class PDFEditorNSView: PDFView {
    weak var coordinator: PDFCanvasRepresentable.Coordinator?
    var toolMode: PDFToolMode = .select {
        didSet {
            if toolMode != oldValue {
                hoverParagraph = nil
                needsDisplay = true
            }
        }
    }

    private var dragStartPoint: CGPoint?
    private var dragCurrentPoint: CGPoint?
    private var freehandStrokes: [[CGPoint]] = []
    private var rubberBandLayer: CAShapeLayer?
    // Selection feedback for the paragraph tools: the paragraph under the
    // cursor (hover, solid frame) and the one being worked on (dialog open
    // or local model translating — dashed frame), Design-mode style.
    private var hoverParagraph: (page: PDFPage, bounds: CGRect)?
    private var activeParagraph: (page: PDFPage, bounds: CGRect)? {
        didSet { needsDisplay = true }
    }
    private var hoverTrackingArea: NSTrackingArea?

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let hoverTrackingArea {
            removeTrackingArea(hoverTrackingArea)
        }
        let area = NSTrackingArea(
            rect: .zero,
            options: [.mouseMoved, .mouseEnteredAndExited, .activeInKeyWindow, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        hoverTrackingArea = area
    }

    override func mouseMoved(with event: NSEvent) {
        super.mouseMoved(with: event)
        guard toolMode == .editText || toolMode == .translate, let viewModel = coordinator?.viewModel else {
            if hoverParagraph != nil {
                hoverParagraph = nil
                needsDisplay = true
            }
            return
        }
        let viewPoint = convert(event.locationInWindow, from: nil)
        var next: (page: PDFPage, bounds: CGRect)?
        if let page = page(for: viewPoint, nearest: false) {
            let pagePoint = convert(viewPoint, to: page)
            if let paragraph = viewModel.paragraph(at: pagePoint, on: page) {
                next = (page, paragraph.bounds)
            }
        }
        if next?.bounds != hoverParagraph?.bounds || (next == nil) != (hoverParagraph == nil) {
            hoverParagraph = next
            needsDisplay = true
        }
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        if hoverParagraph != nil {
            hoverParagraph = nil
            needsDisplay = true
        }
    }

    override func mouseDown(with event: NSEvent) {
        guard toolMode != .select else {
            super.mouseDown(with: event)
            return
        }
        let viewPoint = convert(event.locationInWindow, from: nil)
        guard let page = page(for: viewPoint, nearest: true) else {
            super.mouseDown(with: event)
            return
        }
        let pagePoint = convert(viewPoint, to: page)

        if toolMode.isClickToPlace {
            handleClickPlace(at: pagePoint, page: page)
            return
        }

        dragStartPoint = pagePoint
        dragCurrentPoint = pagePoint
        if toolMode == .draw || toolMode == .signature {
            freehandStrokes = [[pagePoint]]
        }
    }

    override func mouseDragged(with event: NSEvent) {
        guard toolMode != .select, let page = currentPage ?? page(for: convert(event.locationInWindow, from: nil), nearest: true) else {
            super.mouseDragged(with: event)
            return
        }
        let viewPoint = convert(event.locationInWindow, from: nil)
        let pagePoint = convert(viewPoint, to: page)

        if toolMode == .draw || toolMode == .signature {
            if freehandStrokes.isEmpty { freehandStrokes = [[pagePoint]] }
            freehandStrokes[freehandStrokes.count - 1].append(pagePoint)
        } else {
            dragCurrentPoint = pagePoint
        }
        needsDisplay = true
    }

    override func mouseUp(with event: NSEvent) {
        guard toolMode != .select else {
            super.mouseUp(with: event)
            return
        }
        guard let page = currentPage ?? page(for: convert(event.locationInWindow, from: nil), nearest: true) else {
            super.mouseUp(with: event)
            return
        }

        defer {
            dragStartPoint = nil
            dragCurrentPoint = nil
            freehandStrokes = []
            needsDisplay = true
        }

        guard let viewModel = coordinator?.viewModel else { return }

        if toolMode == .draw {
            guard !freehandStrokes.isEmpty, freehandStrokes.contains(where: { $0.count > 1 }) else { return }
            viewModel.addInkDrawing(strokes: freehandStrokes, page: page)
            return
        }
        if toolMode == .signature {
            guard !freehandStrokes.isEmpty, freehandStrokes.contains(where: { $0.count > 1 }) else { return }
            viewModel.addSignature(strokes: freehandStrokes, page: page)
            return
        }

        guard let start = dragStartPoint, let end = dragCurrentPoint else { return }

        // A click (no meaningful drag) with the Edit Text tool targets the
        // whole PARAGRAPH of existing text under the cursor: its current
        // text prefills a multi-line editor, and the typed replacement is
        // patched over it at a matching font size, wrapped to the same
        // column width — click the text, literally rewrite it.
        let dragDistance = hypot(end.x - start.x, end.y - start.y)
        if toolMode == .editText, dragDistance < 4 {
            editTextParagraph(at: start, page: page, viewModel: viewModel)
            return
        }
        if toolMode == .translate, dragDistance < 4 {
            translateParagraph(at: start, page: page, viewModel: viewModel)
            return
        }

        let bounds = CGRect(
            x: min(start.x, end.x), y: min(start.y, end.y),
            width: max(4, abs(end.x - start.x)), height: max(4, abs(end.y - start.y))
        )
        applyDragTool(toolMode, bounds: bounds, page: page, viewModel: viewModel)
    }

    // Translate tool: detect the paragraph, run the LOCAL model, then show
    // the translation for confirmation/tweaks before patching it over the
    // original — RTL targets get right alignment and a Hebrew-capable font.
    private func translateParagraph(at point: CGPoint, page: PDFPage, viewModel: PDFEditorViewModel) {
        guard let paragraph = viewModel.paragraph(at: point, on: page) else {
            NSSound.beep()
            viewModel.statusMessage = "No text there — click on a paragraph to translate it."
            return
        }
        let translator = viewModel.translator
        viewModel.statusMessage = "Translating to \(translator.targetLanguage) with \(translator.selectedModel)…"
        setActiveParagraph(paragraph.bounds, on: page)

        Task { @MainActor in
            defer { self.setActiveParagraph(nil, on: nil) }
            do {
                let translated = try await translator.translate(paragraph.text)
                guard let confirmed = self.promptForText(
                    title: "Translate Paragraph",
                    message: "\(translator.targetLanguage) translation (edit before replacing if needed):",
                    prefill: translated,
                    multiline: true
                ) else {
                    viewModel.statusMessage = "Translation cancelled"
                    return
                }
                viewModel.annotationStyle.fontSize = min(72, max(6, paragraph.lineHeight * 0.72))
                viewModel.annotationStyle.textColor = .black
                viewModel.editText(bounds: paragraph.bounds.insetBy(dx: -2, dy: -1), page: page, newText: confirmed)
                viewModel.statusMessage = "Paragraph translated to \(translator.targetLanguage)"
            } catch {
                NSSound.beep()
                viewModel.statusMessage = "Translation failed: \(error.localizedDescription)"
            }
        }
    }

    private func editTextParagraph(at point: CGPoint, page: PDFPage, viewModel: PDFEditorViewModel) {
        guard let paragraph = viewModel.paragraph(at: point, on: page) else {
            NSSound.beep()
            viewModel.statusMessage = "No text there — click on a paragraph, or drag a box."
            return
        }
        setActiveParagraph(paragraph.bounds, on: page)
        defer { setActiveParagraph(nil, on: nil) }
        guard let replacement = promptForText(
            title: "Edit Text",
            message: "Rewrite this paragraph:",
            prefill: paragraph.text,
            multiline: true
        ) else { return }

        viewModel.annotationStyle.fontSize = min(72, max(6, paragraph.lineHeight * 0.72))
        viewModel.annotationStyle.textColor = .black
        viewModel.editText(bounds: paragraph.bounds.insetBy(dx: -2, dy: -1), page: page, newText: replacement)
    }

    private func promptForText(title: String, message: String, prefill: String, multiline: Bool = false) -> String? {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.addButton(withTitle: "Replace")
        alert.addButton(withTitle: "Cancel")

        let input: NSView
        let readValue: () -> String
        if multiline {
            let scroll = NSScrollView(frame: NSRect(x: 0, y: 0, width: 460, height: 150))
            let textView = NSTextView(frame: scroll.bounds)
            textView.string = prefill
            textView.font = NSFont.systemFont(ofSize: 13)
            textView.isRichText = false
            textView.isAutomaticQuoteSubstitutionEnabled = false
            textView.autoresizingMask = [.width]
            scroll.documentView = textView
            scroll.hasVerticalScroller = true
            scroll.borderType = .bezelBorder
            input = scroll
            readValue = { textView.string }
            alert.accessoryView = scroll
            alert.window.initialFirstResponder = textView
        } else {
            let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 360, height: 24))
            field.stringValue = prefill
            input = field
            readValue = { field.stringValue }
            alert.accessoryView = field
            alert.window.initialFirstResponder = field
        }
        _ = input

        guard alert.runModal() == .alertFirstButtonReturn else { return nil }
        let text = readValue().trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    private func handleClickPlace(at point: CGPoint, page: PDFPage) {
        guard let viewModel = coordinator?.viewModel else { return }
        let bounds = CGRect(x: point.x - 10, y: point.y - 10, width: 20, height: 20)
        switch toolMode {
        case .comment:
            viewModel.addAnnotation(type: .text, bounds: bounds, page: page, contents: "New comment")
        case .signature:
            break // signature uses drag (freehand), not click
        default:
            break
        }
    }

    private func applyDragTool(_ tool: PDFToolMode, bounds: CGRect, page: PDFPage, viewModel: PDFEditorViewModel) {
        switch tool {
        case .editText:
            guard let replacement = promptForText(title: "Edit Text", message: "Text to place over this region:", prefill: "") else { return }
            viewModel.editText(bounds: bounds, page: page, newText: replacement)
        case .replaceImage:
            promptForImage { image in
                guard let image else { return }
                viewModel.replaceImage(bounds: bounds, page: page, newImage: image)
            }
        case .shapeRect:
            viewModel.addAnnotation(type: .square, bounds: bounds, page: page)
        case .shapeCircle:
            viewModel.addAnnotation(type: .circle, bounds: bounds, page: page)
        case .shapeLine:
            let line = viewModel.addAnnotation(type: .line, bounds: bounds, page: page)
            line.startPoint = CGPoint(x: 0, y: bounds.height / 2)
            line.endPoint = CGPoint(x: bounds.width, y: bounds.height / 2)
        case .highlight:
            viewModel.addAnnotation(type: .highlight, bounds: bounds, page: page, color: .systemYellow)
        case .underline:
            viewModel.addAnnotation(type: .underline, bounds: bounds, page: page, color: .systemBlue)
        case .strikeOut:
            viewModel.addAnnotation(type: .strikeOut, bounds: bounds, page: page, color: .systemRed)
        case .freeText:
            viewModel.addFreeText(bounds: bounds, page: page, text: "Text")
        case .formTextField:
            viewModel.addFormField(kind: .formTextField, bounds: bounds, page: page, name: "field_\(Int(Date().timeIntervalSince1970))")
        case .formCheckbox:
            viewModel.addFormField(kind: .formCheckbox, bounds: bounds, page: page, name: "checkbox_\(Int(Date().timeIntervalSince1970))")
        case .crop:
            let pageIndex = document?.index(for: page) ?? 0
            viewModel.cropPage(at: pageIndex, to: bounds)
        default:
            break
        }
    }

    private func drawParagraphFrame(_ item: (page: PDFPage, bounds: CGRect), dashed: Bool) {
        let viewRect = convert(item.bounds.insetBy(dx: -4, dy: -3), from: item.page)
        guard viewRect.intersects(visibleRect) else { return }
        let path = NSBezierPath(roundedRect: viewRect, xRadius: 4, yRadius: 4)
        path.lineWidth = dashed ? 2 : 1.5
        if dashed {
            var pattern: [CGFloat] = [6, 4]
            path.setLineDash(&pattern, count: 2, phase: 0)
        }
        NSColor.controlAccentColor.withAlphaComponent(0.10).setFill()
        path.fill()
        NSColor.controlAccentColor.setStroke()
        path.stroke()
    }

    func setActiveParagraph(_ bounds: CGRect?, on page: PDFPage?) {
        if let bounds, let page {
            activeParagraph = (page, bounds)
        } else {
            activeParagraph = nil
        }
        displayIfNeeded()
    }

    private func promptForImage(completion: @escaping (NSImage?) -> Void) {
        let panel = NSOpenPanel()
        panel.title = "Choose Replacement Image"
        panel.allowedContentTypes = [.image]
        panel.canChooseDirectories = false
        guard panel.runModal() == .OK, let url = panel.url else {
            completion(nil)
            return
        }
        completion(NSImage(contentsOf: url))
    }

    // Live rubber-band feedback while dragging a shape/region tool.
    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)

        // Paragraph selection frames (Design-mode style): solid accent frame
        // under the cursor; dashed frame around the paragraph being edited
        // or translated.
        if let active = activeParagraph {
            drawParagraphFrame(active, dashed: true)
        } else if let hover = hoverParagraph {
            drawParagraphFrame(hover, dashed: false)
        }

        guard toolMode != .select, toolMode != .draw, toolMode != .signature,
              let start = dragStartPoint, let end = dragCurrentPoint,
              let page = currentPage
        else { return }

        let startView = convert(start, from: page)
        let endView = convert(end, from: page)
        let rect = CGRect(
            x: min(startView.x, endView.x), y: min(startView.y, endView.y),
            width: abs(endView.x - startView.x), height: abs(endView.y - startView.y)
        )
        NSColor.controlAccentColor.withAlphaComponent(0.15).setFill()
        NSColor.controlAccentColor.setStroke()
        let path = NSBezierPath(rect: rect)
        path.lineWidth = 1.5
        path.fill()
        path.stroke()
    }
}
