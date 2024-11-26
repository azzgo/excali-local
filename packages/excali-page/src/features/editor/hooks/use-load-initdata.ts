import {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types/types";
import { useEffect, useState } from "react";
import {
  KeyForAppState,
  KeyForElements,
  KeyForLibraryItems,
  KeyForSlideIdList,
  getLocalStorageAsync,
} from "../utils/local";
import { getFiles } from "../utils/indexdb";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { restoreAppState } from "@excalidraw/excalidraw";
import { omit } from "radash";
import { useSetAtom } from "jotai";
import { slideIdOrderListAtom } from "../store/presentation";

interface UseLoadInitDataProps {
  onlyLibrary?: boolean;
}

export const useLoadInitData = ({
  onlyLibrary = false,
}: UseLoadInitDataProps = {}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [data, updateData] = useState<ExcalidrawInitialDataState | null>(null);
  const updateSlideIdOrderList = useSetAtom(slideIdOrderListAtom);

  useEffect(() => {
    if (isLoaded) {
      return;
    }
    const savedLibraryItems = getLocalStorageAsync<LibraryItems>(
      KeyForLibraryItems,
      []
    );

    if (onlyLibrary) {
      Promise.all([savedLibraryItems]).then(
        ([savedLibraryItems]) => {
          updateData({
            elements: [],
            appState: {},
            files: {},
            libraryItems: savedLibraryItems,
          });
          setIsLoaded(true);
        }
      );
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
    const savedSlideIdListStream = getLocalStorageAsync(KeyForSlideIdList, []);

    const filesStream = getFiles();
    Promise.all([
      savedElementsStream,
      savedStateStream,
      filesStream,
      savedSlideIdListStream,
    ]).then(([savedElements, savedState, fileDatas, slideIdList]) => {
      const files = fileDatas.reduce((binaryFiles, file) => {
        binaryFiles[file.id] = file.content;
        return binaryFiles;
      }, {} as BinaryFiles);

      updateSlideIdOrderList(slideIdList);

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
