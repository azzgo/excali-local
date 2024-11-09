type PageType = "edit" | "new";

export const useDrawQuery = () => {
  const searchParams = new URLSearchParams(window.location.search);
  const pageType = searchParams.get("type") || "new";
  const id = searchParams.get("id");

  return { pageType: pageType as PageType, id };
};
