// apps/web/src/views/sidebar/CanvasStudioPanel.tsx
//
// 1:1 port of Views/CanvasStudioPanel.swift (CanvasStudioAssetsPanel).
// Assets, Artboards presets, Creation shortcuts, AI image generation,
// and transparent game sprite studio.

import React, { useState, useRef } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { SFSymbol } from '../../components/SFSymbol';
import { bridge } from '../../bridge/bridgeClient';

export function CanvasStudioPanel() {
  const addArtboard = useProjectStore((s) => s.addArtboard);
  const addMizmorLetodahArtboard = useProjectStore((s) => s.addMizmorLetodahArtboard);
  const addMizmorShapeArtboard = useProjectStore((s) => s.addMizmorShapeArtboard);
  const addStudioText = useProjectStore((s) => s.addStudioText);
  const addFrameNode = useProjectStore((s) => s.addFrameNode);
  const addStudioShape = useProjectStore((s) => s.addStudioShape);
  const addIconNode = useProjectStore((s) => s.addIconNode);
  const addImageNodeWithSource = useProjectStore((s) => s.addImageNodeWithSource);

  const [customWidth, setCustomWidth] = useState(1080);
  const [customHeight, setCustomHeight] = useState(1080);
  const [aiPrompt, setAiPrompt] = useState('editorial product photo, clean studio lighting');
  const [isGeneratingAIImage, setIsGeneratingAIImage] = useState(false);
  const [aiImageError, setAiImageError] = useState<string | null>(null);

  // Sprite Studio
  const [spritePrompt, setSpritePrompt] = useState('glowing power-up orb, clean game sprite, side view');
  const [spriteFrames, setSpriteFrames] = useState(1);
  const [spriteFacing, setSpriteFacing] = useState<'left' | 'right'>('right');
  const [isGeneratingSprite, setIsGeneratingSprite] = useState(false);
  const [spriteError, setSpriteError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleChooseImage = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        addImageNodeWithSource(dataUrl, file.name);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleGenerateAIImage = async () => {
    if (!aiPrompt.trim() || isGeneratingAIImage) return;
    setIsGeneratingAIImage(true);
    setAiImageError(null);
    try {
      const res = (await bridge.call('image.generate', { prompt: aiPrompt.trim() })) as { imageURL?: string } | undefined;
      if (res?.imageURL) {
        addImageNodeWithSource(res.imageURL, 'AI Image');
      } else {
        // Fallback: create an image node with a stylized gradient placeholder
        addImageNodeWithSource(undefined, 'AI Generated Image');
      }
    } catch (err) {
      setAiImageError((err as Error).message || 'Generation failed');
      // Still provide a node so workflow is not interrupted
      addImageNodeWithSource(undefined, 'AI Generated Image');
    } finally {
      setIsGeneratingAIImage(false);
    }
  };

  const handleGenerateSprite = async () => {
    if (!spritePrompt.trim() || isGeneratingSprite) return;
    setIsGeneratingSprite(true);
    setSpriteError(null);
    try {
      const fullPrompt = `${spritePrompt.trim()}, 2D pixel art game sprite, facing ${spriteFacing}, transparent background, isolated`;
      const res = (await bridge.call('image.generate', { prompt: fullPrompt })) as { imageURL?: string } | undefined;
      if (res?.imageURL) {
        addImageNodeWithSource(res.imageURL, `Sprite (${spriteFacing})`);
      } else {
        addImageNodeWithSource(undefined, 'Sprite Asset');
      }
    } catch (err) {
      setSpriteError((err as Error).message || 'Sprite generation failed');
      addImageNodeWithSource(undefined, 'Sprite Asset');
    } finally {
      setIsGeneratingSprite(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 240,
        height: '100%',
        backgroundColor: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-subtle)',
        userSelect: 'none',
        overflowY: 'auto',
      }}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* Header */}
      <div
        style={{
          padding: '16px 16px 10px',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          Studio
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '14px 12px' }}>
        {/* Artboards Section */}
        <section style={sectionBoxStyle}>
          <div style={sectionTitleStyle}>Artboards</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={inputWithPrefixStyle}>
              <span style={inputPrefixStyle}>W</span>
              <input
                type="number"
                value={customWidth}
                onChange={(e) => setCustomWidth(Math.max(1, Number(e.target.value)))}
                style={numberInputStyle}
              />
            </div>
            <div style={inputWithPrefixStyle}>
              <span style={inputPrefixStyle}>H</span>
              <input
                type="number"
                value={customHeight}
                onChange={(e) => setCustomHeight(Math.max(1, Number(e.target.value)))}
                style={numberInputStyle}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => addArtboard('Custom Artboard', customWidth, customHeight)}
            style={actionButtonStyle}
          >
            <SFSymbol name="plus.rectangle" size={13} />
            <span>Create Custom</span>
          </button>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 6,
              marginTop: 10,
            }}
          >
            <ArtboardTile
              title="Post"
              icon="square"
              subtitle="1080"
              onClick={() => addArtboard('Social Post', 1080, 1080)}
            />
            <ArtboardTile
              title="Story"
              icon="rectangle.portrait"
              subtitle="1080x1920"
              onClick={() => addArtboard('Story', 1080, 1920)}
            />
            <ArtboardTile
              title="Banner"
              icon="rectangle"
              subtitle="1600x900"
              onClick={() => addArtboard('Banner', 1600, 900)}
            />
            <ArtboardTile
              title="A4"
              icon="doc"
              subtitle="Print"
              onClick={() => addArtboard('A4 Print', 794, 1123)}
            />
            <ArtboardTile
              title="Mizmor"
              icon="text.book.closed"
              subtitle="100x180cm"
              onClick={() => addMizmorLetodahArtboard()}
            />
            <ArtboardTile
              title="Mizmor Shape"
              icon="album"
              subtitle="100x180cm"
              onClick={() => addMizmorShapeArtboard()}
            />
          </div>
        </section>

        {/* Create Elements Section */}
        <section style={sectionBoxStyle}>
          <div style={sectionTitleStyle}>Create</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginBottom: 6 }}>
            <CreateElementButton label="Text" icon="textformat" onClick={addStudioText} />
            <CreateElementButton label="Photo" icon="photo" onClick={handleChooseImage} />
            <CreateElementButton label="Frame" icon="rectangle.on.rectangle" onClick={addFrameNode} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <CreateElementButton
              label="Rect"
              icon="rectangle"
              onClick={() => addStudioShape('Rectangle', '#D1D5DB', 0)}
            />
            <CreateElementButton
              label="Round"
              icon="square.roundedbottom"
              onClick={() => addStudioShape('Rounded Shape', '#111827', 28)}
            />
            <CreateElementButton label="Icon" icon="sparkles" onClick={addIconNode} />
          </div>
        </section>

        {/* AI Image Generation Section */}
        <section style={sectionBoxStyle}>
          <div style={sectionTitleStyle}>AI Image</div>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={3}
            placeholder="Image prompt..."
            style={textAreaStyle}
          />
          {aiImageError && (
            <div style={{ fontSize: 10, color: 'var(--accent-danger)', marginTop: 4 }}>
              {aiImageError}
            </div>
          )}
          <button
            type="button"
            onClick={handleGenerateAIImage}
            disabled={isGeneratingAIImage}
            style={{
              ...actionButtonStyle,
              marginTop: 8,
              backgroundColor: 'var(--accent-primary)',
              color: '#FFFFFF',
              border: 'none',
              opacity: isGeneratingAIImage ? 0.7 : 1,
            }}
          >
            <SFSymbol name="sparkles" size={13} />
            <span>{isGeneratingAIImage ? 'Generating...' : 'Generate Art'}</span>
          </button>
        </section>

        {/* Sprite Studio Section */}
        <section style={sectionBoxStyle}>
          <div style={sectionTitleStyle}>Sprite Studio</div>
          <textarea
            value={spritePrompt}
            onChange={(e) => setSpritePrompt(e.target.value)}
            rows={2}
            placeholder="Game sprite prompt..."
            style={textAreaStyle}
          />

          <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Facing:</span>
            <button
              type="button"
              onClick={() => setSpriteFacing('left')}
              style={pillToggleStyle(spriteFacing === 'left')}
            >
              Left
            </button>
            <button
              type="button"
              onClick={() => setSpriteFacing('right')}
              style={pillToggleStyle(spriteFacing === 'right')}
            >
              Right
            </button>
          </div>

          {spriteError && (
            <div style={{ fontSize: 10, color: 'var(--accent-danger)', marginTop: 4 }}>
              {spriteError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGenerateSprite}
            disabled={isGeneratingSprite}
            style={{
              ...actionButtonStyle,
              marginTop: 8,
              backgroundColor: 'rgba(79, 70, 229, 0.2)',
              color: 'var(--accent-primary)',
              border: '1px solid rgba(79, 70, 229, 0.4)',
              opacity: isGeneratingSprite ? 0.7 : 1,
            }}
          >
            <SFSymbol name="gamecontroller.fill" size={13} />
            <span>{isGeneratingSprite ? 'Generating Sprite...' : 'Create Sprite'}</span>
          </button>
        </section>
      </div>
    </div>
  );
}

function ArtboardTile({
  title,
  icon,
  subtitle,
  onClick,
}: {
  title: string;
  icon: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px 6px',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        cursor: 'pointer',
        gap: 4,
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)';
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
        e.currentTarget.style.borderColor = 'var(--border-subtle)';
      }}
    >
      <SFSymbol name={icon} size={18} color="var(--accent-primary)" />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
      <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{subtitle}</span>
    </button>
  );
}

function CreateElementButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 4px',
        backgroundColor: 'rgba(255, 255, 255, 0.03)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        cursor: 'pointer',
        gap: 4,
        transition: 'all 0.15s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.07)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.03)';
      }}
    >
      <SFSymbol name={icon} size={15} color="var(--text-secondary)" />
      <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{label}</span>
    </button>
  );
}

const sectionBoxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  letterSpacing: 0.5,
  marginBottom: 8,
};

const inputWithPrefixStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flex: 1,
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '0 6px',
};

const inputPrefixStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginRight: 4,
};

const numberInputStyle: React.CSSProperties = {
  width: '100%',
  border: 'none',
  outline: 'none',
  backgroundColor: 'transparent',
  color: 'var(--text-primary)',
  fontSize: 11,
  padding: '6px 0',
};

const textAreaStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  backgroundColor: 'rgba(0, 0, 0, 0.3)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '6px 8px',
  color: 'var(--text-primary)',
  fontSize: 11,
  outline: 'none',
  resize: 'vertical',
  fontFamily: 'inherit',
};

const actionButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  width: '100%',
  padding: '7px 10px',
  borderRadius: 6,
  backgroundColor: 'rgba(255, 255, 255, 0.05)',
  border: '1px solid var(--border-subtle)',
  color: 'var(--text-primary)',
  fontSize: 11,
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'all 0.15s ease',
};

function pillToggleStyle(active: boolean): React.CSSProperties {
  return {
    padding: '3px 8px',
    borderRadius: 4,
    fontSize: 10,
    fontWeight: active ? 600 : 400,
    color: active ? 'var(--accent-primary)' : 'var(--text-muted)',
    backgroundColor: active ? 'rgba(79, 70, 229, 0.15)' : 'transparent',
    border: active ? '1px solid rgba(79, 70, 229, 0.4)' : '1px solid var(--border-subtle)',
    cursor: 'pointer',
  };
}

export default CanvasStudioPanel;
