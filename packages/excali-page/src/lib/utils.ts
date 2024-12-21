import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getLang() {
  if (chrome) {
    return chrome.i18n.getUILanguage() === 'zh-CN' ? 'zh-CN' : 'en'
  }
  return navigator.language === 'zh-CN' ? 'zh-CN' : 'en'
}
