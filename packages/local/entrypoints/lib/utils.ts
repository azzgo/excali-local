export { cn, PromiseWithResolver, type WithResolvers } from "excali-shared"

export function t(messageCode: string, ...subs: Array<string | number>) {
  return browser.i18n.getMessage(messageCode as any, subs as any);
}
