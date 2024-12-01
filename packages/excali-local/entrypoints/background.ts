const openLocalEditor = () => {
  chrome.tabs.create({ url: "editor/index.html?type=local" });
};

const captureVisibleTab = () => {
  chrome.tabs.captureVisibleTab((dataUrl) => {
    chrome.tabs
      .create({ url: "editor/index.html?type=quick-marker" })
      .then((tab) => {
        chrome.tabs.sendMessage(tab.id!, {
          type: "CAPTURE_VISIBLE_TAB",
          dataUrl,
        });
      });
  });
};
chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
    case "OPEN_LOCAL_EDITOR":
      openLocalEditor();
      break;
    case "CAPTURE_VISIBLE_TAB":
      captureVisibleTab();
      break;
  }
});

export default defineBackground(() => {});
