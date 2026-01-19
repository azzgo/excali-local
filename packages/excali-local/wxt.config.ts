import { ConfigEnv, UserManifest, defineConfig } from "wxt";

import packageJson from "./package.json";

function genManifest(env: ConfigEnv) {
  const manifest: UserManifest = {
    manifest_version: 3,
    name: "Excali Local",
    description: "__MSG_description__",
    version: packageJson.version,
    default_locale: "en",
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
      "open-local-editor": {
        suggested_key: {
          default: "Alt+L",
        },
        description: "Open local editor",
      },
      "open-quick-editor": {
        suggested_key: {
          default: "Alt+Q",
        },
        description: "Open quick editor",
      },
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
    permissions: ["activeTab", "scripting"],
  };

  if (env.browser === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: "ison@excali-local.top",
        strict_min_version: "102.0",
      },
    };
  }
  return manifest;
}
// See https://wxt.dev/api/config.html
export default defineConfig({
  extensionApi: "chrome",
  manifest: genManifest,
  modules: ["@wxt-dev/module-react"],
});
