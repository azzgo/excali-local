import { useAtomValue } from "jotai";
import { collectionsListAtom } from "../store/gallery-atoms";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { IconDeviceFloppy, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, collectionIds: string[], saveAsNew: boolean) => Promise<void>;
  currentLoadedDrawingId: string | null;
  defaultName: string;
}

const SaveDialog = ({
  isOpen,
  onClose,
  onSave,
  currentLoadedDrawingId,
  defaultName,
}: SaveDialogProps) => {
  const [t] = useTranslation();
  const collections = useAtomValue(collectionsListAtom);
  const [name, setName] = useState(defaultName);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setSelectedCollections([]);
      setIsSaving(false);
    }
  }, [isOpen, defaultName]);

  if (!isOpen) return null;

  const toggleCollection = (collectionId: string) => {
    setSelectedCollections((prev) =>
      prev.includes(collectionId)
        ? prev.filter((id) => id !== collectionId)
        : [...prev, collectionId]
    );
  };

  const handleSave = async (saveAsNew: boolean) => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await onSave(name.trim(), selectedCollections, saveAsNew);
      onClose();
    } catch (error) {
      console.error("Save failed:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm transition-all"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg p-6 w-full max-w-md mx-4 border border-border shadow-xl animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-[var(--text-primary-color)] mb-4">
          {currentLoadedDrawingId ? t("Save as New Drawing") : t("Save New Drawing")}
        </h2>

        <div className="flex flex-col gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--text-primary-color)]">
              {t("Name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className={cn(
                "w-full h-9 px-3 rounded-md bg-input",
                "border border-border",
                "text-[var(--text-primary-color)] placeholder:text-[var(--text-secondary-color)]",
                "outline-none transition-colors",
                "focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
              )}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-[var(--text-primary-color)]">
              {t("Collections")}
            </label>
            <div className="max-h-48 overflow-y-auto border border-border rounded-md p-2 bg-muted">
              {collections.length === 0 ? (
                <p className="text-xs text-[var(--text-secondary-color)] text-center py-2">
                  {t("No collections found")}
                </p>
              ) : (
                <div className="space-y-1">
                  {collections.map((collection) => (
                    <label
                      key={collection.id}
                      className="flex items-center gap-2 p-2 rounded hover:bg-[var(--button-hover-bg)] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCollections.includes(collection.id)}
                        onChange={() => toggleCollection(collection.id)}
                        className="h-4 w-4 rounded border-gray-300 text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                      />
                      <span className="text-sm text-[var(--text-primary-color)]">
                        {collection.name}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2 justify-end mt-2">
            <Button variant="ghost" onClick={onClose} disabled={isSaving}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => handleSave(true)} disabled={isSaving || !name.trim()}>
              {t("Save")}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
};

export default SaveDialog;
