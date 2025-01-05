import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getLang() {
  if (typeof chrome?.i18n?.getUILanguage === "function") {
    return chrome.i18n.getUILanguage() === "zh-CN" ? "zh-CN" : "en";
  }
  return navigator.language === "zh-CN" ? "zh-CN" : "en";
}

export const rewriteFont = (fontFamily: string, fontUrl: string) => {
  const style = document.createElement("style");
  style.innerHTML = `
  @font-face {
    font-family: "${fontFamily}";
    src: local("${fontUrl}");
    font-display: swap;
  }
  `;
  document.head.appendChild(style.cloneNode(true));
  parent.document.head.appendChild(style.cloneNode(true));
};
