export { cn, PromiseWithResolver, type WithResolvers } from "excali-shared"
import { storage } from "wxt/storage"

export interface ExcaliLocalSetting {
  font: {
    handwriting: string | null;
    normal: string | null;
    code: string | null;
  };
}
export function saveSetting(setting: ExcaliLocalSetting) {
  return storage.setItem("local:settings", setting);
}

export function getSetting() {
  return storage.getItem<ExcaliLocalSetting | null>("local:settings");
}

export function t(messageCode: string) {
  return browser.i18n.getMessage(messageCode as any);
}
