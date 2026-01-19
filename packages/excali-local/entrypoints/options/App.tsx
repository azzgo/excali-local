import {
  FormEventHandler,
  useRef,
  useCallback,
  useEffect,
  useState,
} from "react";
import { t } from "../lib/utils";
import { FontSlot } from "./FontSlot";
import type { FontSource, FontConfig } from "excali-shared";
import { getFontConfig, saveFontConfig } from "excali-shared";
import { toast } from "sonner";
import { IconCheck, IconX } from "@tabler/icons-react";

const OptionsPage = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const [fontConfig, setFontConfig] = useState<FontConfig>({
    handwriting: null,
    normal: null,
    code: null,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getFontConfig().then((config) => {
      if (config) {
        setFontConfig(config);
      }
      setIsLoading(false);
    });
  }, []);

  const handleSave: FormEventHandler = useCallback(
    async (e) => {
      e.preventDefault();
      try {
        await saveFontConfig(fontConfig);
        toast(t("SaveSuccess"), {
          icon: <IconCheck className="text-green-500 size-4" />,
          description: t("SaveSuccessContent"),
          id: "save-success",
          duration: 1500,
        });
      } catch (error) {
        toast(t("SaveFailed"), {
          icon: <IconX className="text-red-500 size-4" />,
          description: error instanceof Error ? error.message : String(error),
          duration: 3000,
        });
      }
    },
    [fontConfig],
  );

  const handleFontChange = useCallback(
    (slot: keyof FontConfig) => (value: FontSource | null) => {
      setFontConfig((prev) => ({ ...prev, [slot]: value }));
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-screen p-4 bg-gray-100 dark:bg-gray-900">
        <div className="text-gray-700 dark:text-gray-300">{t("Loading")}</div>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center h-screen p-4 bg-gray-100 dark:bg-gray-900 transition-colors duration-200">
      <form
        ref={formRef}
        onSubmit={handleSave}
        className="w-full min-w-xl max-w-2xl bg-white dark:bg-gray-800 shadow-md rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-colors duration-200"
      >
        <div className="mb-4">
          <header className="mb-4">
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
              {t("Font")}
            </h2>
            <p className="text-xs text-gray-500">{t("FontDescription")}</p>
          </header>
          <div className="space-y-3">
            <FontSlot
              label={t("Handwriting")}
              defaultFont="Excalifont"
              value={fontConfig.handwriting}
              onChange={handleFontChange("handwriting")}
            />
            <FontSlot
              label={t("Normal")}
              defaultFont="Nunito"
              value={fontConfig.normal}
              onChange={handleFontChange("normal")}
            />
            <FontSlot
              label={t("Code")}
              defaultFont="Comic Shanns"
              value={fontConfig.code}
              onChange={handleFontChange("code")}
            />
          </div>
        </div>
        <div className="mt-4">
          <button
            type="submit"
            className="w-full px-4 cursor-pointer py-2 rounded bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white transition-colors duration-200"
          >
            {t("Save")}
          </button>
        </div>
      </form>
    </div>
  );
};

export default OptionsPage;
