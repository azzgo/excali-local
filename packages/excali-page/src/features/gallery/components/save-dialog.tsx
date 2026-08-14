import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Collection } from "../../editor/utils/indexdb";

interface SaveDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (name: string, collectionIds: string[], saveAsNew: boolean) => Promise<void>;
  currentLoadedDrawingId: string | null;
  defaultName: string;
  collections: Collection[];
}

const SaveDialog = ({
  isOpen,
  onClose,
  onSave,
  currentLoadedDrawingId,
  defaultName,
  collections,
}: SaveDialogProps) => {
  const [t] = useTranslation();
  const [name, setName] = useState(defaultName);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Draft-state lifecycle: seed fresh state when the dialog opens, and clear it
  // when it closes. Closing must not leave stale draft state behind — the
  // dialog component stays mounted (only the overlay unmounts), so without the
  // close branch a dismissed dialog would resurrect with its old draft.
  useEffect(() => {
    if (isOpen) {
      setName(defaultName);
      setSelectedCollections([]);
      setIsSaving(false);
    } else {
      setName("");
      setSelectedCollections([]);
      setIsSaving(false);
    }
  }, [isOpen, defaultName]);

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
    <Modal
      open={isOpen}
      title={currentLoadedDrawingId ? t("Save as New Drawing") : t("Save New Drawing")}
      onDismiss={isSaving ? undefined : onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t("Name")}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            className="w-full h-9 px-3 rounded-md bg-input border border-border text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t("Collections")}
          </label>
          <div className="max-h-48 overflow-y-auto border border-border rounded-md p-2 bg-muted">
            {collections.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">
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
                      className="h-4 w-4 rounded border-border text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
                    />
                    <span className="text-sm text-foreground">
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
    </Modal>
  );
};

export default SaveDialog;
