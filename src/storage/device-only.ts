// The keychain calls this needs; with no options they reach the items older builds wrote.
export type Keychain<O> = {
  get(key: string, options?: O): string | null;
  set(key: string, value: string, options?: O): void;
  remove(key: string, options?: O): void;
};

export type KeyValueStore = {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
};

// Every write goes to the device-only items; an item an older build wrote moves over on its first read or write.
export function deviceOnly<O>(keychain: Keychain<O>, device: O): KeyValueStore {
  const checked = new Set<string>();
  const dropOld = (key: string): void => {
    if (checked.has(key)) return;
    checked.add(key);
    keychain.remove(key);
  };
  return {
    get(key) {
      const value = keychain.get(key, device);
      if (value !== null || checked.has(key)) return value;
      checked.add(key);
      const old = keychain.get(key);
      if (old === null) return null;
      keychain.set(key, old, device);
      keychain.remove(key);
      return old;
    },
    set(key, value) {
      keychain.set(key, value, device);
      dropOld(key);
    },
    remove(key) {
      keychain.remove(key, device);
      dropOld(key);
    },
  };
}
