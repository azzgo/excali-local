import { defineConfig } from "wxt";

// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: "chrome",
  manifest: {
    manifest_version: 3,
    name: "Excali Local",
    description: "__MSG_description__",
    version: "1.0.3",
    default_locale: 'en',
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
    commands: {
      "capture-visible-tab": {
        suggested_key: {
          default: "Alt+A",
        },
        description: "Capture visible tab",
      },
      "capture-select-area": {
        suggested_key: {
          default: "Alt+S",
        },
        description: "Capture select area",
      },
    },
    permissions: ['activeTab', 'scripting'],
  },
  modules: ["@wxt-dev/module-react"],
});

