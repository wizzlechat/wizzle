import { getRandomValues } from 'expo-crypto';
import type { CryptoProvider } from '../protocol/crypto.ts';
import { toB64Url } from '../protocol/index.ts';
import { createNobleCrypto } from './noble.ts';

// The app's provider: noble primitives over the native CSPRNG from expo-crypto.
export const wizzleCrypto: CryptoProvider = createNobleCrypto((length) => getRandomValues(new Uint8Array(length)));

// Nine random bytes as twelve url safe characters, for packet and message ids.
export function newId(): string {
  return toB64Url(wizzleCrypto.randomBytes(9));
}
