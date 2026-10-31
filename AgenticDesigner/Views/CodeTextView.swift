//
//  CodeTextView.swift
//  AgenticDesigner
//
//  A real code viewer for Code Mode: AppKit NSTextView in an NSScrollView with
//  a line-number ruler — dark editor theme, no soft-wrap (long lines scroll
//  horizontally), native selection and ⌘F find bar. SwiftUI's Text/ScrollView
//  combo can't do any of that properly, which is why this exists.
//

import SwiftUI
import AppKit

/// The one place Code Mode's look is defined — shared by the text view, the
/// ruler and the syntax highlighter so everything stays on one palette.
enum CodeTheme {
    static let background = NSColor(srgbRed: 0.118, green: 0.122, blue: 0.137, alpha: 1)   // #1E1F23
    static let gutterBackground = NSColor(srgbRed: 0.098, green: 0.102, blue: 0.114, alpha: 1)
    static let gutterText = NSColor(srgbRed: 0.42, green: 0.44, blue: 0.48, alpha: 1)
    static let plainText = NSColor(srgbRed: 0.875, green: 0.878, blue: 0.882, alpha: 1)
    static let keyword = NSColor(srgbRed: 0.988, green: 0.373, blue: 0.639, alpha: 1)      // Xcode pink
    static let typeName = NSColor(srgbRed: 0.365, green: 0.847, blue: 1.0, alpha: 1)       // cyan
    static let string = NSColor(srgbRed: 0.988, green: 0.416, blue: 0.365, alpha: 1)       // coral
    static let number = NSColor(srgbRed: 0.816, green: 0.749, blue: 0.412, alpha: 1)       // khaki
    static let comment = NSColor(srgbRed: 0.498, green: 0.549, blue: 0.596, alpha: 1)      // slate
    static let font = NSFont.monospacedSystemFont(ofSize: 12, weight: .regular)
    static let gutterFont = NSFont.monospacedSystemFont(ofSize: 10, weight: .regular)
}

struct CodeTextView: NSViewRepresentable {
    let fileId: String
    let text: NSAttributedString
    var isEditable: Bool = false
    /// Bumped by the host to force-discard local edits back to `text`.
    var resetToken: UUID = UUID()
    /// When token changes, scroll to `jumpLine` (1-based) and select it.
    var jumpToken: UUID? = nil
    var jumpLine: Int = 0
    /// Fired on every user edit with the current full text.
    var onTextChange: ((String) -> Void)? = nil

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CodeTextView
        var currentFileId: String?
        /// The last content WE set — anything else in the view is a user edit,
        /// and user edits must never be clobbered by a live regeneration.
        var lastSetText: String = ""
        var lastResetToken: UUID?
        var lastJumpToken: UUID?
        var boundsObserver: NSObjectProtocol?
        var rehighlightWork: DispatchWorkItem?

        init(parent: CodeTextView) { self.parent = parent }

        deinit {
            if let boundsObserver { NotificationCenter.default.removeObserver(boundsObserver) }
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            parent.onTextChange?(textView.string)
            // Re-color soon, not per-keystroke: attributes-only, so caret,
            // selection and scroll all stay put.
            rehighlightWork?.cancel()
            let isSwift = (currentFileId ?? "").hasSuffix(".swift")
            let work = DispatchWorkItem { [weak textView] in
                guard let storage = textView?.textStorage else { return }
                SwiftCodeHighlighter.rehighlight(storage, isSwift: isSwift)
            }
            rehighlightWork = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: work)
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.drawsBackground = true
        scrollView.backgroundColor = CodeTheme.background

        let textView = NSTextView()
        textView.isEditable = isEditable
        textView.isSelectable = true
        textView.allowsUndo = true
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.isAutomaticSpellingCorrectionEnabled = false
        textView.drawsBackground = true
        textView.backgroundColor = CodeTheme.background
        textView.insertionPointColor = CodeTheme.plainText
        textView.typingAttributes = [.font: CodeTheme.font, .foregroundColor: CodeTheme.plainText]
        textView.textContainerInset = NSSize(width: 10, height: 12)
        textView.usesFindBar = true
        textView.isIncrementalSearchingEnabled = true
        textView.delegate = context.coordinator

        // No soft-wrap: unbounded container + horizontally resizable text view,
        // so long lines scroll instead of reflowing under the reader.
        textView.minSize = .zero
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = true
        textView.autoresizingMask = []
        textView.textContainer?.widthTracksTextView = false
        textView.textContainer?.containerSize = NSSize(
            width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude
        )

        scrollView.documentView = textView

        let ruler = LineNumberRulerView(textView: textView)
        scrollView.verticalRulerView = ruler
        scrollView.hasVerticalRuler = true
        scrollView.rulersVisible = true

        // The ruler draws against the visible rect, so every scroll must repaint it.
        scrollView.contentView.postsBoundsChangedNotifications = true
        context.coordinator.boundsObserver = NotificationCenter.default.addObserver(
            forName: NSView.boundsDidChangeNotification,
            object: scrollView.contentView,
            queue: .main
        ) { [weak ruler] _ in
            ruler?.needsDisplay = true
        }

        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        guard let textView = scrollView.documentView as? NSTextView else { return }
        let coordinator = context.coordinator
        coordinator.parent = self
        textView.isEditable = isEditable

        let fileChanged = coordinator.currentFileId != fileId
        let forcedReset = coordinator.lastResetToken != resetToken
        let userHasLocalEdits = textView.string != coordinator.lastSetText

        // Replace content when switching files or explicitly discarding; on a
        // live regeneration only when the user hasn't typed into this file —
        // an unsaved edit must never be clobbered from underneath the caret.
        let contentDiffers = textView.string != text.string
        if (fileChanged || forcedReset || !userHasLocalEdits) && (contentDiffers || fileChanged) {
            let savedOrigin = scrollView.contentView.bounds.origin
            textView.textStorage?.setAttributedString(text)
            coordinator.lastSetText = text.string
            if fileChanged {
                textView.scroll(.zero)
            } else {
                scrollView.contentView.scroll(to: savedOrigin)
                scrollView.reflectScrolledClipView(scrollView.contentView)
            }
            scrollView.verticalRulerView?.needsDisplay = true
        }
        coordinator.currentFileId = fileId
        coordinator.lastResetToken = resetToken

        // Jump-to-line (from a diagnostic click): select + reveal the line.
        if let jumpToken, coordinator.lastJumpToken != jumpToken, jumpLine > 0 {
            coordinator.lastJumpToken = jumpToken
            let content = textView.string as NSString
            var index = 0
            var line = 1
            while line < jumpLine && index < content.length {
                index = NSMaxRange(content.lineRange(for: NSRange(location: index, length: 0)))
                line += 1
            }
            let lineRange = content.lineRange(for: NSRange(location: min(index, max(0, content.length - 1)), length: 0))
            textView.setSelectedRange(lineRange)
            textView.scrollRangeToVisible(lineRange)
            textView.window?.makeFirstResponder(textView)
        }
    }
}

// MARK: - Line numbers

final class LineNumberRulerView: NSRulerView {
    private weak var textView: NSTextView?

    init(textView: NSTextView) {
        self.textView = textView
        super.init(scrollView: textView.enclosingScrollView, orientation: .verticalRuler)
        clientView = textView
        ruleThickness = 46
    }

    required init(coder: NSCoder) {
        fatalError("init(coder:) is not supported")
    }

    override func drawHashMarksAndLabels(in rect: NSRect) {
        CodeTheme.gutterBackground.setFill()
        bounds.fill()

        guard let textView,
              let layoutManager = textView.layoutManager,
              let container = textView.textContainer else { return }

        let content = textView.string as NSString
        guard content.length > 0 else {
            drawNumber(1, atY: convert(NSPoint.zero, from: textView).y + textView.textContainerInset.height)
            return
        }

        let visibleRect = textView.visibleRect
        let relativePoint = convert(NSPoint.zero, from: textView)
        let inset = textView.textContainerInset.height

        var index = 0
        var line = 1
        while index < content.length {
            let lineRange = content.lineRange(for: NSRange(location: index, length: 0))
            let glyphRange = layoutManager.glyphRange(forCharacterRange: lineRange, actualCharacterRange: nil)
            let lineRect = layoutManager.boundingRect(forGlyphRange: glyphRange, in: container)
            if lineRect.minY > visibleRect.maxY { break }
            if lineRect.maxY >= visibleRect.minY {
                drawNumber(line, atY: lineRect.minY + relativePoint.y + inset)
            }
            index = NSMaxRange(lineRange)
            line += 1
        }
        // The empty line after a trailing newline still deserves a number.
        if content.hasSuffix("\n") {
            let extraRect = layoutManager.extraLineFragmentRect
            if extraRect.maxY >= visibleRect.minY && extraRect.minY <= visibleRect.maxY {
                drawNumber(line, atY: extraRect.minY + relativePoint.y + inset)
            }
        }
    }

    private func drawNumber(_ line: Int, atY y: CGFloat) {
        let label = NSAttributedString(
            string: String(line),
            attributes: [.font: CodeTheme.gutterFont, .foregroundColor: CodeTheme.gutterText]
        )
        let size = label.size()
        label.draw(at: NSPoint(x: ruleThickness - 8 - size.width, y: y + 1.5))
    }
}
