import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import * as path from "path";

const buildForExtension = process.env.BUILD_FOR_EXTENSION === "1";

// https://vitejs.dev/config/
export default defineConfig({
  base: buildForExtension ? "/editor/" : "/",
  define: {
    "process.env.IS_PREACT": JSON.stringify("false"),
    "window.EXCALIDRAW_ASSET_PATH": buildForExtension ? JSON.stringify('/editor/') : JSON.stringify("/"),
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src")
    },
  },
  plugins: [react()],
});
