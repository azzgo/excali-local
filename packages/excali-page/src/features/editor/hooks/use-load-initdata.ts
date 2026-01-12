import {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/dist/types/excalidraw/types";
import { ExcalidrawElement } from "@excalidraw/excalidraw/dist/types/element/src/types";
import { useEffect, useState } from "react";
import {
  KeyForAppState,
  KeyForElements,
  KeyForLibraryItems,
  getLocalStorageAsync,
} from "../utils/local";
import { getFiles } from "../utils/indexdb";
import { restoreAppState } from "@excalidraw/excalidraw";
import { omit } from "radash";

interface UseLoadInitDataProps {
  onlyLibrary?: boolean;
}

export const useLoadInitData = ({
  onlyLibrary = false,
}: UseLoadInitDataProps = {}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [data, updateData] = useState<ExcalidrawInitialDataState | null>(null);

  useEffect(() => {
    if (isLoaded) {
      return;
    }
    const savedLibraryItems = getLocalStorageAsync<LibraryItems>(
      KeyForLibraryItems,
      []
    );

    if (onlyLibrary) {
      updateData({
        elements: [],
        appState: {},
        files: {},
        libraryItems: savedLibraryItems,
      });
      setIsLoaded(true);
      return;
    }

    const savedElementsStream = getLocalStorageAsync<ExcalidrawElement[]>(
      KeyForElements,
      []
    );
    const savedStateStream = getLocalStorageAsync<AppState>(
      KeyForAppState,
      {} as any
    );

    const filesStream = getFiles();
    Promise.all([
      savedElementsStream,
      savedStateStream,
      filesStream,
    ]).then(([savedElements, savedState, fileDatas]) => {
      const files = fileDatas.reduce((binaryFiles, file) => {
        binaryFiles[file.id] = file.content;
        return binaryFiles;
      }, {} as BinaryFiles);

      updateData({
        elements: savedElements,
        appState: restoreAppState(
          omit(savedState, ["collaborators", "viewModeEnabled"]),
          null
        ),
        files,
        libraryItems: savedLibraryItems,
      });

      setIsLoaded(true);
    });
  }, [isLoaded]);

  return { isLoaded, data };
};
