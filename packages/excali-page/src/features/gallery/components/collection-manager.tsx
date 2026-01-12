import { useAtom } from "jotai";
import {
  selectedCollectionIdAtom,
} from "../store/gallery-atoms";
import { useDrawingCrud } from "../hooks/use-drawing-crud";
import { Collection } from "../../editor/utils/indexdb";
import { useState, MouseEvent } from "react";
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
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CollectionItemProps {
  collection: { id: string; name: string };
  isSelected: boolean;
  onClick: () => void;
  count: number;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  onResetPage: () => void;
}

const CollectionItem = ({ 
  collection, 
  isSelected, 
  onClick, 
  count,
  onRename,
  onDelete,
  onResetPage,
}: CollectionItemProps) => {
  const [t] = useTranslation();
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [newName, setNewName] = useState(collection.name);

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();
    if (confirm(t('Delete collection "{{name}}"? This will remove the collection but keep the drawings.', { name: collection.name }))) {
      onDelete(collection.id);
      onResetPage();
      
      if (isSelected) {
        onClick(); 
      }
    }
  };

  const handleRename = async () => {
    if (!newName.trim() || newName === collection.name) {
      setIsRenameDialogOpen(false);
      return;
    }

    onRename(collection.id, newName.trim());
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
        
        <div 
          className="relative opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 hover:bg-[var(--bg-secondary)]"
              >
                <IconDots className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-32">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  setNewName(collection.name);
                  setIsRenameDialogOpen(true);
                }}
              >
                {t("Rename")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleDelete}
                className="text-red-500 focus:text-red-500"
              >
                {t("Delete")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
              {t("Rename Collection")}
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
                {t("Cancel")}
              </Button>
              <Button onClick={handleRename} disabled={!newName.trim()}>
                {t("Save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

interface CollectionsListProps {
  collections: Collection[];
  setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  drawingCounts: Record<string, number>;
  onResetPage: () => void;
}

const CollectionsList = ({ collections, setCollections, drawingCounts, onResetPage }: CollectionsListProps) => {
  const [t] = useTranslation();
  const [selectedId, setSelectedId] = useAtom(selectedCollectionIdAtom);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const { createCollection, updateCollection, deleteCollection } = useDrawingCrud();

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    const tempId = `temp-${Date.now()}`;
    const newCollection: Collection = {
      id: tempId,
      name: newCollectionName.trim(),
      createdAt: Date.now(),
    };

    setCollections(prev => [...prev, newCollection]);
    setNewCollectionName("");
    setIsCreateDialogOpen(false);
    setIsExpanded(true);

    try {
      const savedCollection = await createCollection(newCollectionName.trim());
      setCollections(prev => prev.map(c => c.id === tempId ? savedCollection : c));
      setSelectedId(savedCollection.id);
      onResetPage();
    } catch (error) {
      console.error("Failed to create collection:", error);
      setCollections(prev => prev.filter(c => c.id !== tempId));
      toast.error(t("Failed to create collection"));
    }
  };

  const handleSelectCollection = (id: string | null) => {
    setSelectedId(id);
    onResetPage();
  };

  const handleRename = async (id: string, newName: string) => {
    const oldCollection = collections.find(c => c.id === id);
    if (!oldCollection) return;

    setCollections(prev => prev.map(c => c.id === id ? { ...c, name: newName } : c));

    try {
      await updateCollection(id, { name: newName });
    } catch (error) {
      console.error("Failed to rename collection:", error);
      setCollections(prev => prev.map(c => c.id === id ? oldCollection : c));
      toast.error(t("Failed to rename collection"));
    }
  };

  const handleDelete = async (id: string) => {
    const oldCollection = collections.find(c => c.id === id);
    if (!oldCollection) return;

    setCollections(prev => prev.filter(c => c.id !== id));

    try {
      await deleteCollection(id);
    } catch (error) {
      console.error("Failed to delete collection:", error);
      setCollections(prev => [...prev, oldCollection]);
      toast.error(t("Failed to delete collection"));
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
          {t("COLLECTIONS")}
        </button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={() => setIsCreateDialogOpen(true)}
          title={t("Create Collection")}
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
            onClick={() => handleSelectCollection(null)}
          >
            <IconFolder className={cn("h-4 w-4 shrink-0", selectedId === null ? "fill-[var(--color-primary)]/20" : "")} />
            <span className="flex-1">{t("All Drawings")}</span>
          </div>
          
          {collections.map((collection) => (
            <CollectionItem
              key={collection.id}
              collection={collection}
              isSelected={selectedId === collection.id}
              onClick={() => handleSelectCollection(collection.id)}
              count={drawingCounts[collection.id] || 0}
              onRename={handleRename}
              onDelete={handleDelete}
              onResetPage={onResetPage}
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
              {t("Create Collection")}
            </h2>
            <div className="mb-4">
              <label
                htmlFor="new-collection-name"
                className="block text-sm font-medium text-[var(--text-primary-color)] mb-2"
              >
                {t("Collection Name")}
              </label>
              <Input
                id="new-collection-name"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateCollection();
                  if (e.key === "Escape") setIsCreateDialogOpen(false);
                }}
                placeholder={t("e.g., Work, Personal, Archive")}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setIsCreateDialogOpen(false)}>
                {t("Cancel")}
              </Button>
              <Button
                onClick={handleCreateCollection}
                disabled={!newCollectionName.trim()}
              >
                {t("Create")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface CollectionManagerProps {
  collections: Collection[];
  setCollections: React.Dispatch<React.SetStateAction<Collection[]>>;
  drawingCounts: Record<string, number>;
  onResetPage: () => void;
}

const CollectionManager = ({ collections, setCollections, drawingCounts, onResetPage }: CollectionManagerProps) => {
  return <CollectionsList collections={collections} setCollections={setCollections} drawingCounts={drawingCounts} onResetPage={onResetPage} />;
};

export default CollectionManager;
