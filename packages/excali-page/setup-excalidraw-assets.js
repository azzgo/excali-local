import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// get root dir of project
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../");

// In version 0.18.0, assets are in prod and dev folders
const sourceAssetsPath = path.join(
  rootDir,
  "node_modules/@azzgo/excalidraw/dist/prod"
);
const destAssetsPath = path.resolve("public/excalidraw-assets");

const sourceAssetsDevPath = path.join(
  rootDir,
  "node_modules/@azzgo/excalidraw/dist/dev"
);
const destAssetsDevPath = path.resolve("public/excalidraw-assets-dev");

function copyOrLink(source, destination) {
  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  // Just copy instead of trying to symlink
  fs.cpSync(source, destination, { recursive: true });
}

// make sure public folder exists
if (!fs.existsSync("public")) {
  fs.mkdirSync("public");
}

copyOrLink(sourceAssetsPath, destAssetsPath);
copyOrLink(sourceAssetsDevPath, destAssetsDevPath);
