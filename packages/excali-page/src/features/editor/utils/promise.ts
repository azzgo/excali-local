export interface WithResolves<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: any) => void;
}

export function PromsieWithResolve<T = any>() {
  const withResolves: Partial<WithResolves<T>> = {
    promise: undefined,
    resolve: undefined,
    reject: undefined,
  };

  withResolves.promise = new Promise<T>((resolve, reject) => {
    withResolves.resolve = resolve;
    withResolves.reject = reject;
  });

  return withResolves as WithResolves<T>;
}
