import {
  WelcomeScreen,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import Excalidraw from "../lib/excalidraw";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/types";
import { useCallback, useState } from "react";
import { useLoadInitData } from "../hooks/use-load-initdata";
import { IconLoader2 } from "@tabler/icons-react";
import { useEvent } from "react-use";
import { nanoid } from "nanoid";
import { FileId } from "@excalidraw/excalidraw/types/element/types";

const QuickMarkerEditor = () => {
  const { isLoaded, data } = useLoadInitData({ onlyLibrary: true });
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const updateExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
  }, []);

  useEvent("message", (event) => {
    if (event.data.dataType === "image") {
      const imageBase64 = event.data.data;
      const width = event.data.width;
      const height = event.data.height;
      const mimeType = event.data.mimeType;
      const fileId: FileId = new String(nanoid()) as FileId;
      fileId._brand = "FileId";
      excalidrawAPI?.addFiles([
        {
          id: fileId,
          mimeType,
          dataURL: imageBase64,
          created: Date.now(),
        },
      ]);
      const imageElements = convertToExcalidrawElements([
        {
          type: "image",
          id: nanoid(),
          fileId: fileId,
          x: 0,
          y: 0,
          width: width,
          height: height,
        },
      ]);
      excalidrawAPI?.updateScene({
        elements: imageElements,
      });
      excalidrawAPI?.scrollToContent(imageElements, { fitToContent: true });
    }
  });

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
          langCode={navigator.language}
          initialData={data}
          excalidrawAPI={(api) => updateExcalidrawAPI(api)}
        >
          <WelcomeScreen />
        </Excalidraw>
      )}
    </div>
  );
};

export default QuickMarkerEditor;
