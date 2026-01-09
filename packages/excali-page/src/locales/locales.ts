import { getLang } from "@/lib/utils";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export function initI18n() {
  i18n.use(initReactI18next).init({
    resources: {
      en: {
        translation: {
          "Exit Presentation": "Exit Presentation",
          "Enter Presentation": "Enter Presentation",
          "Edit Slides": "Edit Slides",
          "Marker": "Marker",
          "Gallery": "Gallery",
          "marker": "marker",
          "Quick Marker": "Quick Marker",
        },
      },
      "zh-CN": {
        translation: {
          "Exit Presentation": "退出演示",
          "Enter Presentation": "进入演示",
          "Edit Slides": "编辑幻灯片",
          "Marker": "标记工具",
          "Gallery": "画廊",
          "marker": "标记",
          "Quick Marker": "快速标记",
        },
      },
    },
    lng: getLang(),
    fallbackLng: "en",

    interpolation: {
      escapeValue: false, // react already safes from xss => https://www.i18next.com/translation-function/interpolation#unescape
    },
  });
}
