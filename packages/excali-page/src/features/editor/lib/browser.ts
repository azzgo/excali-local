export function getBrowser(): typeof chrome | null {
  if (typeof (globalThis as any).browser !== "undefined") {
    return (globalThis as any).browser;
  }
  if (typeof chrome !== "undefined") {
    return chrome;
  }
  return null;
}
