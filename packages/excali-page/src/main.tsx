import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import Editor from "./features/editor/components/editor";
import { Toaster } from "sonner";
import { Provider } from "jotai";
import { initI18n } from "./locales/locales";
import { rewriteFont } from "./lib/utils";
initI18n();

// rewriteFont('Virgil', 'XiaolaiSC');

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider>
      <Editor />
      <Toaster />
    </Provider>
  </React.StrictMode>
);
