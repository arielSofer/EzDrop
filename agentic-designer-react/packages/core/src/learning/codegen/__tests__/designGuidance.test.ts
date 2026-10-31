import { expect, it } from 'vitest';
import { getDesignGuidance, kotlinColor } from '../designGuidance';
import { enrichDesignSnapshot, type ScreenSnapshot } from '../designSnapshot';
import { makeDesignProject, makeDesignPage } from '../../../models/DesignProject';
import { makeDesignNode, makeNodeStyle } from '../../../models/DesignNode';
const screen: ScreenSnapshot = { id: 'login', name: 'Login', width: 390, height: 844, fillColor: '#101626', components: [
 { id: 'title', parentId: 'login', type: 'Text', name: 'Brand', text: 'PACEGUARD $5', x: 24, y: 60, width: 342, height: 24, fontSize: 18, textColor: '#c9ff36', textAlign: 'center' },
 { id: 'input', parentId: 'login', type: 'Input', name: 'Password', text: 'Password', isSecure: true, x: 24, y: 100, width: 342, height: 56, fillColor: '#202637', textColor: '#ffffff', stroke: '#515661', cornerRadius: 10 },
 { id: 'button', parentId: 'login', type: 'Button', name: 'Login', text: 'Log in', x: 24, y: 180, width: 342, height: 48, fillColor: '#c9ff36', textColor: '#111111', cornerRadius: 8 },
] };
it('teaches the actual colors, typography, spacing, input and button shape', () => {
 expect(getDesignGuidance(screen, 1).drills[0].code).toContain('Color(0xFF101626)');
 expect(getDesignGuidance(screen, 2).drills[0].code).toContain('18.sp');
 expect(getDesignGuidance(screen, 2).drills[0].code).toContain('PACEGUARD \\$5');
 expect(getDesignGuidance(screen, 3).drills[0].code).toContain('PasswordVisualTransformation()');
 expect(getDesignGuidance(screen, 4).drills[0].code).toContain('containerColor = Color(0xFFc9ff36)');
 expect(getDesignGuidance(screen, 4).drills[0].explanation).toContain('24.dp');
 expect(getDesignGuidance(screen, 5).drills).toHaveLength(3);
 expect(kotlinColor('#1234abcd')).toBe('Color(0xcd1234ab)');
});
it('fills missing legacy metadata without replacing frozen text or source code', () => {
 const project = makeDesignProject({ pages: [makeDesignPage({ nodes: [makeDesignNode({ id: 'login', type: 'Frame', width: 390, height: 844, style: makeNodeStyle({ fill: '#101626', opacity: 1, cornerRadius: 0 }), children: [makeDesignNode({ id: 'title', type: 'Text', name: 'Brand', x: 24, y: 60, width: 342, height: 24, text: 'changed', style: makeNodeStyle({ fill: '#ffffff', opacity: 1, cornerRadius: 0 }) })] })] })] });
 const enriched = enrichDesignSnapshot({ version: '1.0.0', timestamp: 1, projectName: 'Test', screens: [{ ...screen, components: [{ id: 'title', name: 'Brand', type: 'Text', text: 'original' }] }] }, project);
 expect(enriched.screens[0].components[0].text).toBe('original');
 expect(enriched.screens[0].components[0].x).toBe(24);
 expect(enriched.timestamp).toBe(1);
});
export { screen as guidanceTestScreen };
