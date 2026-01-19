import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getBrowser(): typeof chrome | null {
  if (typeof (globalThis as any).browser !== "undefined") {
    return (globalThis as any).browser
  }
  if (globalThis.chrome && typeof chrome !== "undefined") {
    return chrome
  }
  return null
}

export function getLang() {
  if (globalThis.chrome && typeof chrome?.i18n?.getUILanguage === "function") {
    return chrome.i18n.getUILanguage() === "zh-CN" ? "zh-CN" : "en"
  }
  return navigator.language === "zh-CN" ? "zh-CN" : "en"
}

export interface FontConfig {
  handwriting: string | null
  normal: string | null
  code: string | null
}

export interface WithResolvers<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: any) => void
}

export function PromiseWithResolver<T = any>(): WithResolvers<T> {
  const withResolvers: Partial<WithResolvers<T>> = {
    promise: undefined,
    resolve: undefined,
    reject: undefined,
  }

  withResolvers.promise = new Promise<T>((resolve, reject) => {
    withResolvers.resolve = resolve
    withResolvers.reject = reject
  })

  return withResolvers as WithResolvers<T>
}

export async function getFontConfig(): Promise<FontConfig | null> {
  try {
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage || location.href.startsWith("http")) {
      return null
    }

    const config = await chrome.runtime.sendMessage({
      type: "GET_FONTS_SETTINGS"
    })

    if (!config) {
      return null
    }

    return config as FontConfig
  } catch {
    return null
  }
}

export interface ExcalidrawFontConfig {
  handDrawn?: Array<{ uri: string }>
  normal?: Array<{ uri: string }>
  code?: Array<{ uri: string }>
}

export function transformToInitFontConfig(config: FontConfig): ExcalidrawFontConfig {
  const result: ExcalidrawFontConfig = {}

  if (config.handwriting) {
    result.handDrawn = [{ uri: `local-font:${config.handwriting}` }]
  }

  if (config.normal) {
    result.normal = [{ uri: `local-font:${config.normal}` }]
  }

  if (config.code) {
    result.code = [{ uri: `local-font:${config.code}` }]
  }

  return result
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

    return transformToInitFontConfig(config)
  } catch {
    return null
  }
}
