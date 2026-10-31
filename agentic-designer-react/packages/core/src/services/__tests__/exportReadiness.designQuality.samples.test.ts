// ExportReadiness + DesignQualityAudit over three real sample projects.
// Findings carry a fresh UUID each run, so the snapshots keep the parts the
// Swift decides: severity, title and message text.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDesignProject } from '../../models/codec';
import { makeDesignPage, makeDesignProject } from '../../models/DesignProject';
import { newUUID } from '../../models/uuid';
import { resetTextMeasurer } from '../../platform/TextMeasurer';
import { DesignQualityAudit } from '../DesignQualityAudit';
import { ExportReadiness } from '../ExportReadiness';

const ROOT = '/Users/ariel/Documents/XcodeApps/AgenticDesigner';

const SAMPLES = [
  'PaceGuard.agenticdesign',
  'Looply.agenticdesign',
  'SavedProjects/WaltDelivery-MusicApp-FullLogic.agenticdesign',
].map((relative) => ({ name: relative, path: `${ROOT}/${relative}` }));

function loadProject(path: string) {
  expect(existsSync(path), path).toBe(true);
  return parseDesignProject(readFileSync(path, 'utf8'));
}

describe('ExportReadiness over the sample projects', () => {
  for (const sample of SAMPLES) {
    it(`audits ${sample.name}`, () => {
      const project = loadProject(sample.path);
      const flows = project.pages.flatMap((page) => page.logicFlows);
      const findings = ExportReadiness.audit(project, flows);
      expect(findings.map((f) => `${f.severity.toUpperCase()} ${f.title}`)).toMatchSnapshot();
      expect(ExportReadiness.summary(findings)).toMatchSnapshot();
    });
  }

  it('reports READY for a clean project', () => {
    const project = makeDesignProject({
      name: 'Aroma',
      pages: [makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [] })],
    });
    expect(ExportReadiness.summary(ExportReadiness.audit(project, []))).toBe(
      'READY — every flow is bound, every block has a native implementation, and backends are configured.',
    );
  });
});

describe('DesignQualityAudit over the sample projects', () => {
  for (const sample of SAMPLES) {
    it(`scores ${sample.name}`, () => {
      resetTextMeasurer();
      const project = loadProject(sample.path);
      const page = project.pages[0]!;
      const report = DesignQualityAudit.report(page);
      expect({
        score: report.score,
        findings: report.findings.map((f) => `${f.severity.toUpperCase()} [${f.screen}] ${f.message}`),
      }).toMatchSnapshot();
      expect(DesignQualityAudit.summary(report)).toMatchSnapshot();
    });
  }

  it('scores a clean page 100 and passes the reference bar', () => {
    const page = makeDesignPage({ id: newUUID(), name: 'Page 1', nodes: [] });
    expect(DesignQualityAudit.audit(page)).toEqual([]);
    expect(DesignQualityAudit.summary([])).toBe(
      'Reference design score: 100/100 — REFERENCE BAR PASS ✓\nDesign check: clean — hierarchy, spacing, contrast, palette and tap targets passed.',
    );
  });
});
