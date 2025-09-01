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

const rewriteFont = (fontFamily: string, fontUrl: string) => {
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

export const replaceAllFonts = async () => {
  return getBrowser()
    ?.runtime?.sendMessage({ type: "GET_FONTS_SETTINGS" })
    .then((fonts) => {
      if (!fonts) {
        return;
      }
      Object.keys(fonts).forEach((font) => {
        if (fonts[font]) {
          switch (font) {
            case "handwriting":
              rewriteFont("Virgil", fonts[font]);
              break;
            case "normal":
              rewriteFont("Helvetica", fonts[font]);
              break;
            case "code":
              rewriteFont("Cascadia", fonts[font]);
              break;
          }
        }
      });
    });
};
