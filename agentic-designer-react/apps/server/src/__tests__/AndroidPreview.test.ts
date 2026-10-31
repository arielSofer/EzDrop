import { describe, expect, it } from 'vitest';
import { pngDataUrl } from '../services/AndroidPreview';
describe('Android preview binary transport', () => {
  it('preserves PNG bytes rather than decoding them as UTF-8', () => {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
    const result = pngDataUrl(bytes);
    expect(result.startsWith('data:image/png;base64,')).toBe(true);
    expect(Buffer.from(result.split(',')[1], 'base64')).toEqual(bytes);
  });
  it('rejects adb text errors instead of displaying a broken image as a preview', () => {
    expect(() => pngDataUrl(Buffer.from('error: device offline'))).toThrow('PNG');
  });
});
