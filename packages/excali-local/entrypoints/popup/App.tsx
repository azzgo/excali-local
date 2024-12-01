import {
  IconBrowser,
  IconCamera,
  IconCrop,
  IconTools,
} from "@tabler/icons-react";
import IconHeader from "./IconHeader";
import Item from "./item";
import { useMessage } from "./hooks/useMessage";

function App() {
  const { openLocalEditor, captureVisibleTab, captureSelectArea } =
    useMessage();
  return (
    <section className="w-80 p-4">
      <h4 className="font-medium text-2xl border-b border-b-gray-300 p-2 w-full mb-2">
        Excal
      </h4>
      <div>
        <IconHeader icon={IconCamera} label="Screenshot to Mark" />
        <div className="grid grid-cols-2 gap-4 my-4 p-0">
          <Item
            icon={IconBrowser}
            label="Visible"
            onClick={() => captureVisibleTab()}
          />
          <Item
            icon={IconCrop}
            label="Crop"
            onClick={() => captureSelectArea()}
          />
        </div>
      </div>
      <div>
        <IconHeader icon={IconTools} label="Local Editor" />
        <div className="my-4">
          <button
            className="w-full bg-blue-500 text-white p-2 rounded-md hover:bg-blue-600"
            onClick={() => openLocalEditor()}
          >
            Open Editor
          </button>
        </div>
      </div>
    </section>
  );
}

export default App;
