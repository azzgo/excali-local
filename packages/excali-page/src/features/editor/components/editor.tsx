import LocalEditor from "./local-editor";
import QuickMarkerEditor from "./quick-marker-editor";

const Editor = () => {
  const urlParams = new URLSearchParams(window.location.search);
  const pageType = urlParams.get("type");

  if (pageType === "local") {
    return <LocalEditor />;
  }

  if (pageType === "quick-marker") {
    return <QuickMarkerEditor />;
  }

  return <></>;
};

export default Editor;
