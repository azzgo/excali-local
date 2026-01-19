/**
 * Unit tests for font-injector module
 * 
 * Tests the font injection functionality including:
 * - CSS generation from font configuration
 * - CSS injection into document head
 * - Error handling and edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateFontCSS,
  injectFontCSS,
  getFontConfig,
  injectCustomFonts,
  type FontConfig,
} from '../../src/lib/font-injector';

describe.skip('generateFontCSS', () => {
  it('should generate CSS for all three fonts when configured', () => {
    const config: FontConfig = {
      handwriting: 'SourceHanSerifCN-Bold',
      normal: 'PingFangSC-Regular',
      code: 'FiraCode-Regular',
    };

    const css = generateFontCSS(config);

    expect(css).toContain('font-family: "Virgil"');
    expect(css).toContain('src: local("SourceHanSerifCN-Bold")');
    expect(css).toContain('font-family: "Helvetica"');
    expect(css).toContain('src: local("PingFangSC-Regular")');
    expect(css).toContain('font-family: "Cascadia"');
    expect(css).toContain('src: local("FiraCode-Regular")');
    expect(css).toContain('font-display: swap');
  });

  it('should generate CSS only for configured fonts', () => {
    const config: FontConfig = {
      handwriting: 'SourceHanSerifCN-Bold',
      normal: null,
      code: null,
    };

    const css = generateFontCSS(config);

    expect(css).toContain('font-family: "Virgil"');
    expect(css).toContain('src: local("SourceHanSerifCN-Bold")');
    expect(css).not.toContain('Helvetica');
    expect(css).not.toContain('Cascadia');
  });

  it('should return empty string when no fonts are configured', () => {
    const config: FontConfig = {
      handwriting: null,
      normal: null,
      code: null,
    };

    const css = generateFontCSS(config);

    expect(css).toBe('');
  });

  it('should handle partial configuration', () => {
    const config: FontConfig = {
      handwriting: null,
      normal: 'Arial',
      code: 'Courier',
    };

    const css = generateFontCSS(config);

    expect(css).not.toContain('Virgil');
    expect(css).toContain('font-family: "Helvetica"');
    expect(css).toContain('src: local("Arial")');
    expect(css).toContain('font-family: "Cascadia"');
    expect(css).toContain('src: local("Courier")');
  });
});

describe.skip('injectFontCSS', () => {
  beforeEach(() => {
    // Clean up any existing style elements
    document.querySelectorAll('style[data-font-injector]').forEach(el => el.remove());
  });

  afterEach(() => {
    // Clean up after tests
    document.querySelectorAll('style[data-font-injector]').forEach(el => el.remove());
  });

  it('should inject CSS into document head', () => {
    const css = '@font-face { font-family: "Test"; }';
    
    injectFontCSS(css);

    const styleElement = document.querySelector('style[data-font-injector]');
    expect(styleElement).not.toBeNull();
    expect(styleElement?.textContent).toBe(css);
  });

  it('should not inject empty CSS', () => {
    const initialStyleCount = document.querySelectorAll('style[data-font-injector]').length;
    
    injectFontCSS('');

    const finalStyleCount = document.querySelectorAll('style[data-font-injector]').length;
    expect(finalStyleCount).toBe(initialStyleCount);
  });

  it('should not inject whitespace-only CSS', () => {
    const initialStyleCount = document.querySelectorAll('style[data-font-injector]').length;
    
    injectFontCSS('   \n  \t  ');

    const finalStyleCount = document.querySelectorAll('style[data-font-injector]').length;
    expect(finalStyleCount).toBe(initialStyleCount);
  });

  it('should add data-font-injector attribute to style element', () => {
    const css = '@font-face { font-family: "Test"; }';
    
    injectFontCSS(css);

    const styleElement = document.querySelector('style[data-font-injector]');
    expect(styleElement?.getAttribute('data-font-injector')).toBe('true');
  });
});

describe.skip('getFontConfig', () => {
  beforeEach(() => {
    // Reset chrome mock
    vi.stubGlobal('chrome', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should return null when chrome runtime is not available', async () => {
    const config = await getFontConfig();
    expect(config).toBeNull();
  });

  it('should return null when sendMessage is not available', async () => {
    vi.stubGlobal('chrome', { runtime: {} });
    
    const config = await getFontConfig();
    expect(config).toBeNull();
  });

  it('should return font config when available', async () => {
    const mockConfig: FontConfig = {
      handwriting: 'TestFont1',
      normal: 'TestFont2',
      code: 'TestFont3',
    };

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(mockConfig),
      },
    });

    const config = await getFontConfig();
    expect(config).toEqual(mockConfig);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_FONTS_SETTINGS' });
  });

  it('should return null when sendMessage returns null', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(null),
      },
    });

    const config = await getFontConfig();
    expect(config).toBeNull();
  });

  it('should handle sendMessage errors gracefully', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockRejectedValue(new Error('[test] Connection failed')),
      },
    });

    const config = await getFontConfig();
    expect(config).toBeNull();
  });
});

describe.skip('injectCustomFonts', () => {
  beforeEach(() => {
    // Clean up any existing style elements
    document.querySelectorAll('style[data-font-injector]').forEach(el => el.remove());
    vi.stubGlobal('chrome', undefined);
  });

  afterEach(() => {
    document.querySelectorAll('style[data-font-injector]').forEach(el => el.remove());
    vi.unstubAllGlobals();
  });

  it('should complete without error when chrome runtime is not available', async () => {
    await expect(injectCustomFonts()).resolves.toBeUndefined();
    
    const styleElement = document.querySelector('style[data-font-injector]');
    expect(styleElement).toBeNull();
  });

  it('should inject fonts when configuration is available', async () => {
    const mockConfig: FontConfig = {
      handwriting: 'TestFont1',
      normal: 'TestFont2',
      code: 'TestFont3',
    };

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(mockConfig),
      },
    });

    await injectCustomFonts();

    const styleElement = document.querySelector('style[data-font-injector]');
    expect(styleElement).not.toBeNull();
    expect(styleElement?.textContent).toContain('Virgil');
    expect(styleElement?.textContent).toContain('TestFont1');
    expect(styleElement?.textContent).toContain('Helvetica');
    expect(styleElement?.textContent).toContain('TestFont2');
    expect(styleElement?.textContent).toContain('Cascadia');
    expect(styleElement?.textContent).toContain('TestFont3');
  });

  it('should not inject CSS when all fonts are null', async () => {
    const mockConfig: FontConfig = {
      handwriting: null,
      normal: null,
      code: null,
    };

    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(mockConfig),
      },
    });

    await injectCustomFonts();

    const styleElement = document.querySelector('style[data-font-injector]');
    expect(styleElement).toBeNull();
  });

  it('should handle errors gracefully without throwing', async () => {
    vi.stubGlobal('chrome', {
      runtime: {
        sendMessage: vi.fn().mockRejectedValue(new Error('[test] Test error')),
      },
    });

    await expect(injectCustomFonts()).resolves.toBeUndefined();
  });
});
