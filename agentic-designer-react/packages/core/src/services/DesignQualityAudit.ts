// Ported 1:1 from AgenticDesigner/Services/DesignQualityAudit.swift
//
// Deterministic design criticism — the practical alternative to a vision
// critic. A 32B VLM took ~160s per screenshot and still missed obvious
// overlaps; geometry never misses one and costs nothing.
//
// The point is ENFORCEMENT, not advice. Telling a model in a system prompt to
// "use consistent padding" is a suggestion a weak model ignores; returning
// "this call left 2 elements 8pt from the edge while every other screen uses
// 24" inside the tool result is a fact it has to answer for.

import type { DesignNode } from '../models/DesignNode';
import type { DesignPage } from '../models/DesignProject';
import { rect, rectContainsRect, rectIntersection, rectIntersects } from '../models/Geometry';
import { getTextMeasurer } from '../platform/TextMeasurer';

export const AllDesignQualitySeverity = ['blocker', 'warning', 'info'] as const;
export type DesignQualitySeverity = (typeof AllDesignQualitySeverity)[number];

export interface DesignQualityFinding {
  severity: DesignQualitySeverity;
  screen: string;
  message: string;
  fix: string;
}

export interface DesignQualityReport {
  findings: DesignQualityFinding[];
  score: number;
}

export function blockerCount(report: DesignQualityReport): number {
  return report.findings.filter((f) => f.severity === 'blocker').length;
}
export function warningCount(report: DesignQualityReport): number {
  return report.findings.filter((f) => f.severity === 'warning').length;
}
export function infoCount(report: DesignQualityReport): number {
  return report.findings.filter((f) => f.severity === 'info').length;
}

/** `DesignQualityReport.passesReferenceBar` */
export function passesReferenceBar(report: DesignQualityReport): boolean {
  return blockerCount(report) === 0 && warningCount(report) === 0 && report.score >= 90;
}

/** Apple's minimum comfortable touch target. */
const minimumTapTarget = 44;
/** Spacing values a design is allowed to use before it reads as arbitrary. */
const spacingScale: ReadonlySet<number> = new Set([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 56, 64]);

/** Swift `Double.rounded()` — half away from zero. */
function swiftRounded(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** Swift `Int(_:)` on a Double — truncation toward zero. */
function swiftInt(value: number): number {
  return Math.trunc(value);
}

export function audit(page: DesignPage): DesignQualityFinding[] {
  let findings: DesignQualityFinding[] = [];
  const screens = page.nodes.filter((n) => n.type === 'Frame');
  if (screens.length === 0) return [];

  // One screen padding for the whole product: the most common left inset
  // across screens becomes the standard everything else is judged against.
  const insets = screens.flatMap((screen) =>
    screen.children.filter(isContentNode).map((child) => swiftInt(swiftRounded(child.x))),
  );
  const dominantInset = mostCommon(insets);

  for (const screen of screens) {
    findings = findings.concat(auditScreen(screen, dominantInset));
    findings = findings.concat(auditReferenceQuality(screen));
  }

  findings = findings.concat(auditNavigationPromises(screens));
  findings = findings.concat(auditProductConsistency(screens));
  for (const screen of screens) {
    findings = findings.concat(auditOverflow(screen, screen.name));
  }

  // Anything at page level that isn't a screen is floating outside every
  // screen — it renders on the canvas but ships in no view. This was a
  // blind spot: the audit only walked screen children, so the most broken
  // case of all reported "clean".
  for (const orphan of page.nodes) {
    if (orphan.type === 'Frame') continue;
    findings.push({
      severity: 'blocker',
      screen: '(page root)',
      message: `${orphan.name} sits outside every screen frame, so it belongs to no exported view.`,
      fix: "Re-parent it into a screen (moveNode with the screen's node id as parent), or delete it.",
    });
  }
  return findings;
}

export function report(page: DesignPage): DesignQualityReport {
  return reportForFindings(audit(page));
}

function reportForFindings(findings: DesignQualityFinding[]): DesignQualityReport {
  const blockers = findings.filter((f) => f.severity === 'blocker').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;
  const score = Math.max(0, 100 - blockers * 20 - warnings * 6 - Math.min(infos, 10));
  return { findings, score };
}

function auditScreen(screen: DesignNode, dominantInset: number | undefined): DesignQualityFinding[] {
  const findings: DesignQualityFinding[] = [];
  const content = screen.children.filter(isContentNode);

  for (const child of content) {
    // A full-bleed element — nav bar, hero image, background card —
    // is SUPPOSED to reach both edges. Flagging it produced warnings
    // on correct layouts, which is worse than silence: it pushes an
    // agent to "fix" work that was already right.
    const isFullBleed = child.width >= screen.width - 8;
    // Likewise, only the element that STARTS a row can be judged
    // against the screen margin. The second column of a grid and the
    // fourth tab in a bar are meant to sit further in.
    const leadsItsRow = !content.some(
      (sibling) =>
        sibling.id !== child.id &&
        sibling.x < child.x - 1 &&
        sibling.y < child.y + child.height &&
        sibling.y + sibling.height > child.y,
    );
    // A compact focal control such as a progress ring is intentionally
    // centred. Judging its x-origin as a broken left margin trained the
    // loop to stretch or misalign correct hero compositions.
    const isCenteredFocal =
      child.width < screen.width - 48 && Math.abs(child.x + child.width / 2 - screen.width / 2) <= 3;

    // Flush against the edge — the single most common generated-design
    // tell, and the one the padding system prompt rule kept missing.
    if (!isFullBleed && (child.x < 4 || screen.width - (child.x + child.width) < 4)) {
      findings.push({
        severity: 'warning',
        screen: screen.name,
        message: `${child.name} touches the screen edge (x=${swiftInt(child.x)}, right gap=${swiftInt(
          screen.width - child.x - child.width,
        )}).`,
        fix: `Inset it to the screen padding${dominantInset !== undefined ? ` (${dominantInset}pt on this project)` : ''}.`,
      });
    } else if (
      dominantInset !== undefined &&
      leadsItsRow &&
      !isFullBleed &&
      !isCenteredFocal &&
      Math.abs(swiftInt(swiftRounded(child.x)) - dominantInset) > 3
    ) {
      findings.push({
        severity: 'info',
        screen: screen.name,
        message: `${child.name} starts at x=${swiftInt(child.x)} while this project's screen padding is ${dominantInset}.`,
        fix: `Align it to ${dominantInset}pt so every screen shares one margin.`,
      });
    }

    // Off-scale spacing reads as arbitrary even when it looks fine —
    // but only for the row's leading element, for the same reason.
    const rounded = swiftInt(swiftRounded(child.x));
    if (
      leadsItsRow &&
      !isFullBleed &&
      !isCenteredFocal &&
      rounded > 0 &&
      !spacingScale.has(rounded) &&
      Math.abs(rounded - (dominantInset ?? -1)) > 3
    ) {
      findings.push({
        severity: 'info',
        screen: screen.name,
        message: `${child.name} uses an off-scale inset (${rounded}pt).`,
        fix: 'Snap to 4/8/12/16/20/24/32.',
      });
    }

    // Tap targets.
    if (isInteractive(child) && child.height < minimumTapTarget) {
      findings.push({
        severity: 'warning',
        screen: screen.name,
        message: `${child.name} is ${swiftInt(child.height)}pt tall — below the 44pt minimum tap target.`,
        fix: 'resizeNode it to at least 44pt high.',
      });
    }

    // Contrast: unreadable text is a blocker, not a nitpick.
    if (child.type === 'Text') {
      const textColor = child.style.textColor ?? child.style.fill;
      const background = nearestBackground(child, screen);
      const ratio = background !== undefined ? contrastRatio(textColor, background) : undefined;
      if (ratio !== undefined && ratio < 4.5) {
        findings.push({
          severity: ratio < 3 ? 'blocker' : 'warning',
          screen: screen.name,
          message: `${child.name} has ${ratio.toFixed(1)}:1 contrast against its background — WCAG AA needs 4.5:1.`,
          fix: 'Lighten or darken the text colour (updateStyle textColor).',
        });
      }
    }

    // A text box wider than its words makes every alignment lie.
    if (child.type === 'Text' && child.text !== undefined && child.text.length > 0) {
      const measured = measuredWidth(child);
      if (measured > 0 && child.width - measured > 24) {
        findings.push({
          severity: 'info',
          screen: screen.name,
          message: `${child.name}'s box is ${swiftInt(child.width)}pt for ${swiftInt(measured)}pt of text.`,
          fix: 'Hug the text so centring centres the words, not empty space.',
        });
      }
    }
  }

  // Vertical rhythm: wildly varying gaps between stacked siblings.
  const stacked = [...content].sort((a, b) => a.y - b.y);
  const gaps: number[] = [];
  if (stacked.length > 1) {
    for (let index = 1; index < stacked.length; index += 1) {
      const previous = stacked[index - 1]!;
      const gap = swiftInt(swiftRounded(stacked[index]!.y - (previous.y + previous.height)));
      if (gap >= 0) gaps.push(gap);
    }
  }
  const offScale = gaps.filter((g) => g > 0 && !spacingScale.has(g));
  if (offScale.length > 2) {
    findings.push({
      severity: 'info',
      screen: screen.name,
      message: `${offScale.length} vertical gaps are off the spacing scale (${offScale
        .slice(0, 4)
        .map(String)
        .join(', ')}pt).`,
      fix: 'Use distributeChildren, or snap gaps to 8/12/16/24/32.',
    });
  }

  return findings;
}

/**
 * Content spilling out of its container, at ANY depth. The audit used to
 * walk only a screen's direct children, so an image bleeding past a card
 * two levels down reported "clean" while looking obviously broken.
 */
function auditOverflow(node: DesignNode, screenName: string): DesignQualityFinding[] {
  let findings: DesignQualityFinding[] = [];
  for (const child of node.children) {
    const overRight = child.x + child.width - node.width;
    const overBottom = child.y + child.height - node.height;
    // 2pt of tolerance: sub-pixel rounding from layout maths is not a
    // design defect, and reporting it trains people to ignore the list.
    const spills = child.x < -2 || child.y < -2 || overRight > 2 || overBottom > 2;
    // A clipping container is doing this on purpose (aspect-fill crop).
    if (spills && node.clipContent !== true) {
      const by = swiftRounded(Math.max(overRight, overBottom));
      findings.push({
        severity: 'warning',
        screen: screenName,
        message: `${child.name} (${swiftInt(child.width)}×${swiftInt(child.height)}) spills out of ${node.name} (${swiftInt(
          node.width,
        )}×${swiftInt(node.height)}) by ${swiftInt(Math.max(by, 1))}pt.`,
        fix: `Resize the child to fit, or set clipContent on ${node.name} to crop it.`,
      });
    }
    findings = findings.concat(auditOverflow(child, screenName));
  }
  return findings;
}

/**
 * A tab bar with four tabs and one screen behind it is the most common
 * lie a generated design tells: it photographs like a finished app and
 * ships as a dead end. Geometry checks can't see it, so this compares
 * what the navigation PROMISES against the screens that actually exist.
 */
function auditNavigationPromises(screens: DesignNode[]): DesignQualityFinding[] {
  const findings: DesignQualityFinding[] = [];
  const screenNames = screens.map((s) => normalized(s.name));

  for (const screen of screens) {
    for (const bar of screen.children) {
      if (!isNavigationBar(bar)) continue;
      const labels: string[] = [];
      collectText(bar, labels);

      const missing = labels.filter((labelText) => {
        const key = normalized(labelText);
        if (!(key.length > 1)) return false;
        // A tab matches when a screen name contains it or vice versa
        // ("Outfits" ↔ "Outfits Screen").
        return !screenNames.some((name) => name.includes(key) || key.includes(name));
      });
      if (missing.length === 0) continue;
      findings.push({
        severity: 'warning',
        screen: screen.name,
        message: `${bar.name} offers ${missing.length} destination(s) with no screen behind them: ${missing.join(', ')}.`,
        fix: 'Create those screens, or remove the tabs — navigation that goes nowhere makes a demo look like an app.',
      });
    }
  }

  // A screen nothing links to can only be reached by editing the code.
  if (screens.length > 1) {
    const referenced = new Set<string>([normalized(screens[0]!.name)]);
    for (const screen of screens) {
      const labels: string[] = [];
      collectText(screen, labels);
      for (const labelText of labels) {
        const key = normalized(labelText);
        if (!(key.length > 1)) continue;
        for (const name of screens.map((s) => normalized(s.name))) {
          if (name.includes(key) || key.includes(name)) referenced.add(name);
        }
      }
    }
    for (const screen of screens) {
      if (referenced.has(normalized(screen.name))) continue;
      findings.push({
        severity: 'info',
        screen: screen.name,
        message: `Nothing anywhere in the design points to ${screen.name}.`,
        fix: 'Add a control that navigates to it, or it ships unreachable.',
      });
    }
  }
  return findings;
}

// MARK: - AppShots reference bar

/**
 * Higher-level production checks distilled from the 1,856-screen corpus.
 * Geometry catches breakage; these catch the familiar AI-mockup tells:
 * weak hierarchy, rainbow chrome, filler copy and unfinished assets.
 */
function auditReferenceQuality(screen: DesignNode): DesignQualityFinding[] {
  const findings: DesignQualityFinding[] = [];
  const allNodes = flattenedChildren(screen);
  const screenKey = normalized(screen.name);
  const sparseState = ['splash', 'loading', 'permission', 'empty', 'error', 'success'].some((k) =>
    screenKey.includes(k),
  );

  const meaningfulNodes = allNodes.filter((node) => {
    if ((node.zIndex ?? 0) < 0) return false;
    if (node.name.toLowerCase().includes('background')) return false;
    return true;
  });
  if (!sparseState && meaningfulNodes.length < 5) {
    findings.push({
      severity: meaningfulNodes.length < 3 ? 'blocker' : 'warning',
      screen: screen.name,
      message: `The screen has only ${meaningfulNodes.length} meaningful element(s), so it reads as unfinished.`,
      fix: 'Give it one focal section plus the controls/content required for its real task; do not add decorative filler.',
    });
  }

  const textNodes = allNodes.filter(
    (n) => n.type === 'Text' && trimWhitespacesAndNewlines(n.text ?? '').length > 0,
  );
  const displayRequired = ['home', 'today', 'feed', 'dashboard', 'explore', 'onboarding', 'welcome'].some((k) =>
    screenKey.includes(k),
  );
  const fontSizes = textNodes
    .map((n) => n.style.fontSize)
    .filter((s): s is number => s !== undefined);
  const maximumType = fontSizes.length === 0 ? 0 : Math.max(...fontSizes);
  if (displayRequired && textNodes.length >= 2 && maximumType < 22) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: `No text establishes a clear hierarchy (largest type is ${swiftInt(maximumType)}pt).`,
      fix: 'Promote the single most important title or metric to 24-34pt and keep supporting copy at 13-17pt.',
    });
  }

  const typeScale = new Set(
    textNodes
      .map((node) => (node.style.fontSize === undefined ? undefined : swiftInt(swiftRounded(node.style.fontSize))))
      .filter((s): s is number => s !== undefined),
  );
  // Registry components use small, purposeful optical adjustments
  // inside the same role (11/12 captions, 13/14 metadata, 15/16 body).
  // Treating seven such sizes as seven unrelated roles produced false
  // positives and pushed the loop to enlarge fitted list labels. Nine or
  // more distinct sizes is where a screen actually loses a coherent ramp.
  if (typeScale.size > 8) {
    findings.push({
      severity: 'info',
      screen: screen.name,
      message: `The screen uses ${typeScale.size} font sizes (${[...typeScale]
        .sort((a, b) => a - b)
        .map(String)
        .join(', ')}pt).`,
      fix: 'Collapse typography onto 11-13, 15-17, 20-24 and one 28-36 display size.',
    });
  }

  const fillerTerms = [
    'item', 'featured', 'subtitle', 'title', 'button', 'lorem ipsum',
    'a focused content section', 'a beautiful moment', 'your content', 'sample text',
  ];
  const filler = textNodes
    .map((n) => n.text)
    .filter((t): t is string => t !== undefined)
    .filter((raw) => fillerTerms.includes(trimWhitespacesAndNewlines(raw).toLowerCase()));
  if (filler.length > 0) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: `Placeholder copy is visible: ${[...new Set(filler)].slice(0, 4).join(', ')}.`,
      fix: 'Replace every placeholder with concise, believable product copy and real-looking values.',
    });
  }

  const normalizedText = new Set(
    textNodes
      .map((n) => n.text)
      .filter((t): t is string => t !== undefined)
      .map((t) => trimWhitespacesAndNewlines(t).toLowerCase()),
  );
  const factoryFallbackTrio = ['recent order', 'delivered', 'saved for later'];
  if (factoryFallbackTrio.every((t) => normalizedText.has(t))) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: 'A stock component fallback is visible (Recent order / Delivered / Saved for later).',
      fix: 'Pass item1Title/item1Subtitle/item1Amount through item3… using product-specific rows; never ship the component library\'s demo data.',
    });
  }

  const clippedText = textNodes.filter((node) => {
    const text = node.text;
    if (text === undefined || !(charCount(text) > 3)) return false;
    const measured = measuredWidth(node);
    const fontSize = node.style.fontSize ?? 16;
    const visuallySingleLine = node.height < fontSize * 2.1;
    const explicitlyWraps = node.textBehavior?.wrap === true && node.textBehavior?.maxLines !== 1;
    if (visuallySingleLine && !explicitlyWraps && measured > node.width + 6) return true;
    if (explicitlyWraps) {
      const lineCap = Math.max(1, node.textBehavior?.maxLines ?? 99);
      const allowedHeight = Math.min(node.height, lineCap * fontSize * 1.25);
      return measuredHeight(node, node.width) > allowedHeight + 3;
    }
    return false;
  });
  if (clippedText.length > 0) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: `${clippedText.length} label(s) are likely truncated at render time: ${clippedText
        .slice(0, 3)
        .map((n) => n.text)
        .filter((t): t is string => t !== undefined)
        .join(', ')}.`,
      fix: 'Give the label its full row width, fit the font, or explicitly wrap to two lines; an ellipsis in a primary title is not acceptable.',
    });
  }

  const literalEllipses = textNodes
    .map((n) => n.text)
    .filter((t): t is string => t !== undefined)
    .filter((t) => t.includes('…') || trimWhitespacesAndNewlines(t).endsWith('...'));
  if (literalEllipses.length > 0) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: `Visible copy contains ellipsis truncation: ${literalEllipses.slice(0, 3).join(', ')}.`,
      fix: 'Show the full product copy by fitting or wrapping it; do not bake truncation into a finished screen.',
    });
  }

  const machineProgress = textNodes.filter((node) => {
    if (!normalized(node.name).includes('progressvalue')) return false;
    const raw = node.text === undefined ? undefined : trimWhitespacesAndNewlines(node.text);
    if (raw === undefined) return false;
    const numeric = swiftDoubleValue(raw);
    if (numeric === undefined) return false;
    return raw.includes('.') && numeric >= 0 && numeric <= 1;
  });
  if (machineProgress.length > 0) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: `A progress ring exposes a raw machine fraction (${machineProgress
        .map((n) => n.text)
        .filter((t): t is string => t !== undefined)
        .join(', ')}).`,
      fix: 'Render a human metric such as 74%, 18.4 / 25 km, or 3.24 km; keep the 0...1 fraction internal.',
    });
  }

  const taskNeedsCTA = ['onboarding', 'welcome', 'setup', 'configure', 'live', 'active', 'checkout', 'confirm'].some(
    (k) => screenKey.includes(k),
  );
  if (taskNeedsCTA && !allNodes.some((n) => n.type === 'Button')) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: 'This task state has no visible action button for its next step.',
      fix: 'Add one clear child control (Get Started, Continue, Finish, Confirm) and wire the flow to that control.',
    });
  }

  const unresolvedImages = allNodes.filter((node) => {
    if (node.type !== 'Image') return false;
    const source = trimWhitespacesAndNewlines(node.imageSource ?? node.imageName ?? '');
    return source.length === 0 || source.toLowerCase().includes('placeholder');
  });
  if (unresolvedImages.length > 0) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: `${unresolvedImages.length} image slot(s) are still placeholders.`,
      fix: 'Generate or assign each intended asset, then inspect its crop in the rendered screenshot.',
    });
  }

  const chromeColors = new Set(
    allNodes.flatMap((node) =>
      [node.style.fill, node.style.textColor, node.style.stroke]
        .map(canonicalHex)
        .filter((h): h is string => h !== undefined),
    ),
  );
  const accentColors = [...chromeColors].filter((hex) => saturationOf(hex) >= 0.28);
  if (accentColors.length > 7) {
    findings.push({
      severity: 'warning',
      screen: screen.name,
      message: `Interface chrome uses ${accentColors.length} saturated colours; the references use one brand accent plus semantic colours.`,
      fix: 'Keep one repeated brand accent and reserve extras for real states/data categories. Let imagery carry incidental colour.',
    });
  } else if (accentColors.length > 5) {
    findings.push({
      severity: 'info',
      screen: screen.name,
      message: `The palette has ${accentColors.length} saturated interface colours.`,
      fix: 'Check that every accent has a semantic role and remove decorative one-off colours.',
    });
  }

  const radiusScale = new Set(
    allNodes
      .map((node) => {
        const radius = node.style.cornerRadius;
        if (!(radius > 0 && radius < 900)) return undefined;
        return swiftInt(swiftRounded(radius));
      })
      .filter((r): r is number => r !== undefined),
  );
  if (radiusScale.size > 6) {
    findings.push({
      severity: 'info',
      screen: screen.name,
      message: `The screen uses ${radiusScale.size} different corner radii.`,
      fix: 'Use one utility radius, one card radius, one hero radius and a pill token only where appropriate.',
    });
  }

  for (const nav of screen.children) {
    if (!isNavigationBar(nav)) continue;
    const navRect = rect(nav.x, nav.y, nav.width, nav.height);
    const collisions = screen.children.filter((child) => {
      if (child.id === nav.id || child.name.toLowerCase().includes('background')) return false;
      const childRect = rect(child.x, child.y, child.width, child.height);
      return rectIntersects(childRect, navRect) && rectIntersection(childRect, navRect).height > 4;
    });
    if (collisions.length > 0) {
      findings.push({
        severity: 'warning',
        screen: screen.name,
        message: `${collisions.length} fixed element(s) overlap the bottom navigation region.`,
        fix: `End fixed content above y=${swiftInt(nav.y)}; put long content in a vertical scroll container.`,
      });
    }
  }

  const densityRequired = [
    'home', 'today', 'setup', 'progress', 'profile', 'settings', 'feed', 'dashboard', 'onboarding', 'welcome', 'live',
  ].some((k) => screenKey.includes(k));
  if (densityRequired) {
    const navigationTop = screen.children.find(isNavigationBar)?.y ?? screen.height - 24;
    const bottoms = screen.children
      .filter((c) => !isNavigationBar(c) && !c.name.toLowerCase().includes('background'))
      .map((c) => c.y + c.height);
    const contentBottom = bottoms.length === 0 ? 0 : Math.max(...bottoms);
    const unusedBand = navigationTop - contentBottom;
    if (unusedBand > 160) {
      findings.push({
        severity: 'warning',
        screen: screen.name,
        message: `The screen leaves a ${swiftInt(unusedBand)}pt empty band before its bottom region, so it reads as a half-finished mockup.`,
        fix: 'Add the next task-relevant section or a richer state, or rebalance component heights; do not fill the gap with decoration.',
      });
    }
  }

  return findings;
}

function auditProductConsistency(screens: DesignNode[]): DesignQualityFinding[] {
  if (!(screens.length > 1)) return [];
  const findings: DesignQualityFinding[] = [];

  const rootFills = new Set(
    screens.map((s) => canonicalHex(s.style.fill)).filter((h): h is string => h !== undefined),
  );
  if (rootFills.size > 4) {
    findings.push({
      severity: 'warning',
      screen: '(product system)',
      message: `The product uses ${rootFills.size} screen backgrounds, so the screens do not read as one family.`,
      fix: 'Choose one primary canvas and at most one intentional alternate surface for entry/media states.',
    });
  }

  const navFrames = screens.flatMap((screen) =>
    screen.children.filter(isNavigationBar).map((n) => [n.y, n.height] as const),
  );
  if (navFrames.length > 1) {
    const yValues = navFrames.map((f) => swiftInt(swiftRounded(f[0])));
    const heights = navFrames.map((f) => swiftInt(swiftRounded(f[1])));
    if (Math.max(...yValues) - Math.min(...yValues) > 4 || Math.max(...heights) - Math.min(...heights) > 4) {
      findings.push({
        severity: 'warning',
        screen: '(product system)',
        message: 'Bottom navigation shifts size or position between screens.',
        fix: 'Use one shared navigation shell at the same y/height on every core screen.',
      });
    }
  }

  return findings;
}

function isNavigationBar(node: DesignNode): boolean {
  const name = node.name.toLowerCase();
  return (
    name.includes('nav') ||
    name.includes('tab') ||
    name.includes('bottom bar') ||
    name.includes('bottombar') ||
    name.includes('toolbar')
  );
}

function collectText(node: DesignNode, out: string[]): void {
  if (node.type === 'Text' && node.text !== undefined) {
    const text = trimWhitespacesAndNewlines(node.text);
    if (text.length > 0) out.push(text);
  }
  node.children.forEach((child) => collectText(child, out));
}

/** Lowercased letters/digits only, so "Add Item" ↔ "AddItemScreen" match. */
function normalized(raw: string): string {
  return [...raw.toLowerCase()].filter((c) => /\p{L}|\p{N}/u.test(c)).join('');
}

// MARK: - Reporting

/**
 * One-line-per-issue summary appended to a mutating tool's result, so the
 * agent sees the consequence of the call it just made.
 */
export function summary(findings: DesignQualityFinding[], limit?: number): string;
export function summary(report: DesignQualityReport, limit?: number): string;
export function summary(input: DesignQualityFinding[] | DesignQualityReport, limit: number = 8): string {
  const value: DesignQualityReport = Array.isArray(input) ? reportForFindings(input) : input;
  const verdict = passesReferenceBar(value) ? 'REFERENCE BAR PASS ✓' : 'REFERENCE BAR NOT MET';
  if (value.findings.length === 0) {
    return 'Reference design score: 100/100 — REFERENCE BAR PASS ✓\nDesign check: clean — hierarchy, spacing, contrast, palette and tap targets passed.';
  }

  const lines = stableSorted(value.findings, (a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, limit)
    .map((f) => `  ${f.severity.toUpperCase()} [${f.screen}] ${f.message} → ${f.fix}`);
  const more = value.findings.length > limit ? `\n  …and ${value.findings.length - limit} more.` : '';
  return (
    `Reference design score: ${value.score}/100 — ${verdict}\n` +
    `Design check: ${blockerCount(value)} blocker(s), ${warningCount(value)} warning(s), ${infoCount(value)} note(s).\n` +
    `${lines.join('\n')}${more}`
  );
}

function stableSorted<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  return items
    .map((value, index) => ({ value, index }))
    .sort((a, b) => compare(a.value, b.value) || a.index - b.index)
    .map((entry) => entry.value);
}

function severityRank(severity: DesignQualitySeverity): number {
  switch (severity) {
    case 'blocker':
      return 0;
    case 'warning':
      return 1;
    case 'info':
      return 2;
  }
}

// MARK: - Helpers

function flattenedChildren(node: DesignNode): DesignNode[] {
  return node.children.flatMap((child) => [child, ...flattenedChildren(child)]);
}

function canonicalHex(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  let value = trimWhitespacesAndNewlines(raw).toUpperCase();
  if (!value.startsWith('#')) return undefined;
  value = value.slice(1);
  if (value.length === 8 && value.slice(-2) === '00') return undefined;
  if (value.length === 8) value = value.slice(0, 6);
  if (value.length !== 6 || !/^[0-9A-F]{6}$/.test(value)) return undefined;
  return '#' + value;
}

function saturationOf(hex: string): number {
  let value = hex;
  if (value.startsWith('#')) value = value.slice(1);
  if (!/^[0-9a-fA-F]+$/.test(value)) return 0;
  const rgb = parseInt(value, 16);
  if (!Number.isFinite(rgb)) return 0;
  const red = ((rgb >> 16) & 0xff) / 255;
  const green = ((rgb >> 8) & 0xff) / 255;
  const blue = (rgb & 0xff) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  return maximum === 0 ? 0 : (maximum - minimum) / maximum;
}

/** Backgrounds and decorative fills aren't "content" for padding purposes. */
function isContentNode(node: DesignNode): boolean {
  if ((node.zIndex ?? 0) < 0) return false;
  if (node.name.toLowerCase().includes('background')) return false;
  // A child that fills the screen is a backdrop, not an inset element.
  return true;
}

function isInteractive(node: DesignNode): boolean {
  switch (node.type) {
    case 'Button':
    case 'Input':
      return true;
    default:
      return node.name.toLowerCase().includes('button');
  }
}

function mostCommon(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: [number, number] | undefined;
  for (const entry of counts) {
    if (best === undefined || entry[1] > best[1]) best = [entry[0], entry[1]];
  }
  // Only treat it as the standard if it actually repeats.
  if (best === undefined || !(best[1] > 1)) return undefined;
  return best[0];
}

function measuredWidth(node: DesignNode): number {
  const text = node.text;
  if (text === undefined) return 0;
  // NSFont.systemFont(ofSize: node.style.fontSize ?? 16) — the regular weight.
  return getTextMeasurer().width(text, node.style.fontSize ?? 16, 'regular');
}

function measuredHeight(node: DesignNode, width: number): number {
  const text = node.text;
  if (text === undefined || !(width > 0)) return 0;
  return Math.ceil(getTextMeasurer().wrappedHeight(text, width, node.style.fontSize ?? 16, 'regular'));
}

function nearestBackground(child: DesignNode, screen: DesignNode): string | undefined {
  // A sibling behind this one wins; otherwise the screen's own fill.
  const behind = screen.children.find(
    (sibling) =>
      sibling.id !== child.id &&
      (sibling.zIndex ?? 0) <= (child.zIndex ?? 0) &&
      rectContainsRect(
        rect(sibling.x, sibling.y, sibling.width, sibling.height),
        rect(child.x, child.y, child.width, child.height),
      ),
  );
  return behind?.style.fill ?? screen.style.fill;
}

/** WCAG relative-luminance contrast ratio. */
export function contrastRatio(hexA: string, hexB: string): number | undefined {
  const a = relativeLuminance(hexA);
  const b = relativeLuminance(hexB);
  if (a === undefined || b === undefined) return undefined;
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(hex: string): number | undefined {
  let cleaned = trimWhitespacesAndNewlines(hex);
  if (cleaned.startsWith('#')) cleaned = cleaned.slice(1);
  if (cleaned.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(cleaned)) return undefined;
  const value = parseInt(cleaned, 16);
  const channels = [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255].map(
    (channel) => (channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4)),
  );
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

/** Swift `trimmingCharacters(in: .whitespacesAndNewlines)`. */
function trimWhitespacesAndNewlines(text: string): string {
  return text.replace(/^[\s   -   　]+/u, '')
    .replace(/[\s   -   　]+$/u, '');
}

/** Swift `String.count` — code points, not UTF-16 units. */
function charCount(text: string): number {
  let count = 0;
  for (const _ of text) count += 1;
  return count;
}

/** Swift `Double(_ text: String)` — the whole string must be a number. */
function swiftDoubleValue(text: string): number | undefined {
  if (text.length === 0) return undefined;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Static members of the Swift `DesignQualityAudit` enum. */
export const DesignQualityAudit = {
  audit,
  report,
  summary,
  contrastRatio,
} as const;
