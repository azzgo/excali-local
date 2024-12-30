export const KeyForSlideIdList = "excalidraw-slide-id-list";
export const KeyForElements = "excalidraw";
export const KeyForAppState = "excalidraw-state";
export const KeyForLibraryItems = "excalidraw-libraryItems";

export function setLocalStorage(key: string, value: any): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getLocalStorage<T = any>(key: string, defaultValue: T): T {
  const value = localStorage.getItem(key);
  return value ? (JSON.parse(value) as T) : defaultValue;
}

export function getLocalStorageAsync<T = any>(
  key: string,
  defaultValue: T
): Promise<T> {
  return new Promise((resolve) => {
    requestIdleCallback(() => {
      resolve(getLocalStorage(key, defaultValue));
    });
  });
}
