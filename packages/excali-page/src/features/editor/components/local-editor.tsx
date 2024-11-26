import {
  BinaryFiles,
  AppState,
  ExcalidrawImperativeAPI,
  LibraryItems,
} from "@excalidraw/excalidraw/types/types";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyForAppState,
  KeyForElements,
  KeyForLibraryItems,
  setLocalStorage,
} from "../utils/local";
import { ExcalidrawElement } from "@excalidraw/excalidraw/types/element/types";
import { batchSaveFile } from "../utils/indexdb";
import { debounce } from "radash";
import { isNotDeleted } from "../utils/filters";
import { useLoadInitData } from "../hooks/use-load-initdata";
import { IconLoader2 } from "@tabler/icons-react";
import SlideNavigation from "./slide-navigation";
import SlideToolbar from "./slide-toolbar";
import { Footer, WelcomeScreen } from "@excalidraw/excalidraw";
import SlideNavbar from "./slide-navbar";
import { useUpdateSlides } from "../hooks/use-update-slides";
import { cn } from "@/lib/utils";
import { showSlideQuickNavAtom } from "../store/presentation";
import { useAtom } from "jotai";
import Excalidraw from "../lib/excalidraw";

const LocalEditor = () => {
  const { isLoaded, data } = useLoadInitData();
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const updateSlides = useUpdateSlides();
  const [showSlideQuickNav, updateShowSlideQuickNav] = useAtom(
    showSlideQuickNavAtom
  );

  useEffect(() => {
    if (data != null) {
      updateSlides(data?.elements ?? [], data.files ?? {});
    }
  }, [data]);

  const updateExcalidrawAPI = useCallback((api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api);
  }, []);

  // bugs: initdata files not recogized by excalidraw sdk
  useEffect(() => {
    if (excalidrawAPI && data) {
      excalidrawAPI.addFiles(Object.values(data?.files ?? []));
    }
  }, [excalidrawAPI, data]);

  const handleSave = useCallback(
    async (
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles
    ) => {
      setLocalStorage(KeyForElements, elements.filter(isNotDeleted));
      setLocalStorage(KeyForAppState, appState);
      await batchSaveFile(
        Object.keys(files).map((key) => {
          return { id: key, content: files[key] };
        })
      );
      updateSlides(elements, files);
    },
    []
  );

  const debouncedHandleSave = useMemo(() => {
    return debounce({ delay: 50 }, handleSave);
  }, [handleSave]);

  const handleLibrarySave = useCallback((libraryItems: LibraryItems) => {
    setLocalStorage(KeyForLibraryItems, libraryItems);
  }, []);

  const debouncedHandleLibrarySave = useMemo(() => {
    return debounce({ delay: 50 }, handleLibrarySave);
  }, []);

  return (
    <div className="h-full max-h-svh overflow-hidden flex flex-col">
      <div className="flex-1">
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
            onChange={debouncedHandleSave}
            onLibraryChange={debouncedHandleLibrarySave}
            renderTopRightUI={() => (
              <SlideToolbar excalidrawApi={excalidrawAPI} />
            )}
          >
            <WelcomeScreen />
            <Footer>
              <SlideNavigation excalidrawApi={excalidrawAPI} />
            </Footer>
          </Excalidraw>
        )}
      </div>
      <div className={cn(!showSlideQuickNav && "hidden")}>
        <SlideNavbar
          excalidrawApi={excalidrawAPI}
          close={() => updateShowSlideQuickNav(false)}
        />
      </div>
    </div>
  );
};

export default LocalEditor;
