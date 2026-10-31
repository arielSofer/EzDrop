// Ported 1:1 from AgenticDesigner/ViewModels/ProjectViewModel.swift —
// "MARK: - Macro Component Factories" (`extension ProjectViewModel`):
// the presentation-shot and onboarding-screen macros and their sub-node builders.

import { makeDesignNode, makeNodeStyle, newUUID, type DesignAction, type DesignNode } from '@agentic/core';

export function makeSkipText(): DesignNode {
  return makeDesignNode({
    id: newUUID(),
    type: 'Text',
    name: 'Skip',
    x: 320,
    y: 36,
    width: 48,
    height: 24,
    text: 'Skip',
    style: makeNodeStyle({
      fill: '#8A8A8A',
      cornerRadius: 0,
      opacity: 1.0,
      fontSize: 14,
      fontWeight: 'regular',
      textColor: '#8A8A8A',
    }),
    children: [],
  });
}

export function makeOnboardingTitle(title: string): DesignNode {
  return makeDesignNode({
    id: newUUID(),
    type: 'Text',
    name: 'Title',
    x: 48,
    y: 120,
    width: 300,
    height: 60,
    text: title,
    style: makeNodeStyle({
      fill: '#111111',
      cornerRadius: 0,
      opacity: 1.0,
      fontSize: 42,
      fontWeight: 'bold',
      textColor: '#111111',
    }),
    children: [],
  });
}

export function makeIllustrationPlaceholder(name: string): DesignNode {
  return makeDesignNode({
    id: newUUID(),
    type: 'Rectangle',
    name: `Illustration - ${name}`,
    x: 95,
    y: 270,
    width: 200,
    height: 200,
    style: makeNodeStyle({ fill: '#FFF3E8', stroke: '#111111', cornerRadius: 100, opacity: 1.0 }),
    children: [],
  });
}

export function makeDescriptionText(description: string): DesignNode {
  return makeDesignNode({
    id: newUUID(),
    type: 'Text',
    name: 'Description',
    x: 56,
    y: 540,
    width: 278,
    height: 72,
    text: description,
    style: makeNodeStyle({
      fill: '#222222',
      cornerRadius: 0,
      opacity: 1.0,
      fontSize: 16,
      fontWeight: 'regular',
      textColor: '#222222',
    }),
    children: [],
  });
}

export function makePrimaryCTA(text: string): DesignNode {
  return makeDesignNode({
    id: newUUID(),
    type: 'Button',
    name: 'Primary CTA',
    x: 48,
    y: 660,
    width: 294,
    height: 52,
    text,
    style: makeNodeStyle({
      fill: '#111111',
      cornerRadius: 26,
      opacity: 1.0,
      fontSize: 16,
      fontWeight: 'semibold',
      textColor: '#FFFFFF',
    }),
    children: [],
  });
}

export function makeSecondaryCTA(text: string): DesignNode {
  return makeDesignNode({
    id: newUUID(),
    type: 'Button',
    name: 'Secondary CTA',
    x: 48,
    y: 724,
    width: 294,
    height: 52,
    text,
    style: makeNodeStyle({
      fill: '#FFFFFF',
      stroke: '#E5E0DA',
      cornerRadius: 26,
      opacity: 1.0,
      fontSize: 16,
      fontWeight: 'semibold',
      textColor: '#111111',
    }),
    children: [],
  });
}

/** NOTE (faithful to Swift): `height` is ignored — the curve is always 1pt tall. */
export function makeDecorativeCurve(
  name: string,
  x: number,
  y: number,
  width: number,
  _height: number,
): DesignNode {
  return makeDesignNode({
    id: newUUID(),
    type: 'Rectangle',
    name,
    x,
    y,
    width,
    height: 1,
    style: makeNodeStyle({ fill: '#E8E3DD', cornerRadius: 0, opacity: 0.6 }),
    children: [],
  });
}

/** `applyCreateOnboardingScreen(_:parentId:)` — builds the node; insertion is the caller's. */
export function buildOnboardingScreen(action: DesignAction): DesignNode {
  const frameId = newUUID();

  return makeDesignNode({
    id: frameId,
    type: 'Frame',
    name: action.title ?? 'Onboarding Screen',
    x: action.x ?? 120,
    y: action.y ?? 120,
    width: 390,
    height: 844,
    style: makeNodeStyle({ fill: '#FFFFFF', cornerRadius: 36, opacity: 1.0 }),
    children: [
      makeSkipText(),
      makeDecorativeCurve('Curve 1', 0, 60, 390, 180),
      makeOnboardingTitle(action.title ?? 'Risk Ready'),
      makeIllustrationPlaceholder(action.imageName ?? 'Line Art'),
      makeDescriptionText(action.descriptionText ?? 'Describe the value clearly and simply.'),
      makePrimaryCTA(action.primaryCTA ?? 'Log In'),
      makeSecondaryCTA(action.secondaryCTA ?? 'Sign Up'),
    ],
  });
}

/** `applyCreatePresentationShot(_:parentId:)` — builds the node; insertion is the caller's. */
export function buildPresentationShot(action: DesignAction): DesignNode {
  const frameId = newUUID();
  const width = action.width ?? 1200;
  const height = action.height ?? 700;
  const rawScreenCount = action.props?.['screenCount'];
  const parsedScreenCount = rawScreenCount !== undefined ? Number.parseInt(rawScreenCount, 10) : 3;
  const screenCount = Number.isFinite(parsedScreenCount) ? parsedScreenCount : 3;
  const clampedScreenCount = Math.min(Math.max(screenCount, 2), 3);
  const background = action.props?.['background'] ?? action.fill ?? '#294D2A';
  const phoneWidth = clampedScreenCount === 3 ? 260 : 300;
  const phoneHeight = clampedScreenCount === 3 ? 560 : 620;
  const gap = (width - clampedScreenCount * phoneWidth) / (clampedScreenCount + 1);

  const phones: DesignNode[] = [];
  for (let index = 0; index < clampedScreenCount; index += 1) {
    const yOffset = index === 1 && clampedScreenCount === 3 ? 40 : 80;
    phones.push(
      makeDesignNode({
        id: newUUID(),
        type: 'Frame',
        name: `Phone Screen ${index + 1}`,
        x: gap + index * (phoneWidth + gap),
        y: yOffset,
        width: phoneWidth,
        height: phoneHeight,
        style: makeNodeStyle({
          fill: '#F9FAF6',
          stroke: '#FFFFFF',
          cornerRadius: 36,
          opacity: 1.0,
          shadow: { color: '#000000', opacity: 0.24, radius: 34, x: 0, y: 24 },
        }),
        children: [],
      }),
    );
  }

  return makeDesignNode({
    id: frameId,
    type: 'Frame',
    name: action.name ?? 'Presentation Shot',
    x: action.x ?? 80,
    y: action.y ?? 80,
    width,
    height,
    style: makeNodeStyle({
      fill: background,
      cornerRadius: action.cornerRadius ?? 40,
      opacity: action.opacity ?? 1.0,
      shadow: action.shadow ?? { color: '#000000', opacity: 0.16, radius: 28, x: 0, y: 16 },
      ...(action.overlayColor !== undefined ? { overlayColor: action.overlayColor } : {}),
      ...(action.overlayOpacity !== undefined ? { overlayOpacity: action.overlayOpacity } : {}),
    }),
    children: phones,
  });
}
