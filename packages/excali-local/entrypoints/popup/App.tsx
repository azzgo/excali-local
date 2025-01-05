import {
  IconBrowser,
  IconCamera,
  IconCrop,
  IconTools,
  IconXboxX,
} from "@tabler/icons-react";
import IconHeader from "./IconHeader";
import Item from "./item";
import { useMessage } from "./hooks/use-message";
import { useCommandList } from "./hooks/use-command-list";
import { t } from "../lib/utils";

function App() {
  const {
    openLocalEditor,
    captureVisibleTab,
    captureSelectArea,
    errorMessage,
    closeErrorMessage,
  } = useMessage();
  const commands = useCommandList();
  useEffect(() => {
    // nothing, just make sure background script awake
    browser.runtime.sendMessage({ type: "POPUP_MOUNTED" });
  }, []);

  return (
    <section className="flex flex-col w-80 px-4 bg-white dark:bg-black">
      <h4 className="font-medium text-2xl border-b border-b-gray-300 p-2 w-full mb-2 bg:text-white">
        Excali Local
      </h4>
      {errorMessage && (
        <div className="flex flex-row items-center bg-red-500 text-white p-2 rounded">
          <p className="flex-1">{errorMessage}</p>
          <IconXboxX
            className="ml-1 size-4 cursor-pointer"
            onClick={() => closeErrorMessage()}
          />
        </div>
      )}
      <div>
        <IconHeader icon={IconCamera} label={t("ScreenshotToMark")} />
        <div className="grid grid-cols-2 gap-4 my-4 p-0">
          <Item
            icon={IconBrowser}
            label={t("Visible")}
            hoverTitle={`[${commands["capture-visible-tab"]}] ${t(
              "CaptureVisibleTab"
            )}`}
            ariaKeyshortcuts={commands["capture-visible-tab"]}
            onClick={() => captureVisibleTab()}
          />
          <Item
            icon={IconCrop}
            label={t("Crop")}
            hoverTitle={`[${commands["capture-select-area"]}] ${t(
              "CaptureSelectArea"
            )}`}
            ariaKeyshortcuts={commands["capture-select-area"]}
            onClick={() => captureSelectArea()}
          />
        </div>
      </div>
      <div>
        <IconHeader icon={IconTools} label={t("LocalEditor")} />
        <div className="my-4">
          <button
            className="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600"
            onClick={() => openLocalEditor()}
          >
            {t("OpenEditor")}
          </button>
        </div>
      </div>
    </section>
  );
}

export default App;
