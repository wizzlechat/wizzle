import { getRandomValues } from 'expo-crypto';
import type { CryptoProvider } from '../protocol/crypto.ts';
import { createNobleCrypto } from './noble.ts';

// The app's provider: noble primitives over the native CSPRNG from expo-crypto.
export const wizzleCrypto: CryptoProvider = createNobleCrypto((length) => getRandomValues(new Uint8Array(length)));
