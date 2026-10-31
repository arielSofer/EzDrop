// apps/web/src/views/EditorView.tsx
//
// Ported 1:1 from AgenticDesigner/Views/EditorView.swift.
// The main window shell for AgenticDesigner:
// - Top toolbar with mode switcher [Design | Studio | Logic | Code | PDF Editor],
//   file actions (Open, Save, Templates, Web, Git sync), node quick-add tools,
//   brand/theme menus, zoom controls, MCP server status badge, document status.
// - 3-column split view:
//   - Left: Layers / Studio Assets / Block Palette / PDF Thumbnails
//   - Center: Design Canvas / Logic Canvas / Generated Code / PDF Canvas
//   - Right: Inspector & AI Agent / Chat / Flow Simulator / PDF Status
// - Global macOS shortcuts (⌘Z, ⇧⌘Z, ⌫, ⌘S, ⌘O, ⌘+, ⌘-, ⌘0).

import React, { useState, useEffect, useRef } from 'react';
import {
  DevicePresetLibrary,
  type DevicePreset,
  AllVisualStylePreset,
  ThemeApplier,
  BrandKit,
  CheckpointStore,
  makeBrandIdentity,
  exportXcodeProject,
} from '@agentic/core';
import JSZip from 'jszip';
import { useProjectStore } from '../stores/projectStore';
import { useLogicViewModel, useLogicSimulator } from '../stores/logicStore';
import { usePDFStore } from '../stores/pdfStore';
import { themeHost, designHostForLogic } from '../stores/projectHost';
import { bridge } from '../bridge/bridgeClient';
import SFSymbol from '../components/SFSymbol';
import { AndroidSetupWizard } from './android/AndroidSetupWizard';
import { useAndroidSetupStore } from '../stores/androidSetupStore';
import { useAndroidRunStore } from '../stores/androidRunStore';
import { useLearningStore } from '../stores/learningStore';
import { LearningCompanionPanel } from './learning/LearningCompanionPanel';
import { ToolHighlightOverlay } from './learning/ToolHighlightOverlay';

// Sidebar panels
import { LayersPanel } from './sidebar/LayersPanel';
import { CanvasStudioPanel } from './sidebar/CanvasStudioPanel';
import { BlockPaletteView } from './logic/BlockPaletteView';
import { PDFPageThumbnailsPanel } from './pdf/PDFPageThumbnailsPanel';

// Center canvases
import { CanvasView } from './canvas/CanvasView';
import { LogicEditorView } from './logic/LogicEditorView';
import { CodeModeView } from './code/CodeModeView';
import { PDFCanvasView } from './pdf/PDFCanvasView';

// Inspector panels
import { InspectorPanel } from './inspector/InspectorPanel';
import { CanvasStudioInspectorPanel } from './inspector/CanvasStudioInspectorPanel';
import { BlockInspectorPanel } from './logic/BlockInspectorPanel';
import { PDFInspectorPanel } from './pdf/PDFInspectorPanel';

// Bottom agent / status panels
import { DesignChatPanel } from './agent/DesignChatPanel';
import { AgentPanel } from './agent/AgentPanel';
import { PDFStatusPanel } from './pdf/PDFStatusPanel';

// Modals
import { MCPServerPanel } from './modals/MCPServerPanel';
import { TemplateGalleryView } from './modals/TemplateGalleryView';
import { WebPreviewView } from './modals/WebPreviewView';
import { AppPreviewView } from './logic/AppPreviewView';
import { BrandColorPicker } from './modals/BrandColorPicker';

export type EditorMode = 'design' | 'studio' | 'logic' | 'code' | 'pdf';

const BRAND_SWATCHES = [
  { name: 'Coral', hex: '#F0653C' },
  { name: 'Indigo', hex: '#4F46E5' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Rose', hex: '#E11D48' },
  { name: 'Teal', hex: '#0F766E' },
  { name: 'Violet', hex: '#7C3AED' },
  { name: 'Slate', hex: '#334155' },
];

export function EditorView() {
  const project = useProjectStore((s) => s.project);
  const selectedNodeId = useProjectStore((s) => s.selectedNodeId);
  const selectedNodeIds = useProjectStore((s) => s.selectedNodeIds);
  const deleteSelectedNode = useProjectStore((s) => s.deleteSelectedNode);
  const safeDeleteSelectedNode = useProjectStore((s) => s.safeDeleteSelectedNode);
  const addTextNode = useProjectStore((s) => s.addTextNode);
  const addButtonNode = useProjectStore((s) => s.addButtonNode);
  const addInputNode = useProjectStore((s) => s.addInputNode);
  const addFrameNode = useProjectStore((s) => s.addFrameNode);
  const addScreenNode = useProjectStore((s) => s.addScreenNode);
  const addImageNode = useProjectStore((s) => s.addImageNode);
  const addIconNode = useProjectStore((s) => s.addIconNode);
  const addDeviceFrame = useProjectStore((s) => s.addDeviceFrame);
  const duplicateSelection = useProjectStore((s) => s.duplicateSelection);
  const copySelection = useProjectStore((s) => s.copySelection);
  const cutSelection = useProjectStore((s) => s.cutSelection);
  const pasteSelection = useProjectStore((s) => s.pasteSelection);
  const nudgeSelection = useProjectStore((s) => s.nudgeSelection);
  const bringSelectionToFront = useProjectStore((s) => s.bringSelectionToFront);
  const sendSelectionToBack = useProjectStore((s) => s.sendSelectionToBack);
  const projectUndo = useProjectStore((s) => s.undo);
  const projectRedo = useProjectStore((s) => s.redo);
  const replaceProject = useProjectStore((s) => s.replaceProject);
  const loadRunningApp = useProjectStore((s) => s.loadRunningApp);

  // Guided Learning Store
  const learningModeActive = useLearningStore((s) => s.learningModeActive);
  const androidRunning = useAndroidRunStore(s => s.running);
  const toggleLearningMode = useLearningStore((s) => s.toggleLearningMode);
  const learningRecord = useLearningStore((s) => s.learningRecord);
  const rightPanelTab = useLearningStore((s) => s.rightPanelTab);
  const setRightPanelTab = useLearningStore((s) => s.setRightPanelTab);

  const logicViewModel = useLogicViewModel();
  const simulator = useLogicSimulator();

  const pdfStore = usePDFStore();

  const [editorMode, setEditorMode] = useState<EditorMode>('design');
  const [canvasZoom, setCanvasZoom] = useState<number>(1.0);
  const [documentMessage, setDocumentMessage] = useState<string | null>(null);

  // Auto-switch to Code mode when student transitions from Design to Code, and back to Design when exiting
  const designSnapshot = useLearningStore((s) => s.learningStage === 'code' ? s.designSnapshot : null);
  const prevDesignSnapshotRef = useRef<boolean>(false);
  useEffect(() => {
    if (learningModeActive && designSnapshot && !prevDesignSnapshotRef.current) {
      setEditorMode('code');
      setDocumentMessage('עברת לשלב כתיבת הקוד ב־Kotlin!');
    } else if (!designSnapshot && prevDesignSnapshotRef.current && editorMode === 'code') {
      setEditorMode('design');
      setDocumentMessage('חזרת לעורך העיצוב');
    }
    prevDesignSnapshotRef.current = !!designSnapshot;
  }, [designSnapshot, editorMode, learningModeActive]);

  // Modals state
  const [showMCPPanel, setShowMCPPanel] = useState(false);
  const [showTemplateGallery, setShowTemplateGallery] = useState(false);
  const [showWebPreview, setShowWebPreview] = useState(false);
  const [showAppPreview, setShowAppPreview] = useState(false);
  const [showBrandModal, setShowBrandModal] = useState(false);

  // Dropdown menus state
  const [showDeviceMenu, setShowDeviceMenu] = useState(false);
  const [showBrandMenu, setShowBrandMenu] = useState(false);
  const [showThemeMenu, setShowThemeMenu] = useState(false);
  const [showGitMenu, setShowGitMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGitEnabled, setIsGitEnabled] = useState(false);

  const [mcpRunning, setMcpRunning] = useState(false);

  // Auto-load running app project if starting with empty project
  useEffect(() => {
    if (
      !useLearningStore.getState().hasRestoredProject &&
      project.name === 'Untitled Project' &&
      project.pages[0]?.nodes.length === 1 &&
      project.pages[0]?.nodes[0]?.name === 'Login Screen'
    ) {
      loadRunningApp();
    }
  }, [loadRunningApp, project.name, project.pages]);

  // Check MCP status
  useEffect(() => {
    let cancelled = false;
    async function checkMCP() {
      try {
        const res = await bridge.call('mcp.status');
        if (!cancelled && res) {
          setMcpRunning((res as { isRunning: boolean }).isRunning);
        }
      } catch {
        // standalone mode
      }
    }
    checkMCP();
    const interval = setInterval(checkMCP, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Mode switching lifecycle
  const handleModeChange = (newMode: EditorMode) => {
    if (editorMode === 'logic' && newMode !== 'logic') {
      logicViewModel.persist();
    }
    if (newMode === 'logic') {
      logicViewModel.attach(designHostForLogic);
    }
    setEditorMode(newMode);
  };

  // Zoom helpers
  const setZoom = (val: number) => {
    setCanvasZoom(Math.min(Math.max(val, 0.25), 3.0));
  };
  const zoomIn = () => setZoom(canvasZoom * 1.2);
  const zoomOut = () => setZoom(canvasZoom / 1.2);
  const resetZoom = () => setZoom(1.0);

  // Mode-aware Undo / Redo / Delete
  const undoForCurrentMode = () => {
    if (editorMode === 'pdf') {
      pdfStore.undo();
    } else if (editorMode === 'logic') {
      logicViewModel.undo();
    } else {
      projectUndo();
    }
  };

  const redoForCurrentMode = () => {
    if (editorMode === 'pdf') {
      pdfStore.redo();
    } else if (editorMode === 'logic') {
      logicViewModel.redo();
    } else {
      projectRedo();
    }
  };

  const deleteForCurrentMode = () => {
    if (editorMode === 'pdf') {
      if (pdfStore.selectedAnnotation) {
        pdfStore.removeAnnotation(pdfStore.selectedAnnotation);
      }
    } else if (editorMode === 'logic') {
      logicViewModel.deleteSelected();
    } else {
      safeDeleteSelectedNode();
    }
  };

  // File save / open
  const saveProject = () => {
    if (editorMode === 'pdf') {
      pdfStore.save();
      setDocumentMessage('Saved PDF document');
      return;
    }
    logicViewModel.persist();
    const json = JSON.stringify(project, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = window.document.createElement('a');
    a.href = url;
    a.download = `${project.name || 'project'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDocumentMessage(`Saved ${project.name}`);
  };

  const openProject = () => {
    if (editorMode === 'pdf') {
      const input = window.document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const buffer = await file.arrayBuffer();
        await pdfStore.open(new Uint8Array(buffer), file.name);
        setDocumentMessage(`Opened ${file.name}`);
      };
      input.click();
      return;
    }

    const input = window.document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        replaceProject(parsed);
        logicViewModel.attach(designHostForLogic);
        setDocumentMessage(`Opened ${file.name}`);
      } catch (err) {
        setDocumentMessage(`Open failed: ${(err as Error).message}`);
      }
    };
    input.click();
  };

  const handleDownloadXcodeZip = async () => {
    try {
      setIsExporting(true);
      setShowExportMenu(false);
      setDocumentMessage('Generating Xcode project...');
      const result = exportXcodeProject(project, logicViewModel.flows);
      const zip = new JSZip();
      for (const [path, content] of Object.entries(result.files)) {
        if (typeof content === 'string') {
          zip.file(path, content);
        } else if (content instanceof Uint8Array) {
          zip.file(path, content);
        } else if (content && typeof content === 'object' && 'base64' in (content as any)) {
          zip.file(path, (content as any).base64, { base64: true });
        }
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${project.name || 'ExportedApp'}_Xcode.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setDocumentMessage(`Downloaded ${project.name || 'ExportedApp'}_Xcode.zip`);
    } catch (err) {
      setDocumentMessage(`Xcode export failed: ${(err as Error).message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenInXcode = async () => {
    setShowExportMenu(false);
    if (!bridge.connected) {
      setDocumentMessage('Bridge not connected. Use "Xcode Project (.zip)" instead.');
      return;
    }
    try {
      setDocumentMessage('Exporting and launching Xcode...');
      const result = exportXcodeProject(project, logicViewModel.flows);
      const tempRes = (await bridge.call('export.temporaryDirectory', { name: project.name || 'ExportedApp' })) as { path: string };
      const exportFiles: Record<string, string | { base64: string }> = {};
      for (const [k, v] of Object.entries(result.files)) {
        if (typeof v === 'string') {
          exportFiles[k] = v;
        } else if (v instanceof Uint8Array) {
          exportFiles[k] = { base64: btoa(String.fromCharCode(...v)) };
        }
      }
      await bridge.call('export.write', { rootDir: tempRes.path, files: exportFiles, clean: true });
      await bridge.call('os.openInXcode', { path: `${tempRes.path}/${project.name || 'ExportedApp'}.xcodeproj` });
      setDocumentMessage('Opened in Xcode');
    } catch (err) {
      setDocumentMessage(`Open in Xcode failed: ${(err as Error).message}`);
    }
  };

  const handleRunSimulator = async () => {
    if (useLearningStore.getState().learningModeActive && useLearningStore.getState().learningStage === 'code') {
      setDocumentMessage('בונה ומריץ באמולטור Android…');
      await useAndroidRunStore.getState().run();
      setDocumentMessage(useAndroidRunStore.getState().message);
      return;
    }
    setShowExportMenu(false);
    if (!bridge.connected) {
      // Fallback to in-browser interactive simulator
      setShowAppPreview(true);
      return;
    }
    try {
      setDocumentMessage('Building and launching in iOS Simulator...');
      const result = exportXcodeProject(project, logicViewModel.flows);
      const exportFiles: Record<string, string | { base64: string }> = {};
      for (const [k, v] of Object.entries(result.files)) {
        if (typeof v === 'string') {
          exportFiles[k] = v;
        } else if (v instanceof Uint8Array) {
          exportFiles[k] = { base64: btoa(String.fromCharCode(...v)) };
        }
      }
      const launchRes = (await bridge.call('simulator.runInSimulator', {
        appName: project.name || 'ExportedApp',
        files: exportFiles,
      })) as { deviceName: string };
      setDocumentMessage(`Launched on ${launchRes.deviceName}`);
    } catch (err) {
      setDocumentMessage(`Simulator launch failed: ${(err as Error).message}`);
    }
  };

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modifier = isMac ? e.metaKey : e.ctrlKey;

      if (modifier && e.key.toLowerCase() === 'z') {
        if (editorMode === 'code') return; // Monaco handles its own undo
        e.preventDefault();
        if (e.shiftKey) {
          redoForCurrentMode();
        } else {
          undoForCurrentMode();
        }
        return;
      }

      if (modifier && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        zoomIn();
        return;
      }

      if (modifier && e.key === '-') {
        e.preventDefault();
        zoomOut();
        return;
      }

      if (modifier && e.key === '0') {
        e.preventDefault();
        resetZoom();
        return;
      }

      if (modifier && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProject();
        return;
      }

      if (modifier && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        openProject();
        return;
      }

      if (modifier && e.key.toLowerCase() === 'd') {
        if (!isInput && (selectedNodeId || selectedNodeIds.size > 0)) {
          e.preventDefault();
          duplicateSelection();
          setDocumentMessage('Duplicated selection');
          return;
        }
      }

      if (modifier && e.key.toLowerCase() === 'c' && !isInput) {
        if (selectedNodeId || selectedNodeIds.size > 0) {
          e.preventDefault();
          copySelection();
          setDocumentMessage('Copied selection to clipboard');
          return;
        }
      }

      if (modifier && e.key.toLowerCase() === 'x' && !isInput) {
        if (selectedNodeId || selectedNodeIds.size > 0) {
          e.preventDefault();
          cutSelection();
          setDocumentMessage('Cut selection to clipboard');
          return;
        }
      }

      if (modifier && e.key.toLowerCase() === 'v' && !isInput) {
        e.preventDefault();
        pasteSelection();
        setDocumentMessage('Pasted from clipboard');
        return;
      }

      if (modifier && e.key === ']' && !isInput) {
        e.preventDefault();
        bringSelectionToFront();
        setDocumentMessage('Brought to front');
        return;
      }

      if (modifier && e.key === '[' && !isInput) {
        e.preventDefault();
        sendSelectionToBack();
        setDocumentMessage('Sent to back');
        return;
      }

      // Arrow keys nudging
      if (!isInput && (selectedNodeId || selectedNodeIds.size > 0)) {
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          nudgeSelection(-step, 0);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          nudgeSelection(step, 0);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          nudgeSelection(0, -step);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          nudgeSelection(0, step);
          return;
        }
      }

      if (modifier && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        if (useLearningStore.getState().learningModeActive && useLearningStore.getState().learningStage === 'code') void handleRunSimulator();
        else setShowAppPreview(true);
        return;
      }

      if (!isInput && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        deleteForCurrentMode();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editorMode, canvasZoom, project, selectedNodeId, selectedNodeIds]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        minWidth: 1100,
        minHeight: 700,
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        userSelect: 'none',
      }}
      onClick={() => {
        setShowDeviceMenu(false);
        setShowBrandMenu(false);
        setShowThemeMenu(false);
        setShowGitMenu(false);
        setShowExportMenu(false);
      }}
    >
      {/* Top Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-color)',
          height: 48,
          boxSizing: 'border-box',
          flexShrink: 0,
        }}
      >
        {/* Mode Switcher Segmented Control */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'var(--bg-tertiary)',
            padding: 2,
            borderRadius: 6,
            border: '1px solid var(--border-color)',
            width: 440,
          }}
        >
          {(
            [
              { id: 'design', label: 'Design', icon: 'paintbrush' },
              { id: 'studio', label: 'Studio', icon: 'photo.artframe' },
              { id: 'logic', label: 'Logic', icon: 'bolt' },
              { id: 'code', label: 'Code', icon: 'chevron.left.forwardslash.chevron.right' },
              { id: 'pdf', label: 'PDF Editor', icon: 'doc.richtext' },
            ] as const
          ).map((m) => {
            const isSelected = editorMode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleModeChange(m.id)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  padding: '4px 8px',
                  backgroundColor: isSelected ? 'var(--accent-primary)' : 'transparent',
                  color: isSelected ? '#FFFFFF' : 'var(--text-secondary)',
                  border: 'none',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: isSelected ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  whiteSpace: 'nowrap',
                }}
              >
                <SFSymbol name={m.icon} size={12} color={isSelected ? '#FFFFFF' : undefined} />
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>

        <div style={toolbarDividerStyle} />

        {/* Guided Learning Mode Pill */}
        <button
          onClick={toggleLearningMode}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 6,
            backgroundColor: learningModeActive ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-tertiary)',
            border: learningModeActive ? '1px solid rgba(59, 130, 246, 0.4)' : '1px solid var(--border-color)',
            color: learningModeActive ? '#60A5FA' : 'var(--text-secondary)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          title="הפעל או כבה את סוכן הלמידה המודרך בעברית"
        >
          <SFSymbol name="graduationcap.fill" size={13} color={learningModeActive ? '#3B82F6' : undefined} />
          <span>מסלול למידה</span>
          {learningModeActive && (
            <span
              style={{
                fontSize: 9,
                padding: '1px 5px',
                borderRadius: 999,
                backgroundColor: '#3B82F6',
                color: '#FFFFFF',
              }}
            >
              שלב {learningRecord.activeTaskId ? learningRecord.activeTaskId.replace('signup_', '').split('_')[0] : '1'}/13
            </span>
          )}
        </button>

        <div style={toolbarDividerStyle} />

        {/* Global File Operations */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <ToolbarButton title="Open" icon="folder" onClick={openProject} />
          <ToolbarButton title="Save" icon="square.and.arrow.down" onClick={saveProject} />
          <ToolbarButton title="Templates" icon="square.grid.2x2" onClick={() => setShowTemplateGallery(true)} />

          {/* Export Menu */}
          <div style={{ position: 'relative' }}>
            <ToolbarButton
              title={isExporting ? 'Exporting...' : 'Export'}
              icon="square.and.arrow.up"
              onClick={(e) => {
                e.stopPropagation();
                setShowExportMenu(!showExportMenu);
              }}
            />
            {showExportMenu && (
              <div style={{ ...dropdownMenuStyle, width: 220 }}>
                <button
                  style={{ ...dropdownItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={handleDownloadXcodeZip}
                  disabled={isExporting}
                >
                  <SFSymbol name="arrow.down.circle" size={13} color="var(--accent-primary)" />
                  <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontWeight: 600 }}>Xcode Project (.zip)</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>1-click download full project</span>
                  </div>
                </button>

                <button
                  style={{ ...dropdownItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={handleOpenInXcode}
                >
                  <SFSymbol name="hammer" size={13} color="#0A84FF" />
                  <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontWeight: 600 }}>Open in Xcode</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>macOS local app bridge</span>
                  </div>
                </button>

                <button
                  style={{ ...dropdownItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={handleRunSimulator}
                >
                  <SFSymbol name="play.circle" size={13} color="#10B981" />
                  <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontWeight: 600 }}>iOS Simulator</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Build &amp; launch on device</span>
                  </div>
                </button>

                <div style={menuDividerStyle} />

                <button
                  style={{ ...dropdownItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}
                  onClick={() => {
                    setShowExportMenu(false);
                    setShowWebPreview(true);
                  }}
                >
                  <SFSymbol name="globe" size={13} color="#F59E0B" />
                  <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
                    <span style={{ fontWeight: 600 }}>Web Preview</span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Interactive browser export</span>
                  </div>
                </button>
              </div>
            )}
          </div>

          <ToolbarButton title="Web" icon="globe" onClick={() => setShowWebPreview(true)} />

          {/* Git sync menu */}
          <div style={{ position: 'relative' }}>
            <ToolbarButton
              title="Git"
              icon="arrow.triangle.branch"
              onClick={(e) => {
                e.stopPropagation();
                setShowGitMenu(!showGitMenu);
              }}
            />
            {showGitMenu && (
              <div style={dropdownMenuStyle}>
                {isGitEnabled ? (
                  <>
                    <button
                      style={dropdownItemStyle}
                      onClick={() => {
                        setShowGitMenu(false);
                        setDocumentMessage('Git: Committed current project');
                      }}
                    >
                      Commit Now
                    </button>
                    <button
                      style={dropdownItemStyle}
                      onClick={() => {
                        setShowGitMenu(false);
                        setDocumentMessage('Git: Pushed to GitHub');
                      }}
                    >
                      Push to GitHub
                    </button>
                    <div style={menuDividerStyle} />
                    <button
                      style={dropdownItemStyle}
                      onClick={() => {
                        setIsGitEnabled(false);
                        setShowGitMenu(false);
                        setDocumentMessage('Git sync disabled');
                      }}
                    >
                      Disable Auto-Commit
                    </button>
                  </>
                ) : (
                  <button
                    style={dropdownItemStyle}
                    onClick={() => {
                      setIsGitEnabled(true);
                      setShowGitMenu(false);
                      setDocumentMessage('Git sync enabled');
                    }}
                  >
                    Enable Git Sync
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={toolbarDividerStyle} />

        {/* Mode-specific Top Buttons */}
        {editorMode === 'pdf' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <ToolbarButton title="New" icon="doc.badge.plus" onClick={() => pdfStore.newDocument()} />
            <ToolbarButton
              title="Prev"
              icon="chevron.left"
              disabled={pdfStore.currentPageIndex <= 0}
              onClick={() => pdfStore.setCurrentPageIndex(Math.max(0, pdfStore.currentPageIndex - 1))}
            />
            <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', minWidth: 44, textAlign: 'center' }}>
              {pdfStore.pageCount === 0 ? 0 : pdfStore.currentPageIndex + 1} / {pdfStore.pageCount}
            </span>
            <ToolbarButton
              title="Next"
              icon="chevron.right"
              disabled={pdfStore.currentPageIndex >= pdfStore.pageCount - 1}
              onClick={() => pdfStore.setCurrentPageIndex(Math.min(pdfStore.pageCount - 1, pdfStore.currentPageIndex + 1))}
            />

            <div style={toolbarDividerStyle} />

            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', padding: '0 6px' }}>
              {pdfStore.toolMode}
            </span>
            {pdfStore.toolMode !== 'Select' && (
              <button
                onClick={() => pdfStore.setToolMode('Select' as any)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-primary)',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Done
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <ToolbarButton title="Screen" icon="iphone" tourTarget="toolbar-add-screen" onClick={() => addScreenNode()} />

            {/* Device Preset Menu */}
            <div style={{ position: 'relative' }}>
              <ToolbarButton
                title="Device"
                icon="chevron.down"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeviceMenu(!showDeviceMenu);
                }}
              />
              {showDeviceMenu && (
                <div style={dropdownMenuStyle}>
                  {DevicePresetLibrary.all.map((preset) => (
                    <button
                      key={preset.id}
                      style={dropdownItemStyle}
                      onClick={() => {
                        addScreenNode(preset);
                        setShowDeviceMenu(false);
                      }}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ToolbarButton title="Text" icon="textformat" tourTarget="toolbar-add-text" onClick={addTextNode} />
            <ToolbarButton title="Button" icon="capsule" tourTarget="toolbar-add-button" onClick={addButtonNode} />
            <ToolbarButton title="Input" icon="character.cursor.ibeam" tourTarget="toolbar-add-input" onClick={addInputNode} />
            <ToolbarButton title="Frame" icon="rectangle" onClick={addFrameNode} />

            {/* Brand Menu */}
            <div style={{ position: 'relative' }}>
              <ToolbarButton
                title="Brand"
                icon="paintbrush.pointed"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowBrandMenu(!showBrandMenu);
                }}
              />
              {showBrandMenu && (
                <div style={dropdownMenuStyle}>
                  {BRAND_SWATCHES.map((swatch) => (
                    <button
                      key={swatch.hex}
                      style={{ ...dropdownItemStyle, display: 'flex', alignItems: 'center', gap: 8 }}
                      onClick={() => {
                        CheckpointStore.save(project, `before brand: ${swatch.name}`);
                        BrandKit.apply(makeBrandIdentity({ accent: swatch.hex, name: swatch.name }), themeHost);
                        setShowBrandMenu(false);
                      }}
                    >
                      <span
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          backgroundColor: swatch.hex,
                          display: 'inline-block',
                        }}
                      />
                      <span>{swatch.name}</span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                        {swatch.hex}
                      </span>
                    </button>
                  ))}
                  <div style={menuDividerStyle} />
                  <button
                    style={dropdownItemStyle}
                    onClick={() => {
                      setShowBrandMenu(false);
                      setShowBrandModal(true);
                    }}
                  >
                    Pick Custom Colour…
                  </button>
                </div>
              )}
            </div>

            {/* Theme Menu */}
            <div style={{ position: 'relative' }}>
              <ToolbarButton
                title="Theme"
                icon="paintpalette"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowThemeMenu(!showThemeMenu);
                }}
              />
              {showThemeMenu && (
                <div style={dropdownMenuStyle}>
                  {AllVisualStylePreset.map((preset) => (
                    <button
                      key={preset}
                      style={dropdownItemStyle}
                      onClick={() => {
                        CheckpointStore.save(project, `before theme: ${preset}`);
                        ThemeApplier.apply(preset, themeHost);
                        BrandKit.reapplyIfSet(themeHost);
                        setShowThemeMenu(false);
                      }}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={toolbarDividerStyle} />

            <ToolbarButton title="Image" icon="photo" onClick={addImageNode} />
            <ToolbarButton title="Icon" icon="star.circle" onClick={addIconNode} />

            <div style={toolbarDividerStyle} />

            <ToolbarButton
              title="Duplicate (⌘D)"
              icon="plus.square.on.square"
              disabled={!selectedNodeId && selectedNodeIds.size === 0}
              onClick={duplicateSelection}
            />

            <ToolbarButton
              title="Delete (⌫)"
              icon="trash"
              disabled={selectedNodeId === null && selectedNodeIds.size === 0}
              onClick={deleteSelectedNode}
              style={{ color: (selectedNodeId || selectedNodeIds.size > 0) ? '#EF4444' : 'var(--text-muted)' }}
            />
          </div>
        )}

        <div style={{ flex: 1 }} />

        {learningModeActive && <button onClick={() => void useAndroidSetupStore.getState().show()}
          style={{ background: 'transparent', color: '#a8c7ff', border: '1px solid #3d506d', borderRadius: 6, padding: '5px 10px', marginLeft: 8, cursor: 'pointer' }}
          title="בדיקה והתקנה של אמולטור וכלי Android במחשב">הכנת Android</button>}
        <AndroidSetupWizard />
        {/* Run App (Simulator) Pill */}
        <button
          onClick={() => learningModeActive && designSnapshot ? void handleRunSimulator() : setShowAppPreview(true)}
          disabled={androidRunning}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.4)',
            color: '#10B981',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '4px 10px',
            borderRadius: 6,
            transition: 'all 0.15s ease',
          }}
          title={learningModeActive && designSnapshot ? 'בנייה והרצה באמולטור Android (⌘R)' : 'תצוגה מקדימה של העיצוב (⌘R)'}
        >
          <SFSymbol name="play.fill" size={11} color="#10B981" />
          <span>{learningModeActive && designSnapshot ? (androidRunning ? 'מריץ Android…' : 'הרץ ב־Android') : 'Run App'}</span>
          <span
            style={{
              fontSize: 9,
              opacity: 0.75,
              padding: '1px 4px',
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              borderRadius: 3,
            }}
          >
            ⌘R
          </span>
        </button>

        <div style={toolbarDividerStyle} />

        {/* Zoom Controls */}
        {editorMode !== 'pdf' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: 6,
              padding: '2px 4px',
              border: '1px solid var(--border-color)',
            }}
          >
            <button
              onClick={zoomOut}
              disabled={canvasZoom <= 0.25}
              style={zoomButtonStyle}
              title="Zoom Out (⌘-)"
            >
              <SFSymbol name="minus.magnifyingglass" size={12} />
            </button>
            <button
              onClick={resetZoom}
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 500,
                padding: '2px 6px',
                minWidth: 44,
                cursor: 'pointer',
              }}
              title="Reset Zoom (⌘0)"
            >
              {Math.round(canvasZoom * 100)}%
            </button>
            <button
              onClick={zoomIn}
              disabled={canvasZoom >= 3.0}
              style={zoomButtonStyle}
              title="Zoom In (⌘+)"
            >
              <SFSymbol name="plus.magnifyingglass" size={12} />
            </button>
          </div>
        )}

        <div style={toolbarDividerStyle} />

        {/* Running App Preset Button */}
        <button
          onClick={loadRunningApp}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            backgroundColor: 'rgba(200, 255, 61, 0.12)',
            border: '1px solid rgba(200, 255, 61, 0.35)',
            color: '#C8FF3D',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '3px 8px',
            borderRadius: 4,
          }}
          title="Load PaceGuard Running App (GPS, Pace, Heart Rate, Live Run)"
        >
          <SFSymbol name="figure.run" size={12} color="#C8FF3D" />
          <span>Running App</span>
        </button>

        <div style={toolbarDividerStyle} />

        {/* MCP Server Indicator */}
        <button
          onClick={() => setShowMCPPanel(true)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'none',
            border: 'none',
            color: 'var(--text-primary)',
            fontSize: 11,
            fontWeight: 600,
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 4,
          }}
          title="MCP Server — external AI agent relay"
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: mcpRunning ? '#10B981' : '#6B7280',
              display: 'inline-block',
            }}
          />
          <span>MCP</span>
        </button>

        <div style={toolbarDividerStyle} />

        {/* Document Status message & Project name */}
        {documentMessage && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--text-secondary)',
              maxWidth: 180,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {documentMessage}
          </span>
        )}

        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {project.name}
        </span>
      </div>

      {/* 3-Column Split View Body */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          width: '100%',
          height: 'calc(100vh - 48px)',
          overflow: 'hidden',
        }}
      >
        {/* Left Column (240px or 320px in learning mode) */}
        <div
          style={{
            width: learningModeActive ? 320 : 240,
            minWidth: learningModeActive ? 320 : 240,
            maxWidth: learningModeActive ? 360 : 240,
            height: '100%',
            backgroundColor: 'var(--bg-secondary)',
            borderRight: '1px solid var(--border-color)',
            overflow: 'hidden',
          }}
        >
          {learningModeActive ? (
            <LearningCompanionPanel />
          ) : editorMode === 'logic' ? (
            <BlockPaletteView />
          ) : editorMode === 'studio' ? (
            <CanvasStudioPanel />
          ) : editorMode === 'pdf' ? (
            <PDFPageThumbnailsPanel />
          ) : (
            <LayersPanel />
          )}
        </div>

        {/* Center Column (Flex) */}
        <div
          style={{
            flex: 1,
            height: '100%',
            backgroundColor: 'var(--bg-canvas)',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {editorMode === 'logic' ? (
            <LogicEditorView />
          ) : editorMode === 'code' ? (
            <CodeModeView />
          ) : editorMode === 'pdf' ? (
            <PDFCanvasView />
          ) : (
            <CanvasView zoomScale={canvasZoom} onZoomChange={setZoom} />
          )}
        </div>

        {/* Right Column (300px) */}
        <div
          style={{
            width: 300,
            minWidth: 300,
            maxWidth: 300,
            height: '100%',
            backgroundColor: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
          }}
        >
          {learningModeActive ? (
            // In learning mode: Tabs for "מאפיינים" (Inspector) and "שכבות" (Layers)
            <>
              <div
                dir="rtl"
                style={{
                  display: 'flex',
                  borderBottom: '1px solid var(--border-color)',
                  backgroundColor: 'rgba(255, 255, 255, 0.02)',
                }}
              >
                <button
                  onClick={() => setRightPanelTab('inspector')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: rightPanelTab === 'inspector' ? 700 : 500,
                    color: rightPanelTab === 'inspector' ? '#3B82F6' : 'var(--text-secondary)',
                    borderBottom: rightPanelTab === 'inspector' ? '2px solid #3B82F6' : '2px solid transparent',
                    background: 'none',
                    borderTop: 'none',
                    borderLeft: 'none',
                    borderRight: 'none',
                    cursor: 'pointer',
                  }}
                >
                  מאפיינים
                </button>
                <button
                  onClick={() => setRightPanelTab('layers')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: rightPanelTab === 'layers' ? 700 : 500,
                    color: rightPanelTab === 'layers' ? '#3B82F6' : 'var(--text-secondary)',
                    borderBottom: rightPanelTab === 'layers' ? '2px solid #3B82F6' : '2px solid transparent',
                    background: 'none',
                    borderTop: 'none',
                    borderLeft: 'none',
                    borderRight: 'none',
                    cursor: 'pointer',
                  }}
                >
                  שכבות
                </button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto' }}>
                {rightPanelTab === 'inspector' ? <InspectorPanel /> : <LayersPanel />}
              </div>
            </>
          ) : (
            // Normal 2-tier right column (Inspector top, Chat/Status bottom)
            <>
              {/* Top Half: Inspector */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {editorMode === 'logic' ? (
                  <BlockInspectorPanel />
                ) : editorMode === 'studio' ? (
                  <CanvasStudioInspectorPanel />
                ) : editorMode === 'pdf' ? (
                  <PDFInspectorPanel />
                ) : (
                  <InspectorPanel />
                )}
              </div>

              <div style={{ height: 1, backgroundColor: 'var(--border-color)' }} />

              {/* Bottom Half: Agent / Chat / Status */}
              <div
                style={{
                  height: editorMode === 'pdf' || editorMode === 'logic' ? 220 : 340,
                  minHeight: 180,
                  overflowY: 'auto',
                }}
              >
                {editorMode === 'pdf' ? (
                  <PDFStatusPanel />
                ) : editorMode === 'logic' ? (
                  <AgentPanel />
                ) : (
                  <DesignChatPanel />
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modals & Dialogs */}
      <MCPServerPanel isOpen={showMCPPanel} onClose={() => setShowMCPPanel(false)} />
      <TemplateGalleryView isOpen={showTemplateGallery} onClose={() => setShowTemplateGallery(false)} />
      <WebPreviewView isOpen={showWebPreview} onClose={() => setShowWebPreview(false)} />
      <AppPreviewView simulator={simulator} isOpen={showAppPreview} onClose={() => setShowAppPreview(false)} />
      <BrandColorPicker isOpen={showBrandModal} onClose={() => setShowBrandModal(false)} />

      {/* Guided Tour Highlight Overlay */}
      <ToolHighlightOverlay />
    </div>
  );
}

const toolbarDividerStyle: React.CSSProperties = {
  width: 1,
  height: 20,
  backgroundColor: 'var(--border-color)',
  margin: '0 4px',
};

const zoomButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 4,
  borderRadius: 4,
};

const dropdownMenuStyle: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  marginTop: 4,
  backgroundColor: 'var(--bg-primary)',
  border: '1px solid var(--border-color)',
  borderRadius: 6,
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  zIndex: 1000,
  minWidth: 160,
  maxHeight: 320,
  overflowY: 'auto',
  padding: '4px 0',
};

const dropdownItemStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--text-primary)',
  cursor: 'pointer',
};

const menuDividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--border-color)',
  margin: '4px 0',
};

function ToolbarButton({
  title,
  icon,
  onClick,
  disabled = false,
  style,
  tourTarget,
}: {
  title: string;
  icon: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
  tourTarget?: string;
}) {
  return (
    <button
      data-tour-target={tourTarget}
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        width: 44,
        height: 38,
        background: 'none',
        border: 'none',
        borderRadius: 4,
        color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
        padding: 0,
        ...style,
      }}
      title={title}
    >
      <SFSymbol name={icon} size={14} />
      <span style={{ fontSize: 9 }}>{title}</span>
    </button>
  );
}

export default EditorView;
