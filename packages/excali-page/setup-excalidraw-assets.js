import fs from "fs";
import path from "path";

// get root dir of project
const rootDir = path.resolve(__dirname, "../../");

const sourceAssetsPath = path.join(
  rootDir,
  "node_modules/@excalidraw/excalidraw/dist/excalidraw-assets"
);
const destAssetsPath = path.resolve("public/excalidraw-assets");

const sourceAssetsDevPath = path.join(
  rootDir,
  "node_modules/@excalidraw/excalidraw/dist/excalidraw-assets-dev"
);
const destAssetsDevPath = path.resolve("public/excalidraw-assets-dev");

function copyOrLink(source, destination) {
  if (fs.existsSync(destination)) {
    fs.rmSync(destination, { recursive: true, force: true });
  }
  try {
    fs.symlinkSync(source, destination, "junction");
  } catch {
    fs.cpSync(source, destination, { recursive: true });
  }
}

// make sure public folder exists
if (!fs.existsSync("public")) {
  fs.mkdirSync("public");
}

copyOrLink(sourceAssetsPath, destAssetsPath);
copyOrLink(sourceAssetsDevPath, destAssetsDevPath);
