import {
  IconBrowser,
  IconCamera,
  IconCrop,
  IconTools,
} from "@tabler/icons-react";
import IconHeader from "./IconHeader";
import Item from "./item";

function App() {
  return (
    <section className="w-80">
      <h4 className="font-medium text-2xl border-b p-2 w-full mb-2">Excal</h4>
      <div>
        <IconHeader icon={IconCamera} label="Screenshot to Mark" />
        <div className="grid grid-cols-2 gap-4 m-4">
          <Item
            icon={IconBrowser}
            label="Visible"
            onClick={() => console.log("Take Screenshot")}
          />
          <Item
            icon={IconCrop}
            label="Crop"
            onClick={() => console.log("Open Editor")}
          />
        </div>
      </div>
      <div>
        <IconHeader icon={IconTools} label="Local Editor" />
        <div className="p-2">
          <button className="w-full">Open Editor</button>
        </div>
      </div>
    </section>
  );
}

export default App;
