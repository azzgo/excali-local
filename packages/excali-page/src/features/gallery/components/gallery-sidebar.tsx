import { Sidebar } from "@excalidraw/excalidraw";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import {
  IconDeviceFloppy,
  IconPlus,
  IconChevronDown,
  IconTrash,
} from "@tabler/icons-react";
import { restoreAppState } from "@excalidraw/excalidraw";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  drawingsListAtom,
  currentLoadedDrawingIdAtom,
  galleryIsOpenAtom,
  galleryRefreshAtom,
  currentPageAtom,
} from "../store/gallery-atoms";
import { useDrawingCrud } from "../hooks/use-drawing-crud";
import { useThumbnail } from "../hooks/use-thumbnail";
import { useFileCleanup } from "../hooks/use-file-cleanup";
import DrawingCard from "./drawing-card";
import DrawingCardSkeleton from "./drawing-card-skeleton";
import CollectionManager from "./collection-manager";
import SearchBar from "./search-bar";
import SaveDialog from "./save-dialog";
import { Suspense, useCallback, useState } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Drawing } from "../../editor/utils/indexdb";
import { format } from "date-fns";
import { nanoid } from "nanoid";
import { omit } from "radash";
import { useTranslation } from "react-i18next";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/dist/types/excalidraw/types";

interface GallerySidebarProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

const GalleryList = ({
  onLoad,
  onOverwrite,
  currentId,
}: {
  onLoad: (drawing: Drawing) => void;
  onOverwrite: (drawingId: string) => Promise<void>;
  currentId: string | null;
}) => {
  const [t] = useTranslation();
  const drawingsData = useAtomValue(drawingsListAtom);
  const [currentPage, setCurrentPage] = useAtom(currentPageAtom);
  const sortedDrawings = [...drawingsData.drawings].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  const handleLoadMore = () => {
    setCurrentPage(currentPage + 1);
  };

  if (drawingsData.total === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-[var(--text-secondary-color)]">
        <p className="text-sm">{t("No drawings yet.")}</p>
        <p className="text-xs opacity-70 mt-1">{t("Create one to get started!")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 p-4">
        {sortedDrawings.map((drawing) => (
          <DrawingCard
            key={drawing.id}
            drawing={drawing}
            isActive={drawing.id === currentId}
            onClick={onLoad}
            onOverwrite={onOverwrite}
          />
        ))}
      </div>
      {drawingsData.hasMore && (
        <div className="flex justify-center pb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={handleLoadMore}
            className="w-[200px]"
          >
            {t("Load More")} ({drawingsData.drawings.length} / {drawingsData.total})
          </Button>
        </div>
      )}
    </div>
  );
};

const GallerySidebar = ({ excalidrawAPI }: GallerySidebarProps) => {
  const [t] = useTranslation();
  const [docked, setDocked] = useState(false);
  const [isOpen, setIsOpen] = useAtom(galleryIsOpenAtom);
  const [currentLoadedId, setCurrentLoadedId] = useAtom(
    currentLoadedDrawingIdAtom,
  );
  const { save, update, getAll } = useDrawingCrud();
  const { generateThumbnail } = useThumbnail();
  const { cleanupOrphanedFiles } = useFileCleanup();
  const setRefresh = useSetAtom(galleryRefreshAtom);
  const [isSaving, setIsSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [currentName, setCurrentName] = useState("");
  const [isCleaningUp, setIsCleaningUp] = useState(false);

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

    // Quick save if loaded drawing exists
    if (currentLoadedId) {
      await handleQuickSave();
    } else {
      // New drawing - show dialog
      const name = `Drawing ${format(Date.now(), "yyyy-MM-dd HH:mm")}`;
      setCurrentName(name);
      setSaveDialogOpen(true);
    }
  };

  const onSaveAsNewClick = async () => {
    if (!excalidrawAPI) return;
    const name = currentLoadedId
      ? await getDrawingName(currentLoadedId)
      : `Drawing ${format(Date.now(), "yyyy-MM-dd HH:mm")}`;
    setCurrentName(name + " (Copy)");
    setSaveDialogOpen(true);
  };

  const handleQuickSave = async () => {
    if (!excalidrawAPI || !currentLoadedId) return;
    setIsSaving(true);

    try {
      const elements = excalidrawAPI.getSceneElements();
      const files = excalidrawAPI.getFiles();
      const appState = excalidrawAPI.getAppState();
      const thumbnail = await generateThumbnail(elements, files);
      const now = Date.now();

      const drawingName = await getDrawingName(currentLoadedId);

      const drawingData = {
        name: drawingName,
        elements: JSON.stringify(elements),
        appState: JSON.stringify(appState),
        files: JSON.stringify(files),
        thumbnail,
        updatedAt: now,
      };

      await update(currentLoadedId, drawingData);
      setRefresh((prev) => prev + 1);
      toast.success(t("Drawing updated successfully"));
    } catch (error) {
      console.error("Failed to update drawing:", error);
      toast.error(t("Failed to update drawing"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDialogConfirm = async (
    name: string,
    collectionIds: string[],
    saveAsNew: boolean,
  ) => {
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
        // This branch should technically not be reached with the current flow logic
        await update(currentLoadedId, drawingData);
        toast.success(t("Drawing updated successfully"));
      } else {
        const newId = nanoid();
        await save({
          id: newId,
          ...drawingData,
          createdAt: now,
          collectionIds,
        } as Drawing);
        setCurrentLoadedId(newId);
        toast.success(t("Drawing saved successfully"));
      }

      setRefresh((prev) => prev + 1);
    } catch (error) {
      console.error("Failed to save drawing:", error);
      toast.error(t("Failed to save drawing"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOverwrite = useCallback(
    async (targetDrawingId: string) => {
      if (!excalidrawAPI) return;

      try {
        const elements = excalidrawAPI.getSceneElements();
        const files = excalidrawAPI.getFiles();
        const appState = excalidrawAPI.getAppState();
        const thumbnail = await generateThumbnail(elements, files);
        const now = Date.now();

        const drawingName = await getDrawingName(targetDrawingId);

        const drawingData = {
          name: drawingName,
          elements: JSON.stringify(elements),
          appState: JSON.stringify(appState),
          files: JSON.stringify(files),
          thumbnail,
          updatedAt: now,
        };

        await update(targetDrawingId, drawingData);
        setRefresh((prev) => prev + 1);
        toast.success(t("Drawing overwritten successfully"));
      } catch (error) {
        console.error("Failed to overwrite drawing:", error);
        toast.error(t("Failed to overwrite drawing"));
      }
    },
    [excalidrawAPI, generateThumbnail, getDrawingName, update, setRefresh],
  );

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
        });
        excalidrawAPI.addFiles(files)

        setCurrentLoadedId(drawing.id);
      } catch (error) {
        console.error("Failed to load drawing:", error);
        toast.error(t("Failed to load drawing"));
      }
    },
    [excalidrawAPI, setCurrentLoadedId],
  );

  const handleNew = useCallback(() => {
    if (!excalidrawAPI) return;
    excalidrawAPI.resetScene();
    setCurrentLoadedId(null);
  }, [excalidrawAPI, setCurrentLoadedId]);

  const handleCleanup = useCallback(async () => {
    setIsCleaningUp(true);
    try {
      const result = await cleanupOrphanedFiles();
      if (result.cleaned > 0) {
        toast.success(t("Storage Cleaned"), {
          description: t("Cleaned {{count}} orphaned files", { count: result.cleaned }),
        });
      } else {
        toast.success(t("Storage Clean"), {
          description: t("No orphaned files found"),
        });
      }
    } catch (error) {
      console.error("Failed to cleanup storage:", error);
      toast.error(t("Cleanup Failed"), {
        description: t("Failed to cleanup storage"),
      });
    } finally {
      setIsCleaningUp(false);
    }
  }, [cleanupOrphanedFiles, t]);

  return (
    <Sidebar
      name="gallery"
      docked={docked}
      onDock={setDocked}
      className="!min-w-160"
      onStateChange={handleStateChange}
    >
      <Sidebar.Header>
        <div className="flex flex-col w-full gap-4 pr-2 py-2">
          <div className="flex items-center justify-between w-full">
            <div className="text-[var(--color-primary)] text-[1.4em] font-bold mr-2">
              {t("Gallery")}
            </div>
            <SearchBar />
            <div className="flex gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    title={t("More Actions")}
                  >
                    <IconChevronDown className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleNew}>
                    <IconPlus className="mr-2 h-4 w-4" />
                    <span>{t("New Drawing")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCleanup} disabled={isCleaningUp}>
                    {isCleaningUp ? (
                      <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <IconTrash className="mr-2 h-4 w-4" />
                    )}
                    <span>{t("Clean Up Storage")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="flex items-center bg-secondary rounded-md border-border h-9">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-full px-3 rounded-r-none hover:bg-[var(--button-hover-bg)] gap-2"
                  onClick={onSaveClick}
                  disabled={isSaving}
                  title={currentLoadedId ? t("Update Drawing") : t("Save Drawing")}
                >
                  {isSaving ? (
                    <IconLoader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <IconDeviceFloppy className="h-4 w-4" />
                  )}
                  <span className="text-sm font-medium">
                    {currentLoadedId ? t("Update") : t("Save")}
                  </span>
                </Button>

                <div className="w-[1px] h-5 bg-border" />

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-full px-2 rounded-l-none hover:bg-[var(--button-hover-bg)]"
                      disabled={isSaving || !currentLoadedId}
                    >
                      <IconChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem onClick={onSaveAsNewClick}>
                      <IconPlus className="mr-2 h-4 w-4" />
                      <span>{t("Save as New Drawing")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>
      </Sidebar.Header>
      <CollectionManager />
      <ScrollArea className="h-full w-full">
        <Suspense
          fallback={
            <div className="grid grid-cols-2 gap-4 p-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <DrawingCardSkeleton key={index} />
              ))}
            </div>
          }
        >
          <GalleryList
            onLoad={handleLoad}
            onOverwrite={handleOverwrite}
            currentId={currentLoadedId}
          />
        </Suspense>
      </ScrollArea>
      <SaveDialog
        isOpen={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSaveDialogConfirm}
        currentLoadedDrawingId={currentLoadedId}
        defaultName={currentName}
      />
    </Sidebar>
  );
};

export default GallerySidebar;
