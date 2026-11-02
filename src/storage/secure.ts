import { WHEN_UNLOCKED_THIS_DEVICE_ONLY, deleteItemAsync, getItem, setItem, type SecureStoreOptions } from 'expo-secure-store';
import { deviceOnly } from './device-only.ts';

// Its own service, so new items are added with this protection; backups never carry them to another phone.
const DEVICE: SecureStoreOptions = { keychainService: 'wizzle-device', keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };

// Sync reads and writes keep the persist-before-send ordering of the relay client.
export const secureStorage = deviceOnly<SecureStoreOptions>(
  {
    get: (key, options) => getItem(key, options),
    set: (key, value, options) => setItem(key, value, options),
    remove: (key, options) => void deleteItemAsync(key, options),
  },
  DEVICE,
);
