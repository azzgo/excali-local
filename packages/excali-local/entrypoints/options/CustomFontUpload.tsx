import { useState, useRef, useCallback } from "react";
import { IconUpload, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { t } from "../lib/utils";
import type { FontSource } from "excali-shared";

const FONT_SIZE_LIMIT = 30 * 1024 * 1024;

const VALID_EXTENSIONS = [".ttf", ".otf", ".woff", ".woff2"];

interface CustomFontUploadProps {
  onUpload: (fontSource: FontSource) => void;
  onClear?: () => void;
  currentFamily?: string | null;
}

export function CustomFontUpload({
  onUpload,
  onClear,
  currentFamily,
}: CustomFontUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  const validateFile = useCallback((file: File): string | null => {
    const extension = "." + file.name.split(".").pop()?.toLowerCase();
    if (!VALID_EXTENSIONS.includes(extension)) {
      return t("UnsupportedFontFormat");
    }
    if (file.size > FONT_SIZE_LIMIT) {
      return t("FontFileTooLarge");
    }
    return null;
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const error = validateFile(file);
      if (error) {
        toast.error(error);
        return;
      }

      setIsUploading(true);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const fontFace = new FontFace(file.name?.split('.')?.at(0) ?? `TempFile-${Math.random().toString(16).slice(2,7)}`, uint8Array);
        await fontFace.load();
        document.fonts.add(fontFace);
        const family = fontFace.family;

        onUpload({
          type: "custom",
          family,
          data: uint8Array,
        });

        toast.success(t("FontUploadedSuccess"), {
          description: family,
          duration: 2000,
        });
      } catch {
        toast.error(t("FontUploadFailed"));
      } finally {
        setIsUploading(false);
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    },
    [validateFile, onUpload],
  );

  const handleClear = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    onClear?.();
  }, [onClear]);

  if (currentFamily) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-700 dark:text-gray-300">
          {currentFamily}
        </span>
        <button
          onClick={handleClear}
          className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
          title={t("Remove")}
        >
          <IconX className="w-4 h-4 text-gray-500 dark:text-gray-400" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".ttf,.otf,.woff,.woff2"
        onChange={handleFileChange}
        disabled={isUploading}
        className="hidden"
      />
      <button
        type="button"
        disabled={isUploading}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-dashed border-input bg-white hover:bg-neutral-100/50 hover:border-neutral-500 transition-colors cursor-pointer"
        onClick={() => fileInputRef.current?.click()}
      >
        <IconUpload className="w-4 h-4" />
        <span className="text-sm text-neutral-500">
          {isUploading ? t("Uploading") : t("UploadFont")}
        </span>
      </button>
    </div>
  );
}
