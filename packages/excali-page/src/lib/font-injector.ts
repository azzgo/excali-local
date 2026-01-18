import type { FontConfig as ExcalidrawFontConfig } from "@excalidraw/excalidraw/dist/types/excalidraw/fonts/Fonts";

/**
 * Font configuration interface matching the storage format
 */
export interface FontConfig {
  handwriting: string | null;  // PostScript name for Virgil replacement
  normal: string | null;        // PostScript name for Helvetica replacement
  code: string | null;          // PostScript name for Cascadia replacement
}

/**
 * Get font configuration from the Chrome extension background script
 *
 * @returns Promise resolving to FontConfig or null if unavailable
 */
export async function getFontConfig(): Promise<FontConfig | null> {
  try {
    // Check if chrome.runtime is available (extension context)
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage || location.href.startsWith('http')) {
      console.warn('[Font Injector] Chrome runtime not available, skipping font injection');
      return null;
    }

    // Request font settings from background script
    const config = await chrome.runtime.sendMessage({
      type: 'GET_FONTS_SETTINGS'
    });

    if (!config) {
      console.log('[Font Injector] No font configuration found');
      return null;
    }

    console.log('[Font Injector] Font configuration retrieved:', config);
    return config as FontConfig;
  } catch (error) {
    console.error('[Font Injector] Failed to get font configuration:', error);
    return null;
  }
}

/**
 * Transform FontConfig to the format expected by Excalidraw's initFontConfig
 *
 * @param config - Font configuration with PostScript names
 * @returns FontConfig object for initFontConfig, with null values for missing fonts
 */
export function transformToInitFontConfig(config: FontConfig): ExcalidrawFontConfig {
  const result: ExcalidrawFontConfig = {};

  if (config.handwriting) {
    result.handDrawn = [{ uri: `local-font:${config.handwriting}` }];
  }

  if (config.normal) {
    result.normal = [{ uri: `local-font:${config.normal}` }];
  }

  if (config.code) {
    result.code = [{ uri: `local-font:${config.code}` }];
  }

  return result;
}

export async function injectCustomFonts(): Promise<ExcalidrawFontConfig | null> {
  try {
    console.log('[Font Injector] Starting font injection process');

    // Step 1: Get font configuration
    const config = await getFontConfig();

    if (!config) {
      console.log('[Font Injector] No configuration available, using default fonts');
      return null;
    }

    // Check if any fonts are configured
    const hasAnyFont = config.handwriting || config.normal || config.code;
    if (!hasAnyFont) {
      console.log('[Font Injector] No fonts configured, using default fonts');
      return null;
    }

    console.log('[Font Injector] Font injection completed successfully');
    return transformToInitFontConfig(config);
  } catch (error) {
    console.error('[Font Injector] Font injection failed:', error);
    // Don't throw - allow Excalidraw to initialize with default fonts
    return null;
  }
}
