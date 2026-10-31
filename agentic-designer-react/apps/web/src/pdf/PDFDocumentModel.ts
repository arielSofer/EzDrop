// Ported 1:1 from the PDFKit half of AgenticDesigner/ViewModels/PDFEditorViewModel.swift
// (`PDFDocument` / `PDFPage` / `PDFAnnotation` and `PDFImageStampAnnotation`).
//
// In the Swift app PDFKit IS the document model: the view model mutates a live
// `PDFDocument` and PDFKit renders, writes and reads it back. The browser has
// no PDFKit, so this file is that model — a mutable document built on
// **pdf-lib**: pages (add / remove / reorder / duplicate / rotate / crop) and
// annotations (FreeText, Square, Circle, Line, Ink, Highlight, Underline,
// StrikeOut, Text comments, Widget form fields and image stamps), including
// the two custom annotation dictionary entries the overlay-edit convention
// depends on:
//
//   AgenticDesignerTextPatch      — marks the opaque patch under a replacement
//   AgenticDesignerStampImageData — carries a stamp's image bytes
//
// Rendering and text extraction live in PDFRenderer.ts (pdf.js); flattening
// combines the two — every page is rasterised and re-assembled into a new
// pdf-lib document, which is what `exportFlattened(to:)` does with
// `PDFPage.draw(with:to:)` in Swift.
//
// KNOWN DIFFERENCE FROM PDFKIT, recorded rather than hidden: PDFKit generates
// an appearance stream for every annotation it draws. pdf-lib does not, so
// this file writes them itself — for every type except a FreeText whose text
// cannot be encoded in WinAnsi (Hebrew, Arabic). Those carry `/Contents` and a
// `/DA` default-appearance string instead, are drawn correctly by the app's
// own canvas overlay, and are baked into the pixels by `exportFlattened`,
// which draws them with the browser's own text engine.

import {
  PDFArray,
  PDFBool,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
  StandardFonts,
  degrees,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import {
  rectUnion,
  type PDFAnnotationHandle,
  type PDFDocumentAttributesSource,
  type PDFPageSummary,
  type Point,
  type Rect,
  type Size,
} from '@agentic/core';

// MARK: - Subtypes and custom keys

/** `PDFAnnotationSubtype` (PDFKit raw values without the leading slash). */
export const PDFAnnotationSubtype = {
  square: 'Square',
  circle: 'Circle',
  line: 'Line',
  ink: 'Ink',
  highlight: 'Highlight',
  underline: 'Underline',
  strikeOut: 'StrikeOut',
  text: 'Text',
  freeText: 'FreeText',
  stamp: 'Stamp',
  widget: 'Widget',
  popup: 'Popup',
  link: 'Link',
} as const;
export type PDFAnnotationSubtype = (typeof PDFAnnotationSubtype)[keyof typeof PDFAnnotationSubtype];

/** `PDFAnnotationKey(rawValue:)` — the app's private dictionary entries. */
export const PDFAnnotationKey = {
  /** Set on the opaque patch an overlay edit writes. */
  textPatch: 'AgenticDesignerTextPatch',
  /** `PDFImageStampAnnotation`'s coder key — the stamp's image bytes. */
  stampImageData: 'AgenticDesignerStampImageData',
  /** `addSignatureImage(_:bounds:page:)`'s key. */
  stampImage: 'AgenticDesignerStampImage',
} as const;

/** `NSTextAlignment` as the FreeText annotation stores it (`/Q`). */
export const PDFTextAlignment = { left: 'left', center: 'center', right: 'right', natural: 'natural' } as const;
export type PDFTextAlignment = (typeof PDFTextAlignment)[keyof typeof PDFTextAlignment];

export type PDFWidgetFieldType = 'text' | 'button';
export type PDFButtonWidgetState = 'on' | 'off';

export interface PDFStampImage {
  bytes: Uint8Array;
  type: 'png' | 'jpg';
}

/** Everything `PDFAnnotation(bounds:forType:withProperties:)` can carry. */
export interface PDFAnnotationSpec {
  subtype: PDFAnnotationSubtype;
  bounds: Rect;
  contents?: string | null;
  /** `annotation.color` — hex string. */
  color?: string | null;
  /** `annotation.interiorColor` — hex string. */
  interiorColor?: string | null;
  /** `PDFBorder.lineWidth` */
  borderWidth?: number;
  /** `PDFBorder.style` — "solid" | "dashed". */
  borderStyle?: 'solid' | 'dashed';
  fontName?: string;
  fontSize?: number;
  /** `annotation.fontColor` — hex string. */
  fontColor?: string;
  alignment?: PDFTextAlignment;
  startPoint?: Point;
  endPoint?: Point;
  /** Ink strokes in PAGE coordinates (converted to annotation-local on write). */
  inkPaths?: Point[][];
  fieldName?: string;
  widgetFieldType?: PDFWidgetFieldType;
  widgetStringValue?: string;
  buttonWidgetState?: PDFButtonWidgetState;
  image?: PDFStampImage;
  /** Custom annotation keys — `setValue(_:forAnnotationKey:)`. */
  values?: Record<string, unknown>;
}

// MARK: - Colour helpers

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** "#RRGGBB" → PDF colour components. */
export function hexToComponents(hex: string): [number, number, number] {
  const normalized = hex.trim().replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => character + character)
          .join('')
      : normalized;
  const value = Number.parseInt(expanded.slice(0, 6) || '000000', 16);
  if (!Number.isFinite(value)) return [0, 0, 0];
  return [clamp01(((value >> 16) & 0xff) / 255), clamp01(((value >> 8) & 0xff) / 255), clamp01((value & 0xff) / 255)];
}

export function componentsToHex(components: readonly number[]): string {
  const channel = (value: number): string =>
    Math.round(clamp01(value) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  if (components.length === 1) return `#${channel(components[0])}${channel(components[0])}${channel(components[0])}`;
  if (components.length >= 3) return `#${channel(components[0])}${channel(components[1])}${channel(components[2])}`;
  return '#000000';
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

// MARK: - Annotation model

/** A live `PDFAnnotation`: reading is a snapshot, writing goes to the dict. */
export class PDFAnnotationModel implements PDFAnnotationHandle {
  readonly annotationId: string;
  readonly subtype: PDFAnnotationSubtype;
  readonly values: Record<string, unknown>;
  contents: string | null;
  color: string | null;
  interiorColor: string | null;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  fontName: string | undefined;
  fontSize: number | undefined;
  fontColor: string | undefined;
  alignment: PDFTextAlignment;
  startPoint: Point | undefined;
  endPoint: Point | undefined;
  inkPaths: Point[][] | undefined;
  fieldName: string | undefined;
  widgetFieldType: PDFWidgetFieldType | undefined;
  widgetStringValue: string | undefined;
  buttonWidgetState: PDFButtonWidgetState | undefined;
  /** Base64 of the stamp image, from `AgenticDesignerStampImageData`. */
  imageBase64: string | undefined;

  private boundsValue: Rect;

  constructor(
    private readonly owner: PDFDocumentModel,
    readonly pageIndex: number,
    readonly ref: PDFRef,
    fields: {
      subtype: PDFAnnotationSubtype;
      bounds: Rect;
      values: Record<string, unknown>;
      contents?: string | null;
      color?: string | null;
      interiorColor?: string | null;
      borderWidth?: number;
      borderStyle?: 'solid' | 'dashed';
      fontName?: string;
      fontSize?: number;
      fontColor?: string;
      alignment?: PDFTextAlignment;
      startPoint?: Point;
      endPoint?: Point;
      inkPaths?: Point[][];
      fieldName?: string;
      widgetFieldType?: PDFWidgetFieldType;
      widgetStringValue?: string;
      buttonWidgetState?: PDFButtonWidgetState;
      imageBase64?: string;
    },
  ) {
    this.annotationId = `${ref.objectNumber} ${ref.generationNumber}`;
    this.subtype = fields.subtype;
    this.boundsValue = fields.bounds;
    this.values = fields.values;
    this.contents = fields.contents ?? null;
    this.color = fields.color ?? null;
    this.interiorColor = fields.interiorColor ?? null;
    this.borderWidth = fields.borderWidth ?? 0;
    this.borderStyle = fields.borderStyle ?? 'solid';
    this.fontName = fields.fontName;
    this.fontSize = fields.fontSize;
    this.fontColor = fields.fontColor;
    this.alignment = fields.alignment ?? PDFTextAlignment.natural;
    this.startPoint = fields.startPoint;
    this.endPoint = fields.endPoint;
    this.inkPaths = fields.inkPaths;
    this.fieldName = fields.fieldName;
    this.widgetFieldType = fields.widgetFieldType;
    this.widgetStringValue = fields.widgetStringValue;
    this.buttonWidgetState = fields.buttonWidgetState;
    this.imageBase64 = fields.imageBase64;
  }

  /** `annotation.type` */
  get type(): string {
    return this.subtype;
  }

  get bounds(): Rect {
    return this.boundsValue;
  }

  /** `annotation.bounds = …` — writes `/Rect` and regenerates the appearance. */
  set bounds(next: Rect) {
    this.boundsValue = next;
    this.owner.updateAnnotationBounds(this, next);
  }

  /** `annotation.value(forAnnotationKey:)` */
  value(forAnnotationKey: string): unknown {
    return this.values[forAnnotationKey];
  }
}

// MARK: - Rasterizer (pdf.js side of `exportFlattened`)

export interface RasterizedPage {
  /** PNG bytes of the whole page, annotations included. */
  png: Uint8Array;
  width: number;
  height: number;
}

/** Supplied by PDFRenderer — the browser half of `flattenPage(_:)`. */
export type PDFPageRasterizer = (pageIndex: number, mediaBox: Rect, rotation: number) => Promise<RasterizedPage>;

// MARK: - Document

export const USLetterSize: Size = { width: 612, height: 792 };

export class PDFDocumentModel implements PDFDocumentAttributesSource {
  private annotationCache = new Map<number, PDFAnnotationModel[]>();
  private helveticaFont: PDFFont | undefined;

  private constructor(readonly doc: PDFDocument) {}

  /** `PDFDocument()` — an empty document. */
  static async create(): Promise<PDFDocumentModel> {
    const doc = await PDFDocument.create();
    doc.setProducer('AgenticDesigner');
    return new PDFDocumentModel(doc);
  }

  /** `PDFDocument(url:)` / `PDFDocument(data:)` — returns null when unreadable. */
  static async load(bytes: Uint8Array | ArrayBuffer): Promise<PDFDocumentModel | null> {
    try {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      return new PDFDocumentModel(doc);
    } catch {
      return null;
    }
  }

  /** `newDocument(pageSize:)` — one blank WHITE page, US Letter by default. */
  static async newDocument(pageSize: Size = USLetterSize): Promise<PDFDocumentModel> {
    const model = await PDFDocumentModel.create();
    model.insertBlankPage(0, pageSize);
    return model;
  }

  // MARK: Pages

  get pageCount(): number {
    return this.doc.getPageCount();
  }

  page(at: number): PDFPage | null {
    if (at < 0 || at >= this.pageCount) return null;
    return this.doc.getPage(at);
  }

  /** `page.bounds(for: .mediaBox)` */
  mediaBox(index: number): Rect {
    const page = this.page(index);
    if (!page) return { x: 0, y: 0, width: 0, height: 0 };
    const box = page.getMediaBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  /** `page.bounds(for: .cropBox)` */
  cropBox(index: number): Rect {
    const page = this.page(index);
    if (!page) return { x: 0, y: 0, width: 0, height: 0 };
    const box = page.getCropBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }

  rotation(index: number): number {
    const page = this.page(index);
    if (!page) return 0;
    const angle = page.getRotation().angle;
    return ((angle % 360) + 360) % 360;
  }

  /** `var pages: [PDFPageSummary]` */
  get pages(): PDFPageSummary[] {
    const summaries: PDFPageSummary[] = [];
    for (let index = 0; index < this.pageCount; index += 1) {
      const bounds = this.mediaBox(index);
      summaries.push({
        id: index,
        label: `${index + 1}`,
        size: { width: bounds.width, height: bounds.height },
        rotation: this.rotation(index),
      });
    }
    return summaries;
  }

  /** `Self.blankPage(size:)` + `document.insert(page, at:)` */
  insertBlankPage(at: number, size: Size): PDFPage {
    const index = Math.min(Math.max(0, at), this.pageCount);
    const page = this.doc.insertPage(index, [size.width, size.height]);
    // `ctx.setFillColor(.white); ctx.fill(mediaBox)`
    page.drawRectangle({ x: 0, y: 0, width: size.width, height: size.height, color: { type: 'RGB', red: 1, green: 1, blue: 1 } as never });
    this.invalidate();
    return page;
  }

  /** `document.removePage(at:)` */
  removePage(at: number): void {
    if (at < 0 || at >= this.pageCount) return;
    this.doc.removePage(at);
    this.invalidate();
  }

  /**
   * `duplicatePage(at:)` — the Swift version replays the source page's content
   * stream into a fresh PDF context (vector-preserving) and re-creates the
   * annotations; pdf-lib's `copyPages` copies the page object graph, which
   * keeps BOTH the vector content and the annotations.
   */
  async duplicatePage(at: number): Promise<PDFPage | null> {
    if (at < 0 || at >= this.pageCount) return null;
    const [copy] = await this.doc.copyPages(this.doc, [at]);
    if (!copy) return null;
    this.doc.insertPage(at + 1, copy);
    this.invalidate();
    return copy;
  }

  /** `reorderPage(from:to:)` — remove then insert the SAME page object. */
  reorderPage(from: number, to: number): number | null {
    if (from < 0 || from >= this.pageCount) return null;
    if (to < 0 || to > this.pageCount || from === to) return null;
    const page = this.doc.getPage(from);
    this.doc.removePage(from);
    const insertAt = to > from ? to - 1 : to;
    this.doc.insertPage(Math.min(insertAt, this.pageCount), page);
    this.invalidate();
    return Math.min(insertAt, this.pageCount - 1);
  }

  /** `page.rotation = normalized` (absolute, already normalised by the caller). */
  setRotation(index: number, normalized: number): void {
    const page = this.page(index);
    if (!page) return;
    page.setRotation(degrees(normalized));
    this.invalidate();
  }

  /** `page.setBounds(rect, for: .cropBox)` */
  setCropBox(index: number, rect: Rect): void {
    const page = this.page(index);
    if (!page) return;
    page.setCropBox(rect.x, rect.y, rect.width, rect.height);
    this.invalidate();
  }

  // MARK: Metadata (`PDFDocumentAttribute`)

  get documentAttributes(): Record<string, unknown> {
    const keywords = this.doc.getKeywords() ?? '';
    return {
      Title: this.doc.getTitle() ?? '',
      Author: this.doc.getAuthor() ?? '',
      Subject: this.doc.getSubject() ?? '',
      Keywords: keywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter((keyword) => keyword.length > 0),
    };
  }

  set documentAttributes(attributes: Record<string, unknown>) {
    const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
    this.doc.setTitle(asString(attributes.Title));
    this.doc.setAuthor(asString(attributes.Author));
    this.doc.setSubject(asString(attributes.Subject));
    const keywords = attributes.Keywords;
    // PDFKit's keywords attribute is an array; the PDF's /Keywords is one
    // string, joined the way `PDFDocumentMetadata` splits it.
    const joined = Array.isArray(keywords)
      ? keywords.filter((keyword): keyword is string => typeof keyword === 'string').join(', ')
      : asString(keywords);
    this.doc.setKeywords([joined]);
  }

  // MARK: Serialisation

  /** `document.dataRepresentation()` / `document.write(to:)` */
  async dataRepresentation(): Promise<Uint8Array> {
    return this.doc.save({ useObjectStreams: false });
  }

  /**
   * `exportFlattened(to:)` — every page is rasterised (content AND annotations)
   * and re-assembled into a NEW document. The live document is untouched.
   */
  async exportFlattened(rasterize: PDFPageRasterizer): Promise<Uint8Array> {
    const flattened = await PDFDocument.create();
    for (let index = 0; index < this.pageCount; index += 1) {
      const mediaBox = this.mediaBox(index);
      const rasterized = await rasterize(index, mediaBox, this.rotation(index));
      const image = await flattened.embedPng(rasterized.png);
      const page = flattened.addPage([mediaBox.width, mediaBox.height]);
      page.drawImage(image, { x: 0, y: 0, width: mediaBox.width, height: mediaBox.height });
    }
    flattened.setTitle(this.doc.getTitle() ?? '');
    flattened.setAuthor(this.doc.getAuthor() ?? '');
    flattened.setSubject(this.doc.getSubject() ?? '');
    flattened.setKeywords([this.doc.getKeywords() ?? '']);
    return flattened.save({ useObjectStreams: false });
  }

  // MARK: Annotations

  private invalidate(): void {
    this.annotationCache.clear();
  }

  private get context() {
    return this.doc.context;
  }

  private helvetica(): PDFFont {
    if (!this.helveticaFont) this.helveticaFont = this.doc.embedStandardFont(StandardFonts.Helvetica);
    return this.helveticaFont;
  }

  /** `page.annotations` */
  annotations(pageIndex: number): PDFAnnotationModel[] {
    const cached = this.annotationCache.get(pageIndex);
    if (cached) return cached;
    const page = this.page(pageIndex);
    if (!page) return [];
    const annots = page.node.Annots();
    const models: PDFAnnotationModel[] = [];
    if (annots) {
      for (let index = 0; index < annots.size(); index += 1) {
        const ref = annots.get(index);
        if (!(ref instanceof PDFRef)) continue;
        const dict = this.context.lookup(ref, PDFDict);
        if (!dict) continue;
        const model = this.readAnnotation(pageIndex, ref, dict);
        if (model) models.push(model);
      }
    }
    this.annotationCache.set(pageIndex, models);
    return models;
  }

  private readAnnotation(pageIndex: number, ref: PDFRef, dict: PDFDict): PDFAnnotationModel | null {
    const subtypeName = dict.get(PDFName.of('Subtype'));
    if (!(subtypeName instanceof PDFName)) return null;
    const subtype = subtypeName.asString().replace('/', '') as PDFAnnotationSubtype;

    const rect = this.readRect(dict.get(PDFName.of('Rect')));
    if (!rect) return null;

    const values: Record<string, unknown> = {};
    if (dict.get(PDFName.of(PDFAnnotationKey.textPatch)) !== undefined) {
      values[PDFAnnotationKey.textPatch] = true;
    }
    let imageBase64: string | undefined;
    const imageEntry = dict.get(PDFName.of(PDFAnnotationKey.stampImageData));
    if (imageEntry !== undefined) {
      values[PDFAnnotationKey.stampImageData] = true;
      const stream = imageEntry instanceof PDFRef ? this.context.lookup(imageEntry) : imageEntry;
      if (stream instanceof PDFRawStream) imageBase64 = bytesToBase64(stream.contents);
    }

    const border = dict.get(PDFName.of('BS'));
    let borderWidth = 0;
    let borderStyle: 'solid' | 'dashed' = 'solid';
    if (border instanceof PDFDict) {
      const width = border.get(PDFName.of('W'));
      if (width instanceof PDFNumber) borderWidth = width.asNumber();
      const style = border.get(PDFName.of('S'));
      if (style instanceof PDFName && style.asString() === '/D') borderStyle = 'dashed';
    }

    const contentsEntry = dict.get(PDFName.of('Contents'));
    const contents =
      contentsEntry instanceof PDFString || contentsEntry instanceof PDFHexString ? contentsEntry.decodeText() : null;

    const quadding = dict.get(PDFName.of('Q'));
    const alignment: PDFTextAlignment =
      quadding instanceof PDFNumber
        ? quadding.asNumber() === 2
          ? PDFTextAlignment.right
          : quadding.asNumber() === 1
            ? PDFTextAlignment.center
            : PDFTextAlignment.left
        : PDFTextAlignment.natural;

    const defaultAppearance = dict.get(PDFName.of('DA'));
    let fontSize: number | undefined;
    let fontName: string | undefined;
    let fontColor: string | undefined;
    if (defaultAppearance instanceof PDFString || defaultAppearance instanceof PDFHexString) {
      const text = defaultAppearance.decodeText();
      const fontMatch = /\/([^\s]+)\s+([\d.]+)\s+Tf/.exec(text);
      if (fontMatch) {
        fontName = fontMatch[1];
        fontSize = Number.parseFloat(fontMatch[2]);
      }
      const grayMatch = /([\d.]+)\s+g\b/.exec(text);
      const rgbMatch = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg\b/.exec(text);
      if (rgbMatch) {
        fontColor = componentsToHex([
          Number.parseFloat(rgbMatch[1]),
          Number.parseFloat(rgbMatch[2]),
          Number.parseFloat(rgbMatch[3]),
        ]);
      } else if (grayMatch) {
        fontColor = componentsToHex([Number.parseFloat(grayMatch[1])]);
      }
    }

    const line = this.readNumbers(dict.get(PDFName.of('L')));
    const inkList = dict.get(PDFName.of('InkList'));
    let inkPaths: Point[][] | undefined;
    if (inkList instanceof PDFArray) {
      inkPaths = [];
      for (let index = 0; index < inkList.size(); index += 1) {
        const numbers = this.readNumbers(inkList.get(index));
        if (!numbers) continue;
        const path: Point[] = [];
        for (let offset = 0; offset + 1 < numbers.length; offset += 2) {
          path.push({ x: numbers[offset], y: numbers[offset + 1] });
        }
        inkPaths.push(path);
      }
    }

    const fieldNameEntry = dict.get(PDFName.of('T'));
    const fieldName =
      fieldNameEntry instanceof PDFString || fieldNameEntry instanceof PDFHexString ? fieldNameEntry.decodeText() : undefined;
    const fieldTypeEntry = dict.get(PDFName.of('FT'));
    const widgetFieldType: PDFWidgetFieldType | undefined =
      fieldTypeEntry instanceof PDFName
        ? fieldTypeEntry.asString() === '/Btn'
          ? 'button'
          : fieldTypeEntry.asString() === '/Tx'
            ? 'text'
            : undefined
        : undefined;
    const valueEntry = dict.get(PDFName.of('V'));
    const widgetStringValue =
      valueEntry instanceof PDFString || valueEntry instanceof PDFHexString ? valueEntry.decodeText() : undefined;
    const buttonWidgetState: PDFButtonWidgetState | undefined =
      widgetFieldType === 'button'
        ? valueEntry instanceof PDFName && valueEntry.asString() !== '/Off'
          ? 'on'
          : 'off'
        : undefined;

    return new PDFAnnotationModel(this, pageIndex, ref, {
      subtype,
      bounds: rect,
      values,
      contents,
      color: this.readColor(dict.get(PDFName.of('C'))),
      interiorColor: this.readColor(dict.get(PDFName.of('IC'))),
      borderWidth,
      borderStyle,
      fontName,
      fontSize,
      fontColor,
      alignment,
      startPoint: line && line.length >= 4 ? { x: line[0], y: line[1] } : undefined,
      endPoint: line && line.length >= 4 ? { x: line[2], y: line[3] } : undefined,
      inkPaths,
      fieldName,
      widgetFieldType,
      widgetStringValue,
      buttonWidgetState,
      imageBase64,
    });
  }

  private readNumbers(object: unknown): number[] | null {
    if (!(object instanceof PDFArray)) return null;
    const numbers: number[] = [];
    for (let index = 0; index < object.size(); index += 1) {
      const entry = object.get(index);
      if (entry instanceof PDFNumber) numbers.push(entry.asNumber());
    }
    return numbers;
  }

  private readRect(object: unknown): Rect | null {
    const numbers = this.readNumbers(object);
    if (!numbers || numbers.length < 4) return null;
    const [x1, y1, x2, y2] = numbers;
    return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  }

  private readColor(object: unknown): string | null {
    const numbers = this.readNumbers(object);
    if (!numbers || numbers.length === 0) return null;
    return componentsToHex(numbers);
  }

  /**
   * `PDFAnnotation(bounds:forType:withProperties:)` + `page.addAnnotation(_:)`.
   * Image stamps need `embedPng`/`embedJpg`, so this is async throughout.
   */
  async addAnnotation(pageIndex: number, spec: PDFAnnotationSpec): Promise<PDFAnnotationModel | null> {
    const page = this.page(pageIndex);
    if (!page) return null;

    const dictionary: Record<string, unknown> = {
      Type: 'Annot',
      Subtype: spec.subtype,
      Rect: rectToArray(spec.bounds),
      F: 4, // print
    };

    const dict = this.context.obj(dictionary as never) as unknown as PDFDict;
    if (spec.contents !== undefined && spec.contents !== null) {
      dict.set(PDFName.of('Contents'), PDFHexString.fromText(spec.contents));
    }
    if (spec.color) dict.set(PDFName.of('C'), this.context.obj(hexToComponents(spec.color) as never));
    if (spec.interiorColor) dict.set(PDFName.of('IC'), this.context.obj(hexToComponents(spec.interiorColor) as never));
    const borderWidth = spec.borderWidth ?? 0;
    dict.set(
      PDFName.of('BS'),
      this.context.obj({ W: borderWidth, S: spec.borderStyle === 'dashed' ? 'D' : 'S' } as never),
    );
    if (spec.borderStyle === 'dashed') dict.set(PDFName.of('D'), this.context.obj([3, 3] as never));

    if (spec.subtype === PDFAnnotationSubtype.freeText) {
      const size = spec.fontSize ?? 12;
      const components = hexToComponents(spec.fontColor ?? '#000000');
      const fontResourceName = isWinAnsiEncodable(spec.contents ?? '') ? 'Helv' : spec.fontName ?? 'Helv';
      dict.set(
        PDFName.of('DA'),
        PDFString.of(
          `/${fontResourceName} ${formatNumber(size)} Tf ${components.map(formatNumber).join(' ')} rg`,
        ),
      );
      dict.set(PDFName.of('Q'), PDFNumber.of(quaddingFor(spec.alignment ?? PDFTextAlignment.natural, spec.contents ?? '')));
    }

    if (spec.subtype === PDFAnnotationSubtype.line && spec.startPoint && spec.endPoint) {
      dict.set(
        PDFName.of('L'),
        this.context.obj([spec.startPoint.x, spec.startPoint.y, spec.endPoint.x, spec.endPoint.y] as never),
      );
    }

    if (spec.subtype === PDFAnnotationSubtype.ink && spec.inkPaths) {
      dict.set(
        PDFName.of('InkList'),
        this.context.obj(spec.inkPaths.map((path) => path.flatMap((point) => [point.x, point.y])) as never),
      );
    }

    if (
      spec.subtype === PDFAnnotationSubtype.highlight ||
      spec.subtype === PDFAnnotationSubtype.underline ||
      spec.subtype === PDFAnnotationSubtype.strikeOut
    ) {
      const { x, y, width, height } = spec.bounds;
      dict.set(
        PDFName.of('QuadPoints'),
        this.context.obj([x, y + height, x + width, y + height, x, y, x + width, y] as never),
      );
    }

    if (spec.subtype === PDFAnnotationSubtype.text) {
      dict.set(PDFName.of('Name'), PDFName.of('Comment'));
      dict.set(PDFName.of('Open'), PDFBool.False);
    }

    if (spec.subtype === PDFAnnotationSubtype.widget) {
      dict.set(PDFName.of('FT'), PDFName.of(spec.widgetFieldType === 'button' ? 'Btn' : 'Tx'));
      if (spec.fieldName) dict.set(PDFName.of('T'), PDFHexString.fromText(spec.fieldName));
      if (spec.widgetFieldType === 'button') {
        const state = spec.buttonWidgetState === 'on' ? 'Yes' : 'Off';
        dict.set(PDFName.of('V'), PDFName.of(state));
        dict.set(PDFName.of('AS'), PDFName.of(state));
      } else {
        dict.set(PDFName.of('V'), PDFHexString.fromText(spec.widgetStringValue ?? ''));
        dict.set(PDFName.of('DA'), PDFString.of('/Helv 12 Tf 0 g'));
      }
    }

    for (const [key, value] of Object.entries(spec.values ?? {})) {
      if (value === undefined) continue;
      if (typeof value === 'boolean') dict.set(PDFName.of(key), value ? PDFBool.True : PDFBool.False);
      else if (typeof value === 'number') dict.set(PDFName.of(key), PDFNumber.of(value));
      else dict.set(PDFName.of(key), PDFHexString.fromText(String(value)));
    }

    // The stamp's image: an XObject for the appearance, and the raw bytes under
    // the private key so a reload can rebuild `PDFImageStampAnnotation`.
    let imageRef: PDFRef | undefined;
    let imageBase64: string | undefined;
    if (spec.image) {
      const embedded =
        spec.image.type === 'png' ? await this.doc.embedPng(spec.image.bytes) : await this.doc.embedJpg(spec.image.bytes);
      imageRef = embedded.ref;
      imageBase64 = bytesToBase64(spec.image.bytes);
      const dataRef = this.context.register(
        this.context.stream(spec.image.bytes, { Type: 'AgenticDesignerStampImage', Subtype: spec.image.type }),
      );
      dict.set(PDFName.of(PDFAnnotationKey.stampImageData), dataRef);
    }

    const appearance = this.buildAppearance(spec, imageRef);
    if (appearance) dict.set(PDFName.of('AP'), this.context.obj({ N: appearance } as never));

    const ref = this.context.register(dict);
    page.node.addAnnot(ref);
    if (spec.subtype === PDFAnnotationSubtype.widget) this.registerFormField(ref, dict);
    this.invalidate();

    const model = this.annotations(pageIndex).find((annotation) => annotation.ref === ref) ?? null;
    if (model && imageBase64) model.imageBase64 = imageBase64;
    return model;
  }

  /** AcroForm registration so a form field is a real field, not just a widget. */
  private registerFormField(ref: PDFRef, dict: PDFDict): void {
    const catalog = this.doc.catalog;
    let acroForm = catalog.lookup(PDFName.of('AcroForm'), PDFDict);
    if (!acroForm) {
      acroForm = this.context.obj({ Fields: [] } as never) as unknown as PDFDict;
      catalog.set(PDFName.of('AcroForm'), this.context.register(acroForm));
    }
    let fields = acroForm.lookup(PDFName.of('Fields'), PDFArray);
    if (!fields) {
      fields = this.context.obj([] as never) as unknown as PDFArray;
      acroForm.set(PDFName.of('Fields'), fields);
    }
    fields.push(ref);
    let resources = acroForm.lookup(PDFName.of('DR'), PDFDict);
    if (!resources) {
      resources = this.context.obj({} as never) as unknown as PDFDict;
      acroForm.set(PDFName.of('DR'), resources);
    }
    let fonts = resources.lookup(PDFName.of('Font'), PDFDict);
    if (!fonts) {
      fonts = this.context.obj({} as never) as unknown as PDFDict;
      resources.set(PDFName.of('Font'), fonts);
    }
    fonts.set(PDFName.of('Helv'), this.helvetica().ref);
    if (!acroForm.get(PDFName.of('DA'))) acroForm.set(PDFName.of('DA'), PDFString.of('/Helv 12 Tf 0 g'));
    void dict;
  }

  /** `page.removeAnnotation(_:)` */
  removeAnnotation(annotation: PDFAnnotationModel): void {
    const page = this.page(annotation.pageIndex);
    if (!page) return;
    const annots = page.node.Annots();
    if (!annots) return;
    for (let index = annots.size() - 1; index >= 0; index -= 1) {
      const entry = annots.get(index);
      if (entry instanceof PDFRef && entry === annotation.ref) annots.remove(index);
    }
    this.invalidate();
  }

  /** `annotation.bounds = …` */
  updateAnnotationBounds(annotation: PDFAnnotationModel, bounds: Rect): void {
    const dict = this.context.lookup(annotation.ref, PDFDict);
    if (!dict) return;
    dict.set(PDFName.of('Rect'), this.context.obj(rectToArray(bounds) as never));
    const appearance = this.buildAppearance(
      {
        subtype: annotation.subtype,
        bounds,
        contents: annotation.contents,
        color: annotation.color,
        interiorColor: annotation.interiorColor,
        borderWidth: annotation.borderWidth,
        borderStyle: annotation.borderStyle,
        fontName: annotation.fontName,
        fontSize: annotation.fontSize,
        fontColor: annotation.fontColor,
        alignment: annotation.alignment,
        startPoint: annotation.startPoint,
        endPoint: annotation.endPoint,
        inkPaths: annotation.inkPaths,
      },
      undefined,
    );
    if (appearance) dict.set(PDFName.of('AP'), this.context.obj({ N: appearance } as never));
    this.annotationCache.delete(annotation.pageIndex);
  }

  // MARK: Appearance streams

  private buildAppearance(spec: PDFAnnotationSpec, imageRef: PDFRef | undefined): PDFRef | undefined {
    const { width, height } = spec.bounds;
    if (!(width > 0) || !(height > 0)) return undefined;
    const resources: Record<string, unknown> = {};
    let content: string | undefined;

    switch (spec.subtype) {
      case PDFAnnotationSubtype.square:
        content = squareAppearance(spec, width, height);
        break;
      case PDFAnnotationSubtype.circle:
        content = circleAppearance(spec, width, height);
        break;
      case PDFAnnotationSubtype.line:
        content = lineAppearance(spec);
        break;
      case PDFAnnotationSubtype.ink:
        content = inkAppearance(spec);
        break;
      case PDFAnnotationSubtype.highlight:
        content = `${colorOperators(spec.color ?? '#FFCC00', 'fill')}0 0 ${formatNumber(width)} ${formatNumber(height)} re f`;
        resources.ExtGState = { GS0: { Type: 'ExtGState', BM: 'Multiply', ca: 1 } };
        content = `/GS0 gs ${content}`;
        break;
      case PDFAnnotationSubtype.underline:
        content = markupLine(spec, height * 0.08, width);
        break;
      case PDFAnnotationSubtype.strikeOut:
        content = markupLine(spec, height * 0.45, width);
        break;
      case PDFAnnotationSubtype.stamp: {
        if (!imageRef) return undefined;
        resources.XObject = { Im0: imageRef };
        content = `q ${formatNumber(width)} 0 0 ${formatNumber(height)} 0 0 cm /Im0 Do Q`;
        break;
      }
      case PDFAnnotationSubtype.freeText: {
        const text = spec.contents ?? '';
        if (!isWinAnsiEncodable(text)) return undefined; // see the file header
        const font = this.helvetica();
        resources.Font = { Helv: font.ref };
        content = freeTextAppearance(text, spec, font, width, height);
        break;
      }
      default:
        return undefined;
    }

    if (!content) return undefined;
    const stream = this.context.stream(content, {
      Type: 'XObject',
      Subtype: 'Form',
      FormType: 1,
      BBox: [0, 0, width, height],
      Resources: this.context.obj(resources as never) as unknown as PDFDict,
    });
    return this.context.register(stream);
  }
}

// MARK: - Appearance content streams

function rectToArray(rect: Rect): number[] {
  return [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height];
}

function colorOperators(hex: string, mode: 'fill' | 'stroke'): string {
  const [red, green, blue] = hexToComponents(hex);
  const operator = mode === 'fill' ? 'rg' : 'RG';
  return `${formatNumber(red)} ${formatNumber(green)} ${formatNumber(blue)} ${operator} `;
}

function squareAppearance(spec: PDFAnnotationSpec, width: number, height: number): string {
  const parts: string[] = [];
  const inset = (spec.borderWidth ?? 0) / 2;
  const rect = `${formatNumber(inset)} ${formatNumber(inset)} ${formatNumber(width - inset * 2)} ${formatNumber(height - inset * 2)} re`;
  if (spec.interiorColor) parts.push(colorOperators(spec.interiorColor, 'fill'));
  if (spec.color && (spec.borderWidth ?? 0) > 0) {
    parts.push(colorOperators(spec.color, 'stroke'), `${formatNumber(spec.borderWidth ?? 0)} w `);
  }
  parts.push(rect);
  const fills = Boolean(spec.interiorColor);
  const strokes = Boolean(spec.color) && (spec.borderWidth ?? 0) > 0;
  parts.push(fills && strokes ? ' B' : fills ? ' f' : strokes ? ' S' : ' n');
  return parts.join('');
}

function circleAppearance(spec: PDFAnnotationSpec, width: number, height: number): string {
  const kappa = 0.5522847498;
  const inset = (spec.borderWidth ?? 0) / 2;
  const x0 = inset;
  const y0 = inset;
  const x1 = width - inset;
  const y1 = height - inset;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0) / 2;
  const ry = (y1 - y0) / 2;
  const ox = rx * kappa;
  const oy = ry * kappa;
  const n = formatNumber;
  const path =
    `${n(cx - rx)} ${n(cy)} m ` +
    `${n(cx - rx)} ${n(cy + oy)} ${n(cx - ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c ` +
    `${n(cx + ox)} ${n(cy + ry)} ${n(cx + rx)} ${n(cy + oy)} ${n(cx + rx)} ${n(cy)} c ` +
    `${n(cx + rx)} ${n(cy - oy)} ${n(cx + ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c ` +
    `${n(cx - ox)} ${n(cy - ry)} ${n(cx - rx)} ${n(cy - oy)} ${n(cx - rx)} ${n(cy)} c`;
  const parts: string[] = [];
  if (spec.interiorColor) parts.push(colorOperators(spec.interiorColor, 'fill'));
  if (spec.color) parts.push(colorOperators(spec.color, 'stroke'));
  parts.push(`${formatNumber(spec.borderWidth ?? 1)} w `, path);
  const fills = Boolean(spec.interiorColor);
  const strokes = Boolean(spec.color) && (spec.borderWidth ?? 0) > 0;
  parts.push(fills && strokes ? ' B' : fills ? ' f' : ' S');
  return parts.join('');
}

function lineAppearance(spec: PDFAnnotationSpec): string {
  if (!spec.startPoint || !spec.endPoint) return '';
  const x0 = spec.startPoint.x - spec.bounds.x;
  const y0 = spec.startPoint.y - spec.bounds.y;
  const x1 = spec.endPoint.x - spec.bounds.x;
  const y1 = spec.endPoint.y - spec.bounds.y;
  return (
    colorOperators(spec.color ?? '#000000', 'stroke') +
    `${formatNumber(spec.borderWidth ?? 1)} w ${formatNumber(x0)} ${formatNumber(y0)} m ${formatNumber(x1)} ${formatNumber(y1)} l S`
  );
}

function inkAppearance(spec: PDFAnnotationSpec): string {
  if (!spec.inkPaths || spec.inkPaths.length === 0) return '';
  const parts: string[] = [
    colorOperators(spec.color ?? '#000000', 'stroke'),
    `${formatNumber(spec.borderWidth ?? 1)} w 1 J 1 j `,
  ];
  // PDFKit draws ink paths in ANNOTATION-LOCAL coordinates (origin at
  // bounds.origin) — the appearance stream's BBox does the same.
  for (const stroke of spec.inkPaths) {
    if (stroke.length === 0) continue;
    const [first, ...rest] = stroke;
    parts.push(`${formatNumber(first.x - spec.bounds.x)} ${formatNumber(first.y - spec.bounds.y)} m `);
    for (const point of rest) {
      parts.push(`${formatNumber(point.x - spec.bounds.x)} ${formatNumber(point.y - spec.bounds.y)} l `);
    }
    parts.push('S ');
  }
  return parts.join('');
}

function markupLine(spec: PDFAnnotationSpec, y: number, width: number): string {
  return (
    colorOperators(spec.color ?? '#000000', 'stroke') +
    `1 w 0 ${formatNumber(y)} m ${formatNumber(width)} ${formatNumber(y)} l S`
  );
}

/** WinAnsi is what a standard-14 font can encode — Hebrew/Arabic cannot. */
export function isWinAnsiEncodable(text: string): boolean {
  for (const character of text) {
    const value = character.codePointAt(0) ?? 0;
    if (value > 0xff) return false;
  }
  return true;
}

/** `NSTextAlignment` → the FreeText `/Q` quadding value. */
export function quaddingFor(alignment: PDFTextAlignment, text: string): number {
  const resolved =
    alignment === PDFTextAlignment.natural ? (isRightToLeftText(text) ? PDFTextAlignment.right : PDFTextAlignment.left) : alignment;
  return resolved === PDFTextAlignment.right ? 2 : resolved === PDFTextAlignment.center ? 1 : 0;
}

/** `LocalModelTranslator.isRightToLeft(_:)` — duplicated to keep this file standalone. */
function isRightToLeftText(text: string): boolean {
  for (const character of text) {
    const value = character.codePointAt(0) ?? 0;
    if (value >= 0x0590 && value <= 0x08ff) return true;
  }
  return false;
}

function freeTextAppearance(text: string, spec: PDFAnnotationSpec, font: PDFFont, width: number, height: number): string {
  const size = spec.fontSize ?? 12;
  const leading = size * 1.2;
  const usableWidth = Math.max(1, width - 4);
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    let current = '';
    for (const word of paragraph.split(' ')) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= usableWidth || current.length === 0) {
        current = candidate;
      } else {
        lines.push(current);
        current = word;
      }
    }
    lines.push(current);
  }

  const quadding = quaddingFor(spec.alignment ?? PDFTextAlignment.natural, text);
  const parts: string[] = ['q BT ', colorOperators(spec.fontColor ?? '#000000', 'fill'), `/Helv ${formatNumber(size)} Tf `];
  let y = height - 2 - size;
  for (const line of lines) {
    if (y < -leading) break;
    const lineWidth = font.widthOfTextAtSize(line, size);
    const x = quadding === 2 ? Math.max(2, width - 2 - lineWidth) : quadding === 1 ? Math.max(2, (width - lineWidth) / 2) : 2;
    parts.push(`1 0 0 1 ${formatNumber(x)} ${formatNumber(y)} Tm `);
    parts.push(`${font.encodeText(line).asString()} Tj `);
    y -= leading;
  }
  parts.push('ET Q');
  return parts.join('');
}

// MARK: - Base64 helpers (browser + node)

export function bytesToBase64(bytes: Uint8Array): string {
  const globalBuffer = (globalThis as { Buffer?: { from(input: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (globalBuffer) return globalBuffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const globalBuffer = (globalThis as { Buffer?: { from(input: string, encoding: string): Uint8Array } }).Buffer;
  if (globalBuffer) return new Uint8Array(globalBuffer.from(base64, 'base64'));
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** `bounds.union(other)` — re-exported so the store keeps the Swift phrasing. */
export const unionRects = rectUnion;
