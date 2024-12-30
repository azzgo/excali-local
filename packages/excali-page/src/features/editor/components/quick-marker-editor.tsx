import { WelcomeScreen } from "@excalidraw/excalidraw";
import Excalidraw from "../lib/excalidraw";
import { useCallback, useState } from "react";
import { useLoadInitData } from "../hooks/use-load-initdata";
import { IconLoader2 } from "@tabler/icons-react";
import { useMessageEvent } from "../hooks/use-message-event";
import MarkerToolbar from "./marker-toolbar";
import { useMarkerEvent } from "../hooks/use-marker-effect";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
interface QuickMarkerEditorProps {
  lang: string;
}

const QuickMarkerEditor = ({ lang }: QuickMarkerEditorProps) => {
  const { isLoaded, data } = useLoadInitData({ onlyLibrary: true });
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const updateExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
  }, []);

  useMessageEvent({ excalidrawAPI });
  useMarkerEvent(excalidrawAPI);

  return (
    <div className="h-full max-h-svh overflow-hidden flex flex-col">
      {!isLoaded && (
        <div className="h-full w-full flex items-center justify-center">
          <IconLoader2 className="animate-spin" />
        </div>
      )}
      {data && isLoaded && (
        <Excalidraw
          autoFocus
          langCode={lang}
          aiEnabled={false}
          initialData={data}
          excalidrawAPI={(api) => updateExcalidrawAPI(api)}
          renderTopRightUI={() => (
            <MarkerToolbar excalidrawApi={excalidrawAPI} />
          )}
        >
          <WelcomeScreen />
        </Excalidraw>
      )}
    </div>
  );
};

export default QuickMarkerEditor;
