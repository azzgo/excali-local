import { FormEventHandler, useRef, useCallback, useEffect } from "react";
import { saveSetting, getSetting, t } from "../lib/utils";
import FontChooser from "./FontChooser";
import { FontData } from "./type";
import { toast } from "sonner";
import { IconCheck, IconX } from "@tabler/icons-react";

const OptionsPage = () => {
  const formRef = useRef<HTMLFormElement>(null);
  const handleSave: FormEventHandler = useCallback((e) => {
    e.preventDefault();
    const formData = new FormData(formRef.current!);
    const handwriting = formData.get("handwriting") as string;
    const normal = formData.get("normal") as string;
    const code = formData.get("code") as string;

    saveSetting({
      font: {
        handwriting: handwriting || null,
        normal: normal || null,
        code: code || null,
      },
    }).then(
      () => {
        toast(t("SaveSuccess"), {
          icon: <IconCheck className="text-green-500 size-4" />,
          description: t("SaveSuccessContent"),
          id: "save-success",
          duration: 1500,
        });
      },
      (error) => {
        toast(t("SaveFailed"), {
          icon: <IconX className="text-red-500 size-4" />,
          description: error.message,
          duration: 3000,
        });
      }
    );
  }, []);

  useEffect(() => {
    getSetting().then((setting) => {
      if (setting) {
        const handwriting = formRef.current?.querySelector(
          'input[name="handwriting"]'
        ) as HTMLInputElement;
        const normal = formRef.current?.querySelector(
          'input[name="normal"]'
        ) as HTMLInputElement;
        const code = formRef.current?.querySelector(
          'input[name="code"]'
        ) as HTMLInputElement;

        handwriting.value = setting.font.handwriting || "";
        normal.value = setting.font.normal || "";
        code.value = setting.font.code || "";
      }
    });
  }, []);

  const handleFontChoose = useCallback(
    (name: string) => (font: FontData) => {
      const input = formRef.current?.querySelector(
        `input[name="${name}"]`
      ) as HTMLInputElement;
      input.value = font.postscriptName;
    },
    []
  );

  return (
    <div className="flex justify-center items-center h-screen p-4 bg-gray-100 dark:bg-gray-900 transition-colors duration-200">
      <form
        ref={formRef}
        onSubmit={handleSave}
        className="w-full max-w-md bg-white dark:bg-gray-800 shadow-md rounded-xl p-6 border border-gray-200 dark:border-gray-700 transition-colors duration-200"
      >
        <div className="mb-4">
          <h2 className="text-xl font-semibold mb-2 text-gray-900 dark:text-white">{t("Font")}</h2>
          <div className="space-y-4">
            <div className="flex items-center relative">
              <label className="w-1/3 text-gray-700 dark:text-gray-300" htmlFor="handwriting-font">
                {t("Handwriting")}:
              </label>
              <input
                name="handwriting"
                type="text"
                id="handwriting-font"
                className="w-2/3 p-2 border border-gray-300 dark:border-gray-600 rounded outline-none focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
                placeholder={t("FontPlaceholder")}
              />
              <span className="cursor-pointer absolute inset-y-0 end-0 grid w-10 place-content-center text-gray-700 dark:text-gray-300 group">
                <FontChooser
                  className="size-4 group-hover:size-6 transition-all"
                  onChoose={handleFontChoose("handwriting")}
                />
              </span>
            </div>
            <div className="flex items-center relative">
              <label className="w-1/3 text-gray-700 dark:text-gray-300" htmlFor="normal-font">
                {t("Normal")}:
              </label>
              <input
                type="text"
                name="normal"
                id="normal-font"
                className="w-2/3 p-2 border border-gray-300 dark:border-gray-600 rounded outline-none focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
                placeholder={t("FontPlaceholder")}
              />
              <span className="cursor-pointer absolute inset-y-0 end-0 grid w-10 place-content-center text-gray-700 dark:text-gray-300 group">
                <FontChooser
                  className="size-4 group-hover:size-6 transition-all"
                  onChoose={handleFontChoose("normal")}
                />
              </span>
            </div>
            <div className="flex items-center relative">
              <label className="w-1/3 text-gray-700 dark:text-gray-300" htmlFor="code-font">
                {t("Code")}:
              </label>
              <input
                type="text"
                name="code"
                id="code-font"
                className="w-2/3 p-2 border border-gray-300 dark:border-gray-600 rounded outline-none focus:border-blue-500 dark:focus:border-blue-400 bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-colors duration-200"
                placeholder={t("FontPlaceholder")}
              />
              <span className="cursor-pointer absolute inset-y-0 end-0 grid w-10 place-content-center text-gray-700 dark:text-gray-300 group">
                <FontChooser
                  className="size-4 group-hover:size-6 transition-all"
                  onChoose={handleFontChoose("code")}
                />
              </span>
            </div>
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
