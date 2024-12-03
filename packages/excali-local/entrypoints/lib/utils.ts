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
