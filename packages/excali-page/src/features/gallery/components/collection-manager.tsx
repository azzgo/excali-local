import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  selectedCollectionIdAtom,
  collectionsListAtom,
  collectionsRefreshAtom,
} from "../store/gallery-atoms";
import { useDrawingCrud } from "../hooks/use-drawing-crud";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { IconPlus } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const CollectionSelect = () => {
  const [selectedId, setSelectedId] = useAtom(selectedCollectionIdAtom);
  const collections = useAtomValue(collectionsListAtom);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState("");
  const { createCollection } = useDrawingCrud();
  const setCollectionsRefresh = useSetAtom(collectionsRefreshAtom);

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      const collection = await createCollection(newCollectionName.trim());
      setCollectionsRefresh((prev) => prev + 1);
      setSelectedId(collection.id);
      setNewCollectionName("");
      setIsDialogOpen(false);
    } catch (error) {
      console.error("Failed to create collection:", error);
    }
  };

  return (
    <>
      <div className="flex gap-1 items-center w-full">
        <select
          value={selectedId ?? "all"}
          onChange={(e) =>
            setSelectedId(e.target.value === "all" ? null : e.target.value)
          }
          className={cn(
            "h-8 text-xs flex-1 rounded-md px-2 bg-[var(--color-surface-low)]",
            "border border-transparent hover:border-[var(--color-primary)]",
            "text-[var(--text-primary-color)] outline-none transition-colors",
            "focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
          )}
        >
          <option value="all">All Drawings</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={() => setIsDialogOpen(true)}
          title="Create Collection"
        >
          <IconPlus className="h-4 w-4" />
        </Button>
      </div>

      {isDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setIsDialogOpen(false)}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
              Create Collection
            </h2>
            <p className="text-sm text-[var(--text-secondary-color)] mb-4">
              Enter a name for your new collection.
            </p>
            <div className="mb-4">
              <label
                htmlFor="collection-name"
                className="block text-sm font-medium text-[var(--text-primary-color)] mb-2"
              >
                Collection Name
              </label>
              <input
                id="collection-name"
                type="text"
                value={newCollectionName}
                onChange={(e) => setNewCollectionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateCollection();
                  } else if (e.key === "Escape") {
                    setIsDialogOpen(false);
                  }
                }}
                placeholder="e.g., Work, Personal, Archive"
                className={cn(
                  "w-full h-9 px-3 rounded-md bg-input",
                  "border border-border",
                  "text-[var(--text-primary-color)] placeholder:text-[var(--text-secondary-color)]",
                  "outline-none transition-colors",
                  "focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
                )}
                autoFocus
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setIsDialogOpen(false)}>
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
    </>
  );
};

const CollectionManager = () => {
  return (
    <Suspense
      fallback={
        <div className="h-8 w-full bg-muted rounded animate-pulse" />
      }
    >
      <CollectionSelect />
    </Suspense>
  );
};

export default CollectionManager;
