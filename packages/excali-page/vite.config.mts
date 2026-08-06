/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";

const buildForExtension = process.env.BUILD_FOR_EXTENSION === "1";
const currentDir = path.dirname(fileURLToPath(import.meta.url));

// https://vitejs.dev/config/
export default defineConfig({
  base: buildForExtension ? "/editor/" : "/",
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
    // remove some code to fit <https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code> requirements
    "window.DISABLE_EMBEDDED": JSON.stringify("true"),
    "window.DISABLE_FONT_CDN": JSON.stringify("true"),
    "process.env.EXCALIDRAW_ASSET_PATH": buildForExtension
      ? JSON.stringify("/editor/")
      : JSON.stringify("/"),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(currentDir, "src"),
    },
  },
  plugins: [react(), tailwindcss()],
  test: {
    environment: "happy-dom",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    setupFiles: ["./test/setup.ts"],
    // The patched tgz + roughjs use extensionless imports; vitest externalizes
    // node_modules by default (strict ESM resolution fails). Inline them so
    // Vite's resolver handles them — required for canvas/v1 real-helpers tests.
    server: {
      deps: { inline: [/@excalidraw\/excalidraw/, /roughjs/] },
    },
    onConsoleLog: (log) => {
      return !(log.includes("[test]") || log.includes("[font-injector]"));
    },
    coverage: {
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.d.ts",
        "src/lib/utils.ts",
        "src/locales/**/*",
        "src/features/editor/lib/*.ts",
        "src/features/editor/type.ts",
        "src/features/editor/utils/images.ts",
        "src/features/editor/utils/indexdb.ts",
      ],
    },
  },
});
