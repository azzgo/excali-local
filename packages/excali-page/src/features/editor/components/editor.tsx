import {
  BinaryFiles,
  AppState,
  ExcalidrawImperativeAPI,
  LibraryItems,
} from "@excalidraw/excalidraw/types/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lazy } from "react";
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
import { Footer } from "@excalidraw/excalidraw";
import SlideNavbar from "./slide-navbar";
import { useUpdateSlides } from "../hooks/use-update-slides";
import { cn } from "@/lib/utils";
import { showSlideQuickNavAtom } from "../store/presentation";
import { Transition } from "@headlessui/react";
import { useAtom } from "jotai";

const Excalidraw = lazy(() =>
  import("@excalidraw/excalidraw").then((module) => ({
    default: module.Excalidraw,
  }))
);

const Editor = () => {
  const { isLoaded, data } = useLoadInitData();
  const [excalidrawAPI, setExcalidrawAPI] =
    useState<ExcalidrawImperativeAPI | null>(null);
  const updateSlides = useUpdateSlides();
  const [showSlideQuickNav, updateShowSlideQuickNav] = useAtom(
    showSlideQuickNavAtom
  );
  const [showing, updateShowing] = useState(showSlideQuickNav);
  const transitioning = useRef(false);

  useEffect(() => {
    if (transitioning.current) {
      return;
    }
    if (!showing && showSlideQuickNav) {
      updateShowing(true);
    }

    if (showing && !showSlideQuickNav) {
      updateShowing(false);
    }
  }, [showSlideQuickNav, showing]);

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
      <div
        data-state={showing ? "open" : "close"}
        className={cn(
          "transition-[height] duration-150 ease-in-out",
          "data-[state=open]:h-[calc(100vh-320px)]",
          "data-[state=close]:h-[100vh]"
        )}
      >
        {!isLoaded && (
          <div className="h-full w-full flex items-center justify-center">
            <IconLoader2 className="animate-spin" />
          </div>
        )}
        {data && isLoaded && (
          <Excalidraw
            autoFocus
            initialData={data}
            excalidrawAPI={(api) => updateExcalidrawAPI(api)}
            onChange={debouncedHandleSave}
            onLibraryChange={debouncedHandleLibrarySave}
            renderTopRightUI={() => (
              <SlideToolbar excalidrawApi={excalidrawAPI} />
            )}
          >
            <Footer>
              <SlideNavigation excalidrawApi={excalidrawAPI} />
            </Footer>
          </Excalidraw>
        )}
      </div>
      <Transition
        show={showing}
        enterFrom="h-0"
        enterTo="h-80"
        leaveFrom="h-80"
        leaveTo="h-0"
        beforeEnter={() => (transitioning.current = true)}
        afterEnter={() => (transitioning.current = false)}
        beforeLeave={() => (transitioning.current = true)}
        afterLeave={() => {
          transitioning.current = false;
          updateShowSlideQuickNav(false);
        }}
      >
        <div className="overflow-hidden transition-[height] duration-150 ease-in-out">
          <SlideNavbar
            excalidrawApi={excalidrawAPI}
            close={() => updateShowing(false)}
          />
        </div>
      </Transition>
    </div>
  );
};

export default Editor;
