import { WelcomeScreen } from "@excalidraw/excalidraw";
import Excalidraw from "../lib/excalidraw";
import { useCallback, useState, useEffect } from "react";
import { useLoadInitData } from "../hooks/use-load-initdata";
import { IconLoader2 } from "@tabler/icons-react";
import { useMessageEvent } from "../hooks/use-message-event";
import MarkerToolbar from "./marker-toolbar";
import { useMarkerEvent } from "../hooks/use-marker-effect";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import MarkerSidebar from "./marker-sidebar";
import GallerySidebar from "../../gallery/components/gallery-sidebar";
import { useFileCleanup } from "../../gallery/hooks/use-file-cleanup";
import { useSetAtom } from "jotai";
import { currentLoadedDrawingIdAtom } from "@/features/gallery/store/gallery-atoms";

interface QuickMarkerEditorProps {
  lang: string;
}

const QuickMarkerEditor = ({ lang }: QuickMarkerEditorProps) => {
  const { isLoaded, data } = useLoadInitData({ onlyLibrary: true });
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const { runCleanupIfNeeded } = useFileCleanup(excalidrawAPI);

  const updateExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
  }, []);

  useMessageEvent({ excalidrawAPI });
  useMarkerEvent(excalidrawAPI);
  const setCurrentLoadedId = useSetAtom(currentLoadedDrawingIdAtom);

  useEffect(() => {
    if (excalidrawAPI) {
      runCleanupIfNeeded().catch((error) => {
        console.error("Failed to run file cleanup:", error);
      });
    }
  }, [excalidrawAPI, runCleanupIfNeeded]);

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
          showDeprecatedFonts={false}
          excalidrawAPI={(api) => updateExcalidrawAPI(api)}
          onReset={() => setCurrentLoadedId(null)}
          renderTopRightUI={() => (
            <MarkerToolbar excalidrawAPI={excalidrawAPI} />
          )}
        >
          <WelcomeScreen />
          <MarkerSidebar excalidrawAPI={excalidrawAPI} />
          <GallerySidebar excalidrawAPI={excalidrawAPI} />
        </Excalidraw>
      )}
    </div>
  );
};

export default QuickMarkerEditor;
