import { deleteItemAsync, getItem, setItem } from 'expo-secure-store';

// Sync reads and writes keep the persist-before-send ordering of the relay client.
export const secureStorage = {
  get(key: string): string | null {
    return getItem(key);
  },
  set(key: string, value: string): void {
    setItem(key, value);
  },
  remove(key: string): void {
    void deleteItemAsync(key);
  },
};
