// Browsers have no keychain; localStorage keeps a pairing across reloads during development.
export const secureStorage = {
  get(key: string): string | null {
    try {
      return globalThis.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      return;
    }
  },
  remove(key: string): void {
    try {
      globalThis.localStorage.removeItem(key);
    } catch {
      return;
    }
  },
};
