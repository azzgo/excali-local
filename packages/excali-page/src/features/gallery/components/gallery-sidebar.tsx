import { Sidebar, useI18n } from "@excalidraw/excalidraw";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types/excalidraw/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { IconDeviceFloppy, IconPlus } from "@tabler/icons-react";
import { restoreAppState } from "@excalidraw/excalidraw";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  drawingsListAtom,
  currentLoadedDrawingIdAtom,
  galleryIsOpenAtom,
  galleryRefreshAtom,
} from "../store/gallery-atoms";
import { useDrawingCrud } from "../hooks/use-drawing-crud";
import { useThumbnail } from "../hooks/use-thumbnail";
import DrawingCard from "./drawing-card";
import CollectionManager from "./collection-manager";
import SearchBar from "./search-bar";
import SaveDialog from "./save-dialog";
import { Suspense, useCallback, useState, useEffect } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Drawing } from "../../editor/utils/indexdb";
import { format } from "date-fns";
import { nanoid } from "nanoid";
import { omit } from "radash";

interface GallerySidebarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

const GalleryList = ({
  onLoad,
  currentId,
}: {
  onLoad: (drawing: Drawing) => void;
  currentId: string | null;
}) => {
  const drawings = useAtomValue(drawingsListAtom);
  const sortedDrawings = [...drawings].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  if (drawings.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-[var(--text-secondary-color)]">
        <p className="text-sm">No drawings yet.</p>
        <p className="text-xs opacity-70 mt-1">Create one to get started!</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {sortedDrawings.map((drawing) => (
        <DrawingCard
          key={drawing.id}
          drawing={drawing}
          isActive={drawing.id === currentId}
          onClick={onLoad}
        />
      ))}
    </div>
  );
};

const GallerySidebar = ({ excalidrawAPI }: GallerySidebarProps) => {
  const t = useI18n();
  const [docked, setDocked] = useState(false);
  const [isOpen, setIsOpen] = useAtom(galleryIsOpenAtom);
  const [currentLoadedId, setCurrentLoadedId] = useAtom(
    currentLoadedDrawingIdAtom,
  );
  const { save, update, getAll } = useDrawingCrud();
  const { generateThumbnail } = useThumbnail();
  const setRefresh = useSetAtom(galleryRefreshAtom);
  const [isSaving, setIsSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [currentName, setCurrentName] = useState("");

  const handleStateChange = useCallback(
    (state: { name: string; tab?: string } | null) => {
      if (state?.name === "gallery") {
        setIsOpen(true);
      } else {
        setIsOpen(false);
      }
    },
    [setIsOpen],
  );

  const getDrawingName = async (id: string) => {
    try {
      const drawings = await getAll();
      const drawing = drawings.find((d) => d.id === id);
      return drawing
        ? drawing.name
        : `Drawing ${format(Date.now(), "yyyy-MM-dd HH:mm")}`;
    } catch {
      return `Drawing ${format(Date.now(), "yyyy-MM-dd HH:mm")}`;
    }
  };

  const onSaveClick = async () => {
    if (!excalidrawAPI) return;
    const name = currentLoadedId 
      ? await getDrawingName(currentLoadedId)
      : `Drawing ${format(Date.now(), "yyyy-MM-dd HH:mm")}`;
    setCurrentName(name);
    setSaveDialogOpen(true);
  };

  const handleSave = async (name: string, collectionIds: string[], saveAsNew: boolean) => {
    if (!excalidrawAPI) return;
    setIsSaving(true);

    try {
      const elements = excalidrawAPI.getSceneElements();
      const files = excalidrawAPI.getFiles();
      const appState = excalidrawAPI.getAppState();
      const thumbnail = await generateThumbnail(elements, files);

      const now = Date.now();

      const drawingData = {
        name,
        elements: JSON.stringify(elements),
        appState: JSON.stringify(appState),
        files: JSON.stringify(files),
        thumbnail,
        updatedAt: now,
      };

      if (currentLoadedId && !saveAsNew) {
        await update(currentLoadedId, drawingData);
      } else {
        const newId = nanoid();
        await save({
          id: newId,
          ...drawingData,
          createdAt: now,
          collectionIds,
        } as Drawing);
        setCurrentLoadedId(newId);
      }

      setRefresh((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to save drawing:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = useCallback(
    (drawing: Drawing) => {
      if (!excalidrawAPI) return;

      try {
        const elements = JSON.parse(drawing.elements);
        const appState = JSON.parse(drawing.appState);
        const files = JSON.parse(drawing.files);

        excalidrawAPI.updateScene({
          elements,
          appState: restoreAppState(
            omit({ ...appState, isLoading: false }, [
              "collaborators",
              "viewModeEnabled",
            ]),
            null,
          ),
          files,
          commitToHistory: true,
        });

        setCurrentLoadedId(drawing.id);
      } catch (error) {
        console.error("Failed to load drawing:", error);
      }
    },
    [excalidrawAPI, setCurrentLoadedId],
  );

  const handleNew = useCallback(() => {
    if (!excalidrawAPI) return;
    excalidrawAPI.resetScene();
    setCurrentLoadedId(null);
  }, [excalidrawAPI, setCurrentLoadedId]);

  return (
    <Sidebar
      name="gallery"
      docked={docked}
      onDock={setDocked}
      onStateChange={handleStateChange}
    >
      <Sidebar.Header>
        <div className="flex flex-col w-full gap-2 pr-2">
          <div className="flex items-center justify-between w-full">
            <div className="text-[var(--color-primary)] text-[1.2em] font-bold">
              Gallery
            </div>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={handleNew}
                title="New Drawing"
              >
                <IconPlus className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onSaveClick}
                disabled={isSaving}
                title="Save"
              >
                {isSaving ? (
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <IconDeviceFloppy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <CollectionManager />
          <SearchBar />
        </div>
      </Sidebar.Header>
      <ScrollArea className="h-full w-full">
        <Suspense
          fallback={
            <div className="flex items-center justify-center p-8">
              <IconLoader2 className="animate-spin text-[var(--text-secondary-color)]" />
            </div>
          }
        >
          <GalleryList onLoad={handleLoad} currentId={currentLoadedId} />
        </Suspense>
      </ScrollArea>
      <SaveDialog
        isOpen={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSave}
        currentLoadedDrawingId={currentLoadedId}
        defaultName={currentName}
      />
    </Sidebar>
  );
};

export default GallerySidebar;
