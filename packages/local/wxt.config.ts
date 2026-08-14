import { defineConfig, type ConfigEnv, type UserManifest } from "wxt";

import packageJson from "./package.json";

function genManifest(env: ConfigEnv) {
  const manifest: UserManifest = {
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
    permissions: ["activeTab", "scripting", "storage"],
    optional_host_permissions: ["file:///*.excalidraw"],
    // WebMCP origin trial (Wayfinder 043/044): paste the Chrome Origin Trials
    // token here before a release targeting Chrome 157+ (dev builds use the
    // --enable-webmcp-testing flag instead; Firefox ignores trial_tokens).
    trial_tokens: [],
  };

  if (env.browser === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: "ison@excali-local.top",
        strict_min_version: "128.0",
        data_collection_permissions: {
          required: ["none"],
          optional: [],
        },
      },
    };
  }
  return manifest;
}

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: genManifest,
  modules: ["@wxt-dev/module-react"],
});
