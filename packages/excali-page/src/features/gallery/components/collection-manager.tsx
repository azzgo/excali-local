import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  selectedCollectionIdAtom,
  collectionsListAtom,
  collectionsRefreshAtom,
  drawingsListAtom,
  galleryRefreshAtom,
} from "../store/gallery-atoms";
import { useDrawingCrud } from "../hooks/use-drawing-crud";
import { Suspense, useState, useRef, useEffect, MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import { 
  IconPlus, 
  IconFolder, 
  IconDots, 
  IconChevronRight, 
  IconChevronDown 
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const CollectionItem = ({ 
  collection, 
  isSelected, 
  onClick, 
  count 
}: { 
  collection: { id: string, name: string }, 
  isSelected: boolean, 
  onClick: () => void,
  count: number
}) => {
  const [showMenu, setShowMenu] = useState(false);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [newName, setNewName] = useState(collection.name);
  const { updateCollection, deleteCollection } = useDrawingCrud();
  const setCollectionsRefresh = useSetAtom(collectionsRefreshAtom);
  const setGalleryRefresh = useSetAtom(galleryRefreshAtom);
  const menuRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    const handleClickOutside = (e: Event) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showMenu]);

  const handleMenuClick = (e: MouseEvent) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete collection "${collection.name}"? This will remove the collection but keep the drawings.`)) {
      await deleteCollection(collection.id);
      setCollectionsRefresh((prev) => prev + 1);
      setGalleryRefresh((prev) => prev + 1);
      
      if (isSelected) {
        onClick(); 
      }
    }
    setShowMenu(false);
  };

  const handleRename = async () => {
    if (!newName.trim() || newName === collection.name) {
      setIsRenameDialogOpen(false);
      return;
    }

    await updateCollection(collection.id, { name: newName.trim() });
    setCollectionsRefresh((prev) => prev + 1);
    setIsRenameDialogOpen(false);
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm font-medium",
          isSelected 
            ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]" 
            : "text-[var(--text-secondary-color)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary-color)]"
        )}
        onClick={onClick}
      >
        <IconFolder className={cn("h-4 w-4 shrink-0", isSelected ? "fill-[var(--color-primary)]/20" : "")} />
        <span className="flex-1 truncate">{collection.name}</span>
        <span className="text-xs opacity-60 tabular-nums">{count}</span>
        
        <div className="relative opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 hover:bg-[var(--bg-secondary)]"
            onClick={handleMenuClick}
          >
            <IconDots className="h-3.5 w-3.5" />
          </Button>
          
          {showMenu && (
            <div
              ref={menuRef}
              className="absolute right-0 top-full mt-1 w-32 bg-popover rounded-md shadow-lg border border-border z-20 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="py-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setNewName(collection.name);
                    setIsRenameDialogOpen(true);
                    setShowMenu(false);
                  }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-[var(--text-primary-color)] hover:bg-[var(--button-hover-bg)] transition-colors"
                >
                  Rename
                </button>
                <button
                  onClick={handleDelete}
                  className="block w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-[var(--button-hover-bg)] transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {isRenameDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={(e) => {
            e.stopPropagation();
            setIsRenameDialogOpen(false);
          }}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-sm mx-4 border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-4">
              Rename Collection
            </h2>
            <div className="mb-4">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") setIsRenameDialogOpen(false);
                }}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setIsRenameDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleRename} disabled={!newName.trim()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

const CollectionsList = () => {
  const [selectedId, setSelectedId] = useAtom(selectedCollectionIdAtom);
  const collections = useAtomValue(collectionsListAtom);
  const drawings = useAtomValue(drawingsListAtom);
  const [isExpanded, setIsExpanded] = useState(true);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const { createCollection } = useDrawingCrud();
  const setCollectionsRefresh = useSetAtom(collectionsRefreshAtom);
  
  const [counts, setCounts] = useState<Record<string, number>>({});
  const { getAll } = useDrawingCrud();

  useEffect(() => {
    const fetchCounts = async () => {
      const allDrawings = await getAll();
      const newCounts: Record<string, number> = {};
      
      collections.forEach(c => newCounts[c.id] = 0);
      
      allDrawings.forEach(d => {
        if (d.collectionIds) {
          d.collectionIds.forEach(cId => {
            if (newCounts[cId] !== undefined) {
              newCounts[cId]++;
            }
          });
        }
      });
      setCounts(newCounts);
    };
    
    fetchCounts();
  }, [collections, getAll, drawings]); 

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      const collection = await createCollection(newCollectionName.trim());
      setCollectionsRefresh((prev) => prev + 1);
      setSelectedId(collection.id);
      setNewCollectionName("");
      setIsCreateDialogOpen(false);
      setIsExpanded(true); 
    } catch (error) {
      console.error("Failed to create collection:", error);
    }
  };

  return (
    <div className="flex flex-col gap-1 mt-2 mb-2 px-2">
      <div className="flex items-center justify-between px-2 group">
        <button 
          className="flex items-center gap-1 text-xs font-semibold text-[var(--text-secondary-color)] hover:text-[var(--text-primary-color)] transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronRight className="h-3.5 w-3.5" />}
          COLLECTIONS
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => setIsCreateDialogOpen(true)}
          title="Create Collection"
        >
          <IconPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-1 ml-1 pl-1 border-l border-[var(--border-color)]">
          <div
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors text-sm font-medium",
              selectedId === null
                ? "bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
                : "text-[var(--text-secondary-color)] hover:bg-[var(--button-hover-bg)] hover:text-[var(--text-primary-color)]"
            )}
            onClick={() => setSelectedId(null)}
          >
            <IconFolder className={cn("h-4 w-4 shrink-0", selectedId === null ? "fill-[var(--color-primary)]/20" : "")} />
            <span className="flex-1">All Drawings</span>
          </div>
          
          {collections.map((collection) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              isSelected={selectedId === collection.id}
              onClick={() => setSelectedId(collection.id)}
              count={counts[collection.id] || 0}
            />
          ))}
        </div>
      )}

      {isCreateDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setIsCreateDialogOpen(false)}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-sm mx-4 border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-4">
              Create Collection
            </h2>
            <div className="mb-4">
              <label
                htmlFor="new-collection-name"
                className="block text-sm font-medium text-[var(--text-primary-color)] mb-2"
              >
                Collection Name
              </label>
              <Input
                id="new-collection-name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCollection();
                  if (e.key === "Escape") setIsCreateDialogOpen(false);
                }}
                placeholder="e.g., Work, Personal, Archive"
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreateCollection}
                disabled={!newCollectionName.trim()}
              >
                Create
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const CollectionManager = () => {
  return (
    <Suspense
      fallback={
        <div className="h-8 w-full bg-muted rounded animate-pulse" />
      }
    >
      <CollectionsList />
    </Suspense>
  );
};

export default CollectionManager;
