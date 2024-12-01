export function useMessage() {
  const openLocalEditor = () => {
    chrome?.runtime.sendMessage({ type: "OPEN_LOCAL_EDITOR" });
    window.close();
  };
  const captureVisibleTab = () => {
    chrome?.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    window.close();
  };
  const captureSelectArea = () => {
    chrome?.runtime.sendMessage({ type: "CAPTURE_SELECT_AREA" });
    window.close();
  }
  return {
    openLocalEditor,
    captureVisibleTab,
    captureSelectArea,
  };
}
