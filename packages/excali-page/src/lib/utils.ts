import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
export function getBrowser(): typeof chrome | null {
  if (typeof (globalThis as any).browser !== "undefined") {
    return (globalThis as any).browser;
  }
  if (globalThis.chrome && typeof chrome !== "undefined") {
    return chrome;
  }
  return null;
}

export function getLang() {
  if (globalThis.chrome && typeof chrome?.i18n?.getUILanguage === "function") {
    return chrome.i18n.getUILanguage() === "zh-CN" ? "zh-CN" : "en";
  }
  return navigator.language === "zh-CN" ? "zh-CN" : "en";
}

