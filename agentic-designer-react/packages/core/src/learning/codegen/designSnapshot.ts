// packages/core/src/learning/codegen/designSnapshot.ts
//
// Freezes student's personal design as a reference snapshot for Kotlin code generation.
// Ported from Section 8 of docs/hebrew-learning-agent-implementation-plan.he.md.

import type { DesignProject } from '../../models/DesignProject';
import type { DesignNode } from '../../models/DesignNode';
import type { ElementRole } from '../models';

export interface ScreenComponentSnapshot {
  id: string;
  type: string;
  name: string;
  role?: ElementRole;
  text?: string;
  isSecure?: boolean;
  iconName?: string;
  fontSize?: number;
  textColor?: string;
  fillColor?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  parentId?: string;
  cornerRadius?: number;
  stroke?: string;
  strokeWidth?: number;
  fontWeight?: string;
  textAlign?: string;
  fontFamily?: string;
}

export interface ScreenSnapshot {
  id: string;
  name: string;
  width: number;
  height: number;
  components: ScreenComponentSnapshot[];
  fillColor?: string;
}

export interface DesignSnapshot {
  version: string;
  timestamp: number;
  projectName: string;
  screens: ScreenSnapshot[];
}

export function createDesignSnapshot(
  project: DesignProject,
  roles: Record<string, ElementRole> = {},
): DesignSnapshot {
  const page = project.pages[0];
  const rootScreens = page?.nodes.filter((n) => n.type === 'Frame') ?? [];

  const screens: ScreenSnapshot[] = rootScreens.map((screen) => {
    const components: ScreenComponentSnapshot[] = [];

    function extract(nodes: DesignNode[], parentId = screen.id, offsetX = 0, offsetY = 0) {
      for (const node of nodes) {
        components.push({
          id: node.id,
          parentId,
          x: node.x + offsetX, y: node.y + offsetY, width: node.width, height: node.height,
          cornerRadius: node.style.cornerRadius, stroke: node.style.stroke, strokeWidth: node.style.strokeWidth,
          fontWeight: node.style.fontWeight, textAlign: node.style.textAlign, fontFamily: node.style.fontFamily,
          type: node.type,
          name: node.name,
          role: roles[node.id],
          text: node.text,
          isSecure: node.isSecure,
          iconName: node.iconName,
          fontSize: node.style.fontSize,
          textColor: node.style.textColor,
          fillColor: node.style.fill,
        });
        if (node.children && node.children.length > 0) {
          extract(node.children, node.id, node.x + offsetX, node.y + offsetY);
        }
      }
    }

    if (screen.children && screen.children.length > 0) {
      extract(screen.children);
    } else {
      // Find nodes within screen bounds
      const pageNodes = page?.nodes.filter(
        (n) =>
          n.id !== screen.id &&
          n.x >= screen.x &&
          n.x + n.width <= screen.x + screen.width + 40 &&
          n.y >= screen.y &&
          n.y + n.height <= screen.y + screen.height + 40,
      ) ?? [];
      extract(pageNodes, screen.id, -screen.x, -screen.y);
    }

    return {
      id: screen.id,
      name: screen.name,
      width: screen.width,
      height: screen.height,
      components,
      fillColor: screen.style.fill,
    };
  });

  return {
    version: '3.0.0',
    timestamp: Date.now(),
    projectName: project.name,
    screens,
  };
}

/** Recover metadata absent from old snapshots without replacing their frozen text/colors. */
export function enrichDesignSnapshot(snapshot: DesignSnapshot, project: DesignProject): DesignSnapshot {
  if (snapshot.version === '3.0.0') return snapshot;
  const current = createDesignSnapshot(project);
  return { ...snapshot, version: '3.0.0', screens: snapshot.screens.map(screen => {
    const live = current.screens.find(item => item.id === screen.id);
    return { ...screen, fillColor: screen.fillColor ?? live?.fillColor, components: screen.components.map(component => {
      const match = live?.components.find(item => item.id === component.id);
      return { ...match, ...component };
    }) };
  }) };
}
