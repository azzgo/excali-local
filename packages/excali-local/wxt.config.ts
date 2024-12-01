import { defineConfig } from "wxt";
import * as path from "path";

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: "chrome",
  manifest: {
    manifest_version: 3,
    name: "Excali Local",
    version: "1.0.2",
    background: {
      service_worker: "src/background.ts",
      type: "module",
    },
    action: {
      default_title: "Excali",
      default_popup: "index.html",
    },
    icons: {
      "16": "excali@16px.png",
      "48": "excali.png",
      "128": "excali@128px.png",
    },
    permissions: ['activeTab'],
  },
  modules: ["@wxt-dev/module-react"],
  alias: {
    "@": path.resolve(__dirname, "entrypoints"),
  },
});
