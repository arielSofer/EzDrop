// apps/web/src/views/code/CodeModeView.tsx
//
// Ported 1:1 from AgenticDesigner/Views/CodeModeView.swift.
// Code Mode — the anti-black-box panel. Shows the exact Swift the exporter
// will produce for the current design + logic, live — and lets you EDIT it:
// an edited file is stored as a source override (project.sourceOverrides),
// wins over generation in every export path, and Recompile runs the real
// iOS-simulator swiftc over the whole generated tree to prove it still builds.

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  GeneratedSourcePreview,
  generatedSourceFileDirectory,
  generatedSourceFileId,
  generatedSourceFileLineCount,
  generatedSourceFileName,
  type CodeDiagnostic,
  type GeneratedSourceFile,
  CodeTheme,
  CheckpointStore,
} from '@agentic/core';
import { useProjectStore } from '../../stores/projectStore';
import { useLogicViewModel } from '../../stores/logicStore';
import SFSymbol from '../../components/SFSymbol';
import CodeTextView from './CodeTextView';
import { bridge } from '../../bridge/bridgeClient';
import { useAndroidRunStore } from '../../stores/androidRunStore';
import { useLearningStore } from '../../stores/learningStore';
import { LearningDesignPreviewPanel } from '../learning/LearningDesignPreviewPanel';

export function CodeModeView() {
  const project = useProjectStore((s) => s.project);
  const androidRun = useAndroidRunStore();
  const learningTargetFile = useLearningStore(s => s.learningStage === 'code' ? s.kotlinTasks.find(task => task.id === s.activeKotlinTaskId)?.targetFile : undefined);
  useEffect(() => {
    if (!androidRun.message) return;
    setBuildStatus(androidRun.message);
    setBuildSucceeded(androidRun.result?.success === true);
    setDiagnostics((androidRun.result?.diagnostics ?? []).map((d, index) => ({ ...d, id: `android-${index}`, severity: d.severity === 'warning' ? 'warning' as const : 'error' as const })));
  }, [androidRun.message, androidRun.result]);
  const currentPageIndex = useProjectStore((s) => s.currentPageIndex);
  const mutateProject = useProjectStore((s) => s.mutateProject);

  const logicViewModel = useLogicViewModel();
  const flows = logicViewModel.flows;

  const [files, setFiles] = useState<GeneratedSourceFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const lastSelectedFileIdRef = useRef<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [lastGenerated, setLastGenerated] = useState<Date | null>(null);

  // Editing state
  const [dirtyText, setDirtyText] = useState<string | null>(null);
  const [resetToken, setResetToken] = useState<string>(() => crypto.randomUUID());

  // Recompile state
  const [diagnostics, setDiagnostics] = useState<CodeDiagnostic[]>([]);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);
  const [buildSucceeded, setBuildSucceeded] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [jumpToken, setJumpToken] = useState<string | undefined>(undefined);
  const [jumpLine, setJumpLine] = useState<number>(0);

  const selectedFile = useMemo(() => {
    return files.find((f) => generatedSourceFileId(f) === selectedFileId) || (selectedFileId === learningTargetFile ? undefined : files[0]);
  }, [files, selectedFileId, learningTargetFile]);

  useEffect(() => {
    if (learningTargetFile) {
      if (dirtyText !== null) applyCurrentEdit();
      setSelectedFileId(learningTargetFile);
      setDirtyText(null);
      setResetToken(crypto.randomUUID());
    }
  }, [learningTargetFile]);

  // Grouped files by directory
  const groupedFiles = useMemo(() => {
    const map = new Map<string, GeneratedSourceFile[]>();
    for (const f of files) {
      const dir = generatedSourceFileDirectory(f);
      if (!map.has(dir)) map.set(dir, []);
      map.get(dir)!.push(f);
    }
    const dirs = Array.from(map.keys()).sort((a, b) => {
      const aSwift = map.get(a)!.some((f) => f.relativePath.endsWith('.swift'));
      const bSwift = map.get(b)!.some((f) => f.relativePath.endsWith('.swift'));
      if (aSwift !== bSwift) return aSwift ? -1 : 1;
      return a.localeCompare(b);
    });
    return dirs.map((dir) => ({
      directory: dir,
      files: map.get(dir)!,
    }));
  }, [files]);

  // Regeneration logic
  const regenerate = useCallback(() => {
    setIsGenerating(true);
    try {
      const combinedFlows = [...flows, ...(project.pages || []).flatMap((p) => p.logicFlows || [])];
      const seen = new Set<string>();
      const dedupedFlows = combinedFlows.filter((f) => {
        if (seen.has(f.id)) return false;
        seen.add(f.id);
        return true;
      });

      const currentPage = project.pages?.[currentPageIndex];
      const pageId = currentPage?.id;
      const pageName = currentPage?.name || '';

      const generated = GeneratedSourcePreview.generate(project, dedupedFlows, pageId);

      // Include Kotlin student files from sourceOverrides
      if (project.sourceOverrides) {
        for (const [filename, content] of Object.entries(project.sourceOverrides)) {
          if (filename.endsWith('.kt') || filename.endsWith('.kts')) {
            const alreadyExists = generated.some((f) => f.relativePath.endsWith(filename));
            if (!alreadyExists) {
              generated.unshift({
                relativePath: filename.includes('/') ? filename : `android/ui/${filename}`,
                content,
                isOverridden: true,
              });
            }
          }
        }
      }

      setFiles(generated);
      setErrorMessage(null);
      setLastGenerated(new Date());
      setIsGenerating(false);

      setSelectedFileId((prev) => {
        if (prev && generated.some((f) => generatedSourceFileId(f) === prev)) {
          return prev;
        }
        // Prefer Kotlin file if student is in learning code mode
        const ktFile = generated.find((f) => f.relativePath.endsWith('.kt'));
        if (ktFile) return generatedSourceFileId(ktFile);

        const def = GeneratedSourcePreview.defaultSelection(generated, pageName);
        return def ? generatedSourceFileId(def) : generated[0] ? generatedSourceFileId(generated[0]) : null;
      });
    } catch (err) {
      setErrorMessage(`Generation failed: ${(err as Error).message}`);
      setIsGenerating(false);
    }
  }, [flows, project, currentPageIndex]);

  // Initial generate and debounced refresh on project/flows change
  useEffect(() => {
    const timer = setTimeout(() => {
      regenerate();
    }, 400);
    return () => clearTimeout(timer);
  }, [project, flows, regenerate]);

  // Auto-apply edit when switching files
  const handleSelectFile = (newId: string) => {
    if (dirtyText !== null && lastSelectedFileIdRef.current) {
      const prevFile = files.find((f) => generatedSourceFileId(f) === lastSelectedFileIdRef.current);
      if (prevFile && generatedSourceFileId(prevFile) !== newId) {
        saveOverride(generatedSourceFileName(prevFile), dirtyText);
      }
    }
    setDirtyText(null);
    const learning = useLearningStore.getState();
    const screen = learning.designSnapshot?.screens.find(screen => newId.endsWith(`_${screen.id.replace(/[^a-zA-Z0-9]/g, '')}.kt`));
    if (screen) learning.selectKotlinScreen(screen.id);
    setSelectedFileId(newId);
    lastSelectedFileIdRef.current = newId;
  };

  const saveOverride = (fileName: string, content: string) => {
    CheckpointStore.save(project, `before code edit: ${fileName}`);
    const overrides = { ...(project.sourceOverrides || {}), [fileName]: content };
    mutateProject((p) => {
      p.sourceOverrides = overrides;
    });
  };

  const applyCurrentEdit = () => {
    if (!selectedFile || dirtyText === null) return;
    saveOverride(generatedSourceFileName(selectedFile), dirtyText);
    setDirtyText(null);
  };

  const revertCurrentOverride = () => {
    if (!selectedFile) return;
    const fileName = generatedSourceFileName(selectedFile);
    CheckpointStore.save(project, `before code revert: ${fileName}`);
    const overrides = { ...(project.sourceOverrides || {}) };
    delete overrides[fileName];
    mutateProject((p) => {
      p.sourceOverrides = Object.keys(overrides).length > 0 ? overrides : undefined;
    });
    setDirtyText(null);
    setResetToken(crypto.randomUUID());
  };

  // Recompile
  const recompile = async () => {
    if (isCompiling) return;
    if (selectedFile?.relativePath.endsWith('.kt') || selectedFile?.relativePath.endsWith('.kts')) {
      await useAndroidRunStore.getState().run(selectedFile.relativePath);
      return;
    }
    applyCurrentEdit();
    setIsCompiling(true);
    setBuildStatus(null);
    setDiagnostics([]);

    const combinedFlows = [...flows, ...(project.pages || []).flatMap((p) => p.logicFlows || [])];
    const seen = new Set<string>();
    const dedupedFlows = combinedFlows.filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
    const pageId = project.pages?.[currentPageIndex]?.id;

    try {
      // Try running via bridge if server is connected
      const res = await bridge.call('typecheck.run', {
        files: Object.fromEntries(files.filter(f => !/\.kts?$/.test(f.relativePath)).map(f => [f.relativePath,
          selectedFile && f.relativePath === selectedFile.relativePath && dirtyText !== null ? dirtyText : f.content])),
      });

      if (res) {
        const typed = res as { success: boolean; diagnostics: CodeDiagnostic[]; checkedFileCount: number };
        setBuildSucceeded(typed.success);
        setDiagnostics(typed.diagnostics || []);
        const errors = (typed.diagnostics || []).filter((d) => d.severity === 'error').length;
        const warnings = (typed.diagnostics || []).filter((d) => d.severity === 'warning').length;
        setBuildStatus(
          typed.success
            ? `Build OK — ${typed.checkedFileCount} files typechecked${warnings > 0 ? `, ${warnings} warning(s)` : ''}`
            : `${errors} error(s), ${warnings} warning(s)`,
        );
      } else {
        setBuildSucceeded(false);
        setBuildStatus('לא הורץ: לא התקבלה תוצאת בדיקה מהשרת.');
      }
    } catch (err) {
      setBuildStatus(`Compile failed: ${(err as Error).message}`);
      setBuildSucceeded(false);
    } finally {
      setIsCompiling(false);
    }
  };

  const jumpToDiagnostic = (diag: CodeDiagnostic) => {
    const target = files.find((f) => (f.relativePath === diag.fileName || generatedSourceFileName(f) === diag.fileName));
    if (target) {
      setSelectedFileId(generatedSourceFileId(target));
    }
    setJumpLine(diag.line);
    setJumpToken(crypto.randomUUID());
  };

  const handleCopy = () => {
    const textToCopy = dirtyText ?? selectedFile?.content;
    if (textToCopy) {
      navigator.clipboard.writeText(textToCopy);
    }
  };

  const fileIcon = (f: GeneratedSourceFile) => {
    const ext = f.relativePath.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'swift':
        return { name: 'swift', color: '#FC5FA3' };
      case 'plist':
      case 'entitlements':
      case 'xcprivacy':
        return { name: 'gearshape', color: 'var(--text-muted)' };
      case 'storekit':
      case 'json':
        return { name: 'curlybraces', color: 'var(--text-muted)' };
      case 'rules':
        return { name: 'lock.shield', color: 'var(--text-muted)' };
      default:
        return { name: 'doc.text', color: 'var(--text-muted)' };
    }
  };

  const totalLines = files.reduce((sum, f) => sum + generatedSourceFileLineCount(f), 0);
  const editedCount = files.filter((f) => f.isOverridden).length;

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        backgroundColor: CodeTheme.background,
        color: CodeTheme.plainText,
        overflow: 'hidden',
      }}
    >
      {/* File list sidebar */}
      <div
        style={{
          width: 260,
          minWidth: 220,
          maxWidth: 340,
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: CodeTheme.gutterBackground,
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600 }}>Generated Source</span>
          <button
            onClick={regenerate}
            disabled={isGenerating}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Regenerate from current design"
          >
            <span
              style={{
                display: 'inline-flex',
                animation: isGenerating ? 'spin 1s linear infinite' : 'none',
              }}
            >
              <SFSymbol name="arrow.clockwise" size={12} />
            </span>
          </button>
        </div>

        {/* Tree / Sections */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {groupedFiles.map((group) => (
            <div key={group.directory} style={{ marginBottom: 8 }}>
              <div
                style={{
                  padding: '4px 12px',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                {group.directory}
              </div>
              {group.files.map((file) => {
                const id = generatedSourceFileId(file);
                const isSelected = id === (selectedFile ? generatedSourceFileId(selectedFile) : selectedFileId);
                const icon = fileIcon(file);
                const lineCount = generatedSourceFileLineCount(file);

                return (
                  <div
                    key={id}
                    onClick={() => handleSelectFile(id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 12px',
                      cursor: 'pointer',
                      fontSize: 12,
                      backgroundColor: isSelected ? 'var(--accent-primary)' : 'transparent',
                      color: isSelected ? '#FFFFFF' : CodeTheme.plainText,
                      borderRadius: 4,
                      margin: '1px 6px',
                    }}
                  >
                    <SFSymbol name={icon.name} size={11} color={isSelected ? '#FFFFFF' : icon.color} />
                    <span
                      style={{
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {generatedSourceFileName(file)}
                    </span>
                    {file.isOverridden && (
                      <span
                        title="Hand-edited — overrides generation"
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          backgroundColor: '#F59E0B',
                          display: 'inline-block',
                        }}
                      />
                    )}
                    <span
                      style={{
                        fontSize: 10,
                        color: isSelected ? 'rgba(255, 255, 255, 0.7)' : 'var(--text-muted)',
                      }}
                    >
                      {lineCount}
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '6px 10px',
            borderTop: '1px solid var(--border-color)',
            fontSize: 10,
            color: 'var(--text-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {errorMessage ? (
            <span style={{ color: '#EF4444' }}>{errorMessage}</span>
          ) : (
            <span>
              {files.length} files · {totalLines} lines
              {editedCount > 0 ? ` · ${editedCount} edited` : ''}
              {lastGenerated ? ` · ${lastGenerated.toLocaleTimeString()}` : ''}
            </span>
          )}
        </div>
      </div>

      {/* Code Editor Pane */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          overflow: 'hidden',
        }}
      >
        {/* Editor header toolbar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 12px',
            backgroundColor: CodeTheme.gutterBackground,
            borderBottom: '1px solid var(--border-color)',
          }}
        >
          <span
            style={{
              fontFamily: 'SF Mono, Menlo, monospace',
              fontSize: 11,
              color: 'var(--text-secondary)',
              maxWidth: 300,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedFile?.relativePath || 'No file selected'}
          </span>

          {selectedFile?.isOverridden && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 'bold',
                color: '#F59E0B',
                border: '1px solid #F59E0B',
                borderRadius: 999,
                padding: '2px 6px',
                textTransform: 'uppercase',
              }}
            >
              Edited
            </span>
          )}

          <div style={{ flex: 1 }} />

          {dirtyText !== null ? (
            <>
              <button
                onClick={applyCurrentEdit}
                style={{
                  backgroundColor: 'var(--accent-primary)',
                  color: '#FFFFFF',
                  border: 'none',
                  borderRadius: 4,
                  padding: '4px 10px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
                title="Save this edit as a source override (⌘↩)"
              >
                Apply Edit
              </button>
              <button
                onClick={() => {
                  setDirtyText(null);
                  setResetToken(crypto.randomUUID());
                }}
                style={{
                  backgroundColor: 'transparent',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                Discard
              </button>
            </>
          ) : selectedFile?.isOverridden && !/\.kts?$/.test(selectedFile.relativePath) ? (
            <button
              onClick={revertCurrentOverride}
              style={{
                backgroundColor: 'transparent',
                color: '#EF4444',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: 11,
                cursor: 'pointer',
              }}
              title="Delete the hand-edit and revert to generated source"
            >
              Revert to Generated
            </button>
          ) : null}

          {/* Recompile Button */}
          <button
            onClick={recompile}
            disabled={isCompiling || androidRun.running}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 11,
              color: CodeTheme.plainText,
              cursor: isCompiling ? 'default' : 'pointer',
            }}
            title={selectedFile && /\.kts?$/.test(selectedFile.relativePath) ? 'בנייה והרצה באמולטור Android מקומי' : 'Typecheck Swift source with iOS swiftc'}
          >
            <span
              style={{
                display: 'inline-flex',
                animation: isCompiling ? 'spin 1s linear infinite' : 'none',
              }}
            >
              <SFSymbol name="hammer" size={11} />
            </span>
            <span>{isCompiling ? 'Compiling…' : selectedFile && /\.kts?$/.test(selectedFile.relativePath) ? androidRun.running ? 'מריץ Android…' : 'הרץ ב־Android' : 'Recompile Swift'}</span>
          </button>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            disabled={!selectedFile}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              backgroundColor: 'transparent',
              border: '1px solid var(--border-color)',
              borderRadius: 4,
              padding: '4px 8px',
              fontSize: 11,
              color: CodeTheme.plainText,
              cursor: 'pointer',
            }}
            title="Copy file contents"
          >
            <SFSymbol name="doc.on.doc" size={11} />
            <span>Copy</span>
          </button>
        </div>

        {/* Diagnostics strip */}
        {(diagnostics.length > 0 || buildStatus) && (
          <div
            style={{
              backgroundColor: CodeTheme.gutterBackground,
              borderBottom: '1px solid var(--border-color)',
              padding: '6px 12px',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 4,
              }}
            >
              {buildStatus && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <SFSymbol
                    name={buildSucceeded ? 'checkmark.circle.fill' : 'xmark.octagon.fill'}
                    size={12}
                    color={buildSucceeded ? '#10B981' : '#EF4444'}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: buildSucceeded ? '#10B981' : '#EF4444',
                    }}
                  >
                    {buildStatus}
                  </span>
                </div>
              )}
              <button
                onClick={() => {
                  setDiagnostics([]);
                  setBuildStatus(null);
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                <SFSymbol name="xmark" size={9} />
              </button>
            </div>

            {androidRun.result && !androidRun.result.success && androidRun.result.output && (
              <details style={{ padding: 8 }}><summary>פלט בניית Android</summary><pre dir="ltr" style={{ whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto', fontSize: 11 }}>{androidRun.result.output}</pre></details>
            )}
            {diagnostics.map((d) => (
              <div
                key={d.id}
                onClick={() => jumpToDiagnostic(d)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '2px 4px',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                <SFSymbol
                  name={d.severity === 'error' ? 'xmark.octagon.fill' : 'exclamationmark.triangle.fill'}
                  size={10}
                  color={d.severity === 'error' ? '#EF4444' : '#F59E0B'}
                />
                <span style={{ fontFamily: 'SF Mono, Menlo, monospace', opacity: 0.9 }}>
                  {d.fileName}:{d.line}
                </span>
                <span
                  style={{
                    opacity: 0.7,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {d.message}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Editor or empty state with Side-by-Side Learning Design Preview */}
        <div style={{ flex: 1, display: 'flex', height: '100%', overflow: 'hidden' }}>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {selectedFile ? (
              <CodeTextView
                fileId={generatedSourceFileId(selectedFile)}
                text={dirtyText ?? selectedFile.content}
                isEditable={
                  selectedFile.relativePath.endsWith('.swift') ||
                  selectedFile.relativePath.endsWith('.kt') ||
                  selectedFile.relativePath.endsWith('.kts')
                }
                resetToken={resetToken}
                jumpToken={jumpToken}
                jumpLine={jumpLine}
                onTextChange={(newText) => {
                  if (/\.kts?$/.test(selectedFile.relativePath)) {
                    const key = selectedFile.relativePath.startsWith('android/ui/') ? generatedSourceFileName(selectedFile) : selectedFile.relativePath;
                    useLearningStore.getState().saveKotlinDraft(key, newText);
                    setFiles(current => current.map(f => f.relativePath === selectedFile.relativePath ? { ...f, content: newText } : f));
                    setDirtyText(null);
                  } else {
                    setDirtyText(newText === selectedFile.content ? null : newText);
                  }
                }}
              />
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  color: 'var(--text-muted)',
                  gap: 12,
                }}
              >
                <SFSymbol name="doc.text" size={32} />
                <span>Generating source from current design…</span>
              </div>
            )}
          </div>

          {/* Target Design Preview Panel (Side-by-side) */}
          <LearningDesignPreviewPanel />
        </div>
      </div>
    </div>
  );
}

export default CodeModeView;
