//
//  PDFEditorViewModel.swift
//  AgenticDesigner
//
//  Owns the open PDFDocument and every mutation PDF Editor mode (and its MCP
//  tools) perform on it: pages, annotations, overlay text/image edits,
//  metadata, undo/redo, file I/O. PDFKit's PDFDocument/PDFPage/PDFAnnotation
//  are the real model; this class is the single place that mutates them so
//  the UI and MCP tools go through identical, undo-tracked code paths.
//

import Foundation
import PDFKit
import AppKit
import Combine
import UniformTypeIdentifiers

@MainActor
final class PDFEditorViewModel: ObservableObject {

    @Published var document: PDFDocument?
    @Published var fileURL: URL?
    @Published var currentPageIndex: Int = 0
    @Published var toolMode: PDFToolMode = .select
    @Published var selectedAnnotation: PDFAnnotation?
    @Published var isDirty: Bool = false
    @Published var annotationStyle = PDFAnnotationStyle()
    @Published var statusMessage: String?
    @Published var zoomScale: CGFloat = 1.0
    @Published var metadata = PDFDocumentMetadata()
    // Paragraph translation through the user's local models (Ollama/LM Studio).
    let translator = LocalModelTranslator()
    @Published var externalPDFTranslationProgress: String?
    @Published var isExternalPDFTranslationRunning = false
    private var externalPDFTranslationProcess: Process?

    private var undoStack: [Data] = []
    private var redoStack: [Data] = []
    // Bumped on every mutation so SwiftUI views keyed on it (thumbnails,
    // canvas) redraw — PDFDocument/PDFPage/PDFAnnotation are reference
    // types Combine can't see inside of.
    @Published private(set) var revision: Int = 0

    var pageCount: Int { document?.pageCount ?? 0 }

    var pages: [PDFPageSummary] {
        guard let document else { return [] }
        return (0..<document.pageCount).compactMap { index in
            guard let page = document.page(at: index) else { return nil }
            let bounds = page.bounds(for: .mediaBox)
            return PDFPageSummary(id: index, label: "\(index + 1)", size: bounds.size, rotation: page.rotation)
        }
    }

    var currentPage: PDFPage? {
        guard let document, document.pageCount > currentPageIndex, currentPageIndex >= 0 else { return nil }
        return document.page(at: currentPageIndex)
    }

    // MARK: - Google PDF translation pipeline

    func runGooglePDFTranslation() {
        guard !isExternalPDFTranslationRunning else { return }
        guard let fileURL else {
            statusMessage = "Open a PDF first"
            externalPDFTranslationProgress = "Open a PDF first"
            return
        }

        let pythonURL = URL(fileURLWithPath: "/Users/ariel/.agenticdesigner/pdf-translate-venv/bin/python")
        let translateScriptURL = URL(fileURLWithPath: "/Users/ariel/Downloads/mml_translate_to_hebrew.py")
        let exportScriptURL = URL(fileURLWithPath: "/Users/ariel/Downloads/mml_export_readable_hebrew_pdf.py")

        guard FileManager.default.isExecutableFile(atPath: pythonURL.path) else {
            statusMessage = "Translation Python environment is missing"
            externalPDFTranslationProgress = "Missing Python environment"
            return
        }
        guard FileManager.default.fileExists(atPath: translateScriptURL.path),
              FileManager.default.fileExists(atPath: exportScriptURL.path)
        else {
            statusMessage = "Translation scripts are missing"
            externalPDFTranslationProgress = "Missing translation scripts"
            return
        }

        let outputDir = fileURL
            .deletingPathExtension()
            .deletingLastPathComponent()
            .appendingPathComponent("\(fileURL.deletingPathExtension().lastPathComponent)-hebrew-translation", isDirectory: true)
        let readablePDFURL = outputDir.appendingPathComponent("\(fileURL.deletingPathExtension().lastPathComponent)-hebrew-readable.pdf")

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = [
            "-lc",
            "\"\(pythonURL.path)\" \"\(translateScriptURL.path)\" && \"\(pythonURL.path)\" \"\(exportScriptURL.path)\""
        ]

        var environment = ProcessInfo.processInfo.environment
        environment["MML_TRANSLATOR"] = "google"
        environment["MML_PDF_PATH"] = fileURL.path
        environment["MML_OUT_DIR"] = outputDir.path
        process.environment = environment

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.terminationHandler = { [weak self] finishedProcess in
            let outputData = pipe.fileHandleForReading.readDataToEndOfFile()
            let output = String(data: outputData, encoding: .utf8) ?? ""
            let tail = output
                .split(whereSeparator: \.isNewline)
                .suffix(3)
                .map(String.init)
                .joined(separator: " ")

            Task { @MainActor in
                guard let self else { return }
                self.externalPDFTranslationProcess = nil
                self.isExternalPDFTranslationRunning = false
                if finishedProcess.terminationStatus == 0 {
                    self.externalPDFTranslationProgress = "Done: \(readablePDFURL.lastPathComponent)"
                    self.statusMessage = "Created \(readablePDFURL.lastPathComponent)"
                    NSWorkspace.shared.activateFileViewerSelecting([readablePDFURL])
                } else {
                    self.externalPDFTranslationProgress = "Failed: \(tail)"
                    self.statusMessage = "Google translation failed"
                }
            }
        }

        do {
            try process.run()
            externalPDFTranslationProcess = process
            isExternalPDFTranslationRunning = true
            externalPDFTranslationProgress = "Running Google translation..."
            statusMessage = "Running Google translation..."
        } catch {
            externalPDFTranslationProgress = "Could not start: \(error.localizedDescription)"
            statusMessage = "Could not start translation"
        }
    }

    func cancelGooglePDFTranslation() {
        externalPDFTranslationProcess?.terminate()
        externalPDFTranslationProcess = nil
        isExternalPDFTranslationRunning = false
        externalPDFTranslationProgress = "Cancelled"
        statusMessage = "Google translation cancelled"
    }

    // MARK: - File operations

    func newDocument(pageSize: CGSize = CGSize(width: 612, height: 792)) {
        let document = PDFDocument()
        if let page = Self.blankPage(size: pageSize) {
            document.insert(page, at: 0)
        }
        self.document = document
        fileURL = nil
        currentPageIndex = 0
        undoStack.removeAll()
        redoStack.removeAll()
        isDirty = false
        metadata = PDFDocumentMetadata()
        statusMessage = "New PDF"
        bumpRevision()
    }

    @discardableResult
    func open(url: URL) throws -> Bool {
        guard let document = PDFDocument(url: url) else {
            throw PDFEditorError.cannotOpen(url.lastPathComponent)
        }
        self.document = document
        fileURL = url
        currentPageIndex = 0
        selectedAnnotation = nil
        undoStack.removeAll()
        redoStack.removeAll()
        isDirty = false
        metadata = PDFDocumentMetadata(from: document)
        statusMessage = "Opened \(url.lastPathComponent)"
        bumpRevision()
        return true
    }

    func openWithPanel() {
        let panel = NSOpenPanel()
        panel.title = "Open PDF"
        panel.allowedContentTypes = [.pdf]
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try open(url: url)
        } catch {
            statusMessage = "Open failed: \(error.localizedDescription)"
        }
    }

    @discardableResult
    func save() -> Bool {
        guard let fileURL else { return saveAs() }
        return write(to: fileURL)
    }

    @discardableResult
    func saveAs() -> Bool {
        let panel = NSSavePanel()
        panel.title = "Save PDF"
        panel.allowedContentTypes = [.pdf]
        panel.nameFieldStringValue = fileURL?.lastPathComponent ?? "Untitled.pdf"
        guard panel.runModal() == .OK, let url = panel.url else { return false }
        let destination = url.pathExtension.lowercased() == "pdf" ? url : url.appendingPathExtension("pdf")
        let ok = write(to: destination)
        if ok { fileURL = destination }
        return ok
    }

    @discardableResult
    private func write(to url: URL) -> Bool {
        guard let document else { return false }
        metadata.apply(to: document)
        guard document.write(to: url) else {
            statusMessage = "Save failed"
            return false
        }
        isDirty = false
        statusMessage = "Saved \(url.lastPathComponent)"
        return true
    }

    // Bakes every overlay patch + its replacement into the page's own
    // pixels (so a viewer with no knowledge of our annotation convention
    // still sees the edit), then writes that flattened copy out. The live
    // in-app document is untouched — flattening is a one-way export step.
    @discardableResult
    func exportFlattened(to url: URL) -> Bool {
        guard let document else { return false }
        let flattened = PDFDocument()
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index), let rasterized = Self.flattenPage(page) else { continue }
            flattened.insert(rasterized, at: flattened.pageCount)
        }
        metadata.apply(to: flattened)
        guard flattened.write(to: url) else {
            statusMessage = "Export failed"
            return false
        }
        statusMessage = "Exported \(url.lastPathComponent)"
        return true
    }

    private static func flattenPage(_ page: PDFPage) -> PDFPage? {
        let bounds = page.bounds(for: .mediaBox)
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let ctx = CGContext(consumer: consumer, mediaBox: nil, nil)
        else { return nil }

        let mediaBox = bounds
        ctx.beginPDFPage([kCGPDFContextMediaBox as String: mediaBox] as CFDictionary)
        ctx.saveGState()
        // PDFPage.draw(with:to:) renders page content AND annotations
        // together, baking our overlay patches/replacements into the pixels.
        page.draw(with: .mediaBox, to: ctx)
        ctx.restoreGState()
        ctx.endPDFPage()
        ctx.closePDF()

        guard let flatDoc = PDFDocument(data: data as Data) else { return nil }
        return flatDoc.page(at: 0)
    }

    private static func blankPage(size: CGSize) -> PDFPage? {
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let ctx = CGContext(consumer: consumer, mediaBox: nil, nil)
        else { return nil }
        let mediaBox = CGRect(origin: .zero, size: size)
        ctx.beginPDFPage([kCGPDFContextMediaBox as String: mediaBox] as CFDictionary)
        ctx.setFillColor(.white)
        ctx.fill(mediaBox)
        ctx.endPDFPage()
        ctx.closePDF()
        return PDFDocument(data: data as Data)?.page(at: 0)
    }

    // MARK: - Undo / redo

    // Batch operations take ONE snapshot up front instead of one per edit.
    private var suppressUndoSnapshots = false

    func withSingleUndoStep<T>(_ body: @MainActor () throws -> T) rethrows -> T {
        snapshotForUndo()
        suppressUndoSnapshots = true
        defer { suppressUndoSnapshots = false }
        return try body()
    }

    private func snapshotForUndo() {
        guard !suppressUndoSnapshots else {
            isDirty = true
            return
        }
        guard let document, let data = document.dataRepresentation() else { return }
        undoStack.append(data)
        redoStack.removeAll()
        if undoStack.count > 40 { undoStack.removeFirst() }
        isDirty = true
    }

    func undo() {
        guard let data = undoStack.popLast(), let current = document?.dataRepresentation() else { return }
        redoStack.append(current)
        document = PDFDocument(data: data)
        selectedAnnotation = nil
        clampPageIndex()
        bumpRevision()
    }

    func redo() {
        guard let data = redoStack.popLast(), let current = document?.dataRepresentation() else { return }
        undoStack.append(current)
        document = PDFDocument(data: data)
        selectedAnnotation = nil
        clampPageIndex()
        bumpRevision()
    }

    private func clampPageIndex() {
        currentPageIndex = min(max(0, currentPageIndex), max(0, pageCount - 1))
    }

    private func bumpRevision() {
        revision += 1
    }

    // MARK: - Page management

    func addPage(after index: Int? = nil, size: CGSize? = nil) {
        guard let document else { return }
        snapshotForUndo()
        let referenceSize = size ?? currentPage?.bounds(for: .mediaBox).size ?? CGSize(width: 612, height: 792)
        guard let page = Self.blankPage(size: referenceSize) else { return }
        let insertAt = min((index ?? currentPageIndex) + 1, document.pageCount)
        document.insert(page, at: insertAt)
        currentPageIndex = insertAt
        statusMessage = "Added page \(insertAt + 1)"
        bumpRevision()
    }

    func removePage(at index: Int) {
        guard let document, document.pageCount > 1, (0..<document.pageCount).contains(index) else {
            statusMessage = "Can't remove the only page"
            return
        }
        snapshotForUndo()
        document.removePage(at: index)
        clampPageIndex()
        statusMessage = "Removed page \(index + 1)"
        bumpRevision()
    }

    func duplicatePage(at index: Int) {
        guard let document, let source = document.page(at: index) else { return }
        snapshotForUndo()
        guard let copy = Self.copyPage(source) else { return }
        document.insert(copy, at: index + 1)
        currentPageIndex = index + 1
        statusMessage = "Duplicated page \(index + 1)"
        bumpRevision()
    }

    // Vector-preserving page copy: replays the source page's content stream
    // into a fresh PDF-writing context (CGContext.drawPDFPage), so text and
    // vector paths stay real PDF content rather than a rasterized image.
    // Annotations aren't part of that content stream, so they're re-created
    // individually afterward.
    private static func copyPage(_ source: PDFPage) -> PDFPage? {
        guard let pageRef = source.pageRef else { return nil }
        let bounds = source.bounds(for: .mediaBox)
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let ctx = CGContext(consumer: consumer, mediaBox: nil, nil)
        else { return nil }

        let mediaBox = bounds
        ctx.beginPDFPage([kCGPDFContextMediaBox as String: mediaBox] as CFDictionary)
        ctx.drawPDFPage(pageRef)
        ctx.endPDFPage()
        ctx.closePDF()

        guard let newDoc = PDFDocument(data: data as Data), let newPage = newDoc.page(at: 0) else { return nil }
        newPage.rotation = source.rotation
        for annotation in source.annotations {
            // PDFKit auto-generates a Popup companion the moment a Text/
            // markup annotation is added to a page — cloning the source's
            // Popup too would leave two once the re-added parent grows its
            // own fresh one.
            guard annotation.type != "Popup" else { continue }
            if let clone = cloneAnnotation(annotation) {
                newPage.addAnnotation(clone)
            }
        }
        return newPage
    }

    private static func cloneAnnotation(_ annotation: PDFAnnotation) -> PDFAnnotation? {
        // Custom subclass: rebuild from its stored image rather than the
        // generic path below, which knows nothing about draw(with:in:).
        if let stamp = annotation as? PDFImageStampAnnotation {
            return PDFImageStampAnnotation(bounds: stamp.bounds, image: stamp.image)
        }

        let clone = PDFAnnotation(bounds: annotation.bounds, forType: annotation.type.map { PDFAnnotationSubtype(rawValue: $0) } ?? .freeText, withProperties: nil)
        clone.contents = annotation.contents
        clone.color = annotation.color
        clone.interiorColor = annotation.interiorColor
        clone.border = annotation.border
        clone.font = annotation.font
        clone.fontColor = annotation.fontColor
        clone.alignment = annotation.alignment

        // Form fields: carry over identity/type/value, not just appearance.
        if annotation.type == "Widget" {
            clone.fieldName = annotation.fieldName
            clone.widgetFieldType = annotation.widgetFieldType
            clone.widgetStringValue = annotation.widgetStringValue
            clone.buttonWidgetState = annotation.buttonWidgetState
        }

        if annotation.type == "Line" {
            clone.startPoint = annotation.startPoint
            clone.endPoint = annotation.endPoint
        }

        // Known gap: PDFKit doesn't expose a public reader for an Ink
        // annotation's stroke paths, so a duplicated page's ink drawings
        // and signatures keep their bounds/color but not the actual
        // strokes. Everything else round-trips exactly.
        return clone
    }

    func reorderPage(from source: Int, to destination: Int) {
        guard let document,
              (0..<document.pageCount).contains(source),
              destination >= 0, destination <= document.pageCount,
              source != destination
        else { return }
        snapshotForUndo()
        guard let page = document.page(at: source) else { return }
        document.removePage(at: source)
        let insertAt = destination > source ? destination - 1 : destination
        document.insert(page, at: min(insertAt, document.pageCount))
        currentPageIndex = min(insertAt, document.pageCount - 1)
        statusMessage = "Reordered pages"
        bumpRevision()
    }

    func rotatePage(at index: Int, by degrees: Int) {
        guard let page = document?.page(at: index) else { return }
        snapshotForUndo()
        let normalized = ((page.rotation + degrees) % 360 + 360) % 360
        page.rotation = normalized
        statusMessage = "Rotated page \(index + 1) to \(normalized)°"
        bumpRevision()
    }

    func cropPage(at index: Int, to rect: CGRect) {
        guard let page = document?.page(at: index) else { return }
        snapshotForUndo()
        page.setBounds(rect, for: .cropBox)
        statusMessage = "Cropped page \(index + 1)"
        bumpRevision()
    }

    // MARK: - Annotations (comments, highlights, drawings, shapes, signatures, form fields)

    @discardableResult
    func addAnnotation(
        type: PDFAnnotationSubtype,
        bounds: CGRect,
        page: PDFPage,
        contents: String? = nil,
        color: NSColor? = nil,
        properties: [PDFAnnotationKey: Any] = [:]
    ) -> PDFAnnotation {
        snapshotForUndo()
        let annotation = PDFAnnotation(bounds: bounds, forType: type, withProperties: nil)
        annotation.contents = contents
        annotation.color = color ?? annotationStyle.color
        if type == .square || type == .circle {
            annotation.border = PDFBorder()
            annotation.border?.lineWidth = annotationStyle.strokeWidth
        }
        for (key, value) in properties {
            annotation.setValue(value, forAnnotationKey: key)
        }
        page.addAnnotation(annotation)
        selectedAnnotation = annotation
        bumpRevision()
        return annotation
    }

    func addFreeText(bounds: CGRect, page: PDFPage, text: String) {
        snapshotForUndo()
        let annotation = PDFAnnotation(bounds: bounds, forType: .freeText, withProperties: nil)
        annotation.contents = text
        annotation.font = NSFont(name: annotationStyle.fontName, size: annotationStyle.fontSize) ?? NSFont.systemFont(ofSize: annotationStyle.fontSize)
        annotation.fontColor = annotationStyle.textColor
        annotation.color = .clear
        page.addAnnotation(annotation)
        selectedAnnotation = annotation
        statusMessage = "Added text box"
        bumpRevision()
    }

    func addInkDrawing(strokes: [[CGPoint]], page: PDFPage, color: NSColor? = nil, lineWidth: CGFloat? = nil) {
        guard !strokes.isEmpty else { return }
        snapshotForUndo()
        var union = CGRect.null
        for stroke in strokes {
            for point in stroke {
                union = union.union(CGRect(x: point.x, y: point.y, width: 1, height: 1))
            }
        }
        let padding: CGFloat = 6
        let bounds = union.insetBy(dx: -padding, dy: -padding)

        let ink = PDFAnnotation(bounds: bounds, forType: .ink, withProperties: nil)
        ink.color = color ?? annotationStyle.color
        let border = PDFBorder()
        border.lineWidth = lineWidth ?? annotationStyle.strokeWidth
        ink.border = border
        // PDFKit draws ink paths in ANNOTATION-LOCAL coordinates (origin at
        // bounds.origin); passing page coordinates offsets every stroke out
        // of the annotation's clip region, rendering nothing.
        for stroke in strokes {
            let path = NSBezierPath()
            guard let first = stroke.first else { continue }
            path.move(to: CGPoint(x: first.x - bounds.origin.x, y: first.y - bounds.origin.y))
            for point in stroke.dropFirst() {
                path.line(to: CGPoint(x: point.x - bounds.origin.x, y: point.y - bounds.origin.y))
            }
            ink.add(path)
        }
        page.addAnnotation(ink)
        selectedAnnotation = ink
        statusMessage = "Added drawing"
        bumpRevision()
    }

    // A signature is an ink drawing by convention — flagged via contents so
    // MCP/inspection tools can tell "this is the signature" apart from a
    // regular freehand annotation.
    func addSignature(strokes: [[CGPoint]], page: PDFPage) {
        addInkDrawing(strokes: strokes, page: page, color: .black, lineWidth: 2)
        selectedAnnotation?.contents = "Signature"
    }

    func addSignatureImage(_ image: NSImage, bounds: CGRect, page: PDFPage) {
        snapshotForUndo()
        let stamp = PDFAnnotation(bounds: bounds, forType: .stamp, withProperties: nil)
        stamp.contents = "Signature"
        stamp.setValue(image.tiffRepresentation as Any, forAnnotationKey: PDFAnnotationKey(rawValue: "AgenticDesignerStampImage"))
        page.addAnnotation(stamp)
        applyStampImage(image, to: stamp)
        selectedAnnotation = stamp
        statusMessage = "Added signature image"
        bumpRevision()
    }

    func addFormField(kind: PDFToolMode, bounds: CGRect, page: PDFPage, name: String) {
        snapshotForUndo()
        let widget = PDFAnnotation(bounds: bounds, forType: .widget, withProperties: nil)
        widget.fieldName = name
        switch kind {
        case .formCheckbox:
            widget.widgetFieldType = .button
            widget.buttonWidgetState = .offState
        default:
            widget.widgetFieldType = .text
            widget.widgetStringValue = ""
        }
        widget.color = .clear
        widget.border = {
            let border = PDFBorder()
            border.lineWidth = 1
            border.style = .dashed
            return border
        }()
        page.addAnnotation(widget)
        selectedAnnotation = widget
        statusMessage = "Added \(kind == .formCheckbox ? "checkbox" : "text") field"
        bumpRevision()
    }

    func removeAnnotation(_ annotation: PDFAnnotation) {
        guard let page = annotation.page else { return }
        snapshotForUndo()
        page.removeAnnotation(annotation)
        if selectedAnnotation === annotation { selectedAnnotation = nil }
        statusMessage = "Removed annotation"
        bumpRevision()
    }

    func moveAnnotation(_ annotation: PDFAnnotation, to bounds: CGRect, recordUndo: Bool = true) {
        if recordUndo { snapshotForUndo() }
        annotation.bounds = bounds
        bumpRevision()
    }

    // MARK: - Overlay text/image editing
    //
    // "Editing" existing page text/images means covering the original run
    // with an opaque patch (a Square annotation matching the surrounding
    // page color) and drawing the replacement on top — see the file header.

    @discardableResult
    private func fontForText(_ text: String, size: CGFloat) -> NSFont {
        if LocalModelTranslator.isRightToLeft(text) {
            return NSFont(name: "ArialHebrew", size: size) ?? NSFont.systemFont(ofSize: size)
        }
        return NSFont(name: annotationStyle.fontName, size: size) ?? NSFont.systemFont(ofSize: size)
    }

    private func headingVerticalLift(lineHeight: CGFloat) -> CGFloat {
        min(9, max(4, lineHeight * 0.35))
    }

    func editText(bounds: CGRect, page: PDFPage, newText: String, backgroundColor: NSColor = .white, alignment: NSTextAlignment = .natural, fitToBounds: Bool = false, verticalLift: CGFloat = 0) -> PDFAnnotation {
        snapshotForUndo()
        let patch = PDFAnnotation(bounds: bounds, forType: .square, withProperties: nil)
        patch.color = backgroundColor
        patch.interiorColor = backgroundColor
        patch.border = PDFBorder()
        patch.border?.lineWidth = 0
        patch.setValue(true, forAnnotationKey: PDFAnnotationKey(rawValue: "AgenticDesignerTextPatch"))
        page.addAnnotation(patch)

        // The replacement free-text sizes itself to FIT the new string.
        // Interactive edits: single-line runs widen; paragraphs keep their
        // column width, wrap, and grow DOWNWARD when longer.
        // fitToBounds (batch translation): NEVER grow — shrink the font
        // until the text fits the original block exactly, so neighboring
        // paragraphs can't overlap and the page layout stays intact.
        var font = fontForText(newText, size: annotationStyle.fontSize)
        var replacementBounds = bounds.insetBy(dx: 2, dy: 2)
        let pageBounds = page.bounds(for: .mediaBox)

        func wrappedHeight(_ measureFont: NSFont) -> CGFloat {
            ceil((newText as NSString).boundingRect(
                with: CGSize(width: replacementBounds.width, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                attributes: [.font: measureFont]
            ).height)
        }

        if fitToBounds {
            // Tight single-line blocks clip glyphs when the box is inset —
            // the replacement's background is clear (the patch below is the
            // opaque layer), so give it breathing room beyond the block
            // instead: only glyphs draw, nothing gets covered.
            replacementBounds = bounds.insetBy(dx: 0, dy: -2)
            var size = annotationStyle.fontSize
            while size > 5, wrappedHeight(font) > bounds.height + 2 {
                size *= 0.93
                font = fontForText(newText, size: size)
            }
            if verticalLift > 0 {
                let liftedY = min(pageBounds.maxY - replacementBounds.height, replacementBounds.origin.y + verticalLift)
                replacementBounds.origin.y = max(pageBounds.minY, liftedY)
            }
        } else {
            let singleLine = (newText as NSString).size(withAttributes: [.font: font])
            let isSingleLineRegion = bounds.height < singleLine.height * 2.2

            if isSingleLineRegion {
                let originalMidY = replacementBounds.midY
                replacementBounds.size.width = max(replacementBounds.width, singleLine.width + 8)
                replacementBounds.size.height = max(replacementBounds.height, singleLine.height + 4)
                replacementBounds.origin.y = max(pageBounds.minY, originalMidY - replacementBounds.height / 2)
            } else if !isSingleLineRegion || singleLine.width + 8 > replacementBounds.width {
                let neededHeight = wrappedHeight(font) + 6
                if neededHeight > replacementBounds.height {
                    replacementBounds.origin.y = max(pageBounds.minY, replacementBounds.origin.y - (neededHeight - replacementBounds.height))
                    replacementBounds.size.height = neededHeight
                }
            }
            if replacementBounds.maxX > pageBounds.maxX {
                replacementBounds.origin.x = max(pageBounds.minX, pageBounds.maxX - replacementBounds.width)
            }
        }

        // If the replacement outgrew the original region, extend the patch
        // to the union so the new text sits on a clean background instead
        // of over nearby content.
        if !bounds.contains(replacementBounds) {
            patch.bounds = bounds.union(replacementBounds.insetBy(dx: -2, dy: -2))
        }

        let replacement = PDFAnnotation(bounds: replacementBounds, forType: .freeText, withProperties: nil)
        replacement.contents = newText
        replacement.font = font
        replacement.fontColor = annotationStyle.textColor
        replacement.color = .clear
        replacement.alignment = alignment == .natural
            ? (LocalModelTranslator.isRightToLeft(newText) ? .right : .left)
            : alignment
        page.addAnnotation(replacement)

        selectedAnnotation = replacement
        statusMessage = "Edited text"
        bumpRevision()
        return replacement
    }

    // Removes every overlay edit (patch + replacement text) from a page so
    // it can be re-translated cleanly — the original page content was never
    // touched, so removal is a full restore. Returns how many annotations
    // were removed.
    func revertOverlayEdits(on page: PDFPage) -> Int {
        let patchKey = PDFAnnotationKey(rawValue: "AgenticDesignerTextPatch")
        let ours = page.annotations.filter { annotation in
            if annotation.value(forAnnotationKey: patchKey) != nil { return true }
            if annotation.type == "Square", let fill = annotation.interiorColor {
                // Saved-and-reloaded patches lose the custom key; identify
                // them as filled borderless squares (book PDFs don't ship those).
                let rgb = fill.usingColorSpace(.deviceRGB)
                let isFilled = rgb.map { $0.redComponent + $0.greenComponent + $0.blueComponent > 2.0 } ?? true
                return isFilled && (annotation.border?.lineWidth ?? 0) == 0
            }
            // Every FreeText on these documents is one of our replacements —
            // source PDFs ship links/notes, not free text. Matching on
            // Hebrew alone missed replacements the model mangled into
            // pure-symbol output.
            if annotation.type == "FreeText" { return true }
            return false
        }
        guard !ours.isEmpty else { return 0 }
        snapshotForUndo()
        for annotation in ours { page.removeAnnotation(annotation) }
        if let selected = selectedAnnotation, ours.contains(where: { $0 === selected }) {
            selectedAnnotation = nil
        }
        statusMessage = "Reverted \(ours.count) overlay edit(s)"
        bumpRevision()
        return ours.count
    }

    @discardableResult
    func replaceImage(bounds: CGRect, page: PDFPage, newImage: NSImage, backgroundColor: NSColor = .white) -> PDFAnnotation {
        snapshotForUndo()
        let patch = PDFAnnotation(bounds: bounds, forType: .square, withProperties: nil)
        patch.color = backgroundColor
        patch.interiorColor = backgroundColor
        patch.border = PDFBorder()
        patch.border?.lineWidth = 0
        page.addAnnotation(patch)

        let stamp = PDFAnnotation(bounds: bounds, forType: .stamp, withProperties: nil)
        page.addAnnotation(stamp)
        applyStampImage(newImage, to: stamp)

        selectedAnnotation = stamp
        statusMessage = "Replaced image"
        bumpRevision()
        return stamp
    }

    // PDFAnnotation has no built-in "draw this NSImage" mode, so a custom
    // subclass supplies the draw(with:in:) override — see
    // PDFImageStampAnnotation below.
    private func applyStampImage(_ image: NSImage, to annotation: PDFAnnotation) {
        guard let page = annotation.page else { return }
        let bounds = annotation.bounds
        page.removeAnnotation(annotation)
        let imageAnnotation = PDFImageStampAnnotation(bounds: bounds, image: image)
        page.addAnnotation(imageAnnotation)
        if selectedAnnotation === annotation { selectedAnnotation = imageAnnotation }
    }

    // MARK: - Batch page translation (shared by the UI button and MCP)

    struct BatchPageResult {
        var translated = 0
        var skipped = 0
        var failed = 0
        /// How the translated text had to be fitted, so layout fidelity is a
        /// measurement rather than an impression.
        var fitOutcomes: [TextFitPlan.Strategy: Int] = [:]

        /// Share of blocks placed without touching the type size.
        var typographyPreserved: Double {
            let total = fitOutcomes.values.reduce(0, +)
            guard total > 0 else { return 1 }
            let untouched = fitOutcomes[.unchanged] ?? 0
            let grown = fitOutcomes[.grewIntoSlack] ?? 0
            return Double(untouched + grown) / Double(total)
        }
    }

    /// One memory per target language, kept alive for the app's lifetime so a
    /// whole book shares a single cache and glossary.
    private var translationMemories: [String: TranslationMemory] = [:]

    func translationMemory(for language: String) -> TranslationMemory {
        let key = TranslationMemory.normalizedLanguage(language)
        if let existing = translationMemories[key] { return existing }
        let created = TranslationMemory(language: key)
        translationMemories[key] = created
        return created
    }

    @Published var batchProgress: String?
    private var batchTask: Task<Void, Never>?
    var isBatchTranslating: Bool { batchTask != nil }

    // Translates every prose paragraph on one page with the local model:
    // symbol-heavy blocks (equations) and already-RTL blocks are skipped,
    // translations run in parallel (bounded), and edits apply in document
    // order as ONE undo step. Short blocks are skipped UNLESS they look like
    // headings (larger-than-body font) — that keeps figure axis labels and
    // margin notes safe while chapter/section titles still translate.
    // Blocks already covered by a translation patch are skipped, so
    // re-running a page only fills in what's missing.
    func translatePage(at index: Int, targetLanguage: String? = nil, minWords: Int = 6, concurrency: Int = 3, includeHeadings: Bool = true) async -> BatchPageResult {
        var result = BatchPageResult()
        guard let document, let page = document.page(at: index) else { return result }

        let blocks = paragraphs(on: page)
        // Sanity cap for font sizing: a block whose line boxes are inflated
        // by an inline equation would otherwise render its translation huge.
        let sortedLineHeights = blocks.map(\.lineHeight).sorted()
        let pageMedianLineHeight = sortedLineHeights.isEmpty ? 12 : sortedLineHeights[sortedLineHeights.count / 2]

        // Patches from earlier runs (custom key when fresh; square-with-fill
        // shape as the fallback after a save/reload round-trip).
        let patchKey = PDFAnnotationKey(rawValue: "AgenticDesignerTextPatch")
        let existingPatches: [CGRect] = page.annotations.compactMap { annotation in
            let isPatch = annotation.value(forAnnotationKey: patchKey) != nil
                || (annotation.type == "Square" && annotation.interiorColor != nil)
            return isPatch ? annotation.bounds : nil
        }
        func alreadyPatched(_ bounds: CGRect) -> Bool {
            existingPatches.contains { patch in
                let overlap = patch.intersection(bounds)
                return !overlap.isNull && overlap.width * overlap.height > 0.3 * bounds.width * bounds.height
            }
        }

        // Equation glyphs come out of PDF math fonts as a wide zoo of
        // symbols — arrows in every direction, super/subscripts, blackboard
        // and script letters (U+1D400 block). One is enough to poison a
        // model rewrite, so the threshold is strict.
        var mathMarkers = CharacterSet(charactersIn: "∈∉ℝℕℤℚℂ⇒⇐⇑⇓⇔↦→←↑↓↕↖↗↘↙∀∃∑∏∫≃≅≈≪≫≠≤≥⊤⊥∥×÷√∇∂λΣΠ⊗⊕⊖⊙∘∗†‖⟨⟩∅∞∝∼⋅𝟙")
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x1D400)!...Unicode.Scalar(0x1D7FF)!) // math alphanumerics
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x2070)!...Unicode.Scalar(0x209F)!)   // super/subscripts

        // Table-of-contents blocks: section numbers + page numbers fused
        // into one run, OR a single entry ("10.6 Title .... 336") — either
        // way translating them destroys the leader/number columns.
        func looksLikeTOC(_ text: String) -> Bool {
            let sectionRefs = text.matches(of: /\d+\.\d+/).count
            let pageRefs = text.matches(of: /\s\d{1,4}(\s|$)/).count
            if sectionRefs >= 2 && pageRefs >= 2 { return true }
            let trimmed = text.trimmingCharacters(in: .whitespaces)
            return trimmed.firstMatch(of: /^\d+(\.\d+)*\s/) != nil
                && trimmed.firstMatch(of: /\s\d{1,4}$/) != nil
        }

        // Glyphs that only ever come from typeset math (blackboard letters,
        // super/subscripts, arrows — which are how PDFKit mangles sub/
        // superscripted tokens) — a single one means the block IS notation.
        var hardMathMarkers = CharacterSet(charactersIn: "ℝℕℤℚℂ𝟙↑↓⇑⇓↖↗↘↙↦→⇒⇐⇔∈∉↦∀∃")
        hardMathMarkers.insert(charactersIn: Unicode.Scalar(0x1D400)!...Unicode.Scalar(0x1D7FF)!)
        hardMathMarkers.insert(charactersIn: Unicode.Scalar(0x2070)!...Unicode.Scalar(0x209F)!)

        // A page dominated by section-numbered lines IS a table of contents —
        // skip it wholesale (block-level patterns miss entries whose page
        // number split into its own line).
        let numberedBlocks = blocks.filter {
            $0.text.trimmingCharacters(in: .whitespaces).firstMatch(of: /^\d+(\.\d+)*\s/) != nil
        }.count
        let isTOCPage = numberedBlocks >= 5 && numberedBlocks * 2 >= blocks.count

        // Safe-prose geometry: only main-column, full-width blocks translate
        // reliably — margin notes, figure labels, table cells, list fragments
        // and rotated stacks all break layout when replaced. The body column
        // is the modal left edge of prose-sized blocks.
        let pageBox = page.bounds(for: .mediaBox)
        let proseSized = blocks.filter { $0.text.split(separator: " ").count >= minWords }
        let columnLeft: CGFloat? = {
            guard !proseSized.isEmpty else { return nil }
            var freq: [CGFloat: Int] = [:]
            for b in proseSized { freq[(b.bounds.minX / 8).rounded() * 8, default: 0] += 1 }
            return freq.max { $0.value < $1.value }?.key
        }()
        let columnWidth = proseSized.map(\.bounds.width).max() ?? pageBox.width * 0.6

        // A fixed "6 words or it isn't prose" rule was written to block figure
        // labels, but it also rejects legitimate short paragraphs — list items,
        // sub-headings, definition lines — and a page made of those loses
        // almost everything. Judge each block against the PAGE it lives on:
        // where most blocks are short, short IS the body text here.
        let blockWordCounts = blocks.map { $0.text.split(separator: " ").count }.sorted()
        let medianWords = blockWordCounts.isEmpty ? 0 : blockWordCounts[blockWordCounts.count / 2]
        let effectiveMinWords = medianWords < minWords ? max(3, medianWords) : minWords

        var candidates: [(order: Int, block: PDFParagraph, isHeading: Bool)] = []
        var claimedRects: [CGRect] = []
        var equationRects: [CGRect] = []
        for (order, block) in blocks.enumerated() {
            if isTOCPage { result.skipped += 1; continue }
            let words = block.text.split(separator: " ").count
            let letterCount = block.text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
            let letterFraction = Double(letterCount) / Double(max(1, block.text.count))
            let mathCount = block.text.unicodeScalars.filter { mathMarkers.contains($0) }.count
            // Any "=" (equations extract without spaces: "ImA=AIn") or a
            // single hard-math glyph disqualifies the block outright.
            let hasEquation = block.text.contains("=")
                || block.text.unicodeScalars.contains { hardMathMarkers.contains($0) }
            if hasEquation { equationRects.append(block.bounds) }
            // Prose only: math-laden blocks stay untranslated — a model
            // rewrite would mangle the notation AND their inflated line
            // boxes wreck the font sizing.
            let isHeading = includeHeadings && words >= 2 && words < minWords
                && block.lineHeight >= pageMedianLineHeight * 1.05
                && letterCount >= 4
            let mixedMathProse = !hasEquation || letterFraction >= 0.45
            // Clustering can occasionally emit blocks that share page area;
            // translating both stacks two patches — first claim wins.
            let overlapsClaimed = claimedRects.contains { rect in
                let overlap = rect.intersection(block.bounds)
                return !overlap.isNull && overlap.width * overlap.height > 0.15 * block.bounds.width * block.bounds.height
            }

            // Safe-prose gate (see column detection above).
            let b = block.bounds
            let isVerticalStack = b.height > b.width && b.height > block.lineHeight * 3 && b.width < 60
            let inHeaderStrip = b.maxY > pageBox.maxY - pageBox.height * 0.10
            let isCentered = abs(b.midX - pageBox.midX) < 20 && (columnLeft.map { b.minX - $0 > 24 } ?? false)
            let columnAligned = columnLeft.map { abs(b.minX - $0) < 14 } ?? true
            let wideEnough = b.width >= columnWidth * 0.55
            let trimmedText = block.text.trimmingCharacters(in: .whitespacesAndNewlines)
            // Fragments of a split paragraph translate mid-sentence: a block
            // starting lowercase, or a short block that doesn't end a
            // sentence, is a continuation — it stays with its parent.
            let startsLowercase = trimmedText.first.map { $0.isLowercase && $0.isLetter } ?? false
            let endsSentence = trimmedText.last.map { ".:!?;\u{05F4}\")".contains($0) } ?? false
            // A block that doesn't close its sentence continues elsewhere
            // (next column/page) — translating it splices languages
            // mid-sentence, so the whole paragraph stays English instead.
            // A bare leading number is a merged-in running header.
            let startsWithBareNumber = trimmedText.firstMatch(of: /^\d+\s/) != nil
            let isFragment = startsLowercase || !endsSentence || startsWithBareNumber
            // A heading is never SMALLER than body text; a figure caption
            // almost always is. Without this, "(a) Geometric vectors." (23% of
            // the column width, sitting inside Figure 2.1) matched "centered
            // and short", took the heading path — which skips the width and
            // column checks entirely — and its opaque patch was painted across
            // the chart. Measured on this page: captions ran 11–25% of column
            // width, i.e. nothing a body paragraph could ever be.
            let centeredShortTitle = includeHeadings && words >= 1 && words < minWords
                && letterCount >= 4
                && isCentered
                && b.midY > pageBox.midY
                && block.lineHeight >= pageMedianLineHeight
                && b.width >= columnWidth * 0.35
            let isFigureLabel = words <= max(6, minWords)
                && b.midY > pageBox.minY + pageBox.height * 0.30
                && (columnLeft.map { abs(b.minX - $0) > 30 } ?? false)
            let safeBody = (columnAligned || isCentered) && wideEnough && !isVerticalStack && !inHeaderStrip && !isFragment
            let safeHeading = (isHeading || centeredShortTitle) && !isVerticalStack && !inHeaderStrip && !startsLowercase

            if ((words >= effectiveMinWords && safeBody) || safeHeading), mixedMathProse, !isFigureLabel,
               !looksLikeTOC(block.text), !overlapsClaimed,
               !LocalModelTranslator.isRightToLeft(block.text), !alreadyPatched(block.bounds) {
                candidates.append((order, block, safeHeading))
                claimedRects.append(block.bounds)
            } else {
                result.skipped += 1
            }
        }

        // A logical paragraph that clustering split around a formula must not
        // end up half-translated: fragments vertically adjacent to a skipped
        // equation block (same column, within ~a line's gap) stay English too.
        if !equationRects.isEmpty {
            candidates = candidates.filter { candidate in
                let bounds = candidate.block.bounds
                let joinsEquation = equationRects.contains { eq in
                    let horizontalOverlap = min(bounds.maxX, eq.maxX) - max(bounds.minX, eq.minX)
                    guard horizontalOverlap > 0.5 * min(bounds.width, eq.width) else { return false }
                    let gap = max(eq.minY - bounds.maxY, bounds.minY - eq.maxY)
                    return gap < candidate.block.lineHeight * 1.2
                }
                if joinsEquation { result.skipped += 1 }
                return !joinsEquation
            }
        }

        var translations: [Int: String] = [:]
        let translator = self.translator
        let memory = translationMemory(for: targetLanguage ?? "he")
        let bounded = max(1, min(concurrency, 6))
        await withTaskGroup(of: (Int, String?).self) { group in
            var next = 0
            func submit() {
                guard next < candidates.count, !Task.isCancelled else { return }
                let item = candidates[next]
                next += 1
                group.addTask { @MainActor in
                    // Identical source text always yields the identical
                    // translation — a textbook repeats "Definition", "Example",
                    // "Remark" hundreds of times, and asking the model afresh
                    // each time costs time AND invites the wording to drift.
                    if let remembered = memory.cached(item.block.text) {
                        return (item.order, remembered)
                    }

                    // Formulas never reach the model: they are swapped for
                    // sentinels first and restored verbatim afterwards. A
                    // translator handed "Ax = 0" will reorder or re-render it,
                    // which in a maths textbook is worse than leaving the
                    // sentence in English.
                    let masked = PDFMathGuard.mask(item.block.text)
                    guard !masked.isMostlyFormula else { return (item.order, nil) }

                    // Glossary terms are masked the same way, continuing the
                    // sentinel numbering so the two maskers never collide. The
                    // model cannot paraphrase a term it never sees.
                    let terms = memory.maskTerms(in: masked.masked, startingAt: masked.fragments.count + 1)

                    guard let raw = try? await translator.translate(terms.masked, to: targetLanguage) else {
                        return (item.order, nil)
                    }
                    var restoredTerms = raw
                    var lostTerm = false
                    for (token, translation) in terms.restorations {
                        if restoredTerms.contains(token) {
                            restoredTerms = restoredTerms.replacingOccurrences(of: token, with: translation)
                        } else {
                            lostTerm = true
                        }
                    }
                    guard !lostTerm else { return (item.order, nil) }

                    switch PDFMathGuard.restore(restoredTerms, from: masked) {
                    case .restored(let text):
                        memory.store(source: item.block.text, translation: text)
                        return (item.order, text)
                    case .corrupted:
                        // A sentinel came back mangled — the equation cannot be
                        // put back safely, so keep the original line.
                        return (item.order, nil)
                    }
                }
            }
            for _ in 0..<bounded { submit() }
            for await (order, translated) in group {
                if let translated {
                    translations[order] = translated
                } else {
                    result.failed += 1
                }
                submit()
            }
        }

        withSingleUndoStep {
            for (order, block, isHeading) in candidates {
                guard let translated = translations[order] else { continue }
                // Model-side mangling guard: prose in, arrow-junk out
                // happens on subscript-ish tokens ("In" -> "⇓ח"). A
                // translation that introduces math symbols the source
                // never had is garbage — keep the original text.
                let sourceMarkers = Set(block.text.unicodeScalars.filter { mathMarkers.contains($0) })
                let introducedMath = translated.unicodeScalars.contains { mathMarkers.contains($0) && !sourceMarkers.contains($0) }
                if introducedMath {
                    result.skipped += 1
                    continue
                }
                let cleanedTranslation = Self.separateHebrewLatinScripts(translated)
                // A line carrying an inline formula reports a box up to TWICE
                // the body's — measured on this book: 19.3pt line boxes on a
                // page whose prose median is 10.1pt, because the math glyphs
                // are taller. Sizing the replacement from that inflated number
                // rendered the translation ~40% too large, which then did not
                // fit its own block and painted over the paragraph beneath.
                // Body text is therefore pinned to the page's prose size;
                // headings are genuinely larger and keep their headroom.
                let cappedLineHeight = isHeading
                    ? min(block.lineHeight, pageMedianLineHeight * 1.4)
                    : min(block.lineHeight, pageMedianLineHeight)
                let sourceSize = min(72, max(6, cappedLineHeight * 0.72))

                // Ordered fitting instead of shrink-until-it-fits: the plan
                // prefers adjustments nobody can see (using genuinely empty
                // space below, a third of a point of tracking) and only then
                // reduces type size — and reports when it had to go far.
                let plan = PDFTextFitter.plan(
                    text: cleanedTranslation,
                    in: block.bounds,
                    sourceFontSize: sourceSize,
                    fontProvider: { [weak self] size in
                        self?.fontForText(cleanedTranslation, size: size)
                            ?? NSFont.systemFont(ofSize: size)
                    },
                    verticalSlack: PDFTextFitter.verticalSlack(
                        for: block.bounds,
                        among: candidates.map(\.block.bounds),
                        pageBounds: pageBox
                    ),
                    pageBounds: pageBox
                )
                annotationStyle.fontSize = plan.fontSize
                annotationStyle.textColor = .black
                result.fitOutcomes[plan.strategy, default: 0] += 1

                let lift = isHeading ? headingVerticalLift(lineHeight: block.lineHeight) : 0
                _ = editText(bounds: plan.bounds.insetBy(dx: -2, dy: -1), page: page, newText: cleanedTranslation, fitToBounds: true, verticalLift: lift)
                result.translated += 1
            }
        }
        return result
    }

    // UI entry point: translates an inclusive 0-based page range in the
    // background with live progress; cancelable between paragrpah waves.
    func translatePages(from firstIndex: Int, to lastIndex: Int, concurrency: Int = 3) {
        guard batchTask == nil, document != nil else { return }
        let lower = max(0, min(firstIndex, lastIndex))
        let upper = min(pageCount - 1, max(firstIndex, lastIndex))
        guard lower <= upper else { return }

        batchTask = Task { @MainActor in
            var total = BatchPageResult()
            for (step, index) in (lower...upper).enumerated() {
                if Task.isCancelled { break }
                batchProgress = "Translating page \(index + 1) (\(step + 1)/\(upper - lower + 1)) to \(translator.targetLanguage)…"
                let page = await rewritePage(at: index, concurrency: max(concurrency, 4))
                total.translated += page.translated
                total.skipped += page.keptOriginal
                total.failed += page.failed
            }
            batchProgress = Task.isCancelled
                ? "Cancelled — \(total.translated) paragraph(s) translated"
                : "Done: \(total.translated) paragraph(s) translated across \(upper - lower + 1) page(s)"
            batchTask = nil
            try? await Task.sleep(nanoseconds: 10_000_000_000)
            if batchTask == nil { batchProgress = nil }
        }
    }

    func cancelBatchTranslation() {
        batchTask?.cancel()
    }

    // MARK: - Paragraph detection

    // The block of consecutive text lines under a point. Lines cluster into
    // one paragraph while they stay in the same column, keep a normal
    // leading gap, use a similar font size, and no indented line (a new
    // paragraph's first line) interrupts — which handles books like this
    // one that separate paragraphs by indentation rather than spacing.
    private var textLineCache: (pageID: ObjectIdentifier, revision: Int, lines: [(string: String, bounds: CGRect)])?

    func paragraph(at point: CGPoint, on page: PDFPage) -> PDFParagraph? {
        let lines = cachedTextLines(on: page)
        guard let clicked = lines.firstIndex(where: { $0.bounds.insetBy(dx: -2, dy: -2).contains(point) }) else {
            return nil
        }

        func continuous(upper: (string: String, bounds: CGRect), lower: (string: String, bounds: CGRect)) -> Bool {
            let gap = upper.bounds.minY - lower.bounds.maxY
            let reference = min(upper.bounds.height, lower.bounds.height)
            guard gap < reference * 0.9 else { return false }
            let overlap = min(upper.bounds.maxX, lower.bounds.maxX) - max(upper.bounds.minX, lower.bounds.minX)
            guard overlap > reference else { return false }
            let sizeRatio = upper.bounds.height / max(1, lower.bounds.height)
            return sizeRatio > 0.7 && sizeRatio < 1.4
        }

        var first = clicked
        while first > 0, continuous(upper: lines[first - 1], lower: lines[first]) {
            // An indented line is a paragraph's first line — stop there.
            if lines[first].bounds.minX > lines[first - 1].bounds.minX + 6 { break }
            // A line starting far right of this block (beyond any first-line
            // indent) is a different block — typically a centered heading.
            if lines[first - 1].bounds.minX > lines[first].bounds.minX + 24 { break }
            first -= 1
        }
        var last = clicked
        while last + 1 < lines.count, continuous(upper: lines[last], lower: lines[last + 1]) {
            if lines[last + 1].bounds.minX > lines[last].bounds.minX + 6 { break }
            // Symmetric centered-heading guard when the CLICKED line is the
            // heading itself: body text far left of it is a different block.
            if lines[last].bounds.minX > lines[last + 1].bounds.minX + 24 { break }
            last += 1
        }

        let block = Array(lines[first...last])
        let bounds = block.dropFirst().reduce(block[0].bounds) { $0.union($1.bounds) }
        let heights = block.map(\.bounds.height).sorted()
        let lineHeight = heights[heights.count / 2]
        return PDFParagraph(text: Self.joinLines(block.map(\.string)), bounds: bounds, lineHeight: lineHeight)
    }

    // Every text block on the page, top to bottom — the same clustering
    // rules as paragraph(at:), applied sequentially. Used by batch
    // operations (translate a whole page's paragraphs).
    func paragraphs(on page: PDFPage) -> [PDFParagraph] {
        let lines = cachedTextLines(on: page)
        guard !lines.isEmpty else { return [] }

        func splits(between upper: (string: String, bounds: CGRect), _ lower: (string: String, bounds: CGRect)) -> Bool {
            let gap = upper.bounds.minY - lower.bounds.maxY
            let reference = min(upper.bounds.height, lower.bounds.height)
            if gap >= reference * 0.9 { return true }
            let overlap = min(upper.bounds.maxX, lower.bounds.maxX) - max(upper.bounds.minX, lower.bounds.minX)
            if overlap <= reference { return true }
            let sizeRatio = upper.bounds.height / max(1, lower.bounds.height)
            if sizeRatio <= 0.7 || sizeRatio >= 1.4 { return true }
            if lower.bounds.minX > upper.bounds.minX + 6 { return true }   // indented paragraph start
            if upper.bounds.minX > lower.bounds.minX + 24 { return true }  // centered heading above
            return false
        }

        var blocks: [[(string: String, bounds: CGRect)]] = []
        var current = [lines[0]]
        for index in 1..<lines.count {
            if splits(between: lines[index - 1], lines[index]) {
                blocks.append(current)
                current = [lines[index]]
            } else {
                current.append(lines[index])
            }
        }
        blocks.append(current)

        return blocks.map { block in
            let bounds = block.dropFirst().reduce(block[0].bounds) { $0.union($1.bounds) }
            let heights = block.map(\.bounds.height).sorted()
            return PDFParagraph(text: Self.joinLines(block.map(\.string)), bounds: bounds, lineHeight: heights[heights.count / 2])
        }
    }

    // Line extraction is O(page text) — cached per page + revision so
    // hover-tracking (every mouse move) stays cheap.
    private func cachedTextLines(on page: PDFPage) -> [(string: String, bounds: CGRect)] {
        let pageID = ObjectIdentifier(page)
        if let cache = textLineCache, cache.pageID == pageID, cache.revision == revision {
            return cache.lines
        }
        let lines = Self.textLines(on: page)
        textLineCache = (pageID, revision, lines)
        return lines
    }

    private static func textLines(on page: PDFPage) -> [(string: String, bounds: CGRect)] {
        guard let all = page.selection(for: page.bounds(for: .mediaBox)) else { return [] }
        return all.selectionsByLine().compactMap { selection in
            guard let string = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !string.isEmpty
            else { return nil }
            return (string, selection.bounds(for: page))
        }
    }

    // Inline math protection: maximal runs of formula tokens become ⟦n⟧
    // placeholders so the surrounding sentence translates as one unit and
    // the original notation returns verbatim.
    static func maskMathRuns(_ text: String, markers: CharacterSet) -> (masked: String, runs: [String]) {
        let tokens = text.components(separatedBy: " ")
        var runs: [String] = []
        var out: [String] = []
        var current: [String] = []
        func isMathToken(_ token: String) -> Bool {
            guard !token.isEmpty else { return false }
            if token.unicodeScalars.contains(where: { markers.contains($0) }) { return true }
            return ["+", "-", "−", "·", "/", ":=", "|"].contains(token)
        }
        func flush() {
            guard !current.isEmpty else { return }
            runs.append(current.joined(separator: " "))
            out.append("⟦\(runs.count - 1)⟧")
            current = []
        }
        for token in tokens {
            if isMathToken(token) { current.append(token) } else { flush(); out.append(token) }
        }
        flush()
        return (out.joined(separator: " "), runs)
    }

    // Re-inserts the original runs; nil when the model lost or invented a
    // placeholder — the caller keeps the original text in that case.
    static func unmaskMathRuns(_ text: String, runs: [String]) -> String? {
        var result = text
        for (index, run) in runs.enumerated() {
            let token = "⟦\(index)⟧"
            guard result.contains(token) else { return nil }
            result = result.replacingOccurrences(of: token, with: run)
        }
        return result.contains("⟦") ? nil : result
    }

    // Joins extracted lines into flowing text, merging hyphenated line
    // breaks when the next line starts lowercase.
    private static func joinLines(_ lines: [String]) -> String {
        var result = ""
        for line in lines {
            if result.isEmpty {
                result = line
            } else if result.hasSuffix("-"), let firstChar = line.first, firstChar.isLowercase {
                result.removeLast()
                result += line
            } else {
                result += " " + line
            }
        }
        return result
    }

    private static func separateHebrewLatinScripts(_ text: String) -> String {
        func script(of character: Character) -> Int {
            if character.unicodeScalars.contains(where: { (0x0590...0x05FF).contains(Int($0.value)) }) { return 1 }
            if character.unicodeScalars.contains(where: { CharacterSet.letters.contains($0) && $0.isASCII }) { return 2 }
            return 0
        }

        var result = ""
        var previousScript = 0
        for character in text {
            let currentScript = script(of: character)
            if previousScript > 0, currentScript > 0, previousScript != currentScript {
                result.append(" ")
            }
            result.append(character)
            previousScript = currentScript
        }
        return result
    }

    // MARK: - Full-page rewrite translation
    //
    // The overlay-per-block engine protects layout by skipping anything
    // risky, which caps coverage. This engine goes the other way: it
    // reconstructs the page's text FLOW from raw lines — columns, segments,
    // real paragraphs (hyphenation joined) — translates complete semantic
    // units, then re-typesets each segment region from scratch: one clean
    // patch, font size solved to fit, paragraphs stacked top-down. Only
    // notation lines, figures and structured pages stay pinned as-is.

    struct RewritePageResult {
        var translated = 0
        var keptOriginal = 0
        var failed = 0
    }

    private struct RewriteLine {
        let text: String
        let bounds: CGRect
        var isKeep: Bool
    }

    private struct RewriteSegment {
        var lines: [RewriteLine]
        var region: CGRect { lines.map(\.bounds).reduce(lines[0].bounds) { $0.union($1) } }
        var medianLineHeight: CGFloat {
            let heights = lines.map(\.bounds.height).sorted()
            return heights.isEmpty ? 12 : heights[heights.count / 2]
        }

        func looksLikeFigure(pageBox: CGRect) -> Bool {
            guard lines.count >= 5 else { return false }

            let wordCounts = lines.map { $0.text.split(whereSeparator: { $0.isWhitespace }).count }
            let shortLineCount = wordCounts.filter { $0 <= 4 }.count
            guard shortLineCount >= max(4, lines.count * 2 / 3) else { return false }

            let lineWidths = lines.map(\.bounds.width).sorted()
            let medianWidth = lineWidths[lineWidths.count / 2]
            let xValues = lines.map(\.bounds.minX)
            let xSpread = (xValues.max() ?? 0) - (xValues.min() ?? 0)
            let leftBins = lines.reduce(into: [CGFloat: Int]()) { freq, line in
                freq[(line.bounds.minX / 10).rounded() * 10, default: 0] += 1
            }
            let dominantLeftCount = leftBins.values.max() ?? 0

            let wideScatter = region.width > pageBox.width * 0.35 || region.height > pageBox.height * 0.18
            let noDominantColumn = dominantLeftCount < max(3, lines.count / 2)
            let spreadOut = xSpread > pageBox.width * 0.18 && medianWidth < region.width * 0.8
            return wideScatter && noDominantColumn && spreadOut
        }

        func looksLikeHeading(pageMedianLineHeight: CGFloat, pageBox: CGRect) -> Bool {
            let bounds = region
            let words = lines.reduce(0) { total, line in
                total + line.text.split(whereSeparator: { $0.isWhitespace }).count
            }
            let compact = lines.count <= 2 && words >= 1 && words <= 14
            let largerThanBody = medianLineHeight >= pageMedianLineHeight * 1.05
            let centered = abs(bounds.midX - pageBox.midX) < pageBox.width * 0.12
            let notFullBodyColumn = bounds.width < pageBox.width * 0.82
            let centeredShortTitle = centered && bounds.midY > pageBox.midY && words <= 10
            return compact && (largerThanBody || centeredShortTitle) && (centered || notFullBodyColumn)
        }
    }

    private struct RewriteParagraph {
        let text: String
        let lines: [RewriteLine]

        var region: CGRect {
            lines.dropFirst().reduce(lines[0].bounds) { $0.union($1.bounds) }
        }
    }

    func rewritePage(at index: Int, targetLanguage: String? = nil, concurrency: Int = 4) async -> RewritePageResult {
        var result = RewritePageResult()
        guard let document, let page = document.page(at: index) else { return result }
        let pageBox = page.bounds(for: .mediaBox)
        // Math fonts split a visual line into several boxes on one baseline
        // ("Note that Im" / "≠" / "In…") — classifying fragments separately
        // loses the rest of the line under the patch. Merge by baseline first.
        var rawLines: [(string: String, bounds: CGRect)] = []
        for line in cachedTextLines(on: page).sorted(by: { $0.bounds.midY == $1.bounds.midY ? $0.bounds.minX < $1.bounds.minX : $0.bounds.midY > $1.bounds.midY }) {
            if let last = rawLines.last,
               abs(last.bounds.midY - line.bounds.midY) < min(last.bounds.height, line.bounds.height) * 0.5,
               line.bounds.minX - last.bounds.maxX < 40 {
                rawLines[rawLines.count - 1] = (last.string + " " + line.string, last.bounds.union(line.bounds))
            } else {
                rawLines.append(line)
            }
        }
        guard !rawLines.isEmpty else { return result }

        var mathMarkers = CharacterSet(charactersIn: "∈∉ℝℕℤℚℂ⇒⇐⇑⇓⇔↦→←↑↓↕↖↗↘↙∀∃∑∏∫≃≅≈≪≫≠≤≥⊤⊥∥×÷√∇∂λΣΠ⊗⊕⊖⊙∘∗†‖⟨⟩∅∞∝∼⋅𝟙=")
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x1D400)!...Unicode.Scalar(0x1D7FF)!)
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x2070)!...Unicode.Scalar(0x209F)!)
        // Combining accents for symbols (vector arrows x⃗) — plain-letter
        // math like "x + y = z" is only detectable through these.
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x20D0)!...Unicode.Scalar(0x20FF)!)

        // Structured pages (TOC/tables) keep their designed layout entirely.
        let numberedLines = rawLines.filter {
            $0.string.trimmingCharacters(in: .whitespaces).firstMatch(of: /^\d+(\.\d+)*\s/) != nil
        }.count
        if numberedLines >= 5 && numberedLines * 2 >= rawLines.count {
            result.keptOriginal = rawLines.count
            return result
        }

        // Chat models follow the placeholder protocol (⟦n⟧ tokens protect
        // inline math through translation); the Helsinki MT model cannot.
        let supportsPlaceholders = translator.selectedModel != LocalModelTranslator.helsinkiModel

        let sortedHeights = rawLines.map(\.bounds.height).sorted()
        let pageMedianLineHeight = sortedHeights[sortedHeights.count / 2]
        let proseLeft: CGFloat? = {
            let prose = rawLines.filter { raw in
                let words = raw.string.split(whereSeparator: { $0.isWhitespace }).count
                return words >= 8 || raw.bounds.width >= pageBox.width * 0.55
            }
            guard !prose.isEmpty else { return nil }
            var freq: [CGFloat: Int] = [:]
            for raw in prose { freq[(raw.bounds.minX / 8).rounded() * 8, default: 0] += 1 }
            return freq.max { $0.value < $1.value }?.key
        }()

        // 1. Classify lines: notation/figure-furniture stays, prose flows.
        let lines: [RewriteLine] = rawLines.map { raw in
            let text = raw.string
            let letterCount = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
            let letterFraction = Double(letterCount) / Double(max(1, text.count))
            let mathCount = text.unicodeScalars.filter { mathMarkers.contains($0) }.count
            let words = text.split(whereSeparator: { $0.isWhitespace }).count
            let isVertical = raw.bounds.height > raw.bounds.width && words <= 2
            let inFooter = raw.bounds.maxY < pageBox.minY + pageBox.height * 0.05
            let inHeader = raw.bounds.minY > pageBox.maxY - pageBox.height * 0.15
            let isTinyLabel = raw.bounds.height < pageMedianLineHeight * 0.72 && words <= 2
            let isSmallFooter = raw.bounds.maxY < pageBox.minY + pageBox.height * 0.20
                && raw.bounds.height < pageMedianLineHeight * 0.82
            let isShortHeading = words <= 3 && raw.bounds.height > pageMedianLineHeight * 1.18
            let isFigureLabel = words <= 8
                && raw.bounds.midY > pageBox.minY + pageBox.height * 0.30
                && (proseLeft.map { abs(raw.bounds.minX - $0) > 30 } ?? false)
            let isEquationOnly = mathCount >= 1 && letterFraction < 0.45
            // Inline formulas written with plain letters ("x + y = z", "x⃗")
            // survive every density check but get mangled by translation —
            // "=" and combining-accent marks are the reliable tells. An
            // instruction-following model gets them as protected placeholder
            // tokens instead (translate AROUND the math); Helsinki can't
            // follow instructions, so for it these lines stay English.
            let hasInlineFormula = text.contains("=")
                || text.unicodeScalars.contains { (0x20D0...0x20FF).contains(Int($0.value)) }
            let keep = isEquationOnly || (hasInlineFormula && !supportsPlaceholders) || letterFraction < 0.55 || isVertical
                || inFooter || inHeader || isTinyLabel || isSmallFooter || isShortHeading
                || isFigureLabel
                || LocalModelTranslator.isRightToLeft(text)
            return RewriteLine(text: text, bounds: raw.bounds, isKeep: keep)
        }

        // 2. Column assignment: prose lines whose x-ranges overlap belong to
        // the same column (body vs margin notes emerge naturally).
        var columns: [[RewriteLine]] = []
        for line in lines where !line.isKeep {
            if let idx = columns.firstIndex(where: { column in
                let ref = column[0].bounds
                let overlap = min(ref.maxX, line.bounds.maxX) - max(ref.minX, line.bounds.minX)
                return overlap > 0.5 * min(ref.width, line.bounds.width)
            }) {
                columns[idx].append(line)
            } else {
                columns.append([line])
            }
        }

        // 3. Segments: contiguous lines in a column; a big vertical gap (a
        // figure or displayed equation sits there) or a font-size jump
        // (heading vs body) splits the flow.
        var segments: [RewriteSegment] = []
        for column in columns {
            let sorted = column.sorted { $0.bounds.maxY > $1.bounds.maxY }
            var current: [RewriteLine] = []
            for line in sorted {
                if let last = current.last {
                    let gap = last.bounds.minY - line.bounds.maxY
                    let heightRatio = line.bounds.height / max(1, last.bounds.height)
                    if gap > min(last.bounds.height, line.bounds.height) * 1.7
                        || heightRatio > 1.3 || heightRatio < 0.77 {
                        segments.append(RewriteSegment(lines: current))
                        current = []
                    }
                }
                current.append(line)
            }
            if !current.isEmpty { segments.append(RewriteSegment(lines: current)) }
        }
        result.keptOriginal = lines.filter(\.isKeep).count

        // 4. Real paragraphs per segment: indentation or extra vertical
        // whitespace starts a paragraph. Keep each paragraph's exact line
        // bounds so a translated paragraph never patches its neighbors.
        struct Job { let segmentIndex: Int; let paragraphIndex: Int; let text: String }
        var segmentParagraphs: [[RewriteParagraph]] = []
        var jobs: [Job] = []
        for (si, segment) in segments.enumerated() {
            if segment.looksLikeFigure(pageBox: pageBox) {
                segmentParagraphs.append([])
                result.keptOriginal += segment.lines.count
                continue
            }
            var leftFrequency: [CGFloat: Int] = [:]
            for line in segment.lines {
                leftFrequency[(line.bounds.minX / 6).rounded() * 6, default: 0] += 1
            }
            let columnLeft = leftFrequency.max { $0.value < $1.value }?.key
                ?? segment.lines.map(\.bounds.minX).min() ?? 0
            let alignedWidths = segment.lines
                .filter { abs($0.bounds.minX - columnLeft) < 8 }
                .map(\.bounds.width)
            let columnWidth = alignedWidths.max() ?? segment.region.width
            var paragraphLines: [[RewriteLine]] = []
            for line in segment.lines {
                let indented = line.bounds.minX - columnLeft > 6
                let previous = paragraphLines.last?.last
                let verticalGap = previous.map { $0.bounds.minY - line.bounds.maxY } ?? 0
                let separated = verticalGap > segment.medianLineHeight * 0.45
                let previousEndsParagraph = previous?.text.trimmingCharacters(in: .whitespacesAndNewlines).last
                    .map { ".:!?;\u{05F4}\")".contains($0) } ?? true
                let listContinuation = previous.map {
                    $0.bounds.width < columnWidth * 0.88
                        && line.bounds.width < columnWidth * 0.88
                } ?? false
                let indentStartsParagraph = indented && (previousEndsParagraph || listContinuation)
                if indentStartsParagraph || separated || paragraphLines.isEmpty {
                    paragraphLines.append([line])
                } else {
                    paragraphLines[paragraphLines.count - 1].append(line)
                }
            }
            let paragraphs = paragraphLines.map {
                RewriteParagraph(text: Self.joinLines($0.map(\.text)), lines: $0)
            }
            segmentParagraphs.append(paragraphs)
            let isHeadingSegment = segment.looksLikeHeading(pageMedianLineHeight: pageMedianLineHeight, pageBox: pageBox)

            // Only complete sentences translate — a fragment that starts
            // mid-sentence or trails off (continuation of a kept notation
            // line or a cross-page break) stays exactly as printed.
            // A ")" only closes a sentence after real terminal punctuation
            // ("…(2010)." yes, "…Figure 2.1(a)" no).
            var eligible: [Bool] = paragraphs.map { paragraph in
                if isHeadingSegment { return true }
                let trimmed = paragraph.text.trimmingCharacters(in: .whitespacesAndNewlines)
                let startsMidSentence = trimmed.first.map { $0.isLowercase && $0.isLetter } ?? true
                let endsClosed = trimmed.firstMatch(of: /[.:!?;][\u{05F4}\")\u{201D}']*$/) != nil
                let words = trimmed.split(whereSeparator: { $0.isWhitespace }).count
                return !(startsMidSentence || trimmed.hasSuffix("-") || (!endsClosed && words < 25))
            }
            // Fragment cascade: if a paragraph's continuation was withheld,
            // the paragraph itself is mid-thought too — withhold it, or the
            // page switches language inside one sentence.
            if paragraphs.count > 1 {
                for pi in stride(from: paragraphs.count - 2, through: 0, by: -1) {
                    let nextTrimmed = paragraphs[pi + 1].text.trimmingCharacters(in: .whitespacesAndNewlines)
                    let nextIsFragment = nextTrimmed.first.map { $0.isLowercase && $0.isLetter || $0 == "–" || $0 == "-" } ?? false
                    if eligible[pi], !eligible[pi + 1], nextIsFragment { eligible[pi] = false }
                }
            }
            // Narrow segments (margin notes, captions) read as one unit —
            // partial translation looks broken, so it's all or nothing.
            let isNarrow = segment.region.width < pageBox.width * 0.30
            if isNarrow, eligible.contains(false) {
                eligible = eligible.map { _ in false }
            }
            for (pi, paragraph) in paragraphs.enumerated() {
                guard eligible[pi] else { result.keptOriginal += 1; continue }
                jobs.append(Job(segmentIndex: si, paragraphIndex: pi, text: paragraph.text))
            }
        }

        // 5. Translate all paragraphs (bounded parallel). Inline math is
        // masked to ⟦n⟧ tokens first so the sentence translates as a whole
        // and the exact original notation drops back into position — a
        // paragraph only survives if every token comes back intact.
        let translator = self.translator
        var translations: [Int: String] = [:] // job index -> translation
        let bounded = max(1, min(concurrency, 6))
        let markersForMasking = mathMarkers
        await withTaskGroup(of: (Int, String?).self) { group in
            var next = 0
            func submit() {
                guard next < jobs.count, !Task.isCancelled else { return }
                let jobIndex = next
                next += 1
                group.addTask { @MainActor in
                    let (masked, runs) = Self.maskMathRuns(jobs[jobIndex].text, markers: markersForMasking)
                    if runs.isEmpty {
                        return (jobIndex, try? await translator.translate(jobs[jobIndex].text, to: targetLanguage))
                    }
                    guard supportsPlaceholders,
                          let raw = try? await translator.translate(masked, to: targetLanguage)
                    else { return (jobIndex, nil) }
                    return (jobIndex, Self.unmaskMathRuns(raw, runs: runs))
                }
            }
            for _ in 0..<bounded { submit() }
            for await (jobIndex, translated) in group {
                if let translated { translations[jobIndex] = translated } else { result.failed += 1 }
                submit()
            }
        }

        // Output sanity per paragraph: garbage translations fall back to the
        // original English text (still re-typeset, so the flow stays whole).
        var finalTexts = segmentParagraphs.map { $0.map(\.text) }
        var translatedParagraphs: [Int: Set<Int>] = [:]
        for (jobIndex, job) in jobs.enumerated() {
            guard let translated = translations[jobIndex] else { continue }
            let sourceMarkers = Set(job.text.unicodeScalars.filter { mathMarkers.contains($0) })
            let introduced = translated.unicodeScalars.contains { mathMarkers.contains($0) && !sourceMarkers.contains($0) }
            if introduced {
                result.keptOriginal += 1
            } else {
                finalTexts[job.segmentIndex][job.paragraphIndex] = Self.separateHebrewLatinScripts(translated)
                translatedParagraphs[job.segmentIndex, default: []].insert(job.paragraphIndex)
                result.translated += 1
            }
        }

        // 6. Re-typeset successful paragraphs independently. A failed or
        // skipped paragraph receives no patch and remains exactly as it was.
        // ONE body size for the whole page — per-paragraph sizing reads as
        // a ransom note; a book page has uniform body type.
        let bodyLineHeights = lines.filter { !$0.isKeep }.map(\.bounds.height).sorted()
        let pageBodySize = (bodyLineHeights.isEmpty ? pageMedianLineHeight : bodyLineHeights[bodyLineHeights.count / 2]) * 0.74
        withSingleUndoStep {
            for (si, segment) in segments.enumerated() {
                let isHeadingSegment = segment.looksLikeHeading(pageMedianLineHeight: pageMedianLineHeight, pageBox: pageBox)
                // Narrow segments render all-or-nothing: if any paragraph's
                // translation failed the checks, the whole note stays English.
                let isNarrow = segment.region.width < pageBox.width * 0.30
                if isNarrow, (translatedParagraphs[si]?.count ?? 0) < segmentParagraphs[si].count { continue }
                for (pi, paragraph) in segmentParagraphs[si].enumerated() {
                    guard translatedParagraphs[si]?.contains(pi) == true else { continue }
                    let text = finalTexts[si][pi]
                    let region = paragraph.region.insetBy(dx: -2, dy: -1)
                    guard region.width > 12, region.height > 2 else { continue }

                    let patch = PDFAnnotation(bounds: region, forType: .square, withProperties: nil)
                    patch.color = .white
                    patch.interiorColor = .white
                    patch.border = PDFBorder()
                    patch.border?.lineWidth = 0
                    patch.setValue(true, forAnnotationKey: PDFAnnotationKey(rawValue: "AgenticDesignerTextPatch"))
                    page.addAnnotation(patch)

                    let wrapped: (CGFloat) -> CGFloat = { size in
                        ceil((text as NSString).boundingRect(
                            with: CGSize(width: region.width - 12, height: .greatestFiniteMagnitude),
                            options: [.usesLineFragmentOrigin, .usesFontLeading],
                            attributes: [.font: self.fontForText(text, size: size)]
                        ).height * 1.06)
                    }
                    let padding: CGFloat = isHeadingSegment ? 4 : 6
                    // Headings keep their own scale; body text is uniform
                    // across the page, shrinking only when a translation
                    // genuinely outgrows its paragraph box.
                    var size = isHeadingSegment
                        ? min(paragraph.lines.map(\.bounds.height).sorted()[paragraph.lines.count / 2] * 0.78, 24)
                        : pageBodySize
                    while size > 5, wrapped(size) + padding > region.height {
                        size *= 0.93
                    }

                    let font = fontForText(text, size: size)
                    var slot = region
                    if isHeadingSegment {
                        let liftedY = min(pageBox.maxY - slot.height, slot.origin.y + headingVerticalLift(lineHeight: segment.medianLineHeight))
                        slot.origin.y = max(pageBox.minY, liftedY)
                    }
                    let replacement = PDFAnnotation(bounds: slot, forType: .freeText, withProperties: nil)
                    replacement.contents = text
                    replacement.font = font
                    replacement.fontColor = .black
                    replacement.color = .clear
                    replacement.alignment = LocalModelTranslator.isRightToLeft(text) ? .right : .left
                    page.addAnnotation(replacement)
                }
            }
        }
        statusMessage = "Rewrote page \(index + 1): \(result.translated) paragraph(s) translated"
        bumpRevision()
        return result
    }

    // MARK: - Translated-edition page builder
    //
    // In-place overlays can't deliver book-quality typography (bidi in tiny
    // boxes, per-paragraph font solving, patch collisions). This builder
    // goes the other way: it produces a NEW page — translated paragraphs
    // typeset by CoreText (real RTL justification, automatic bidi and font
    // fallback), and every non-prose band of the original (equations,
    // figures, tables) embedded as a vector clip at its natural position in
    // the flow. Nothing can overlap or garble by construction.

    private enum EditionItem {
        case slice(CGRect)                    // source-page band, embedded verbatim
        case paragraph(String, CGFloat, Bool) // text, fontSize, isHeading
    }

    func buildTranslatedPage(at index: Int, targetLanguage: String? = nil, concurrency: Int = 5) async -> PDFPage? {
        guard let document, let page = document.page(at: index) else { return nil }
        let pageBox = page.bounds(for: .mediaBox)

        // Reuse the rewrite engine's analysis by running its classification
        // on raw lines, but assemble a linear flow instead of overlays.
        var rawLines: [(string: String, bounds: CGRect)] = []
        for line in cachedTextLines(on: page).sorted(by: { $0.bounds.midY == $1.bounds.midY ? $0.bounds.minX < $1.bounds.minX : $0.bounds.midY > $1.bounds.midY }) {
            if let last = rawLines.last,
               abs(last.bounds.midY - line.bounds.midY) < min(last.bounds.height, line.bounds.height) * 0.5,
               line.bounds.minX - last.bounds.maxX < 14 {
                rawLines[rawLines.count - 1] = (last.string + " " + line.string, last.bounds.union(line.bounds))
            } else {
                rawLines.append(line)
            }
        }
        guard !rawLines.isEmpty else { return nil }

        var mathMarkers = CharacterSet(charactersIn: "∈∉ℝℕℤℚℂ⇒⇐⇑⇓⇔↦→←↑↓↕↖↗↘↙∀∃∑∏∫≃≅≈≪≫≠≤≥⊤⊥∥×÷√∇∂λΣΠ⊗⊕⊖⊙∘∗†‖⟨⟩∅∞∝∼⋅𝟙=")
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x1D400)!...Unicode.Scalar(0x1D7FF)!)
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x2070)!...Unicode.Scalar(0x209F)!)
        mathMarkers.insert(charactersIn: Unicode.Scalar(0x20D0)!...Unicode.Scalar(0x20FF)!)

        let sortedHeights = rawLines.map(\.bounds.height).sorted()
        let pageMedianLineHeight = sortedHeights[sortedHeights.count / 2]

        // Classify each line: translatable prose vs pinned content.
        struct FlowLine { let text: String; let bounds: CGRect; let isProse: Bool }
        let flowLines: [FlowLine] = rawLines.map { raw in
            let text = raw.string
            let letterCount = text.unicodeScalars.filter { CharacterSet.letters.contains($0) }.count
            let letterFraction = Double(letterCount) / Double(max(1, text.count))
            let mathCount = text.unicodeScalars.filter { mathMarkers.contains($0) }.count
            let words = text.split(whereSeparator: { $0.isWhitespace }).count
            let inFooter = raw.bounds.maxY < pageBox.minY + pageBox.height * 0.20
                && raw.bounds.height < pageMedianLineHeight * 0.85
            let inHeader = raw.bounds.minY > pageBox.maxY - pageBox.height * 0.065
            let hasFormula = text.contains("=") || mathCount >= 2
            let prose = !inFooter && !inHeader && !hasFormula
                && letterFraction >= 0.6 && words >= 3
                && !LocalModelTranslator.isRightToLeft(text)
                && raw.bounds.width >= pageBox.width * 0.35
            return FlowLine(text: text, bounds: raw.bounds, isProse: prose)
        }

        // Walk top-to-bottom building the flow: consecutive prose lines merge
        // into paragraphs (indent = paragraph break); everything between
        // prose runs becomes one source band embedded as-is.
        var items: [EditionItem] = []
        var paragraphJobs: [(itemIndex: Int, text: String)] = []
        var paragraphRegions: [Int: CGRect] = [:]
        var currentParagraph: [FlowLine] = []
        var bandTop: CGFloat? = nil // top of the current non-prose band
        var cursor = pageBox.maxY - pageBox.height * 0.05 // skip running head

        func flushParagraph() {
            guard !currentParagraph.isEmpty else { return }
            // Orphaned combining accents (the leftovers of x⃗ glyphs whose
            // base ended up in another extraction run) render as junk marks.
            let joined = Self.joinLines(currentParagraph.map(\.text))
            let text = String(joined.unicodeScalars.filter { !(0x20D0...0x20FF).contains(Int($0.value)) })
            let heights = currentParagraph.map(\.bounds.height).sorted()
            let lineHeight = heights[heights.count / 2]
            let isHeading = lineHeight > pageMedianLineHeight * 1.18 && currentParagraph.count <= 2
            let region = currentParagraph.map(\.bounds).reduce(currentParagraph[0].bounds) { $0.union($1) }
            items.append(.paragraph(text, lineHeight, isHeading))
            paragraphRegions[items.count - 1] = region
            paragraphJobs.append((items.count - 1, text))
            currentParagraph = []
        }
        func flushBand(downTo bottom: CGFloat) {
            guard let top = bandTop else { return }
            let band = CGRect(x: pageBox.minX, y: bottom, width: pageBox.width, height: max(0, top - bottom))
            if band.height > 3 { items.append(.slice(band)) }
            bandTop = nil
        }

        for line in flowLines.sorted(by: { $0.bounds.maxY > $1.bounds.maxY }) {
            if line.bounds.maxY > cursor { continue } // running-head zone
            if line.isProse {
                flushBand(downTo: line.bounds.maxY + 1)
                if let last = currentParagraph.last {
                    let gap = last.bounds.minY - line.bounds.maxY
                    let indented = line.bounds.minX - last.bounds.minX > 6
                    if gap > line.bounds.height * 1.6 || indented && (last.text.trimmingCharacters(in: .whitespaces).last.map { ".:!?;".contains($0) } ?? false) {
                        flushParagraph()
                    }
                }
                currentParagraph.append(line)
            } else {
                flushParagraph()
                if bandTop == nil { bandTop = line.bounds.maxY + 2 }
            }
            cursor = min(cursor, line.bounds.minY)
        }
        flushParagraph()
        flushBand(downTo: cursor - 2)

        // Translate paragraphs (complete units by construction — whole
        // paragraphs joined across lines with hyphenation repaired).
        let translator = self.translator
        var translated: [Int: String] = [:]
        let bounded = max(1, min(concurrency, 6))
        await withTaskGroup(of: (Int, String?).self) { group in
            var next = 0
            func submit() {
                guard next < paragraphJobs.count, !Task.isCancelled else { return }
                let jobIndex = next
                next += 1
                group.addTask { @MainActor in
                    (jobIndex, try? await translator.translate(paragraphJobs[jobIndex].text, to: targetLanguage))
                }
            }
            for _ in 0..<bounded { submit() }
            for await (jobIndex, result) in group {
                if let result,
                   result.firstMatch(of: /[⟦⟧〚〛]/) == nil,
                   LocalModelTranslator.isRightToLeft(result) {
                    // Chat models sometimes emit markdown emphasis — strip it.
                    translated[paragraphJobs[jobIndex].itemIndex] = result
                        .replacingOccurrences(of: "**", with: "")
                        .replacingOccurrences(of: "```", with: "")
                }
                submit()
            }
        }

        // Typeset the new page.
        let margin: CGFloat = pageBox.width * 0.09
        let contentWidth = pageBox.width - margin * 2
        let data = NSMutableData()
        guard let consumer = CGDataConsumer(data: data as CFMutableData),
              let ctx = CGContext(consumer: consumer, mediaBox: nil, nil) else { return nil }
        var mediaBox = CGRect(origin: .zero, size: pageBox.size)
        ctx.beginPDFPage([kCGPDFContextMediaBox as String: mediaBox] as CFDictionary)
        ctx.setFillColor(CGColor.white)
        ctx.fill(mediaBox)

        func attributed(_ text: String, size: CGFloat, heading: Bool) -> NSAttributedString {
            let rtl = LocalModelTranslator.isRightToLeft(text)
            let style = NSMutableParagraphStyle()
            style.baseWritingDirection = rtl ? .rightToLeft : .leftToRight
            style.alignment = rtl ? (heading ? .center : .justified) : .natural
            style.lineSpacing = size * 0.24
            style.paragraphSpacing = 0
            let fontName = rtl ? "ArialHebrew" : annotationStyle.fontName
            let font = NSFont(name: heading && rtl ? "ArialHebrew-Bold" : fontName, size: size)
                ?? NSFont.systemFont(ofSize: size, weight: heading ? .semibold : .regular)
            return NSAttributedString(string: text, attributes: [
                .font: font, .paragraphStyle: style, .foregroundColor: NSColor.black,
            ])
        }

        let bodySize = pageMedianLineHeight * 0.74
        var y = pageBox.height * 0.94
        for item in items {
            switch item {
            case .slice(let band):
                let height = band.height
                guard height > 3 else { continue }
                ctx.saveGState()
                ctx.translateBy(x: 0, y: (y - height) - band.minY)
                ctx.clip(to: CGRect(x: pageBox.minX, y: band.minY, width: pageBox.width, height: band.height))
                page.draw(with: .mediaBox, to: ctx)
                ctx.restoreGState()
                y -= height + 6
            case .paragraph(let original, let lineHeight, let heading):
                let itemIndex = items.firstIndex { if case .paragraph(let t, _, _) = $0 { return t == original } else { return false } }
                // Untranslated paragraphs embed as slices of the ORIGINAL —
                // the book's own typography, not a re-typed approximation.
                guard let text = itemIndex.flatMap({ translated[$0] }) else {
                    if let region = itemIndex.flatMap({ paragraphRegions[$0] }) {
                        let band = CGRect(x: pageBox.minX, y: region.minY - 2, width: pageBox.width, height: region.height + 4)
                        ctx.saveGState()
                        ctx.translateBy(x: 0, y: (y - band.height) - band.minY)
                        ctx.clip(to: CGRect(x: pageBox.minX, y: band.minY, width: pageBox.width, height: band.height))
                        page.draw(with: .mediaBox, to: ctx)
                        ctx.restoreGState()
                        y -= band.height + 6
                    }
                    continue
                }
                let size = heading ? min(lineHeight * 0.8, 20) : bodySize
                let attr = attributed(text, size: size, heading: heading)
                let framesetter = CTFramesetterCreateWithAttributedString(attr)
                let fitted = CTFramesetterSuggestFrameSizeWithConstraints(
                    framesetter, CFRange(location: 0, length: 0), nil,
                    CGSize(width: contentWidth, height: .greatestFiniteMagnitude), nil)
                let frameRect = CGRect(x: margin, y: y - fitted.height - 2, width: contentWidth, height: fitted.height + 2)
                let path = CGPath(rect: frameRect, transform: nil)
                let frame = CTFramesetterCreateFrame(framesetter, CFRange(location: 0, length: 0), path, nil)
                CTFrameDraw(frame, ctx)
                y -= fitted.height + size * 0.7
            }
            if y < pageBox.height * 0.04 { break }
        }

        ctx.endPDFPage()
        ctx.closePDF()
        _ = mediaBox
        return PDFDocument(data: data as Data)?.page(at: 0)
    }

    // MARK: - Text lookup (for the "click existing text to edit" flow)

    func text(at point: CGPoint, on page: PDFPage) -> (text: String, bounds: CGRect)? {
        guard let selection = page.selectionForWord(at: point) else { return nil }
        let bounds = selection.bounds(for: page)
        guard let text = selection.string, !text.isEmpty else { return nil }
        return (text, bounds)
    }

    func pageText(at index: Int) -> String {
        document?.page(at: index)?.string ?? ""
    }
}

enum PDFEditorError: LocalizedError {
    case cannotOpen(String)
    case noDocument
    case invalidPageIndex(Int)

    var errorDescription: String? {
        switch self {
        case .cannotOpen(let name): return "Couldn't open \(name) — it may not be a valid PDF."
        case .noDocument: return "No PDF is open."
        case .invalidPageIndex(let index): return "Page \(index + 1) doesn't exist."
        }
    }
}

// A PDFAnnotation subclass that actually knows how to draw an NSImage —
// PDFKit's stock .stamp type otherwise renders nothing without an
// appearance stream. Used for image replacement and image-based signatures.
final class PDFImageStampAnnotation: PDFAnnotation {
    let image: NSImage

    init(bounds: CGRect, image: NSImage) {
        self.image = image
        super.init(bounds: bounds, forType: .stamp, withProperties: nil)
        contents = "Image"
    }

    required init?(coder: NSCoder) {
        guard let restoredData = coder.decodeObject(forKey: "AgenticDesignerStampImageData") as? Data,
              let restoredImage = NSImage(data: restoredData)
        else { return nil }
        image = restoredImage
        super.init(coder: coder)
    }

    override func encode(with coder: NSCoder) {
        super.encode(with: coder)
        if let data = image.tiffRepresentation {
            coder.encode(data, forKey: "AgenticDesignerStampImageData")
        }
    }

    override func draw(with box: PDFDisplayBox, in context: CGContext) {
        guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return }
        context.saveGState()
        context.draw(cgImage, in: bounds)
        context.restoreGState()
    }
}
