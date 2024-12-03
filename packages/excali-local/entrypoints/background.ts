import { PromsieWithResolver, WithResolvers } from "./lib/utils";

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
  browser.tabs
    .create({ url: "editor/index.html?type=quick-marker" })
    .then((tab) => {
      ready = PromsieWithResolver();
      ready.promise.then(() => {
        browser.tabs.sendMessage(tab.id!, {
          type: "UPDATE_CANVAS_WITH_SCREENSHOT",
          dataUrl: imageUrl,
          area,
        });
      });
    });
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
    files: ["crop.js"],
  });
}

browser.runtime.onMessage.addListener((message, _, sendMessage) => {
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
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
  browser.commands.onCommand.addListener((command) => {
    switch (command) {
      case "capture-visible-tab":
        captureVisibleTab();
        return;
      case "capture-select-area":
        browser.tabs
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
