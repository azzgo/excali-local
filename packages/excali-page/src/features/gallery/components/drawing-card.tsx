import { Drawing, Collection } from "../../editor/utils/indexdb";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { MouseEvent, useState } from "react";
import { Hint } from "@/components/ui/hint";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconDots } from "@tabler/icons-react";
import { useDrawingCrud } from "../hooks/use-drawing-crud";
import { useAtomValue, useSetAtom } from "jotai";
import { collectionsListAtom, collectionsRefreshAtom, galleryRefreshAtom } from "../store/gallery-atoms";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DrawingCardProps {
  drawing: Drawing;
  isActive: boolean;
  onClick: (drawing: Drawing) => void;
  onOverwrite: (drawingId: string) => Promise<void>;
}

const DrawingCard = ({ drawing, isActive, onClick, onOverwrite }: DrawingCardProps) => {
  const [showCollectionDialog, setShowCollectionDialog] = useState(false);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [showOverwriteDialog, setShowOverwriteDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedCollections, setSelectedCollections] = useState<string[]>(drawing.collectionIds || []);
  const [newName, setNewName] = useState(drawing.name);
  const { update, remove } = useDrawingCrud();
  const collections = useAtomValue(collectionsListAtom);
  const setGalleryRefresh = useSetAtom(galleryRefreshAtom);

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    onClick(drawing);
  };

  const handleDelete = async (e: MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    try {
      await remove(drawing.id);
      setGalleryRefresh((prev) => prev + 1);
      toast.success("Drawing deleted successfully");
    } catch (error) {
      console.error("Failed to delete drawing:", error);
      toast.error("Failed to delete drawing");
    }
    setShowDeleteDialog(false);
  };

  const handleRename = (e: MouseEvent) => {
    e.stopPropagation();
    setNewName(drawing.name);
    setShowRenameDialog(true);
  };

  const handleRenameConfirm = async () => {
    try {
      await update(drawing.id, { name: newName });
      setGalleryRefresh((prev) => prev + 1);
      toast.success("Drawing renamed successfully");
    } catch (error) {
      console.error("Failed to rename drawing:", error);
      toast.error("Failed to rename drawing");
    }
    setShowRenameDialog(false);
  };

  const handleOverwrite = (e: MouseEvent) => {
    e.stopPropagation();
    setShowOverwriteDialog(true);
  };

  const handleOverwriteConfirm = async () => {
    try {
      await onOverwrite(drawing.id);
      setShowOverwriteDialog(false);
    } catch (error) {
      console.error("Failed to overwrite drawing:", error);
    }
  };

  const handleAddToCollection = (e: MouseEvent) => {
    e.stopPropagation();
    setShowCollectionDialog(true);
  };

  const handleSaveCollections = async () => {
    await update(drawing.id, { collectionIds: selectedCollections });
    setGalleryRefresh((prev) => prev + 1);
    setShowCollectionDialog(false);
  };

  const toggleCollection = (collectionId: string) => {
    setSelectedCollections((prev) =>
      prev.includes(collectionId)
        ? prev.filter((id) => id !== collectionId)
        : [...prev, collectionId]
    );
  };

  return (
    <>
      <Hint label={`Updated: ${format(new Date(drawing.updatedAt), "PP p")}`}>
        <div
          className={cn(
            "group relative flex flex-col gap-2 p-3 rounded-lg border transition-all cursor-pointer h-full",
            "hover:bg-[var(--button-hover-bg)] hover:border-[var(--color-primary)]",
            isActive
              ? "bg-[var(--button-hover-bg)] border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]"
              : "bg-card border-transparent"
          )}
          onClick={handleClick}
        >
          <div className="relative aspect-video w-full overflow-hidden rounded-md bg-white/10 border border-black/5 dark:border-white/5">
            {drawing.thumbnail ? (
              <img
                src={drawing.thumbnail}
                alt={drawing.name}
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
                loading="lazy"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground bg-muted">
                No Preview
              </div>
            )}
            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 bg-card hover:bg-[var(--button-hover-bg)]"
                  >
                    <IconDots className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={handleRename}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleAddToCollection}>
                    Add to Collection
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleOverwrite}>
                    Overwrite with current canvas
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDelete} className="text-red-500 focus:text-red-500">
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium truncate text-[var(--text-primary-color)]">
              {drawing.name}
            </span>
            <span className="text-xs text-[var(--text-secondary-color)]">
              {format(new Date(drawing.updatedAt), "MMM d, yyyy")}
            </span>
            {drawing.collectionIds && drawing.collectionIds.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {drawing.collectionIds.map((id) => {
                  const collection = collections.find((c) => c.id === id);
                  return collection ? (
                    <span
                      key={id}
                      className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-primary)]/20 text-[var(--color-primary)]"
                    >
                      {collection.name}
                    </span>
                  ) : null;
                })}
              </div>
            )}
          </div>
        </div>
      </Hint>

      {showCollectionDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowCollectionDialog(false)}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
              Add to Collection
            </h2>
            <p className="text-sm text-[var(--text-secondary-color)] mb-4">
              Select collections for "{drawing.name}"
            </p>
            {collections.length === 0 ? (
              <p className="text-sm text-[var(--text-secondary-color)] py-4 text-center">
                No collections yet. Create one first!
              </p>
            ) : (
              <div className="max-h-64 overflow-y-auto mb-4">
                {collections.map((collection) => (
                  <label
                    key={collection.id}
                    className="flex items-center gap-2 p-2 rounded hover:bg-[var(--button-hover-bg)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedCollections.includes(collection.id)}
                      onChange={() => toggleCollection(collection.id)}
                      className="h-4 w-4"
                    />
                    <span className="text-sm text-[var(--text-primary-color)]">
                      {collection.name}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => setShowCollectionDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleSaveCollections}>Save</Button>
            </div>
          </div>
        </div>
      )}

      {showRenameDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowRenameDialog(false)}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
              Rename Drawing
            </h2>
            <p className="text-sm text-[var(--text-secondary-color)] mb-4">
              Enter a new name for this drawing
            </p>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Drawing name"
              className="mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleRenameConfirm();
                }
              }}
            />
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => setShowRenameDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleRenameConfirm} disabled={!newName.trim()}>
                Rename
              </Button>
            </div>
          </div>
        </div>
      )}

      {showOverwriteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowOverwriteDialog(false)}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
              Overwrite Drawing
            </h2>
            <p className="text-sm text-[var(--text-secondary-color)] mb-4">
              Overwrite "{drawing.name}" with current canvas? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => setShowOverwriteDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleOverwriteConfirm} variant="destructive">
                Overwrite
              </Button>
            </div>
          </div>
        </div>
      )}

      {showDeleteDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-2">
              Delete Drawing
            </h2>
            <p className="text-sm text-[var(--text-secondary-color)] mb-4">
              Delete "{drawing.name}"? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                onClick={() => setShowDeleteDialog(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleDeleteConfirm} variant="destructive">
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DrawingCard;
