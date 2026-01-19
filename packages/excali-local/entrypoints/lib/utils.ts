export { cn, PromiseWithResolver, type WithResolvers } from "excali-shared"

export function t(messageCode: string) {
  return browser.i18n.getMessage(messageCode as any);
}
