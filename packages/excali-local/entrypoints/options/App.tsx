import { FormEventHandler } from "react";
import { ExcaliLocalSetting, saveSetting, t } from "../lib/utils";
import { useSimpleNotify } from "../lib/hooks/use-simple-notify";


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
    }).then(() => {
      notify({
        type: "success",
        title: t("SaveSuccess"),
        message: t("SaveSuccessContent"),
      });
    }, (error) => {
      notify({
        type: "error",
        title: t("SaveFailed"),
        message: error.message,
      });
    });
  }, []);

  const { notify, Notify } = useSimpleNotify();

  return (
    <div className="flex justify-center items-center h-screen p-4 bg-gray-100">
      <form
        ref={formRef}
        onSubmit={handleSave}
        className="w-full max-w-md bg-white shadow-md rounded-lg p-6 border"
      >
        <div className="mb-4">
          <h2 className="text-xl font-semibold mb-2">{t("Font")}</h2>
          <div className="space-y-4">
            <div className="flex items-center">
              <label className="w-1/3 text-gray-700" htmlFor="handwriting-font">
                {t("Handwriting")}:
              </label>
              <input
                name="handwriting"
                type="text"
                id="handwriting-font"
                className="w-2/3 p-2 border rounded-md"
                placeholder={t("HandwritingFontPlaceholder")}
              />
            </div>
            <div className="flex items-center">
              <label className="w-1/3 text-gray-700" htmlFor="normal-font">
                {t("Normal")}:
              </label>
              <input
                type="text"
                name="normal"
                id="normal-font"
                className="w-2/3 p-2 border rounded-md"
                placeholder={t("HandwritingFontPlaceholder")}
              />
            </div>
            <div className="flex items-center">
              <label className="w-1/3 text-gray-700" htmlFor="code-font">
                {t("Code")}:
              </label>
              <input
                type="text"
                name="code"
                id="code-font"
                className="w-2/3 p-2 border rounded-md"
                placeholder={t("HandwritingFontPlaceholder")}
              />
            </div>
          </div>
        </div>
        <div className="mt-4">
          <button
            type="submit"
            className="w-full px-4 py-2 border rounded-md bg-blue-500 text-white hover:bg-blue-600"
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
