// Canvas half of the AgentGameKit port: draws an SKNode tree (SpriteKitCompat)
// through a camera onto a 2D context, the way SKView renders an SKScene with
// `scaleMode = .aspectFill`.
//
// SCENE→CANVAS (see SpriteKitCompat's coordinate note for the full picture):
//   scale   = max(canvasWidth / sceneWidth, canvasHeight / sceneHeight) / camera.xScale
//   canvasX = (sceneX - camera.x) * scale + canvasWidth / 2
//   canvasY = canvasHeight / 2 - (sceneY - camera.y) * scale
// The context transform carries that flip, so paths and rects are drawn in
// scene coordinates directly; images and text undo the flip locally (a nested
// scale(1, -1)) so they never render upside down, and rotation is applied as
// the node's zRotation, which the flip turns back into SpriteKit's
// counter-clockwise-positive sense.

import type { Point, Size } from '@agentic/core';
import {
  SKCameraNode,
  SKEmitterNode,
  SKLabelNode,
  SKLightNode,
  SKNode,
  SKShapeNode,
  SKSpriteNode,
  SKColors,
  cssColor,
  withAlphaComponent,
  type SKColor,
  type SKTexture,
} from './SpriteKitCompat';

export interface CameraTransform {
  scale: number;
  originX: number;
  originY: number;
}

export function cameraTransform(
  canvas: Size,
  sceneSize: Size,
  camera: { position: Point; xScale: number } | undefined,
): CameraTransform {
  const base = Math.max(canvas.width / Math.max(sceneSize.width, 1), canvas.height / Math.max(sceneSize.height, 1));
  const scale = base / Math.max(camera?.xScale ?? 1, 0.01);
  const cam = camera?.position ?? { x: sceneSize.width / 2, y: sceneSize.height / 2 };
  return {
    scale,
    originX: canvas.width / 2 - cam.x * scale,
    originY: canvas.height / 2 + cam.y * scale,
  };
}

export function sceneToCanvas(p: Point, t: CameraTransform): Point {
  return { x: p.x * t.scale + t.originX, y: t.originY - p.y * t.scale };
}

export function canvasToScene(p: Point, t: CameraTransform): Point {
  return { x: (p.x - t.originX) / t.scale, y: (t.originY - p.y) / t.scale };
}

/** Initials badge for an SF-symbol reference, matching SFSymbol's fallback. */
function symbolInitials(name: string): string {
  const parts = name.split('.').filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0] ?? '').join('');
  return (letters || '?').toUpperCase();
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function ellipsePath(ctx: CanvasRenderingContext2D, size: Size): void {
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.abs(size.width) / 2, Math.abs(size.height) / 2, 0, 0, Math.PI * 2);
  ctx.closePath();
}

interface DrawContext {
  ctx: CanvasRenderingContext2D;
  transform: CameraTransform;
  /** Multiplied into every node's own alpha, like SpriteKit's inherited alpha. */
  alpha: number;
}

export class GameRenderer {
  constructor(private readonly loadTextureImage: (texture: SKTexture) => CanvasImageSource | null = (t) => t.image) {}

  /**
   * Renders the scene: background, world children through the camera, then the
   * camera's own children (HUD/overlay) in screen space.
   */
  render(options: {
    ctx: CanvasRenderingContext2D;
    canvasSize: Size;
    sceneSize: Size;
    backgroundColor: SKColor;
    root: SKNode;
    camera: SKCameraNode | undefined;
    light: SKLightNode | undefined;
  }): void {
    const { ctx, canvasSize, sceneSize, backgroundColor, root, camera, light } = options;
    const transform = cameraTransform(canvasSize, sceneSize, camera);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
    ctx.fillStyle = cssColor(backgroundColor);
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
    ctx.restore();

    // World pass.
    ctx.save();
    ctx.setTransform(transform.scale, 0, 0, -transform.scale, transform.originX, transform.originY);
    const world = root.children.filter((child) => !(child instanceof SKCameraNode));
    for (const child of sortedByZ(world)) this.drawNode(child, { ctx, transform, alpha: 1 });
    ctx.restore();

    // Lighting pass (ambient darkening + a radial pool at the light).
    if (light !== undefined) this.drawLight(ctx, canvasSize, transform, light);

    // UI pass — the camera's children are screen-space, centered on the canvas.
    if (camera !== undefined) {
      const base = Math.max(
        canvasSize.width / Math.max(sceneSize.width, 1),
        canvasSize.height / Math.max(sceneSize.height, 1),
      );
      ctx.save();
      ctx.setTransform(base, 0, 0, -base, canvasSize.width / 2, canvasSize.height / 2);
      const uiTransform: CameraTransform = {
        scale: base,
        originX: canvasSize.width / 2,
        originY: canvasSize.height / 2,
      };
      for (const child of sortedByZ(camera.children)) {
        this.drawNode(child, { ctx, transform: uiTransform, alpha: 1 });
      }
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawLight(ctx: CanvasRenderingContext2D, canvasSize: Size, transform: CameraTransform, light: SKLightNode): void {
    const centre = sceneToCanvas(light.position, transform);
    const radius = Math.max(canvasSize.width, canvasSize.height) / Math.max(light.falloff, 0.2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = cssColor(withAlphaComponent(SKColors.black, 1 - light.ambientColor.r));
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
    const gradient = ctx.createRadialGradient(centre.x, centre.y, 0, centre.x, centre.y, Math.max(radius, 1));
    gradient.addColorStop(0, cssColor(withAlphaComponent(light.lightColor, 0.75)));
    gradient.addColorStop(1, cssColor(withAlphaComponent(light.lightColor, 0)));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  private drawNode(node: SKNode, dc: DrawContext): void {
    if (node.isHidden || node.alpha <= 0) return;
    const { ctx } = dc;
    const alpha = dc.alpha * node.alpha;

    ctx.save();
    ctx.translate(node.position.x, node.position.y);
    if (node.zRotation !== 0) ctx.rotate(node.zRotation);
    if (node.xScale !== 1 || node.yScale !== 1) ctx.scale(node.xScale, node.yScale);
    if (node.blendMode === 'add') ctx.globalCompositeOperation = 'lighter';

    if (node instanceof SKSpriteNode) this.drawSprite(node, ctx, alpha, dc.transform);
    else if (node instanceof SKShapeNode) this.drawShape(node, ctx, alpha);
    else if (node instanceof SKLabelNode) this.drawLabel(node, ctx, alpha);
    else if (node instanceof SKEmitterNode) this.drawEmitter(node, ctx, alpha);

    const clip = node instanceof SKSpriteNode && node.cropsChildren;
    if (clip && node instanceof SKSpriteNode) {
      ctx.beginPath();
      ctx.rect(-node.size.width / 2, -node.size.height / 2, node.size.width, node.size.height);
      ctx.clip();
    }
    for (const child of sortedByZ(node.children)) {
      this.drawNode(child, { ctx, transform: dc.transform, alpha });
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  private drawSprite(node: SKSpriteNode, ctx: CanvasRenderingContext2D, alpha: number, transform: CameraTransform): void {
    const w = node.size.width, h = node.size.height;
    const ax = (0.5 - node.anchorPoint.x) * w;
    const ay = (0.5 - node.anchorPoint.y) * h;
    const left = -w / 2 + ax, bottom = -h / 2 + ay;

    if (node.gradient !== undefined && node.gradient.colors.length > 0) {
      this.drawGradientSprite(node, ctx, alpha, left, bottom, w, h, transform);
      return;
    }

    const image = node.texture === undefined ? null : this.loadTextureImage(node.texture);
    if (image !== null && image !== undefined) {
      ctx.save();
      ctx.globalAlpha = alpha;
      // Undo the world flip so the bitmap is not drawn upside down.
      ctx.scale(1, -1);
      ctx.drawImage(image, left, -bottom - h, w, h);
      ctx.restore();
      if (node.colorBlendFactor > 0 && node.color.a > 0) {
        ctx.save();
        ctx.globalAlpha = alpha * node.colorBlendFactor;
        ctx.fillStyle = cssColor(node.color);
        ctx.fillRect(left, bottom, w, h);
        ctx.restore();
      }
      return;
    }

    if (node.texture?.isSymbolPlaceholder === true) {
      this.drawSymbolPlaceholder(node.texture.symbolName ?? '?', ctx, alpha, left, bottom, w, h);
      return;
    }

    if (node.color.a <= 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = cssColor(node.color);
    if (node.drawsAsEllipse) {
      ctx.beginPath();
      ctx.ellipse(left + w / 2, bottom + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (node.cornerRadius > 0) {
      roundedRectPath(ctx, left, bottom, w, h, node.cornerRadius);
      ctx.fill();
    } else {
      ctx.fillRect(left, bottom, w, h);
    }
    ctx.restore();
  }

  private drawGradientSprite(
    node: SKSpriteNode, ctx: CanvasRenderingContext2D, alpha: number,
    left: number, bottom: number, w: number, h: number, _transform: CameraTransform,
  ): void {
    const spec = node.gradient;
    if (spec === undefined) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (spec.kind === 'linear') {
      // Top color first: the Swift draws from y = height down to y = 0.
      const gradient = ctx.createLinearGradient(0, bottom + h, 0, bottom);
      spec.colors.forEach((color, index) => {
        gradient.addColorStop(index / Math.max(spec.colors.length - 1, 1), cssColor(color));
      });
      ctx.fillStyle = gradient;
      ctx.fillRect(left, bottom, w, h);
    } else {
      const radius = Math.max(Math.abs(w), Math.abs(h)) * 0.72;
      const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(radius, 1));
      const locations = spec.locations ?? spec.colors.map((_, i) => i / Math.max(spec.colors.length - 1, 1));
      spec.colors.forEach((color, index) => {
        gradient.addColorStop(Math.max(0, Math.min(1, locations[index] ?? 1)), cssColor(color));
      });
      ctx.fillStyle = gradient;
      ctx.fillRect(left, bottom, w, h);
    }
    ctx.restore();
  }

  private drawSymbolPlaceholder(
    name: string, ctx: CanvasRenderingContext2D, alpha: number,
    left: number, bottom: number, w: number, h: number,
  ): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    roundedRectPath(ctx, left, bottom, w, h, Math.min(w, h) * 0.22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.04);
    ctx.stroke();
    ctx.scale(1, -1);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = `600 ${Math.max(8, Math.min(w, h) * 0.42)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbolInitials(name), left + w / 2, -(bottom + h / 2));
    ctx.restore();
  }

  private drawShape(node: SKShapeNode, ctx: CanvasRenderingContext2D, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    switch (node.shape.kind) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(node.shape.radius, 0.1), 0, Math.PI * 2);
        ctx.closePath();
        break;
      case 'ellipse':
        ellipsePath(ctx, node.shape.size);
        break;
      case 'rect':
        roundedRectPath(ctx, -node.shape.size.width / 2, -node.shape.size.height / 2,
          node.shape.size.width, node.shape.size.height, node.shape.cornerRadius);
        break;
      case 'path': {
        ctx.beginPath();
        node.shape.points.forEach((p, index) => {
          if (index === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        if (node.shape.closed) ctx.closePath();
        break;
      }
      default:
        break;
    }
    if (node.fillColor.a > 0) {
      ctx.fillStyle = cssColor(node.fillColor);
      ctx.fill();
    }
    if (node.strokeColor.a > 0 && node.lineWidth > 0) {
      ctx.strokeStyle = cssColor(node.strokeColor);
      ctx.lineWidth = node.lineWidth;
      ctx.lineCap = node.lineCap;
      ctx.lineJoin = node.lineJoin;
      if (node.glowWidth > 0) {
        // SKShapeNode.glowWidth — a soft halo of the same stroke.
        ctx.save();
        ctx.globalAlpha = alpha * 0.35;
        ctx.lineWidth = node.lineWidth + node.glowWidth * 2;
        ctx.stroke();
        ctx.restore();
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawLabel(node: SKLabelNode, ctx: CanvasRenderingContext2D, alpha: number): void {
    if (node.text.length === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.scale(1, -1);
    const bold = node.fontName.toLowerCase().includes('bold') ? 'bold ' : '';
    const family = node.fontName.split('-')[0] ?? 'Menlo';
    ctx.font = `${bold}${node.fontSize}px ${family}, Menlo, ui-monospace, monospace`;
    ctx.fillStyle = cssColor(node.fontColor);
    ctx.textAlign = node.horizontalAlignmentMode;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(node.text, 0, 0);
    ctx.restore();
  }

  private drawEmitter(node: SKEmitterNode, ctx: CanvasRenderingContext2D, alpha: number): void {
    const worldSpace = node.targetNode !== undefined;
    ctx.save();
    if (worldSpace) {
      // Particles were spawned in scene coordinates; undo the emitter's local
      // transform so they stay put while the emitter moves (SKEmitterNode's
      // `targetNode` behaviour).
      ctx.translate(-node.position.x, -node.position.y);
    }
    for (const p of node.particles) {
      const life = p.lifetime <= 0 ? 1 : p.age / p.lifetime;
      const a = Math.max(0, Math.min(1, p.alpha)) * alpha * (1 - Math.max(0, life - 0.85) / 0.15);
      if (a <= 0) continue;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(p.x, p.y);
      if (p.rotation !== 0) ctx.rotate(p.rotation);
      ctx.fillStyle = cssColor(p.color);
      const w = node.particleSize.width * p.scale;
      const h = node.particleSize.height * p.scale;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    ctx.restore();
  }
}

/** SpriteKit draws siblings in zPosition order (ties keep insertion order). */
function sortedByZ(nodes: SKNode[]): SKNode[] {
  return [...nodes]
    .map((node, index) => ({ node, index }))
    .sort((a, b) => (a.node.zPosition - b.node.zPosition) || (a.index - b.index))
    .map((entry) => entry.node);
}
