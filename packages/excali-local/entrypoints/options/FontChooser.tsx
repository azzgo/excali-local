import { useState, useRef, MouseEventHandler } from "react";
import { IconLetterCase } from "@tabler/icons-react";
import { FontData } from "./type";
import { t } from "../lib/utils";

export interface FontChooserProps {
  onChoose?: (font: FontData) => void;
  className?: string;
}

declare global {
  interface Window {
    queryLocalFonts: () => Promise<FontData[]>;
  }
}

const FontChooser = ({ className, onChoose }: FontChooserProps) => {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [fontList, setFontList] = useState<FontData[]>([]);
  const [searchText, setSearchText] = useState("");
  const [selectedFont, setSelectedFont] = useState<FontData | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const openDialog = async () => {
    if (fontList.length === 0) {
      const fonts = await window.queryLocalFonts();
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

  return (
    <>
      <IconLetterCase onClick={openDialog} className={className} />
      <dialog ref={dialogRef} className="w-[800px]">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-lg font-semibold">{t("ChooseAFont")}</h2>
          <button onClick={closeDialog} className="text-lg font-bold">
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
            className="p-2 border rounded w-full mb-4"
          />
          <ul className="font-list overflow-y-auto h-64">
            {filteredFonts.map((font) => (
              <li
                key={font.postscriptName}
                onClick={() => setSelectedFont(font)}
                className={`cursor-pointer p-2 hover:bg-gray-200 ${
                  selectedFont?.postscriptName === font.postscriptName &&
                  "bg-gray-300"
                }`}
              >
                {font.family} - {font.style}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex justify-end p-4 border-t">
          <button
            onClick={closeDialog}
            className="px-4 py-2 mr-2 border rounded"
          >
            {t("Cancel")}
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-500 text-white rounded"
          >
            {t("Save")}
          </button>
        </div>
      </dialog>
    </>
  );
};

export default FontChooser;
