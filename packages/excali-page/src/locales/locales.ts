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
        },
      },
      "zh-CN": {
        translation: {
          "Exit Presentation": "退出演示",
          "Enter Presentation": "进入演示",
          "Edit Slides": "编辑幻灯片",
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
