import { vi, beforeEach } from 'vitest';

// Mock localStorage
class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    const keys = Object.keys(this.store);
    return keys[index] || null;
  }
}

// Setup localStorage mock
Object.defineProperty(global, 'localStorage', {
  value: new LocalStorageMock(),
  writable: true,
});

// Setup sessionStorage mock
Object.defineProperty(global, 'sessionStorage', {
  value: new LocalStorageMock(),
  writable: true,
});

// Mock requestIdleCallback
global.requestIdleCallback = vi.fn().mockImplementation((callback: IdleRequestCallback) => {
  const handle = setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => 50,
    });
  }, 0);
  return handle as unknown as number;
});

global.cancelIdleCallback = vi.fn().mockImplementation((handle: number) => {
  clearTimeout(handle);
});

// Mock location to avoid the http check in font-injector
Object.defineProperty(global, 'location', {
  value: {
    href: 'chrome-extension://test/editor.html',
    origin: 'chrome-extension://test',
  },
  writable: true,
});

// Reset mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
  // Clear localStorage
  (global.localStorage as LocalStorageMock).clear();
  (global.sessionStorage as LocalStorageMock).clear();
});