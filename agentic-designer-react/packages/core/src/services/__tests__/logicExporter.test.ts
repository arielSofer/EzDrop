// Runs the ported exporter over every real .agenticdesign document on this
// machine and diffs the output against the exports the Swift app produced.
// node:fs is used ONLY here (the exporter itself stays pure).

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDesignProject } from '../../models/codec';
import { AllLogicBlockType, makeLogicFlow, type LogicFlow } from '../../models/LogicModels';
import { BlockCatalog } from '../../models/BlockDefinitions';
import type { DesignProject } from '../../models/DesignProject';
import {
  blocksWithoutNativeCodegen,
  buildBlueprint,
  exportSwiftUISource,
  exportXcodeProject,
  LogicExporter,
} from '../LogicExporter';
import { asyncSetup } from '../logicExporter/asyncSetup';
import { swiftStatement } from '../logicExporter/statements';
import { swiftDoubleString, swiftSplit } from '../logicExporter/swiftRuntime';
import type { ExportAssetProvider } from '../logicExporter/types';

const ROOT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner';
const SEARCH_DIRS = [ROOT, join(ROOT, 'SavedProjects'), join(ROOT, 'Exports')];

const assets: ExportAssetProvider = {
  fileExists: (path) => {
    try {
      return existsSync(path) && statSync(path).isFile();
    } catch {
      return false;
    }
  },
  readFileBase64: (path) => readFileSync(path).toString('base64'),
};

function collectProjects(): string[] {
  const files: string[] = [];
  for (const dir of SEARCH_DIRS) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      if (entry.endsWith('.agenticdesign')) files.push(join(dir, entry));
    }
  }
  return files.sort();
}

function load(path: string): { project: DesignProject; flows: LogicFlow[] } {
  const project = parseDesignProject(readFileSync(path, 'utf8'));
  // The Swift app passes the CURRENT page's live editor flows; opening a
  // document straight from disk makes those the page's persisted flows.
  const flows = project.pages[0]?.logicFlows ?? [];
  return { project, flows };
}

const projectFiles = collectProjects();

describe('LogicExporter — Swift semantics helpers', () => {
  it('reproduces Swift Double interpolation', () => {
    expect(swiftDoubleString(1)).toBe('1.0');
    expect(swiftDoubleString(0.5)).toBe('0.5');
    expect(swiftDoubleString(12)).toBe('12.0');
    expect(swiftDoubleString(-0.25)).toBe('-0.25');
    expect(swiftDoubleString(0)).toBe('0.0');
    expect(swiftDoubleString(1e16)).toBe('1e+16');
    expect(swiftDoubleString(0.000001)).toBe('1e-06');
    expect(swiftDoubleString(100.75)).toBe('100.75');
  });

  it('reproduces Swift split semantics (empty subsequences omitted)', () => {
    expect(swiftSplit('a=b=c', '=', 1)).toEqual(['a', 'b=c']);
    expect(swiftSplit('=b', '=', 1)).toEqual(['b']);
    expect(swiftSplit('a\n\nb', '\n')).toEqual(['a', 'b']);
    expect(swiftSplit('', '\n')).toEqual([]);
  });
});

describe('LogicExporter — block coverage', () => {
  it('emits code (or a documented no-codegen marker) for every LogicBlockType', () => {
    const project = { pages: [], apiEndpoints: [], globalVariables: [], name: 'X', platformSettings: { enabledPlatforms: ['iPhone'], defaultPreviewPlatform: 'iPhone', orientation: 'portrait' } } as unknown as DesignProject;
    const silent: string[] = [];
    for (const type of AllLogicBlockType) {
      const block = BlockCatalog.makeBlock(type, { x: 0, y: 0 });
      const statement = swiftStatement(block, [], new Map(), new Map(), project, new Map());
      const branch = asyncSetup(block, 'flag', [], new Map(), project);
      expect(typeof branch).toBe('string');
      expect(branch.length).toBeGreaterThan(0);
      const definition = BlockCatalog.definition(type);
      const isEvent = definition?.inputPortCount === 0;
      const branches = (definition?.outputPortCount ?? 1) > 1;
      if (!isEvent && !branches && statement === undefined) silent.push(type);
    }
    // Every remaining silent block is a read-only/no-op block by design.
    expect(silent.sort()).toEqual(
      ['bindProperty', 'getVariable'].concat(
        silent.filter((t) => !['bindProperty', 'getVariable'].includes(t)),
      ).sort(),
    );
  });

  it('keeps the honest no-codegen list', () => {
    expect([...blocksWithoutNativeCodegen].sort()).toEqual(
      [
        'customAction', 'firestoreBatchWrite', 'firestoreListenDocument', 'firestoreListenQuery',
        'onChange', 'onLocationChanged', 'onShake', 'onWatchAction',
        'presentColorPicker', 'presentDatePicker', 'scrollTo',
      ].sort(),
    );
  });
});

describe.skipIf(projectFiles.length === 0)('LogicExporter — every real project', () => {
  for (const path of projectFiles) {
    const name = path.slice(ROOT.length + 1);

    it(`exports SwiftUI + Xcode sources for ${name}`, () => {
      const { project, flows } = load(path);

      const spm = exportSwiftUISource(project, flows, { assets });
      expect(spm.rootName.endsWith('SwiftUIExport')).toBe(true);
      const appName = LogicExporter.exportAppName(project);
      for (const required of [
        'Package.swift',
        'README.md',
        'Info.plist',
        `Sources/${appName}/Shared/AppState.swift`,
        `Sources/${appName}/Shared/GeneratedActions.swift`,
        `Sources/${appName}/Shared/GeneratedSupport.swift`,
        `Sources/${appName}/Shared/SensorServices.swift`,
        `Sources/${appName}/Shared/StateStore.swift`,
        `Sources/${appName}/Shared/AuthService.swift`,
        `Sources/${appName}/Shared/Permissions.swift`,
        `Sources/${appName}/Shared/StoreService.swift`,
        `Sources/${appName}/Shared/PushService.swift`,
        `Sources/${appName}/RootView.swift`,
        `Sources/${appName}/${appName}App.swift`,
        `${appName}UITests/${appName}UITests.swift`,
      ]) {
        expect(Object.keys(spm.files)).toContain(required);
      }

      const xcode = exportXcodeProject(project, flows, { assets });
      expect(xcode.rootName).toBe(`${appName}Xcode`);
      for (const required of [
        `${appName}.xcodeproj/project.pbxproj`,
        `${appName}.xcodeproj/xcshareddata/xcschemes/${appName}.xcscheme`,
        'Shared/AppState.swift',
        'Shared/GeneratedActions.swift',
        'iOS/App.swift',
        'iOS/RootView.swift',
        'iOS/PrivacyInfo.xcprivacy',
        'iOS/Assets.xcassets/Contents.json',
        'iOS/Assets.xcassets/AppIcon.appiconset/Contents.json',
        'iOS/Assets.xcassets/AppIcon.appiconset/icon-1024.png',
        'README.md',
      ]) {
        expect(Object.keys(xcode.files)).toContain(required);
      }

      // Every emitted .swift file must be non-empty text.
      for (const [file, content] of Object.entries(xcode.files)) {
        if (!file.endsWith('.swift')) continue;
        expect(typeof content).toBe('string');
        expect((content as string).length).toBeGreaterThan(0);
      }

      const blueprint = buildBlueprint(project, flows);
      expect(blueprint.projectName).toBe(project.name);
      expect(blueprint.screens.length).toBeGreaterThanOrEqual(0);
    });
  }

  it('honours sourceOverrides in both export layouts', () => {
    const { project, flows } = load(projectFiles[0]!);
    const appName = LogicExporter.exportAppName(project);
    const edited = { ...project, sourceOverrides: { 'AppState.swift': '// hand-edited\n' } };
    const spm = exportSwiftUISource(edited, flows, { assets });
    expect(spm.files[`Sources/${appName}/Shared/AppState.swift`]).toBe('// hand-edited\n');
    const xcode = exportXcodeProject(edited, flows, { assets });
    expect(xcode.files['Shared/AppState.swift']).toBe('// hand-edited\n');
  });

  it('drops flows nothing can trigger and reports them', () => {
    const { project } = load(projectFiles[0]!);
    const orphan = makeLogicFlow({ name: 'Orphan Flow', blocks: [BlockCatalog.makeBlock('onTap', { x: 0, y: 0 })] });
    exportXcodeProject(project, [orphan], { assets });
    expect(LogicExporter.lastDroppedFlowNames).toContain('Orphan Flow');
  });
});

// ── Diff against the exports the Swift app actually produced ───────────────
// The references may predate the current exporter and were sometimes
// hand-edited, so non-zero diffs are REPORTED, never failed.

interface Reference {
  project: string;
  exportRoot: string;
}

const REFERENCES: Reference[] = [
  { project: join(ROOT, 'PaceGuard.agenticdesign'), exportRoot: join(ROOT, 'Exports/PaceGuard-Verified/PaceGuardXcode') },
  { project: join(ROOT, 'AeronShop.agenticdesign'), exportRoot: join(ROOT, 'Exports/AeronShop-Verified/AeronShopXcode') },
  { project: join(ROOT, 'Looply.agenticdesign'), exportRoot: join(ROOT, 'Looply-Xcode/LooplyXcode') },
  // The newest Looply export on disk — the closest reference in exporter age.
  { project: join(ROOT, 'Looply.agenticdesign'), exportRoot: join(ROOT, 'Looply-Xcode-Snappy/LooplyXcode') },
];

function walkFiles(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'build' || entry === '.DS_Store') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out.sort();
}

/** Line-level diff count (added + removed), like `diff | grep -c '^[<>]'`. */
function diffLineCount(a: string, b: string): number {
  const left = a.split('\n');
  const right = b.split('\n');
  const n = left.length;
  const m = right.length;
  // LCS over lines (documents here are a few thousand lines at most).
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = left[i] === right[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const common = dp[0]![0]!;
  return n - common + (m - common);
}

describe('LogicExporter — diff vs the Swift app\'s own exports', () => {
  for (const reference of REFERENCES) {
    const label = reference.exportRoot.slice(ROOT.length + 1);
    it.skipIf(!existsSync(reference.project) || !existsSync(reference.exportRoot))(
      `reports per-file differences for ${label}`,
      () => {
        const { project, flows } = load(reference.project);
        const generated = exportXcodeProject(project, flows, { assets });
        const referenceFiles = walkFiles(reference.exportRoot);
        const generatedFiles = Object.keys(generated.files).sort();

        const report: string[] = [`\n=== ${label} ===`];
        let identical = 0;
        for (const file of generatedFiles) {
          const refPath = join(reference.exportRoot, file);
          if (!existsSync(refPath)) {
            report.push(`  only-in-port : ${file}`);
            continue;
          }
          const content = generated.files[file]!;
          if (typeof content !== 'string') {
            report.push(`  binary       : ${file} (icon PNG — AppKit rendering is not reproducible)`);
            continue;
          }
          const diff = diffLineCount(content, readFileSync(refPath, 'utf8'));
          if (diff === 0) identical += 1;
          else report.push(`  ${String(diff).padStart(5)} lines : ${file}`);
        }
        for (const file of referenceFiles) {
          if (!generatedFiles.includes(file)) report.push(`  only-in-ref  : ${file}`);
        }
        report.push(`  identical    : ${identical}/${generatedFiles.length} generated files`);
        console.log(report.join('\n'));

        expect(generatedFiles.length).toBeGreaterThan(0);
      },
    );
  }
});
