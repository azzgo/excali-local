import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import {
  getFontConfig as getFontConfigFromDB,
  saveFontConfig,
  updateFontSlot,
  clearFontSlot,
} from "./db"
export { getFontConfigFromDB as getFontConfig, saveFontConfig, updateFontSlot, clearFontSlot }

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

export type FontSource =
  | { type: 'system'; postscriptName: string }
  | { type: 'custom'; family: string; data: Uint8Array }

export interface FontConfig {
  handwriting: FontSource | null
  normal: FontSource | null
  code: FontSource | null
}

export interface FontConfigRecord {
  key: 'font-config'
  handwriting: FontSource | null
  normal: FontSource | null
  code: FontSource | null
}

export interface ExcalidrawFontConfig {
  handDrawn?: Array<{ uri: string, buffer?: ArrayBuffer }>
  normal?: Array<{ uri: string, buffer?: ArrayBuffer }>
  code?: Array<{ uri: string, buffer?: ArrayBuffer }>
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

export function getFileNameWithoutExtension(fileName: string) {
  const parts = fileName.split('.');
  if (parts.length > 1 && parts[0] !== '') {
    parts.pop(); // Remove the last element (the extension)
    return parts.join('.');
  }
  return fileName;
}
