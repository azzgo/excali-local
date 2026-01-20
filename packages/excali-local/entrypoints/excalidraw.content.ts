const EXCALIDRAW_TYPE = "excalidraw";
const SUPPORT_EXCALIDRAW_VERSION = 2;
const OPEN_EDITOR_MSG = "OPEN_QUICK_EDITOR_WITH_JSON";
const MATCH_PATTERNS = ["*://*/*.excalidraw", "file:///*.excalidraw"];

interface ExcalidrawFile {
  type: string;
  version: number;
  [key: string]: unknown;
}

const isValidExcalidrawFile = (json: any): json is ExcalidrawFile => {
  return (
    typeof json === "object" &&
    json !== null &&
    json.type === EXCALIDRAW_TYPE &&
    typeof json.version === "number" &&
    json.version === SUPPORT_EXCALIDRAW_VERSION
  );
};

export default defineContentScript({
  matches: MATCH_PATTERNS,
  runAt: "document_idle",
  main() {
    let json: unknown;
    try {
      json = JSON.parse(document.body.innerText);
    } catch (e) {
      console.error("[Excalidraw] parse JSON failed:", e);
      return;
    }
    if (isValidExcalidrawFile(json)) {
      const btn = document.createElement("button");
      btn.innerText = "Open with Excali Local";
      btn.style.position = "fixed";
      btn.style.bottom = "32px";
      btn.style.right = "32px";
      document.body.appendChild(btn);

      btn.addEventListener("click", () => {
        browser.runtime.sendMessage({
          type: OPEN_EDITOR_MSG,
          json,
        });
      });
    } else {
      console.warn("[Excalidraw] Illegal Excalidraw file structure");
    }
  },
});
