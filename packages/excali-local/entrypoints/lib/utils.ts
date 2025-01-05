import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { storage } from "wxt/storage";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export interface WithResolvers<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export function PromsieWithResolver<T = any>() {
  const withResolves: Partial<WithResolvers<T>> = {
    promise: undefined,
    resolve: undefined,
    reject: undefined,
  };

  withResolves.promise = new Promise<T>((resolve, reject) => {
    withResolves.resolve = resolve;
    withResolves.reject = reject;
  });

  return withResolves as WithResolvers<T>;
}

export function t(messageCode: string) {
  return browser.i18n.getMessage(messageCode as any);
}

export interface ExcaliLocalSetting {
  langCode: "en" | "zh_CN" | "system";
  font: {
    handwriting: string | null;
    normal: string | null;
    code: string | null;
  };
}
export function saveSetting(setting: ExcaliLocalSetting) {
  return storage.setItem("local:settings", setting);
}

export function getString() {
  return storage.getItem<ExcaliLocalSetting | null>("local:settings");
}
