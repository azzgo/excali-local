import { useState, useCallback } from "react";
import FontChooser from "./FontChooser";
import { CustomFontUpload } from "./CustomFontUpload";
import { cn, t } from "../lib/utils";
import type { FontSource } from "excali-shared";

interface FontSlotProps {
  label: string;
  defaultFont: string;
  value: FontSource | null;
  onChange: (value: FontSource | null) => void;
}

export function FontSlot({
  label,
  defaultFont,
  value,
  onChange,
}: FontSlotProps) {
  const [mode, setMode] = useState<"system" | "custom">(
    value?.type === "custom" ? "custom" : "system",
  );

  const handleSystemFontSelect = useCallback(
    (font: { postscriptName: string }) => {
      onChange({ type: "system", postscriptName: font.postscriptName });
    },
    [onChange],
  );

  const handleCustomFontUpload = useCallback(
    (fontSource: FontSource) => {
      onChange(fontSource);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange(null);
  }, [onChange]);

  const toggleMode = useCallback(() => {
    setMode((prev) => {
      const newMode = prev === "system" ? "custom" : "system";
      if (prev === "custom") {
        onChange(null);
      }
      return newMode;
    });
  }, [onChange]);

  const fontFamily = useMemo(() => {
    if (value) {
      switch (value.type) {
        case "system":
          return value.postscriptName;
        case "custom":
          return value.family;
      }
    }
    return defaultFont;
  }, [value, defaultFont]);

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-neutral-200">
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-neutral-100 flex items-center justify-center">
        <span
          className="text-lg font-medium text-neutral-950"
          style={{ fontFamily: fontFamily }}
        >
          Aa
        </span>
      </div>
      <div className="w-30 text-left min-w-0">
        <span className="font-medium text-neutral-950">{label}</span>
        <p className="text-xs text-neutral-500 truncate mt-0.5" title={fontFamily}>
          {fontFamily}
          {value == null && "(Default)"}
        </p>
      </div>
      <div className="flex rounded-lg bg-neutral-100 p-0.5 flex-shrink-0">
        <button
          type="button"
          className={cn(
            "cursor-pointer px-3 py-1 text-xs font-medium rounded-md transition-all",
            mode === "system"
              ? "text-neutral-950 bg-white shadow-sm"
              : "text-neutral-500 hover:text-neutral-950",
          )}
          onClick={() => setMode("system")}
        >
          System
        </button>
        <button
          type="button"
          className={cn(
            "cursor-pointer px-3 py-1 text-xs font-medium rounded-md transition-all",
            mode === "custom"
              ? "text-neutral-950 bg-white shadow-sm"
              : "text-neutral-500 hover:text-neutral-950",
          )}
          onClick={() => setMode("custom")}
        >
          Custom
        </button>
      </div>
      <div className="flex-1 min-w-10">
        {mode === "system" ? (
          <div className="relative flex items-center">
            <input
              type="text"
              value={value?.type === "system" ? value.postscriptName : ""}
              onChange={(event) =>
                handleSystemFontSelect({ postscriptName: event.target.value })
              }
              placeholder={t("FontPlaceholder")}
              className="w-full h-10 px-3 pr-10 border border-gray-300 dark:border-gray-600 rounded-md outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white transition-all shadow-sm"
            />
            <span className="absolute inset-y-0 end-0 grid w-10 place-content-center text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer group">
              <FontChooser
                className="size-4 group-hover:size-5 transition-all"
                onChoose={handleSystemFontSelect}
              />
            </span>
          </div>
        ) : (
          <CustomFontUpload
            onUpload={handleCustomFontUpload}
            onClear={handleClear}
            currentFamily={value?.type === "custom" ? value.family : null}
          />
        )}
      </div>
    </div>
  );
}
