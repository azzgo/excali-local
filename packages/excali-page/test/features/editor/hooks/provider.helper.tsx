import { Provider, createStore } from "jotai";
import { PropsWithChildren } from "react";

export const globalJotaiStore = createStore();

export function ProviderWrapper({ children }: PropsWithChildren) {
  return <Provider store={globalJotaiStore}>{children}</Provider>;
}
