import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 as nobleX25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import type { CryptoProvider, KeyPair } from '../protocol/crypto.ts';
import { X25519_BYTES } from '../protocol/crypto.ts';

export type RandomSource = (length: number) => Uint8Array;

// Pure JS provider. The random source is injected so the same code runs on Hermes and in Node.
export function createNobleCrypto(random: RandomSource): CryptoProvider {
  return {
    randomBytes(length) {
      return random(length);
    },
    sha256(data) {
      return nobleSha256(data);
    },
    hkdfSha256(ikm, salt, info, length) {
      return hkdf(nobleSha256, ikm, salt, info, length);
    },
    x25519KeyPair(): KeyPair {
      const privateKey = random(X25519_BYTES);
      return { publicKey: nobleX25519.getPublicKey(privateKey), privateKey };
    },
    x25519(privateKey, peerPublicKey) {
      return nobleX25519.getSharedSecret(privateKey, peerPublicKey);
    },
    aeadSeal(key, nonce, aad, plaintext) {
      return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
    },
    aeadOpen(key, nonce, aad, ciphertext) {
      try {
        return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
      } catch {
        return null;
      }
    },
  };
}
