import { PromiseWithResolver, type WithResolvers } from "./lib/utils";
import {
	AB_READY,
	AB_STATE,
	AB_ACTIVATE,
	AB_DEACTIVATE,
	AB_DISPLACED,
	AB_HEARTBEAT,
  AGENT_BRIDGE_STORAGE_KEY,
  AGENT_BRIDGE_DEFAULT_STORAGE,
  type AgentBridgeStorage,
  type AgentBridgeStatePayload,
} from "excali-shared";

const openLocalEditor = () => {
  browser.tabs.create({ url: "editor/index.html?type=local" });
};

let ready: WithResolvers<void>;

type Area = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const openEditorWithImageUrl = (imageUrl: string, area?: Area) => {
  openQuickEditor().then((tab) => {
    ready = PromiseWithResolver();
    ready.promise.then(() => {
      browser.tabs.sendMessage(tab.id!, {
        type: "UPDATE_CANVAS_WITH_SCREENSHOT",
        dataUrl: imageUrl,
        area,
      });
    });
  });
};

const openQuickEditorWithJSON = (message: any) => {
  const { json } = message;
  openQuickEditor().then((tab) => {
    ready = PromiseWithResolver();
    ready.promise.then(() => {
      browser.tabs.sendMessage(tab.id!, {
        type: "UPDATE_CANVAS_WITH_JSON",
        json,
      });
    });
  });
};

const openQuickEditor = () => {
  return browser.tabs.create({ url: "editor/index.html?type=quick" });
};

const captureVisibleTab = () => {
  browser.tabs.captureVisibleTab((dataUrl) => {
    openEditorWithImageUrl(dataUrl);
  });
};

const captureSelectArea = (message: any) => {
  const { area } = message;
  browser.tabs
    .captureVisibleTab()
    .then((dataUrl) => openEditorWithImageUrl(dataUrl, area));
};

function runAreaCaptureScript(tabId: number) {
  return browser.scripting.executeScript({
    target: { tabId },
    files: ["/crop.js"],
  });
}

// =============================================================================
// Agent Bridge — control plane (Wayfinder Tickets 003 / 006 / 010 / 011 / 013)
// -----------------------------------------------------------------------------
// The background SW is the SINGLE SOURCE OF TRUTH for the activation registry.
// The registry is EPHEMERAL by design: it lives in SW memory and is wiped on SW
// restart (swInstanceId regenerates per boot). The page owns the WS data path;
// the SW only grants/revokes activation and broadcasts state.
//
//   Layer 0  master   chrome.storage (persisted, default OFF)  -> kill-switch
//   Gate 1   pairing  chrome.storage (persisted)               -> gates all control
//   Gate 2   activate this SW registry (ephemeral)             -> per-canvas
// =============================================================================

const swInstanceId = crypto.randomUUID();
let activeTabId: number | null = null;
const editorTabs = new Set<number>();

const isEditorTabUrl = (url: string | undefined): boolean => {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === "chrome-extension:" && u.pathname.endsWith("/editor/index.html")
    );
  } catch {
    return false;
  }
};

const isQuickEditorUrl = (url: string | undefined): boolean =>
  !!url && url.includes("type=quick");

const readConsent = async (): Promise<AgentBridgeStorage> => {
  const result = await browser.storage.local.get(AGENT_BRIDGE_STORAGE_KEY);
  return (
    (result[AGENT_BRIDGE_STORAGE_KEY] as AgentBridgeStorage | undefined) ??
    AGENT_BRIDGE_DEFAULT_STORAGE
  );
};

/** Broadcast the current activation state to every known editor tab. */
const broadcastState = () => {
  const payload: AgentBridgeStatePayload = {
    type: AB_STATE,
    swInstanceId,
    activeTabId,
    isActive: false, // per-tab below
  };
  for (const tabId of [...editorTabs]) {
    browser.tabs
      .sendMessage(tabId, {
        ...payload,
        isActive: activeTabId === tabId,
      })
      .catch(() => {
        // tab gone — drop it from the registry set
        editorTabs.delete(tabId);
      });
  }
};

const handleAgentBridgeMessage = async (
  message: any,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void,
) => {
  const tabId = sender.tab?.id;
  const url = sender.url ?? sender.tab?.url;

  switch (message?.type) {
    case AB_READY: {
      if (tabId != null && isEditorTabUrl(url)) editorTabs.add(tabId);
      sendResponse({
        type: AB_STATE,
        swInstanceId,
        activeTabId,
        isActive: tabId != null && activeTabId === tabId,
      });
      return;
    }
    case AB_ACTIVATE: {
      // Defense-in-depth: only Local editor tabs may activate (Ticket 006/013),
      // and the Layer 0 master + Gate 1 pairing must both be ON.
      if (
        tabId == null ||
        !isEditorTabUrl(url) ||
        isQuickEditorUrl(url)
      ) {
        sendResponse({ granted: false, reason: "not-activatable" });
        return;
      }
      const consent = await readConsent();
      if (!consent.master || !consent.pairing) {
        sendResponse({ granted: false, reason: "consent-off" });
        return;
      }
      editorTabs.add(tabId);
      if (activeTabId !== tabId) {
        // Single-active-canvas invariant: activating B deactivates A.
        activeTabId = tabId;
        broadcastState();
      }
      sendResponse({ granted: true });
      return;
    }
    case AB_DEACTIVATE: {
      if (tabId != null && activeTabId === tabId) {
        activeTabId = null;
        broadcastState();
      }
      sendResponse(true);
      return;
    }
    case AB_DISPLACED: {
      // The daemon displaced this page: a newer activation (from any profile)
      // took the cross-profile single-active slot (Tickets 016/017). Same
      // teardown as DEACTIVATE; the type is distinct so the cause stays
      // distinguishable (displacement is not the user deactivating).
      if (tabId != null && activeTabId === tabId) {
        activeTabId = null;
        broadcastState();
      }
      sendResponse(true);
      return;
    }
    case AB_HEARTBEAT: {
      // Keeps the SW alive while a canvas is active AND lets the page detect a
      // new SW instance (registry wiped) via the swInstanceId in the reply.
      if (tabId != null && isEditorTabUrl(url)) editorTabs.add(tabId);
      sendResponse({
        type: AB_STATE,
        swInstanceId,
        activeTabId,
        isActive: tabId != null && activeTabId === tabId,
      });
      return;
    }
    default:
      sendResponse(undefined);
  }
};

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (
    typeof message?.type === "string" &&
    message.type.startsWith("AGENT_BRIDGE_")
  ) {
    void handleAgentBridgeMessage(message, sender, sendResponse);
    return true;
  }
  return false;
});

// Kill-switch (Layer 0 OFF) / unpair (Gate 1 OFF) → tear all control down.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[AGENT_BRIDGE_STORAGE_KEY]) return;
  const next = changes[AGENT_BRIDGE_STORAGE_KEY].newValue as
    | AgentBridgeStorage
    | undefined;
  const consent = next ?? AGENT_BRIDGE_DEFAULT_STORAGE;
  if ((!consent.master || !consent.pairing) && activeTabId != null) {
    activeTabId = null;
    broadcastState();
  }
});

// Tab close → teardown that tab's activation.
browser.tabs.onRemoved.addListener((tabId) => {
  editorTabs.delete(tabId);
  if (activeTabId === tabId) {
    activeTabId = null;
    broadcastState();
  }
});

// =============================================================================

browser.runtime.onMessage.addListener((message, _, sendMessage) => {
  if (
    typeof message?.type === "string" &&
    message.type.startsWith("AGENT_BRIDGE_")
  ) {
    return; // handled by the agent-bridge listener above
  }
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const activeTab = tabs[0];
    const activeTabId = activeTab?.id;
    switch (message.type) {
      case "OPEN_LOCAL_EDITOR":
        openLocalEditor();
        sendMessage(true);
        return;
      case "OPEN_QUICK_EDITOR":
        openQuickEditor();
        sendMessage(true);
        return;
      case "CAPTURE_VISIBLE_TAB":
        captureVisibleTab();
        sendMessage(true);
        return;
      case "CAPTURE_SELECT_AREA":
        if (activeTabId == null) {
          sendMessage({
            type: "CAPTURE_SELECT_AREA_ERROR",
            error: "No active tab",
          });
          return;
        }
        runAreaCaptureScript(activeTabId)
          .then(() => {
            sendMessage(true);
          })
          .catch((e) => {
            sendMessage({
              type: "CAPTURE_SELECT_AREA_ERROR",
              error: e.message,
            });
          });
        return;
      case "CAPTURE_SELECT_AREA_END":
        captureSelectArea(message);
        sendMessage(true);
        return;
      case "OPEN_QUICK_EDITOR_WITH_JSON":
        openQuickEditorWithJSON(message);
        sendMessage(true);
        return;
      case "READY":
        ready?.resolve();
        sendMessage(true);
        return;
    }
  });
  return true;
});

export default defineBackground(() => {
  browser.commands.onCommand.addListener((command) => {
    switch (command) {
      case "capture-visible-tab":
        captureVisibleTab();
        return;
      case "open-quick-editor":
        openQuickEditor();
        return;
      case "capture-select-area":
        browser.tabs
          .query({ active: true, currentWindow: true })
          .then((tabs) => {
            const activeTabId = tabs[0]?.id;
            if (activeTabId != null) {
              runAreaCaptureScript(activeTabId);
            }
          });
        return;
      case "open-local-editor":
        openLocalEditor();
        return;
    }
  });
});
