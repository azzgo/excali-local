import { t } from "@/entrypoints/lib/utils";
import { useState } from "react";

export function useMessage() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const openLocalEditor = () => {
    browser?.runtime.sendMessage({ type: "OPEN_LOCAL_EDITOR" });
    window.close();
  };
  const captureVisibleTab = () => {
    browser?.runtime.sendMessage({ type: "CAPTURE_VISIBLE_TAB" });
    window.close();
  };
  const captureSelectArea = () => {
    browser?.runtime
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
              "Missing host permission for the tab",
            ].includes(response.error)
          ) {
            setErrorMessage(t("NotTheSupportedAddress"));
          } else {
            setErrorMessage(t("SomethingWentWrong"));
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
