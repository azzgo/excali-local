import type { FontConfig, ExcalidrawFontConfig } from "excali-shared"
import { getFontConfig as getFontConfigFromDB } from "excali-shared"

export type { FontConfig, ExcalidrawFontConfig }

export async function getFontConfig(): Promise<FontConfig | null> {
  return getFontConfigFromDB()
}

export async function injectCustomFonts(): Promise<ExcalidrawFontConfig | null> {
  try {
    const config = await getFontConfig()

    if (!config) {
      return null
    }

    const hasAnyFont = config.handwriting || config.normal || config.code
    if (!hasAnyFont) {
      return null
    }

    const fontConfig: ExcalidrawFontConfig = {}

    if (config.handwriting) {
      if (config.handwriting.type === 'system') {
        fontConfig.handDrawn = [{ uri: `local-font:${config.handwriting.postscriptName}` }]
      } else {
        fontConfig.handDrawn = [{ uri: '',  buffer: config.handwriting.data.buffer as ArrayBuffer }];
      }
    }

    if (config.normal) {
      if (config.normal.type === 'system') {
        fontConfig.normal = [{ uri: `local-font:${config.normal.postscriptName}` }]
      } else {
        fontConfig.normal = [{ uri: '',  buffer: config.normal.data.buffer as ArrayBuffer }];
      }
    }

    if (config.code) {
      if (config.code.type === 'system') {
        fontConfig.code = [{ uri: `local-font:${config.code.postscriptName}` }]
      } else {
        fontConfig.code = [{ uri: '',  buffer: config.code.data.buffer as ArrayBuffer }];
      }
    }
    return fontConfig
  } catch {
    console.error("[font-injector] Failed to inject custom fonts")
    return null
  }
}

