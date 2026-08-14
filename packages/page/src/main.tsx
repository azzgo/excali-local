import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import Editor from "./features/editor/components/editor";
import { Toaster } from "sonner";
import { Provider } from "jotai";
import { initI18n } from "./locales/locales";
import { injectCustomFonts } from "./lib/font-injector";
import { initFontConfig } from "@excalidraw/excalidraw";

(globalThis as any).EXCALIDRAW_ASSET_PATH = (process.env.EXCALIDRAW_ASSET_PATH) || '';

initI18n();

// Inject custom fonts before Excalidraw initializes
// This ensures CSS @font-face rules are available when Excalidraw tries to use fonts
// Requirements: 1.1, 2.1, 4.1
injectCustomFonts().then((config) => {
  if (config) {
    initFontConfig({ ...config });
  }

  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <Provider>
        <Editor />
        <Toaster />
      </Provider>
    </React.StrictMode>,
  );
});
