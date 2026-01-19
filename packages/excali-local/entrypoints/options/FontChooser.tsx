import { useState, useRef, MouseEventHandler, useMemo } from "react";
import { IconAlertTriangle, IconLetterCase } from "@tabler/icons-react";
import { FontData } from "./type";
import { t } from "../lib/utils";
import { toast } from "sonner";

export interface FontChooserProps {
  onChoose?: (font: FontData) => void;
  className?: string;
}

declare global {
  interface Window {
    queryLocalFonts: () => Promise<FontData[]>;
  }
}

const canUseQueryLocalFont = "queryLocalFonts" in window;

const FontChooser = ({ className, onChoose }: FontChooserProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [fontList, setFontList] = useState<FontData[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selectedFont, setSelectedFont] = useState<FontData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const openDialog = async () => {
    if (fontList.length === 0) {
      const fonts = await window.queryLocalFonts();
      const permitResult = await navigator.permissions.query({
        name: "local-fonts" as any,
      });
      if (permitResult.state === "denied") {
        toast(t("LocalFontPermissionDenied"), {
          icon: <IconAlertTriangle className="text-yellow-500 size-4" />,
          description: t("LocalFontPermissionDeniedContent"),
          duration: 5000,
          closeButton: true,
          dismissible: true,
          id: "local-font-permission-denied",
        });
        return;
      }
      setFontList(fonts);
    }
    dialogRef.current?.showModal();
  };

  const closeDialog: MouseEventHandler = (e) => {
    e.preventDefault();
    setSearchText("");
    setSelectedFont(null);
    dialogRef.current?.close();
  };

  const handleSave: MouseEventHandler = (e) => {
    e.preventDefault();
    if (onChoose && selectedFont) {
      onChoose(selectedFont);
    }
    closeDialog(e);
  };

  const filteredFonts = useMemo(
    () =>
      fontList.filter((font) =>
        font.family.toLowerCase().includes(searchText.toLowerCase())
      ),
    [fontList, searchText]
  );

  if (!canUseQueryLocalFont) {
    return null;
  }

  return (
    <>
      <IconLetterCase onClick={openDialog} className={className} />
      <dialog ref={dialogRef} className="w-[800px] m-auto cursor-auto bg-white dark:bg-gray-800 text-gray-900 dark:text-white rounded-lg border border-gray-200 dark:border-gray-700">
        <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-lg font-semibold">{t("ChooseAFont")}</h2>
          <button onClick={closeDialog} className="text-lg font-bold cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200">
            &times;
          </button>
        </div>
        <div className="p-4">
          <input
            ref={searchRef}
            type="text"
            placeholder={t("FontSearch")}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="p-2 border border-gray-300 dark:border-gray-600 rounded w-full mb-4 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400"
          />
          <ul className="font-list overflow-y-auto h-64">
            {filteredFonts.map((font) => (
              <li
                key={font.postscriptName}
                onClick={() => setSelectedFont(font)}
                style={{ contentVisibility: "auto" }}
                className={`cursor-pointer p-2 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200 ${
                  selectedFont?.postscriptName === font.postscriptName &&
                  "bg-gray-300 dark:bg-gray-600"
                }`}
              >
                {font.family} - {font.style}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end p-4 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={closeDialog}
            className="px-4 py-2 mr-2 border border-gray-300 dark:border-gray-600 rounded cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded cursor-pointer transition-colors duration-200"
          >
            {t("Save")}
          </button>
        </div>
      </dialog>
    </>
  );
};

export default FontChooser;
