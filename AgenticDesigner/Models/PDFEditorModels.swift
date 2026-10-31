//
//  PDFEditorModels.swift
//  AgenticDesigner
//
//  Data model for PDF Editor mode. PDFKit's PDFDocument/PDFPage/PDFAnnotation
//  ARE the document model — this file adds only what PDFKit doesn't already
//  give us: tool state, and the overlay-edit representation "Edit Text" and
//  "Replace Image" use.
//
//  Text/vector content inside an existing PDF page lives in its content
//  stream, which PDFKit does not expose for in-place rewriting. Editing it
//  the way every consumer PDF editor does: cover the old run with an opaque
//  patch, then draw the replacement (new text, or a new image) on top as its
//  own annotation. Non-destructive until the page is flattened on export.
//

import Foundation
import PDFKit
import CoreGraphics

// MARK: - Tool modes

enum PDFToolMode: String, CaseIterable, Identifiable {
    case select = "Select"
    case editText = "Edit Text"
    case translate = "Translate"
    case replaceImage = "Replace Image"
    case shapeRect = "Rectangle"
    case shapeCircle = "Circle"
    case shapeLine = "Line"
    case draw = "Draw"
    case highlight = "Highlight"
    case underline = "Underline"
    case strikeOut = "Strikeout"
    case comment = "Comment"
    case freeText = "Text Box"
    case signature = "Signature"
    case formTextField = "Text Field"
    case formCheckbox = "Checkbox"
    case crop = "Crop"

    var id: String { rawValue }

    var icon: String {
        switch self {
        case .select: return "cursorarrow"
        case .editText: return "character.cursor.ibeam"
        case .translate: return "globe"
        case .replaceImage: return "photo"
        case .shapeRect: return "rectangle"
        case .shapeCircle: return "circle"
        case .shapeLine: return "line.diagonal"
        case .draw: return "pencil.tip"
        case .highlight: return "highlighter"
        case .underline: return "underline"
        case .strikeOut: return "strikethrough"
        case .comment: return "text.bubble"
        case .freeText: return "textbox"
        case .signature: return "signature"
        case .formTextField: return "character.textbox"
        case .formCheckbox: return "checklist"
        case .crop: return "crop"
        }
    }

    // Tools that place something with a single click, vs. drag-to-size.
    var isClickToPlace: Bool {
        switch self {
        case .comment, .signature: return true
        default: return false
        }
    }
}

// MARK: - Overlay text edit

// A non-destructive replacement for one text run on a page: an opaque patch
// (matching the page background) plus new text drawn on top, both stored as
// annotations so they show, move, and undo like anything else — until
// flatten bakes them into the page's pixels on export.
final class PDFTextEditMarker {
    static let patchKey = PDFAnnotationKey(rawValue: "AgenticDesignerTextPatch")
}

struct PDFPatchStyle {
    var backgroundColor: NSColor = .white
}

// MARK: - Page thumbnail model (lightweight, for the left panel list)

struct PDFPageSummary: Identifiable, Equatable {
    let id: Int // page index — pages don't have a stable identity in PDFKit beyond position
    let label: String
    let size: CGSize
    let rotation: Int

    static func == (lhs: PDFPageSummary, rhs: PDFPageSummary) -> Bool {
        lhs.id == rhs.id && lhs.size == rhs.size && lhs.rotation == rhs.rotation
    }
}

// MARK: - Annotation authoring defaults

struct PDFAnnotationStyle {
    var color: NSColor = .systemYellow
    var strokeWidth: CGFloat = 2
    var fontSize: CGFloat = 14
    var fontName: String = "Helvetica"
    var textColor: NSColor = .black
}

// MARK: - Paragraph detection result

// A block of consecutive text lines under one point: the unit "click text
// to rewrite it" operates on. lineHeight is the median line box height —
// the basis for matching the replacement's font size.
struct PDFParagraph {
    let text: String
    let bounds: CGRect
    let lineHeight: CGFloat
}

// MARK: - Selection

enum PDFSelectionKind {
    case annotation(PDFAnnotation)
    case textRange(PDFSelection)
    case none
}

// MARK: - Metadata editing surface

struct PDFDocumentMetadata {
    var title: String = ""
    var author: String = ""
    var subject: String = ""
    var keywords: String = ""

    init() {}

    init(from document: PDFDocument) {
        let attrs = document.documentAttributes ?? [:]
        title = attrs[PDFDocumentAttribute.titleAttribute] as? String ?? ""
        author = attrs[PDFDocumentAttribute.authorAttribute] as? String ?? ""
        subject = attrs[PDFDocumentAttribute.subjectAttribute] as? String ?? ""
        if let keywordsArray = attrs[PDFDocumentAttribute.keywordsAttribute] as? [String] {
            keywords = keywordsArray.joined(separator: ", ")
        }
    }

    func apply(to document: PDFDocument) {
        var attrs = document.documentAttributes ?? [:]
        attrs[PDFDocumentAttribute.titleAttribute] = title
        attrs[PDFDocumentAttribute.authorAttribute] = author
        attrs[PDFDocumentAttribute.subjectAttribute] = subject
        attrs[PDFDocumentAttribute.keywordsAttribute] = keywords
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        document.documentAttributes = attrs
    }
}
