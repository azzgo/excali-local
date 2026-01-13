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
  currentLoadedDrawingIdAtom,
  galleryIsOpenAtom,
  selectedCollectionIdAtom,
  searchQueryAtom,
} from "../store/gallery-atoms";
import { useDrawingCrud } from "../hooks/use-drawing-crud";
import { useThumbnail } from "../hooks/use-thumbnail";
import { useFileCleanup } from "../hooks/use-file-cleanup";
import DrawingCard from "./drawing-card";
import DrawingCardSkeleton from "./drawing-card-skeleton";
import CollectionManager from "./collection-manager";
import SearchBar from "./search-bar";
import SaveDialog from "./save-dialog";
import { Suspense, useCallback, useState, useEffect, useMemo } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { Drawing, DrawingMetadata, Collection } from "../../editor/utils/indexdb";
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

interface GalleryListProps {
  drawings: DrawingMetadata[];
  collections: Collection[];
  onLoad: (drawing: DrawingMetadata) => void;
  onOverwrite: (drawingId: string) => Promise<void>;
  currentId: string | null;
  onDrawingUpdate: (id: string, updates: Partial<DrawingMetadata>) => void;
  onDrawingDelete: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  total: number;
  currentPage: number;
  onCollectionCountUpdate: () => void;
}

const GalleryList = ({
  drawings,
  collections,
  onLoad,
  onOverwrite,
  currentId,
  onDrawingUpdate,
  onDrawingDelete,
  onLoadMore,
  hasMore,
  total,
  onCollectionCountUpdate,
}: GalleryListProps) => {
  const [t] = useTranslation();
  const sortedDrawings = [...drawings].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );

  if (total === 0) {
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
            collections={collections}
            isActive={drawing.id === currentId}
            onClick={onLoad}
            onOverwrite={onOverwrite}
            onUpdate={onDrawingUpdate}
            onDelete={onDrawingDelete}
            onCollectionCountUpdate={onCollectionCountUpdate}
          />
        ))}
      </div>
      {hasMore && (
        <div className="flex justify-center pb-4">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            className="w-[200px]"
          >
            {t("Load More")} ({drawings.length} / {total})
          </Button>
        </div>
      )}
    </div>
  );
};

const GallerySidebar = ({ excalidrawAPI }: GallerySidebarProps) => {
  const [t] = useTranslation();
  const [docked, setDocked] = useState(false);
  const setIsOpen = useSetAtom(galleryIsOpenAtom);
  const [currentLoadedId, setCurrentLoadedId] = useAtom(
    currentLoadedDrawingIdAtom,
  );
  const { save, update, getAll, getFullData, getCollections } = useDrawingCrud();
  const { generateThumbnail } = useThumbnail();
  const { cleanupOrphanedFiles } = useFileCleanup();
  const [isSaving, setIsSaving] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [currentName, setCurrentName] = useState("");
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  
  const [allDrawings, setAllDrawings] = useState<DrawingMetadata[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const selectedCollectionId = useAtomValue(selectedCollectionIdAtom);
  const searchQuery = useAtomValue(searchQueryAtom);

  // 计算所有 collection 的 drawing 数量（基于全量数据）
  const drawingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    collections.forEach(c => counts[c.id] = 0);
    allDrawings.forEach(d => {
      if (d.collectionIds) {
        d.collectionIds.forEach(cId => {
          if (counts[cId] !== undefined) {
            counts[cId]++;
          }
        });
      }
    });
    return counts;
  }, [allDrawings, collections]);

  // 根据 collection 和 searchQuery 过滤
  const filteredDrawings = useMemo(() => {
    let result = allDrawings;
    
    if (selectedCollectionId) {
      result = result.filter(d => d.collectionIds?.includes(selectedCollectionId));
    }
    
    if (searchQuery) {
      result = result.filter(d => 
        d.name.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }
    
    return result;
  }, [allDrawings, selectedCollectionId, searchQuery]);

  // 分页显示的 drawings
  const displayedDrawings = useMemo(() => {
    const endIndex = currentPage * 20;
    return filteredDrawings.slice(0, endIndex);
  }, [filteredDrawings, currentPage]);

  // 计算分页信息
  const paginationInfo = useMemo(() => {
    const endIndex = currentPage * 20;
    return {
      total: filteredDrawings.length,
      hasMore: filteredDrawings.length > endIndex,
    };
  }, [filteredDrawings, currentPage]);

  useEffect(() => {
    const loadCollections = async () => {
      const data = await getCollections();
      setCollections(data);
    };
    loadCollections();
  }, [getCollections]);

  useEffect(() => {
    let cancelled = false;
    
    const loadDrawings = async () => {
      try {
        const data = await getAll();
        if (!cancelled) {
          setAllDrawings(data);
        }
      } catch(e) {
        console.error('load drawing failed', e)
      }
    };
    
    loadDrawings();
    return () => { cancelled = true; };
  }, [getAll]);

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

  const handleDrawingUpdate = useCallback((id: string, updates: Partial<DrawingMetadata>) => {
    setAllDrawings(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
  }, []);

  const handleDrawingDelete = useCallback((id: string) => {
    setAllDrawings(prev => prev.filter(d => d.id !== id));
  }, []);

  const handleLoadMore = useCallback(() => {
    setCurrentPage(prev => prev + 1);
  }, []);

  const handleResetPage = useCallback(() => {
    setCurrentPage(1);
  }, []);

  const handleCollectionCountUpdate = useCallback(() => {
    const loadCollections = async () => {
      const data = await getCollections();
      setCollections(data);
    };
    loadCollections();
  }, [getCollections]);

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
      handleDrawingUpdate(currentLoadedId, {
        ...drawingData,
        thumbnail,
        updatedAt: now,
      });
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
        await update(currentLoadedId, drawingData);
        handleDrawingUpdate(currentLoadedId, {
          ...drawingData,
          thumbnail,
          updatedAt: now,
        });
        if (collectionIds.length > 0) {
          handleCollectionCountUpdate();
        }
        toast.success(t("Drawing updated successfully"));
      } else {
        const newId = nanoid();
        const newDrawing = {
          id: newId,
          ...drawingData,
          createdAt: now,
          collectionIds,
        } as Drawing;
        await save(newDrawing);
        setCurrentLoadedId(newId);
        
        const newDrawingMetadata: DrawingMetadata = {
          id: newId,
          name: drawingData.name,
          thumbnail: drawingData.thumbnail,
          collectionIds,
          createdAt: now,
          updatedAt: now,
        };
        setAllDrawings(prev => [newDrawingMetadata, ...prev]);
        
        if (collectionIds.length > 0) {
          handleCollectionCountUpdate();
        }
        toast.success(t("Drawing saved successfully"));
      }
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
        handleDrawingUpdate(targetDrawingId, {
          ...drawingData,
          thumbnail,
          updatedAt: now,
        });
        toast.success(t("Drawing overwritten successfully"));
      } catch (error) {
        console.error("Failed to overwrite drawing:", error);
        toast.error(t("Failed to overwrite drawing"));
      }
    },
    [excalidrawAPI, generateThumbnail, getDrawingName, update, handleDrawingUpdate, t],
  );

  const handleLoad = useCallback(
    async (drawing: DrawingMetadata) => {
      if (!excalidrawAPI) return;

      try {
        const fullDrawing = await getFullData(drawing.id);
        const elements = JSON.parse(fullDrawing.elements);
        const appState = JSON.parse(fullDrawing.appState);
        const files = JSON.parse(fullDrawing.files);

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
    [excalidrawAPI, getFullData, setCurrentLoadedId, t],
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
            <SearchBar onResetPage={handleResetPage} />
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
      <CollectionManager 
        collections={collections} 
        setCollections={setCollections}
        drawingCounts={drawingCounts}
        onResetPage={handleResetPage}
      />
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
            drawings={displayedDrawings}
            collections={collections}
            onLoad={handleLoad}
            onOverwrite={handleOverwrite}
            currentId={currentLoadedId}
            onDrawingUpdate={handleDrawingUpdate}
            onDrawingDelete={handleDrawingDelete}
            onLoadMore={handleLoadMore}
            hasMore={paginationInfo.hasMore} total={paginationInfo.total} currentPage={currentPage}
            onCollectionCountUpdate={handleCollectionCountUpdate}
          />
        </Suspense>
      </ScrollArea>
      <SaveDialog
        isOpen={saveDialogOpen}
        onClose={() => setSaveDialogOpen(false)}
        onSave={handleSaveDialogConfirm}
        currentLoadedDrawingId={currentLoadedId}
        defaultName={currentName}
        collections={collections}
      />
    </Sidebar>
  );
};

export default GallerySidebar;
