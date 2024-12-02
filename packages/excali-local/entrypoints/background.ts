import { PromsieWithResolver, WithResolvers } from "./lib/utils";

const openLocalEditor = () => {
  chrome.tabs.create({ url: "editor/index.html?type=local" });
};

let ready: WithResolvers<void>;

type Area = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const openEditorWithImageUrl = (imageUrl: string, area?: Area) => {
  chrome.tabs
    .create({ url: "editor/index.html?type=quick-marker" })
    .then((tab) => {
      ready = PromsieWithResolver();
      ready.promise.then(() => {
        chrome.tabs.sendMessage(tab.id!, {
          type: "UPDATE_CANVAS_WITH_SCREENSHOT",
          dataUrl: imageUrl,
          area,
        });
      });
    });
};

const captureVisibleTab = () => {
  chrome.tabs.captureVisibleTab((dataUrl) => {
    openEditorWithImageUrl(dataUrl);
  });
};

const captureSelectArea = (message: any) => {
  const { area } = message;
  chrome.tabs
    .captureVisibleTab()
    .then((dataUrl) => openEditorWithImageUrl(dataUrl, area));
};

function runAreaCaptureScript(tabId: number) {
  return chrome.scripting.executeScript({
    target: { tabId },
    files: ["crop.js"],
  });
}

chrome.runtime.onMessage.addListener((message, _, sendMessage) => {
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const activeTab = tabs[0];
    switch (message.type) {
      case "OPEN_LOCAL_EDITOR":
        openLocalEditor();
        sendMessage(true);
        return;
      case "CAPTURE_VISIBLE_TAB":
        captureVisibleTab();
        sendMessage(true);
        return;
      case "CAPTURE_SELECT_AREA":
        if (!activeTab.id) {
          sendMessage({
            type: "CAPTURE_SELECT_AREA_ERROR",
            error: "No active tab",
          });
          return;
        }
        runAreaCaptureScript(activeTab.id!)
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
      case "READY":
        ready?.resolve();
        sendMessage(true);
        return;
    }
  });
  return true;
});

export default defineBackground(() => {
  chrome.commands.onCommand.addListener((command) => {
    switch (command) {
      case "capture-visible-tab":
        captureVisibleTab();
        return;
      case "capture-select-area":
        chrome.tabs
          .query({ active: true, currentWindow: true })
          .then((tabs) => {
            const activeTab = tabs[0];
            if (activeTab.id) {
              runAreaCaptureScript(activeTab.id);
            }
          });
        return;
    }
  });
});
