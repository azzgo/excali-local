import { useEffect, useLayoutEffect, useState } from "react";
import type { Theme } from "@excalidraw/excalidraw/element/types";

const THEME_STORAGE_KEY = "excali-editor-theme";

const getStoredTheme = (): Theme => {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") {
      return stored;
    }
  } catch {
    /* storage unavailable — fall through to light */
  }
  return "light";
};

/**
 * Bridges Excalidraw's own theme (`.excalidraw.theme--dark` class + its CSS
 * variable set) to the app's shadcn/Tailwind dark system. Excalidraw dark mode
 * only toggles `theme--dark` on its container, so every custom UI styled with
 * the app's `.dark` CSS-variable block / `dark:` variants stayed light
 * forever. Keeping the theme here as a controlled `<Excalidraw theme>` prop
 * (via `onThemeChange`) and mirroring it onto `document.documentElement` makes
 * both systems switch in sync, including components portaled to `document.body`
 * (Modals, tooltips), which are `.dark` descendants.
 *
 * The choice is persisted across reloads (Excalidraw itself does not persist
 * theme in this build).
 */
export const useEditorTheme = () => {
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  // Toggle the class before paint so the first frame is already themed.
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* storage unavailable */
    }
  }, [theme]);

  const handleThemeChange = (next: Theme | "system") => {
    if (next === "system") {
      const prefersDark =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches;
      setTheme(prefersDark ? "dark" : "light");
      return;
    }
    setTheme(next);
  };

  return { theme, handleThemeChange };
};
