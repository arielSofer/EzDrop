// Ported 1:1 from AgenticDesigner/Models/PDFEditorModels.swift
//
// Data model for PDF Editor mode. In the Swift app PDFKit's
// PDFDocument/PDFPage/PDFAnnotation ARE the document model; in the port those
// are opaque handles the web app implements with pdf.js (rendering/text) and
// pdf-lib (writing). This file adds only what PDFKit doesn't already give us:
// tool state, and the overlay-edit representation "Edit Text" and
// "Replace Image" use.
//
// Text/vector content inside an existing PDF page lives in its content
// stream, which PDFKit does not expose for in-place rewriting. Editing it
// the way every consumer PDF editor does: cover the old run with an opaque
// patch, then draw the replacement (new text, or a new image) on top as its
// own annotation. Non-destructive until the page is flattened on export.

import type { Rect, Size } from './Geometry';

// MARK: - Tool modes

/** Swift case names → raw values (what the toolbar shows). */
export const PDFToolMode = {
  select: 'Select',
  editText: 'Edit Text',
  translate: 'Translate',
  replaceImage: 'Replace Image',
  shapeRect: 'Rectangle',
  shapeCircle: 'Circle',
  shapeLine: 'Line',
  draw: 'Draw',
  highlight: 'Highlight',
  underline: 'Underline',
  strikeOut: 'Strikeout',
  comment: 'Comment',
  freeText: 'Text Box',
  signature: 'Signature',
  formTextField: 'Text Field',
  formCheckbox: 'Checkbox',
  crop: 'Crop',
} as const;
export type PDFToolModeCase = keyof typeof PDFToolMode;
export type PDFToolMode = (typeof PDFToolMode)[PDFToolModeCase];
/** `CaseIterable.allCases` order. */
export const AllPDFToolMode = [
  'Select', 'Edit Text', 'Translate', 'Replace Image', 'Rectangle', 'Circle', 'Line', 'Draw',
  'Highlight', 'Underline', 'Strikeout', 'Comment', 'Text Box', 'Signature', 'Text Field', 'Checkbox', 'Crop',
] as const satisfies readonly PDFToolMode[];

/** `PDFToolMode.id` */
export function pdfToolModeId(mode: PDFToolMode): string {
  return mode;
}

/** `PDFToolMode.icon` — SF Symbol name. */
export function pdfToolModeIcon(mode: PDFToolMode): string {
  switch (mode) {
    case 'Select': return 'cursorarrow';
    case 'Edit Text': return 'character.cursor.ibeam';
    case 'Translate': return 'globe';
    case 'Replace Image': return 'photo';
    case 'Rectangle': return 'rectangle';
    case 'Circle': return 'circle';
    case 'Line': return 'line.diagonal';
    case 'Draw': return 'pencil.tip';
    case 'Highlight': return 'highlighter';
    case 'Underline': return 'underline';
    case 'Strikeout': return 'strikethrough';
    case 'Comment': return 'text.bubble';
    case 'Text Box': return 'textbox';
    case 'Signature': return 'signature';
    case 'Text Field': return 'character.textbox';
    case 'Checkbox': return 'checklist';
    case 'Crop': return 'crop';
  }
}

/** `PDFToolMode.isClickToPlace` — tools that place something with a single click, vs. drag-to-size. */
export function pdfToolModeIsClickToPlace(mode: PDFToolMode): boolean {
  switch (mode) {
    case 'Comment':
    case 'Signature':
      return true;
    default:
      return false;
  }
}

// MARK: - Overlay text edit

// A non-destructive replacement for one text run on a page: an opaque patch
// (matching the page background) plus new text drawn on top, both stored as
// annotations so they show, move, and undo like anything else — until
// flatten bakes them into the page's pixels on export.
export const PDFTextEditMarker = {
  /** `PDFAnnotationKey(rawValue: "AgenticDesignerTextPatch")` */
  patchKey: 'AgenticDesignerTextPatch',
} as const;

export interface PDFPatchStyle {
  /** hex colour; Swift default `NSColor.white` */
  backgroundColor: string;
}

export function makePDFPatchStyle(init: Partial<PDFPatchStyle> = {}): PDFPatchStyle {
  return { backgroundColor: init.backgroundColor ?? '#FFFFFF' };
}

// MARK: - Page thumbnail model (lightweight, for the left panel list)

export interface PDFPageSummary {
  /** page index — pages don't have a stable identity in PDFKit beyond position */
  id: number;
  label: string;
  size: Size;
  rotation: number;
}

/** `PDFPageSummary ==` (label is deliberately excluded, as in Swift). */
export function pdfPageSummariesEqual(lhs: PDFPageSummary, rhs: PDFPageSummary): boolean {
  return (
    lhs.id === rhs.id &&
    lhs.size.width === rhs.size.width &&
    lhs.size.height === rhs.size.height &&
    lhs.rotation === rhs.rotation
  );
}

// MARK: - Annotation authoring defaults

export interface PDFAnnotationStyle {
  /** hex colour; Swift default `NSColor.systemYellow` */
  color: string;
  strokeWidth: number;
  fontSize: number;
  fontName: string;
  /** hex colour; Swift default `NSColor.black` */
  textColor: string;
}

export function makePDFAnnotationStyle(init: Partial<PDFAnnotationStyle> = {}): PDFAnnotationStyle {
  return {
    color: init.color ?? '#FFCC00',
    strokeWidth: init.strokeWidth ?? 2,
    fontSize: init.fontSize ?? 14,
    fontName: init.fontName ?? 'Helvetica',
    textColor: init.textColor ?? '#000000',
  };
}

// MARK: - Paragraph detection result

// A block of consecutive text lines under one point: the unit "click text
// to rewrite it" operates on. lineHeight is the median line box height —
// the basis for matching the replacement's font size.
export interface PDFParagraph {
  text: string;
  bounds: Rect;
  lineHeight: number;
}

// MARK: - Opaque PDFKit handles (implemented by the web app on pdf.js / pdf-lib)

declare const opaqueBrand: unique symbol;

/** Stands in for PDFKit's `PDFAnnotation`. */
export interface PDFAnnotationHandle {
  readonly [opaqueBrand]?: 'PDFAnnotation';
  /** Zero-based page index the annotation lives on. */
  readonly pageIndex: number;
  /** Stable id assigned by the web PDF layer. */
  readonly annotationId: string;
  /** PDF annotation subtype (Square, Circle, Line, Ink, Highlight, Underline, StrikeOut, Text, FreeText, Stamp, Widget, ...). */
  readonly subtype: string;
  bounds: Rect;
  /** Arbitrary annotation key/values (e.g. PDFTextEditMarker.patchKey). */
  readonly values: Record<string, unknown>;
}

/** Stands in for PDFKit's `PDFSelection`. */
export interface PDFSelectionHandle {
  readonly [opaqueBrand]?: 'PDFSelection';
  readonly pageIndex: number;
  readonly text: string;
  /** Selection bounds in page space. */
  readonly bounds: Rect;
  /** Per-line boxes, when the implementation can provide them. */
  readonly lineBounds?: Rect[];
}

// MARK: - Selection

export type PDFSelectionKind =
  | { kind: 'annotation'; annotation: PDFAnnotationHandle }
  | { kind: 'textRange'; selection: PDFSelectionHandle }
  | { kind: 'none' };

export const PDFSelectionNone: Readonly<PDFSelectionKind> = Object.freeze({ kind: 'none' });

// MARK: - Metadata editing surface

/** PDFKit `PDFDocumentAttribute` keys. */
export const PDFDocumentAttribute = {
  titleAttribute: 'Title',
  authorAttribute: 'Author',
  subjectAttribute: 'Subject',
  keywordsAttribute: 'Keywords',
  creatorAttribute: 'Creator',
  producerAttribute: 'Producer',
  creationDateAttribute: 'CreationDate',
  modificationDateAttribute: 'ModDate',
} as const;

/** The slice of PDFKit's `PDFDocument` the metadata surface needs. */
export interface PDFDocumentAttributesSource {
  documentAttributes: Record<string, unknown> | null | undefined;
}

export interface PDFDocumentMetadata {
  title: string;
  author: string;
  subject: string;
  keywords: string;
}

export function makePDFDocumentMetadata(init: Partial<PDFDocumentMetadata> = {}): PDFDocumentMetadata {
  return {
    title: init.title ?? '',
    author: init.author ?? '',
    subject: init.subject ?? '',
    keywords: init.keywords ?? '',
  };
}

/** `PDFDocumentMetadata.init(from document:)` */
export function pdfDocumentMetadataFrom(document: PDFDocumentAttributesSource): PDFDocumentMetadata {
  const attrs = document.documentAttributes ?? {};
  const meta = makePDFDocumentMetadata();
  const title = attrs[PDFDocumentAttribute.titleAttribute];
  const author = attrs[PDFDocumentAttribute.authorAttribute];
  const subject = attrs[PDFDocumentAttribute.subjectAttribute];
  const keywords = attrs[PDFDocumentAttribute.keywordsAttribute];
  meta.title = typeof title === 'string' ? title : '';
  meta.author = typeof author === 'string' ? author : '';
  meta.subject = typeof subject === 'string' ? subject : '';
  if (Array.isArray(keywords) && keywords.every((k) => typeof k === 'string')) {
    meta.keywords = (keywords as string[]).join(', ');
  }
  return meta;
}

/** `PDFDocumentMetadata.apply(to:)` */
export function applyPDFDocumentMetadata(meta: PDFDocumentMetadata, document: PDFDocumentAttributesSource): void {
  const attrs: Record<string, unknown> = { ...(document.documentAttributes ?? {}) };
  attrs[PDFDocumentAttribute.titleAttribute] = meta.title;
  attrs[PDFDocumentAttribute.authorAttribute] = meta.author;
  attrs[PDFDocumentAttribute.subjectAttribute] = meta.subject;
  attrs[PDFDocumentAttribute.keywordsAttribute] = meta.keywords
    .split(',')
    .map((s) => s.replace(/^[ \t]+|[ \t]+$/g, ''))
    .filter((s) => s.length > 0);
  document.documentAttributes = attrs;
}
