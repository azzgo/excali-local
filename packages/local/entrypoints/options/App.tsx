import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { t } from "../lib/utils";
import { FontSlot } from "./FontSlot";
import type { FontSource, FontConfig } from "excali-shared";
import { getFontConfig, updateFontSlot, clearFontSlot } from "excali-shared";
import { toast } from "sonner";
import { IconX } from "@tabler/icons-react";

import AgentControl from "./AgentControl";
import CollabSection from "./CollabSection";
const OptionsPage = () => {
  const [fontConfig, setFontConfig] = useState<FontConfig>({
    handwriting: null,
    normal: null,
    code: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const fontConfigRef = useRef(fontConfig);

  useEffect(() => {
    fontConfigRef.current = fontConfig;
  }, [fontConfig]);

  useEffect(() => {
    getFontConfig().then((config) => {
      if (config) {
        setFontConfig(config);
      }
      setIsLoading(false);
    });
  }, []);

  // Optimistic UI + immediate persistence: every slot change (text commit,
  // FontChooser pick, custom upload, clear) flows through here. On persist
  // failure the UI rolls back to the previous value and a FontWriteFailed
  // toast is shown.
  const applySlot = useCallback(
    (slot: keyof FontConfig, source: FontSource | null) => {
      const prevValue = fontConfigRef.current[slot];
      setFontConfig((cur) => ({ ...cur, [slot]: source }));
      const persist =
        source === null
          ? clearFontSlot(slot)
          : updateFontSlot(slot, source);
      persist.catch((error) => {
        setFontConfig((cur) =>
          cur[slot] === source ? { ...cur, [slot]: prevValue } : cur,
        );
        toast(t("FontWriteFailed"), {
          icon: <IconX className="text-red-500 size-4" />,
          description: error instanceof Error ? error.message : String(error),
          duration: 3000,
        });
      });
    },
    [],
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-start min-h-screen p-4 bg-gray-100 dark:bg-gray-900 scroll-view">
        <div className="text-gray-700 dark:text-gray-300">{t("Loading")}</div>
      </div>
    );
  }
  return (
    <div className="flex justify-center items-start min-h-screen p-4 overflow-y-auto bg-gray-100 dark:bg-gray-900 transition-colors duration-200 scroll-view">
      <div className="w-full min-w-xl max-w-2xl bg-white dark:bg-gray-800 shadow-md rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-colors duration-200">
        <div className="mb-6">
          <AgentControl />
        </div>
        <div className="mb-4">
          <header className="mb-4">
            <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">
              {t("Font")}
            </h2>
            <p className="text-xs text-gray-500">{t("FontDescription")}</p>
            <p className="text-[11px] text-gray-400 mt-1">{t("FontApplyHint")}</p>
          </header>
          <div className="space-y-3">
            <FontSlot
              label={t("Handwriting")}
              defaultFont="Excalifont"
              value={fontConfig.handwriting}
              onChange={(v) => applySlot("handwriting", v)}
            />
            <FontSlot
              label={t("Normal")}
              defaultFont="Nunito"
              value={fontConfig.normal}
              onChange={(v) => applySlot("normal", v)}
            />
            <FontSlot
              label={t("Code")}
              defaultFont="Comic Shanns"
              value={fontConfig.code}
              onChange={(v) => applySlot("code", v)}
            />
          </div>
        </div>
        <div className="mb-4">
          <CollabSection />
        </div>
      </div>
    </div>
  );
};

export default OptionsPage;
