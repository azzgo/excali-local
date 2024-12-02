import { useState } from "react";

export function useMessage() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const openLocalEditor = () => {
    chrome?.runtime.sendMessage({ type: "OPEN_LOCAL_EDITOR" });
    window.close();
  };
  const captureVisibleTab = () => {
    chrome?.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    window.close();
  };
  const captureSelectArea = () => {
    chrome?.runtime
      .sendMessage({ type: "CAPTURE_SELECT_AREA" })
      .then((response) => {
        if (response === true) {
          window.close();
          return;
        }
        if (response?.type === "CAPTURE_SELECT_AREA_ERROR") {
          if (
            [
              "No active tab",
              "Cannot access a chrome:// URL",
            ].includes(response.error)
          ) {
            setErrorMessage("Not the Supported Address");
          } else {
            setErrorMessage("Something went wrong. Please try again later.");
          }
          console.error(response.error);
        }
      });
  };
  const closeErrorMessage = () => {
    setErrorMessage(null);
  };
  return {
    openLocalEditor,
    captureVisibleTab,
    captureSelectArea,
    errorMessage,
    closeErrorMessage,
  };
}
