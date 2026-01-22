import { t } from "./lib/utils";

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
      let start = document.body.innerText.indexOf("{");
      let end = document.body.innerText.lastIndexOf("}");
      if (start > -1 && end > -1) {
        json = JSON.parse(document.body.innerText.slice(start, end + 1));
      }
    } catch (e) {
      console.error("[Excalidraw] parse JSON failed:", e);
      return;
    }
    if (isValidExcalidrawFile(json)) {
      const btn = document.createElement("button");
      btn.innerText = t("OpenWithExcaliLocal");
      Object.assign(btn.style, {
        position: "fixed",
        bottom: "32px",
        right: "32px",
        zIndex: "9999",
        padding: "10px 24px",
        backgroundColor: "#2563EB",
        color: "#ffffff",
        borderRadius: "8px",
        border: "none",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        fontWeight: "500",
        fontSize: "14px",
        cursor: "pointer",
        boxShadow:
          "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
        transition: "all 0.2s ease",
      });

      btn.onmouseenter = () => {
        btn.style.backgroundColor = "#1D4ED8";
        btn.style.boxShadow =
          "0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)";
        btn.style.transform = "translateY(-1px)";
      };

      btn.onmouseleave = () => {
        btn.style.backgroundColor = "#2563EB";
        btn.style.boxShadow =
          "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)";
        btn.style.transform = "translateY(0)";
      };
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
