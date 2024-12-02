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

chrome.runtime.onMessage.addListener((message) => {
  chrome.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    const activeTab = tabs[0];
    switch (message.type) {
      case "OPEN_LOCAL_EDITOR":
        openLocalEditor();
        break;
      case "CAPTURE_VISIBLE_TAB":
        captureVisibleTab();
        break;
      case "CAPTURE_SELECT_AREA":
        chrome.scripting.executeScript({
          target: { tabId: activeTab.id! },
          files: ["crop.js"],
        });
        break;
      case "CAPTURE_SELECT_AREA_END":
        captureSelectArea(message);
        break;
      case "READY":
        ready?.resolve();
        break;
    }
  });
});

export default defineBackground(() => {});
