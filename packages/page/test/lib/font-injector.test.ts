/**
 * Unit tests for font-injector module
 *
 * Tests the font injection functionality including:
 * - Font configuration retrieval from IndexedDB
 * - System font handling via local-font: URI
 * - Custom font handling with ArrayBuffer
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  injectCustomFonts,
  getFontConfig,
  type FontConfig,
} from '../../src/lib/font-injector';

describe('injectCustomFonts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return null when no font configuration exists', async () => {
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(null);

    const result = await injectCustomFonts();
    expect(result).toBeNull();
  });

  it('should return null when all font slots are null', async () => {
    const mockConfig: FontConfig = {
      handwriting: null,
      normal: null,
      code: null,
    };
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(mockConfig);

    const result = await injectCustomFonts();
    expect(result).toBeNull();
  });

  it('should handle system fonts correctly', async () => {
    const mockConfig: FontConfig = {
      handwriting: { type: 'system', postscriptName: 'SourceHanSerifCN-Bold' },
      normal: { type: 'system', postscriptName: 'PingFangSC-Regular' },
      code: { type: 'system', postscriptName: 'FiraCode-Regular' },
    };
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(mockConfig);

    const result = await injectCustomFonts();

    expect(result).toEqual({
      handDrawn: [{ uri: 'local-font:SourceHanSerifCN-Bold' }],
      normal: [{ uri: 'local-font:PingFangSC-Regular' }],
      code: [{ uri: 'local-font:FiraCode-Regular' }],
    });
  });

  it('should handle mixed system and custom fonts', async () => {
    const fontData = new Uint8Array([0, 1, 2, 3]);
    const mockConfig: FontConfig = {
      handwriting: { type: 'system', postscriptName: 'SourceHanSerifCN-Bold' },
      normal: { type: 'custom', family: 'TestCustomFont', data: fontData },
      code: null,
    };
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(mockConfig);

    const result = await injectCustomFonts();

    expect(result).toEqual({
      handDrawn: [{ uri: 'local-font:SourceHanSerifCN-Bold' }],
      normal: [{ uri: '', buffer: fontData.buffer }],
    });
  });

  it('should handle errors gracefully without throwing', async () => {
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockRejectedValue(new Error('DB error'));

    const result = await injectCustomFonts();
    expect(result).toBeNull();
  });
});

describe('getFontConfig', () => {
  it('should return font configuration from IndexedDB', async () => {
    const mockConfig: FontConfig = {
      handwriting: { type: 'system', postscriptName: 'TestFont1' },
      normal: { type: 'system', postscriptName: 'TestFont2' },
      code: { type: 'system', postscriptName: 'TestFont3' },
    };
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(mockConfig);

    const result = await getFontConfig();
    expect(result).toEqual(mockConfig);
  });

  it('should return null when no config exists', async () => {
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(null);

    const result = await getFontConfig();
    expect(result).toBeNull();
  });
});

describe('injectCustomFonts with custom fonts', () => {
  it('should handle custom fonts with ArrayBuffer', async () => {
    const fontData = new Uint8Array([0, 1, 2, 3, 4, 5]);
    const mockConfig: FontConfig = {
      handwriting: null,
      normal: { type: 'custom', family: 'CustomFont', data: fontData },
      code: null,
    };
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(mockConfig);

    const result = await injectCustomFonts();

    expect(result).toEqual({
      normal: [{ uri: '', buffer: fontData.buffer }],
    });
  });

  it('should handle all three custom fonts with buffers', async () => {
    const handwritingData = new Uint8Array([1, 2, 3]);
    const normalData = new Uint8Array([4, 5, 6]);
    const codeData = new Uint8Array([7, 8, 9]);
    const mockConfig: FontConfig = {
      handwriting: { type: 'custom', family: 'HandwritingFont', data: handwritingData },
      normal: { type: 'custom', family: 'NormalFont', data: normalData },
      code: { type: 'custom', family: 'CodeFont', data: codeData },
    };
    vi.spyOn(await import('excali-shared'), 'getFontConfig').mockResolvedValue(mockConfig);

    const result = await injectCustomFonts();

    expect(result).toEqual({
      handDrawn: [{ uri: '', buffer: handwritingData.buffer }],
      normal: [{ uri: '', buffer: normalData.buffer }],
      code: [{ uri: '', buffer: codeData.buffer }],
    });
  });
});
