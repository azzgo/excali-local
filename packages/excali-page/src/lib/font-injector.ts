/**
 * Font Injector Module
 * 
 * This module handles custom font injection for Excalidraw by:
 * 1. Fetching font configuration from the Chrome extension background script
 * 2. Patching the window.FontFace constructor to intercept font loading
 * 3. Replacing Excalidraw font URLs with local() references to system fonts
 * 
 * The CSS @font-face approach alone is insufficient because Excalidraw uses
 * the JavaScript FontFace API to load fonts dynamically. We need to intercept
 * the FontFace constructor and replace the font source URLs.
 * 
 * Requirements: 1.1, 2.1, 2.2, 3.1, 3.2, 3.3, 5.5
 */

/**
 * Font configuration interface matching the storage format
 */
export interface FontConfig {
  handwriting: string | null;  // PostScript name for Virgil replacement
  normal: string | null;        // PostScript name for Helvetica replacement
  code: string | null;          // PostScript name for Cascadia replacement
}

/**
 * Mapping of Excalidraw font families to configuration keys
 */
const FONT_FAMILY_MAP: Record<string, keyof FontConfig> = {
  'Virgil': 'handwriting',
  'Xiaolai': 'handwriting',  // Xiaolai is also a handwriting font
  'Helvetica': 'normal',
  'Cascadia': 'code',
  'Excalifont': 'normal',  // Excalifont can use normal font
};

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
 * Generate CSS @font-face rules from font configuration
 * 
 * Maps Excalidraw font families to user's system fonts:
 * - Virgil (handwriting) -> config.handwriting
 * - Helvetica (normal) -> config.normal
 * - Cascadia (code) -> config.code
 * 
 * @param config - Font configuration with PostScript names
 * @returns CSS string with @font-face rules
 */
export function generateFontCSS(config: FontConfig): string {
  let css = '';

  // Generate @font-face for Virgil (handwriting font)
  if (config.handwriting) {
    css += `
      @font-face {
        font-family: "Virgil";
        src: local("${config.handwriting}");
        font-display: swap;
      }
    `;
  }

  // Generate @font-face for Helvetica (normal font)
  if (config.normal) {
    css += `
      @font-face {
        font-family: "Helvetica";
        src: local("${config.normal}");
        font-display: swap;
      }
    `;
  }

  // Generate @font-face for Cascadia (code font)
  if (config.code) {
    css += `
      @font-face {
        font-family: "Cascadia";
        src: local("${config.code}");
        font-display: swap;
      }
    `;
  }

  return css;
}

/**
 * Inject CSS into the document head
 * 
 * Creates a <style> element and appends it to document.head.
 * This must be called before Excalidraw initializes to ensure
 * the CSS rules are available when Excalidraw tries to use fonts.
 * 
 * @param css - CSS string to inject
 */
export function injectFontCSS(css: string): void {
  if (!css || css.trim().length === 0) {
    console.log('[Font Injector] No CSS to inject');
    return;
  }

  try {
    const style = document.createElement('style');
    style.textContent = css;
    style.setAttribute('data-font-injector', 'true');
    document.head.appendChild(style);
    
    console.log('[Font Injector] CSS injected successfully');
  } catch (error) {
    console.error('[Font Injector] Failed to inject CSS:', error);
    throw error;
  }
}

/**
 * Patch the window.FontFace constructor to intercept font loading
 * 
 * This function replaces the native FontFace constructor with a wrapper
 * that checks if the font family matches a configured custom font.
 * If so, it replaces the font source with a local() reference.
 * 
 * @param config - Font configuration with PostScript names
 */
function patchFontFace(config: FontConfig): void {
  const OriginalFontFace = window.FontFace;
  
  if (!OriginalFontFace) {
    console.warn('[Font Injector] FontFace API not available');
    return;
  }

  // Store the original constructor
  const originalConstructor = OriginalFontFace;

  // Create a wrapper constructor
  window.FontFace = function(
    family: string,
    source: string | ArrayBuffer,
    descriptors?: FontFaceDescriptors
  ) {
    // Check if this font family should be replaced
    const configKey = FONT_FAMILY_MAP[family];
    const replacementFont = configKey ? config[configKey] : null;

    if (replacementFont && typeof source === 'string') {
      // Replace the source with local() reference
      const localSource = `local("${replacementFont}")`;
      console.log(`[Font Injector] Replacing ${family} font source with ${localSource}`);
      return new originalConstructor(family, localSource, descriptors);
    }

    // Otherwise, use the original source
    return new originalConstructor(family, source, descriptors);
  } as any;

  // Copy static properties
  Object.setPrototypeOf(window.FontFace, originalConstructor);
  window.FontFace.prototype = originalConstructor.prototype;

  console.log('[Font Injector] FontFace constructor patched');
}

/**
 * Main function to inject custom fonts
 * 
 * Orchestrates the entire font injection process:
 * 1. Fetches font configuration from background script
 * 2. Patches the FontFace constructor to intercept font loading
 * 3. Injects CSS @font-face rules as a fallback
 * 
 * This function should be called before Excalidraw initializes
 * to ensure fonts are available when needed.
 * 
 * @returns Promise that resolves when injection is complete
 */
export async function injectCustomFonts(): Promise<void> {
  try {
    console.log('[Font Injector] Starting font injection process');

    // Step 1: Get font configuration
    const config = await getFontConfig();
    
    if (!config) {
      console.log('[Font Injector] No configuration available, using default fonts');
      return;
    }

    // Check if any fonts are configured
    const hasAnyFont = config.handwriting || config.normal || config.code;
    if (!hasAnyFont) {
      console.log('[Font Injector] No fonts configured, using default fonts');
      return;
    }

    // Step 2: Patch FontFace constructor (primary method)
    patchFontFace(config);

    // Step 3: Inject CSS as fallback
    const css = generateFontCSS(config);
    if (css && css.trim().length > 0) {
      console.log('[Font Injector] Generated CSS:', css);
      injectFontCSS(css);
    }

    console.log('[Font Injector] Font injection completed successfully');
  } catch (error) {
    console.error('[Font Injector] Font injection failed:', error);
    // Don't throw - allow Excalidraw to initialize with default fonts
  }
}
