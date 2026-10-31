import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeDesignProject, encodeDesignProject, serializeDesignProject } from '../codec';
import type { DesignNode, DesignProject } from '..';

const ROOT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner';
const SKIP_DIRS = new Set(['node_modules', 'agentic-designer-react', '.git', 'DerivedData', '.build', 'build']);

function collect(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) collect(full, out);
    else if (entry.endsWith('.agenticdesign')) out.push(full);
  }
  return out.sort();
}

const files = collect(ROOT);

interface Counts {
  pages: number;
  nodes: number;
  flows: number;
  blocks: number;
}

function countRawNodes(nodes: unknown[]): number {
  let n = 0;
  for (const node of nodes) {
    n += 1;
    const children = (node as { children?: unknown[] }).children;
    if (Array.isArray(children)) n += countRawNodes(children);
  }
  return n;
}

function rawCounts(raw: { pages: { nodes: unknown[]; logicFlows?: { blocks?: unknown[] }[] }[] }): Counts {
  const counts: Counts = { pages: raw.pages.length, nodes: 0, flows: 0, blocks: 0 };
  for (const page of raw.pages) {
    counts.nodes += countRawNodes(page.nodes);
    for (const flow of page.logicFlows ?? []) {
      counts.flows += 1;
      counts.blocks += (flow.blocks ?? []).length;
    }
  }
  return counts;
}

function countNodes(nodes: DesignNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countNodes(node.children), 0);
}

function portCounts(project: DesignProject): Counts {
  const counts: Counts = { pages: project.pages.length, nodes: 0, flows: 0, blocks: 0 };
  for (const page of project.pages) {
    counts.nodes += countNodes(page.nodes);
    for (const flow of page.logicFlows) {
      counts.flows += 1;
      counts.blocks += flow.blocks.length;
    }
  }
  return counts;
}

function assertNoUndefined(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`undefined leaked into encoded output at ${path}`);
  if (Array.isArray(value)) value.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) assertNoUndefined(v, `${path}.${k}`);
  }
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Every key/value present in the file must survive into the encoded output
 * (values compared after UUID case-normalisation, since Swift uppercases).
 * Reports the first few losses instead of throwing so the whole set is visible.
 */
function findLosses(raw: unknown, encoded: unknown, path: string, out: string[]): void {
  if (out.length >= 5) return;
  if (Array.isArray(raw)) {
    if (!Array.isArray(encoded) || encoded.length !== raw.length) {
      out.push(`${path}: array length ${raw.length} → ${Array.isArray(encoded) ? encoded.length : typeof encoded}`);
      return;
    }
    raw.forEach((v, i) => findLosses(v, encoded[i], `${path}[${i}]`, out));
    return;
  }
  if (raw !== null && typeof raw === 'object') {
    if (encoded === null || typeof encoded !== 'object' || Array.isArray(encoded)) {
      out.push(`${path}: object → ${typeof encoded}`);
      return;
    }
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v === null) continue; // Swift never writes null; treat as absent
      if (!(k in (encoded as Record<string, unknown>))) {
        out.push(`${path}.${k}: dropped`);
        continue;
      }
      findLosses(v, (encoded as Record<string, unknown>)[k], `${path}.${k}`, out);
    }
    return;
  }
  if (typeof raw === 'string' && typeof encoded === 'string' && UUID_RE.test(raw)) {
    if (raw.toUpperCase() !== encoded) out.push(`${path}: ${raw} → ${encoded}`);
    return;
  }
  if (raw !== encoded) out.push(`${path}: ${JSON.stringify(raw)} → ${JSON.stringify(encoded)}`);
}

describe('.agenticdesign round-trip (decode → encode → decode)', () => {
  it('finds the sample projects', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const name = relative(ROOT, file);
    it(`round-trips ${name}`, () => {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const first = decodeDesignProject(raw);
      const encoded = encodeDesignProject(first);
      assertNoUndefined(encoded, '$');

      const second = decodeDesignProject(JSON.parse(JSON.stringify(encoded)));
      expect(second).toEqual(first);
      expect(portCounts(first)).toEqual(rawCounts(raw));

      const text = serializeDesignProject(first);
      expect(decodeDesignProject(JSON.parse(text))).toEqual(first);

      const losses: string[] = [];
      findLosses(raw, encoded, '$', losses);
      expect(losses, `data lost between file and encoded output:\n${losses.join('\n')}`).toEqual([]);
    });
  }
});
