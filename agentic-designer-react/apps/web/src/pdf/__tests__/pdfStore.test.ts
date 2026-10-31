// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { usePDFStore } from '../../stores/pdfStore';
import { PDFAnnotationSubtype } from '../PDFDocumentModel';

describe('usePDFStore', () => {
  beforeEach(async () => {
    await usePDFStore.getState().newDocument();
  });

  it('initializes with a blank document and 1 page', () => {
    const state = usePDFStore.getState();
    expect(state.document).not.toBeNull();
    expect(state.pageCount).toBe(1);
    expect(state.currentPageIndex).toBe(0);
  });

  it('adds and removes pages', async () => {
    const store = usePDFStore.getState();
    await store.addPage(0);
    expect(usePDFStore.getState().pageCount).toBe(2);

    await store.removePage(1);
    expect(usePDFStore.getState().pageCount).toBe(1);
  });

  it('adds and removes annotations', async () => {
    const store = usePDFStore.getState();
    const ann = await store.addAnnotation(0, {
      subtype: PDFAnnotationSubtype.square,
      bounds: { x: 50, y: 50, width: 100, height: 100 },
      color: '#FF0000',
    });

    expect(ann).not.toBeNull();
    expect(usePDFStore.getState().selectedAnnotation?.annotationId).toBe(ann?.annotationId);

    if (ann) {
      await store.removeAnnotation(ann);
      expect(usePDFStore.getState().selectedAnnotation).toBeNull();
    }
  });

  it('performs overlay text edit and reverts it', async () => {
    const store = usePDFStore.getState();
    const textModel = await store.editText(
      { x: 100, y: 200, width: 150, height: 30 },
      0,
      'Translated text',
    );
    expect(textModel).not.toBeNull();

    const reverted = await store.revertOverlayEdits(0);
    expect(reverted).toBeGreaterThanOrEqual(1);
  });

  it('supports undo and redo', async () => {
    const store = usePDFStore.getState();
    await store.addPage(0);
    expect(usePDFStore.getState().pageCount).toBe(2);

    await store.undo();
    expect(usePDFStore.getState().pageCount).toBe(1);

    await store.redo();
    expect(usePDFStore.getState().pageCount).toBe(2);
  });
});
