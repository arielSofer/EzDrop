// apps/web/src/stores/pdfStore.ts
//
// Ported 1:1 from AgenticDesigner/ViewModels/PDFEditorViewModel.swift
// Central Zustand store for the PDF Editor mode.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  PDFToolMode,
  makePDFAnnotationStyle,
  makePDFPatchStyle,
  makePDFDocumentMetadata,
  applyPDFDocumentMetadata,
  type PDFAnnotationStyle,
  type PDFPatchStyle,
  type PDFDocumentMetadata,
  type Rect,
  type Size,
} from '@agentic/core';
import {
  PDFDocumentModel,
  PDFAnnotationKey,
  type PDFAnnotationModel,
  type PDFAnnotationSpec,
  PDFAnnotationSubtype,
} from '../pdf/PDFDocumentModel';
import { bridge } from '../bridge/bridgeClient';

export interface PDFStoreState {
  document: PDFDocumentModel | null;
  fileURL: string | null;
  currentPageIndex: number;
  pageCount: number;
  toolMode: PDFToolMode;
  selectedAnnotation: PDFAnnotationModel | null;
  isDirty: boolean;
  annotationStyle: PDFAnnotationStyle;
  patchStyle: PDFPatchStyle;
  statusMessage: string | null;
  zoomScale: number;
  metadata: PDFDocumentMetadata;
  revision: number;
  batchProgress: string | null;
  isTranslating: boolean;
  externalPDFTranslationProgress: string | null;
  isExternalPDFTranslationRunning: boolean;
  undoStack: Uint8Array[];
  redoStack: Uint8Array[];
}

export interface PDFStoreActions {
  newDocument(pageSize?: Size): Promise<void>;
  open(data: Uint8Array, fileURL?: string): Promise<boolean>;
  openFromPath(path: string): Promise<boolean>;
  save(): Promise<Uint8Array | null>;
  saveAs(path?: string): Promise<Uint8Array | null>;
  exportFlattened(): Promise<Uint8Array | null>;
  setCurrentPageIndex(index: number): void;
  setToolMode(mode: PDFToolMode): void;
  setSelectedAnnotation(annotation: PDFAnnotationModel | null): void;
  setAnnotationStyle(style: Partial<PDFAnnotationStyle>): void;
  setPatchStyle(style: Partial<PDFPatchStyle>): void;
  setZoomScale(scale: number): void;
  setStatusMessage(msg: string | null): void;
  setMetadata(meta: Partial<PDFDocumentMetadata>): void;
  applyMetadata(): void;
  snapshotForUndo(): Promise<void>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  addPage(afterIndex?: number, size?: Size): Promise<void>;
  removePage(index: number): Promise<void>;
  duplicatePage(index: number): Promise<void>;
  reorderPage(from: number, to: number): Promise<void>;
  rotatePage(index: number, degrees: number): Promise<void>;
  cropPage(index: number, rect: Rect): Promise<void>;
  addAnnotation(pageIndex: number, spec: PDFAnnotationSpec): Promise<PDFAnnotationModel | null>;
  removeAnnotation(annotation: PDFAnnotationModel): Promise<void>;
  moveAnnotation(annotation: PDFAnnotationModel, toBounds: Rect): Promise<void>;
  editText(
    bounds: Rect,
    pageIndex: number,
    newText: string,
    options?: {
      backgroundColor?: string;
      fitToBounds?: boolean;
      verticalLift?: number;
    },
  ): Promise<PDFAnnotationModel | null>;
  revertOverlayEdits(pageIndex: number): Promise<number>;
  replaceImage(
    bounds: Rect,
    pageIndex: number,
    imageBase64: string,
    backgroundColor?: string,
  ): Promise<PDFAnnotationModel | null>;
  cancelBatchTranslation(): void;
  runGooglePDFTranslation(): Promise<void>;
  cancelGooglePDFTranslation(): void;
}

export type PDFStore = PDFStoreState & PDFStoreActions;

const MAX_UNDO_STACK = 40;

export const usePDFStore = create<PDFStore>()(
  immer((set, get) => ({
    document: null,
    fileURL: null,
    currentPageIndex: 0,
    pageCount: 0,
    toolMode: PDFToolMode.select,
    selectedAnnotation: null,
    isDirty: false,
    annotationStyle: makePDFAnnotationStyle(),
    patchStyle: makePDFPatchStyle(),
    statusMessage: null,
    zoomScale: 1.0,
    metadata: makePDFDocumentMetadata(),
    revision: 0,
    batchProgress: null,
    isTranslating: false,
    externalPDFTranslationProgress: null,
    isExternalPDFTranslationRunning: false,
    undoStack: [],
    redoStack: [],

    async newDocument(pageSize: Size = { width: 612, height: 792 }) {
      const doc = await PDFDocumentModel.newDocument(pageSize);
      set((state) => {
        state.document = doc;
        state.fileURL = null;
        state.currentPageIndex = 0;
        state.pageCount = doc.pageCount;
        state.isDirty = false;
        state.undoStack = [];
        state.redoStack = [];
        state.revision += 1;
        state.statusMessage = 'New document created';
      });
    },

    async open(data: Uint8Array, fileURL?: string) {
      try {
        const doc = await PDFDocumentModel.load(data);
        if (!doc) return false;
        set((state) => {
          state.document = doc;
          state.fileURL = fileURL ?? null;
          state.currentPageIndex = 0;
          state.pageCount = doc.pageCount;
          state.isDirty = false;
          state.undoStack = [];
          state.redoStack = [];
          state.revision += 1;
          state.statusMessage = `Opened ${fileURL ?? 'document'}`;
        });
        return true;
      } catch (error) {
        set((state) => {
          state.statusMessage = `Failed to open PDF: ${(error as Error).message}`;
        });
        return false;
      }
    },

    async openFromPath(path: string) {
      try {
        const res = await bridge.call('fs.readFile', { path, encoding: 'base64' });
        if (!res) return false;
        const binary = atob((res as { content?: string }).content ?? '');
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return get().open(bytes, path);
      } catch {
        return false;
      }
    },

    async snapshotForUndo() {
      const doc = get().document;
      if (!doc) return;
      try {
        const bytes = await doc.dataRepresentation();
        set((state) => {
          state.undoStack.push(bytes);
          if (state.undoStack.length > MAX_UNDO_STACK) {
            state.undoStack.shift();
          }
          state.redoStack = [];
          state.isDirty = true;
          state.revision += 1;
        });
      } catch {
        // ignore snapshot error
      }
    },

    async undo() {
      const { undoStack, document: doc } = get();
      if (undoStack.length === 0 || !doc) return;
      const currentBytes = await doc.dataRepresentation();
      const prevBytes = undoStack[undoStack.length - 1]!;
      const restored = await PDFDocumentModel.load(prevBytes);
      if (!restored) return;

      set((state) => {
        state.redoStack.push(currentBytes);
        state.undoStack.pop();
        state.document = restored;
        state.pageCount = restored.pageCount;
        state.currentPageIndex = Math.min(state.currentPageIndex, restored.pageCount - 1);
        state.revision += 1;
      });
    },

    async redo() {
      const { redoStack, document: doc } = get();
      if (redoStack.length === 0 || !doc) return;
      const currentBytes = await doc.dataRepresentation();
      const nextBytes = redoStack[redoStack.length - 1]!;
      const restored = await PDFDocumentModel.load(nextBytes);
      if (!restored) return;

      set((state) => {
        state.undoStack.push(currentBytes);
        state.redoStack.pop();
        state.document = restored;
        state.pageCount = restored.pageCount;
        state.currentPageIndex = Math.min(state.currentPageIndex, restored.pageCount - 1);
        state.revision += 1;
      });
    },

    async save() {
      const doc = get().document;
      if (!doc) return null;
      const bytes = await doc.dataRepresentation();
      set((state) => {
        state.isDirty = false;
        state.statusMessage = 'Saved';
      });
      return bytes;
    },

    async saveAs() {
      const doc = get().document;
      if (!doc) return null;
      return await doc.dataRepresentation();
    },

    async exportFlattened() {
      const doc = get().document;
      if (!doc) return null;
      return await doc.dataRepresentation();
    },

    setCurrentPageIndex(index: number) {
      const count = get().pageCount;
      if (count === 0) return;
      const clamped = Math.max(0, Math.min(index, count - 1));
      set((state) => {
        state.currentPageIndex = clamped;
        state.selectedAnnotation = null;
      });
    },

    setToolMode(mode: PDFToolMode) {
      set((state) => {
        state.toolMode = mode;
        if (mode !== PDFToolMode.select) {
          state.selectedAnnotation = null;
        }
      });
    },

    setSelectedAnnotation(annotation: PDFAnnotationModel | null) {
      set((state) => {
        state.selectedAnnotation = annotation;
      });
    },

    setAnnotationStyle(style: Partial<PDFAnnotationStyle>) {
      set((state) => {
        state.annotationStyle = { ...state.annotationStyle, ...style };
      });
    },

    setPatchStyle(style: Partial<PDFPatchStyle>) {
      set((state) => {
        state.patchStyle = { ...state.patchStyle, ...style };
      });
    },

    setZoomScale(scale: number) {
      set((state) => {
        state.zoomScale = Math.max(0.2, Math.min(scale, 5.0));
      });
    },

    setStatusMessage(msg: string | null) {
      set((state) => {
        state.statusMessage = msg;
      });
    },

    setMetadata(meta: Partial<PDFDocumentMetadata>) {
      set((state) => {
        state.metadata = { ...state.metadata, ...meta };
      });
    },

    applyMetadata() {
      const { document: doc, metadata } = get();
      if (!doc) return;
      applyPDFDocumentMetadata(metadata, doc);
      set((state) => {
        state.isDirty = true;
        state.revision += 1;
      });
    },

    async addPage(afterIndex?: number, size: Size = { width: 612, height: 792 }) {
      const doc = get().document;
      if (!doc) return;
      await get().snapshotForUndo();
      const targetIndex = afterIndex ?? get().currentPageIndex;
      doc.insertBlankPage(targetIndex + 1, size);
      set((state) => {
        state.pageCount = doc.pageCount;
        state.currentPageIndex = targetIndex + 1;
        state.revision += 1;
      });
    },

    async removePage(index: number) {
      const doc = get().document;
      if (!doc || doc.pageCount <= 1) return;
      await get().snapshotForUndo();
      doc.removePage(index);
      set((state) => {
        state.pageCount = doc.pageCount;
        state.currentPageIndex = Math.min(state.currentPageIndex, doc.pageCount - 1);
        state.revision += 1;
      });
    },

    async duplicatePage(index: number) {
      const doc = get().document;
      if (!doc) return;
      await get().snapshotForUndo();
      await doc.duplicatePage(index);
      set((state) => {
        state.pageCount = doc.pageCount;
        state.currentPageIndex = index + 1;
        state.revision += 1;
      });
    },

    async reorderPage(from: number, to: number) {
      const doc = get().document;
      if (!doc) return;
      await get().snapshotForUndo();
      const insertAt = doc.reorderPage(from, to);
      if (insertAt !== null) {
        set((state) => {
          state.currentPageIndex = insertAt;
          state.revision += 1;
        });
      }
    },

    async rotatePage(index: number, degrees: number) {
      const doc = get().document;
      if (!doc) return;
      await get().snapshotForUndo();
      const current = doc.rotation(index);
      doc.setRotation(index, (current + degrees) % 360);
      set((state) => {
        state.revision += 1;
      });
    },

    async cropPage(index: number, rect: Rect) {
      const doc = get().document;
      if (!doc) return;
      await get().snapshotForUndo();
      doc.setCropBox(index, rect);
      set((state) => {
        state.revision += 1;
      });
    },

    async addAnnotation(pageIndex: number, spec: PDFAnnotationSpec) {
      const doc = get().document;
      if (!doc) return null;
      await get().snapshotForUndo();
      const model = await doc.addAnnotation(pageIndex, spec);
      set((state) => {
        state.selectedAnnotation = model;
        state.revision += 1;
      });
      return model;
    },

    async removeAnnotation(annotation: PDFAnnotationModel) {
      const doc = get().document;
      if (!doc) return;
      await get().snapshotForUndo();
      doc.removeAnnotation(annotation);
      set((state) => {
        if (state.selectedAnnotation?.annotationId === annotation.annotationId) {
          state.selectedAnnotation = null;
        }
        state.revision += 1;
      });
    },

    async moveAnnotation(annotation: PDFAnnotationModel, toBounds: Rect) {
      const doc = get().document;
      if (!doc) return;
      await get().snapshotForUndo();
      annotation.bounds = toBounds;
      set((state) => {
        state.revision += 1;
      });
    },

    async editText(bounds: Rect, pageIndex: number, newText: string, options = {}) {
      const doc = get().document;
      if (!doc) return null;
      await get().snapshotForUndo();

      const patchSpec: PDFAnnotationSpec = {
        bounds,
        subtype: PDFAnnotationSubtype.square,
        color: options.backgroundColor ?? get().patchStyle.backgroundColor,
        interiorColor: options.backgroundColor ?? get().patchStyle.backgroundColor,
        values: {
          [PDFAnnotationKey.textPatch]: true,
        },
      };
      doc.addAnnotation(pageIndex, patchSpec);

      const textSpec: PDFAnnotationSpec = {
        bounds: {
          ...bounds,
          y: bounds.y + (options.verticalLift ?? 0),
        },
        subtype: PDFAnnotationSubtype.freeText,
        contents: newText,
        fontSize: get().annotationStyle.fontSize,
        fontColor: get().annotationStyle.textColor,
        values: {
          [PDFAnnotationKey.textPatch]: true,
        },
      };
      const textModel = await doc.addAnnotation(pageIndex, textSpec);

      set((state) => {
        state.selectedAnnotation = textModel;
        state.revision += 1;
      });
      return textModel;
    },

    async revertOverlayEdits(pageIndex: number) {
      const doc = get().document;
      if (!doc) return 0;
      await get().snapshotForUndo();
      const annotations = doc.annotations(pageIndex);
      let count = 0;
      for (const ann of annotations) {
        if (ann.value(PDFAnnotationKey.textPatch)) {
          doc.removeAnnotation(ann);
          count += 1;
        }
      }
      set((state) => {
        state.revision += 1;
        state.statusMessage = `Reverted ${count} overlay edit(s)`;
      });
      return count;
    },

    async replaceImage(bounds: Rect, pageIndex: number, imageBase64: string, backgroundColor = '#FFFFFF') {
      const doc = get().document;
      if (!doc) return null;
      await get().snapshotForUndo();

      const patchSpec: PDFAnnotationSpec = {
        bounds,
        subtype: PDFAnnotationSubtype.square,
        color: backgroundColor,
        interiorColor: backgroundColor,
      };
      await doc.addAnnotation(pageIndex, patchSpec);

      const stampSpec: PDFAnnotationSpec = {
        bounds,
        subtype: PDFAnnotationSubtype.stamp,
        values: {
          [PDFAnnotationKey.stampImageData]: imageBase64,
        },
      };
      const stampModel = await doc.addAnnotation(pageIndex, stampSpec);

      set((state) => {
        state.selectedAnnotation = stampModel;
        state.revision += 1;
      });
      return stampModel;
    },

    cancelBatchTranslation() {
      set((state) => {
        state.isTranslating = false;
        state.batchProgress = null;
        state.statusMessage = 'Batch translation cancelled';
      });
    },

    async runGooglePDFTranslation() {
      const fileURL = get().fileURL;
      if (!fileURL) {
        set((state) => {
          state.statusMessage = 'No file open to translate';
        });
        return;
      }
      set((state) => {
        state.isExternalPDFTranslationRunning = true;
        state.externalPDFTranslationProgress = 'Starting Google PDF translation...';
      });
      try {
        await bridge.call('bridges.runGooglePDFTranslation', { fileURL });
      } catch (error) {
        set((state) => {
          state.externalPDFTranslationProgress = `Failed: ${(error as Error).message}`;
        });
      } finally {
        set((state) => {
          state.isExternalPDFTranslationRunning = false;
        });
      }
    },

    cancelGooglePDFTranslation() {
      set((state) => {
        state.isExternalPDFTranslationRunning = false;
        state.externalPDFTranslationProgress = null;
      });
    },
  })),
);
