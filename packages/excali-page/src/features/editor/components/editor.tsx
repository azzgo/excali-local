import { getLang } from "@/lib/utils";
import LocalEditor from "./local-editor";
import QuickMarkerEditor from "./quick-marker-editor";

const Editor = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const pageType = urlParams.get("type");
  const lang = getLang();

  if (pageType === "local") {
    return <LocalEditor lang={lang} />;
  }

  if (pageType === "quick-marker") {
    return <QuickMarkerEditor lang={lang} />;
  }

  return <></>;
};

export default Editor;
