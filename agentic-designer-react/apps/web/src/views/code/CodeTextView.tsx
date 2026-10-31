// apps/web/src/views/code/CodeTextView.tsx
//
// Ported 1:1 from AgenticDesigner/Views/CodeTextView.swift.
// Code viewer and editor for Code Mode. Uses Monaco Editor with Xcode/Dark theme,
// monospaced font, line numbers ruler, no soft-wrap, and jump-to-line on diagnostic click.
// Includes a fallback text editor for environments where Monaco worker cannot load (e.g. tests).

import React, { useRef, useEffect } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { CodeTheme } from '@agentic/core';

export interface CodeTextViewProps {
  fileId: string;
  text: string;
  isEditable?: boolean;
  resetToken?: string;
  jumpToken?: string;
  jumpLine?: number;
  onTextChange?: (newText: string) => void;
}

export function CodeTextView({
  fileId,
  text,
  isEditable = false,
  resetToken,
  jumpToken,
  jumpLine = 0,
  onTextChange,
}: CodeTextViewProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const history = (redo: boolean) => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!model || !isEditable) return;
    editor.focus();
    if (redo) void model.redo();
    else { model.pushStackElement(); void model.undo(); }
  };
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isEditable) return;
    const keydown = (event: KeyboardEvent) => {
      if (!container.contains(document.activeElement)) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey &&
          (event.code === 'KeyZ' || event.key.toLowerCase() === 'z')) {
        event.preventDefault(); event.stopImmediatePropagation(); history(event.shiftKey);
      }
    };
    // Safari Edit menu / native undo can arrive as beforeinput without a keydown.
    const beforeinput = (event: InputEvent) => {
      if (event.inputType === 'historyUndo' || event.inputType === 'historyRedo') {
        event.preventDefault(); event.stopImmediatePropagation(); history(event.inputType === 'historyRedo');
      }
    };
    window.addEventListener('keydown', keydown, true);
    container.addEventListener('beforeinput', beforeinput);
    return () => { window.removeEventListener('keydown', keydown, true); container.removeEventListener('beforeinput', beforeinput); };
  }, [isEditable]);
  const isSwift = fileId.endsWith('.swift');
  const isKotlin = fileId.endsWith('.kt') || fileId.endsWith('.kts');
  const language = isSwift
    ? 'swift'
    : isKotlin
    ? 'kotlin'
    : fileId.endsWith('.json')
    ? 'json'
    : fileId.endsWith('.plist') || fileId.endsWith('.entitlements') || fileId.endsWith('.xml')
    ? 'xml'
    : 'plaintext';

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Define Xcode Dark theme based on Swift CodeTheme
    monaco.editor.defineTheme('xcode-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: '', foreground: CodeTheme.plainText.replace('#', '') },
        { token: 'keyword', foreground: CodeTheme.keyword.replace('#', ''), fontStyle: 'bold' },
        { token: 'type', foreground: CodeTheme.typeName.replace('#', '') },
        { token: 'string', foreground: CodeTheme.string.replace('#', '') },
        { token: 'number', foreground: CodeTheme.number.replace('#', '') },
        { token: 'comment', foreground: CodeTheme.comment.replace('#', ''), fontStyle: 'italic' },
      ],
      colors: {
        'editor.background': CodeTheme.background,
        'editorGutter.background': CodeTheme.gutterBackground,
        'editorLineNumber.foreground': CodeTheme.gutterText,
        'editorLineNumber.activeForeground': CodeTheme.plainText,
        'editor.foreground': CodeTheme.plainText,
        'editorCursor.foreground': CodeTheme.plainText,
      },
    });

    monaco.editor.setTheme('xcode-dark');

    if (jumpLine > 0) {
      editor.revealLineInCenter(jumpLine);
      editor.setPosition({ lineNumber: jumpLine, column: 1 });
      editor.focus();
    }
  };

  // Handle jumpToLine updates
  useEffect(() => {
    if (editorRef.current && jumpLine > 0) {
      editorRef.current.revealLineInCenter(jumpLine);
      editorRef.current.setPosition({ lineNumber: jumpLine, column: 1 });
      editorRef.current.focus();
    }
  }, [jumpToken, jumpLine]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: CodeTheme.background,
        position: 'relative',
      }}
    >
      {isEditable && <div dir="rtl" style={{ height: 30, display: 'flex', gap: 8, alignItems: 'center', paddingInline: 8 }}>
        <button className="learning-control" onClick={() => history(false)}>ביטול ⌘Z</button>
        <button className="learning-control" onClick={() => history(true)}>שחזור ⌘⇧Z</button>
      </div>}
      <div style={{ height: isEditable ? 'calc(100% - 30px)' : '100%' }}>
      <Editor
        key={resetToken}
        path={fileId}
        height="100%"
        width="100%"
        language={language}
        value={text}
        theme="vs-dark"
        options={{
          readOnly: !isEditable,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: CodeTheme.fontSize,
          fontFamily: 'SF Mono, Menlo, Monaco, "Courier New", monospace',
          wordWrap: 'off',
          lineNumbers: 'on',
          lineNumbersMinChars: 3,
          glyphMargin: false,
          folding: true,
          renderLineHighlight: 'line',
          automaticLayout: true,
          tabSize: 4,
          insertSpaces: true,
          scrollbar: {
            verticalScrollbarSize: 10,
            horizontalScrollbarSize: 10,
          },
        }}
        onMount={handleEditorDidMount}
        onChange={(val) => {
          onTextChange?.(val ?? '');
        }}
      />
      </div>
    </div>
  );
}

export default CodeTextView;
