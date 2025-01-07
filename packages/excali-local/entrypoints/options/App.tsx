import { FormEventHandler } from "react";
import { saveSetting, getSetting, t } from "../lib/utils";
import { useSimpleNotify } from "../lib/hooks/use-simple-notify";
import FontChooser from "./FontChooser";
import { FontData } from "./type";

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
        notify({
          type: "success",
          title: t("SaveSuccess"),
          message: t("SaveSuccessContent"),
        });
      },
      (error) => {
        notify({
          type: "error",
          title: t("SaveFailed"),
          message: error.message,
        });
      }
    );
  }, []);

  const { notify, Notify } = useSimpleNotify();

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
    <div className="flex justify-center items-center h-screen p-4 bg-gray-100">
      <form
        ref={formRef}
        onSubmit={handleSave}
        className="w-full max-w-md bg-white shadow-md rounded-xl p-6 border"
      >
        <div className="mb-4">
          <h2 className="text-xl font-semibold mb-2">{t("Font")}</h2>
          <div className="space-y-4">
            <div className="flex items-center relative">
              <label className="w-1/3 text-gray-700" htmlFor="handwriting-font">
                {t("Handwriting")}:
              </label>
              <input
                name="handwriting"
                type="text"
                id="handwriting-font"
                className="w-2/3 p-2 border rounded outline-none focus:border-blue-500"
                placeholder={t("FontPlaceholder")}
              />
              <span className="cursor-pointer absolute inset-y-0 end-0 grid w-10 place-content-center text-gray-700 group">
                <FontChooser
                  className="size-4 group-hover:size-6 transition-all"
                  onChoose={handleFontChoose("handwriting")}
                />
              </span>
            </div>
            <div className="flex items-center relative">
              <label className="w-1/3 text-gray-700" htmlFor="normal-font">
                {t("Normal")}:
              </label>
              <input
                type="text"
                name="normal"
                id="normal-font"
                className="w-2/3 p-2 border rounded outline-none focus:border-blue-500"
                placeholder={t("FontPlaceholder")}
              />
              <span className="cursor-pointer absolute inset-y-0 end-0 grid w-10 place-content-center text-gray-700 group">
                <FontChooser
                  className="size-4 group-hover:size-6 transition-all"
                  onChoose={handleFontChoose("normal")}
                />
              </span>
            </div>
            <div className="flex items-center relative">
              <label className="w-1/3 text-gray-700" htmlFor="code-font">
                {t("Code")}:
              </label>
              <input
                type="text"
                name="code"
                id="code-font"
                className="w-2/3 p-2 border rounded outline-none focus:border-blue-500"
                placeholder={t("FontPlaceholder")}
              />
              <span className="cursor-pointer absolute inset-y-0 end-0 grid w-10 place-content-center text-gray-700 group">
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
            className="w-full px-4 py-2 rounded bg-blue-500 text-white hover:bg-blue-600"
          >
            {t("Save")}
          </button>
        </div>
      </form>
      <Notify />
    </div>
  );
};

export default OptionsPage;
