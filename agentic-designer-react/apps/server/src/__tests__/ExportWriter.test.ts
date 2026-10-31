import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { prettySortedJSON, compactJSON } from '../platform/json.js';
import { ExportWriter } from '../services/ExportWriter.js';
import { MCPToolNames } from '../mcp/toolNames.js';

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-export-test-'));

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('ExportWriter', () => {
  it('writes text and base64 files into nested directories', () => {
    const root = path.join(scratch, 'MyApp');
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const result = ExportWriter.write(root, {
      'Package.swift': '// swift-tools-version:5.9\n',
      'Sources/MyApp/App.swift': 'import SwiftUI\n',
      'Sources/MyApp/Resources/icon.png': { base64: png.toString('base64') },
    });
    expect(result.written).toBe(3);
    expect(fs.readFileSync(path.join(root, 'Sources/MyApp/App.swift'), 'utf8')).toBe('import SwiftUI\n');
    expect(fs.readFileSync(path.join(root, 'Sources/MyApp/Resources/icon.png'))).toEqual(png);
  });

  it('cleans the root when asked', () => {
    const root = path.join(scratch, 'Clean');
    ExportWriter.write(root, { 'old.txt': 'x' });
    ExportWriter.write(root, { 'new.txt': 'y' }, true);
    expect(fs.existsSync(path.join(root, 'old.txt'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'new.txt'))).toBe(true);
  });

  it('refuses absolute paths and traversal', () => {
    const root = path.join(scratch, 'Safe');
    expect(() => ExportWriter.write(root, { '/etc/passwd': 'x' })).toThrow('must be relative');
    expect(() => ExportWriter.write(root, { '../escape.txt': 'x' })).toThrow('escapes the export root');
  });

  it('creates the Swift temp directory names under $TMPDIR', () => {
    const dir = ExportWriter.temporaryDirectory('AgenticDesignerSimulatorRun');
    expect(dir).toBe(path.join(os.tmpdir(), 'AgenticDesignerSimulatorRun'));
    expect(fs.statSync(dir).isDirectory()).toBe(true);
  });
});

describe('Foundation-style JSON', () => {
  it('prettySortedJSON sorts keys, uses " : " and escapes slashes', () => {
    expect(prettySortedJSON({ b: 1, a: 'x/y', c: [], d: {} })).toBe('{\n  "a" : "x\\/y",\n  "b" : 1,\n  "c" : [\n\n  ],\n  "d" : {\n\n  }\n}');
    expect(compactJSON({ a: [1, 'two', null, true] })).toBe('{"a":[1,"two",null,true]}');
  });
});

describe('tool registry names', () => {
  it('has the 100 Swift controller tools with no duplicates', () => {
    expect(MCPToolNames).toHaveLength(100);
    expect(new Set(MCPToolNames).size).toBe(100);
    expect(MCPToolNames[0]).toBe('get_build_methodology');
    expect(MCPToolNames[MCPToolNames.length - 1]).toBe('pdf_export_flattened');
  });
});
