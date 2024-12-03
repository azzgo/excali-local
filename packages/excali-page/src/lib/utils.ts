import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getLang() {
  return navigator.language === 'zh-CN' ? 'zh-CN' : 'en'
}
