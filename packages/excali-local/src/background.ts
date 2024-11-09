chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({
    url: "editor/index.html",
  });
});

export {};
