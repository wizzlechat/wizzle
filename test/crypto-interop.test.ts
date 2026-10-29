import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNobleCrypto } from '../src/crypto/noble.ts';
import { equal, utf8 } from '../src/protocol/bytes.ts';
import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import { NONCE_BYTES, TAG_BYTES } from '../src/protocol/crypto.ts';
import { FRAME_HEADER_BYTES, MAX_FILE_BYTES, decodeFrame } from '../src/protocol/envelope.ts';
import { decodePacket, encodePacket } from '../src/protocol/messages.ts';
import { derivePairedRelaySecret, derivePsk, deriveRelaySecret } from '../src/protocol/pairing.ts';
import { Session } from '../src/protocol/session.ts';

// Same shape as the app binding, with Node's CSPRNG in place of expo-crypto.
const wizzleCrypto = createNobleCrypto((length) => globalThis.crypto.getRandomValues(new Uint8Array(length)));

function plaintextOf(result: ReturnType<Session['open']>): Uint8Array {
  assert.equal(result.kind, 'data');
  return (result as { plaintext: Uint8Array }).plaintext;
}

test('randomBytes honours the requested length', () => {
  for (const n of [0, 1, 16, 32, 1000]) assert.equal(wizzleCrypto.randomBytes(n).length, n);
  assert.ok(!equal(wizzleCrypto.randomBytes(32), wizzleCrypto.randomBytes(32)));
});

test('sha256 and hkdf match node byte for byte', () => {
  for (const n of [0, 1, 31, 32, 33, 64, 1000]) {
    const data = nodeCrypto.randomBytes(n);
    assert.ok(equal(wizzleCrypto.sha256(data), nodeCrypto.sha256(data)), `sha256 of ${n} bytes`);
  }
  const ikm = nodeCrypto.randomBytes(32);
  const info = utf8('wizzle-v1 p2b');
  for (const salt of [new Uint8Array(0), nodeCrypto.randomBytes(32)]) {
    for (const length of [32, 64]) {
      assert.ok(equal(wizzleCrypto.hkdfSha256(ikm, salt, info, length), nodeCrypto.hkdfSha256(ikm, salt, info, length)));
    }
  }
});

test('pairing derivations match node', () => {
  const secret = nodeCrypto.randomBytes(32);
  assert.ok(equal(deriveRelaySecret(wizzleCrypto, secret), deriveRelaySecret(nodeCrypto, secret)));
  assert.ok(equal(derivePsk(wizzleCrypto, secret), derivePsk(nodeCrypto, secret)));
});

test('x25519 shared secrets agree across providers', () => {
  const wizzleKeys = wizzleCrypto.x25519KeyPair();
  const nodeKeys = nodeCrypto.x25519KeyPair();
  assert.equal(wizzleKeys.publicKey.length, 32);
  assert.equal(wizzleKeys.privateKey.length, 32);
  const viaWizzle = wizzleCrypto.x25519(wizzleKeys.privateKey, nodeKeys.publicKey);
  const viaNode = nodeCrypto.x25519(nodeKeys.privateKey, wizzleKeys.publicKey);
  assert.ok(equal(viaWizzle, viaNode));
  // Each provider with the other side's private key still lands on the same secret.
  assert.ok(equal(nodeCrypto.x25519(wizzleKeys.privateKey, nodeKeys.publicKey), viaWizzle));
  assert.ok(equal(wizzleCrypto.x25519(nodeKeys.privateKey, wizzleKeys.publicKey), viaWizzle));
  assert.throws(() => wizzleCrypto.x25519(wizzleKeys.privateKey, new Uint8Array(32)));
  assert.throws(() => nodeCrypto.x25519(nodeKeys.privateKey, new Uint8Array(32)));
});

test('aead frames open across providers and reject tampering', () => {
  const key = nodeCrypto.randomBytes(32);
  const nonce = nodeCrypto.randomBytes(NONCE_BYTES);
  const aad = nodeCrypto.randomBytes(FRAME_HEADER_BYTES);
  for (const n of [0, 1, 100, 70000]) {
    const plaintext = nodeCrypto.randomBytes(n);
    const fromWizzle = wizzleCrypto.aeadSeal(key, nonce, aad, plaintext);
    const fromNode = nodeCrypto.aeadSeal(key, nonce, aad, plaintext);
    assert.equal(fromWizzle.length, n + TAG_BYTES);
    assert.ok(equal(fromWizzle, fromNode), `ciphertext of ${n} bytes`);
    assert.ok(equal(nodeCrypto.aeadOpen(key, nonce, aad, fromWizzle) as Uint8Array, plaintext));
    assert.ok(equal(wizzleCrypto.aeadOpen(key, nonce, aad, fromNode) as Uint8Array, plaintext));
  }
  const sealed = nodeCrypto.aeadSeal(key, nonce, aad, utf8('tamper me'));
  const flipped = sealed.slice();
  flipped[flipped.length - 1] = (flipped[flipped.length - 1] as number) ^ 1;
  assert.equal(wizzleCrypto.aeadOpen(key, nonce, aad, flipped), null);
  assert.equal(wizzleCrypto.aeadOpen(key, nonce, nodeCrypto.randomBytes(FRAME_HEADER_BYTES), sealed), null);
  assert.equal(wizzleCrypto.aeadOpen(key, nodeCrypto.randomBytes(NONCE_BYTES), aad, sealed), null);
  assert.equal(wizzleCrypto.aeadOpen(key, nonce, aad, sealed.subarray(0, TAG_BYTES - 1)), null);
});

test('wizzle session on noble talks to a bridge session on node', () => {
  const pairingId = nodeCrypto.randomBytes(16);
  const psk = nodeCrypto.randomBytes(32);
  const wizzleKeys = wizzleCrypto.x25519KeyPair();
  const bridgeKeys = nodeCrypto.x25519KeyPair();
  const wizzle = new Session(wizzleCrypto, 'wizzle', pairingId, { psk, own: wizzleKeys, peer: bridgeKeys.publicKey });
  const bridge = new Session(nodeCrypto, 'bridge', pairingId, { psk, own: bridgeKeys, peer: null });

  const hs1 = decodeFrame(wizzle.beginHandshake());
  const hs2 = decodeFrame(bridge.handleHandshake(hs1) as Uint8Array);
  const confirm = wizzle.handleHandshake(hs2) as Uint8Array;
  const bridgeConfirm = bridge.open(decodeFrame(confirm));
  assert.equal(bridgeConfirm.kind, 'confirm');
  const reply = (bridgeConfirm as { reply: Uint8Array }).reply;
  assert.equal(wizzle.open(decodeFrame(reply)).kind, 'confirm');
  assert.ok(wizzle.ready && bridge.ready);
  assert.ok(equal(wizzle.currentEpochId as Uint8Array, bridge.currentEpochId as Uint8Array));
  assert.ok(equal(bridge.peerKey as Uint8Array, wizzleKeys.publicKey));
  const pairedOnWizzle = derivePairedRelaySecret(wizzleCrypto, pairingId, wizzleKeys.privateKey, bridgeKeys.publicKey);
  assert.ok(equal(pairedOnWizzle, derivePairedRelaySecret(nodeCrypto, pairingId, bridgeKeys.privateKey, wizzleKeys.publicKey)));

  const sync = wizzle.seal(encodePacket({ id: 'p1', t: 'sync' }));
  const atBridge = decodePacket(plaintextOf(bridge.open(decodeFrame(sync))));
  assert.equal(atBridge.header.t, 'sync');
  assert.equal(atBridge.header.id, 'p1');

  const agents = bridge.seal(encodePacket({ id: 'b1', t: 'agents', agents: [] }));
  const atWizzle = decodePacket(plaintextOf(wizzle.open(decodeFrame(agents))));
  assert.equal(atWizzle.header.t, 'agents');

  const body = nodeCrypto.randomBytes(5000);
  const upload = wizzle.seal(encodePacket({ id: 'p2', t: 'upload', uploadId: 'u1', file: { name: 'a.bin', mime: 'application/octet-stream', size: body.length } }, body));
  const uploadAtBridge = decodePacket(plaintextOf(bridge.open(decodeFrame(upload))));
  assert.equal(uploadAtBridge.header.t, 'upload');
  assert.ok(equal(uploadAtBridge.body, body));

  const restored = new Session(wizzleCrypto, 'wizzle', pairingId, { psk, own: wizzleKeys, peer: bridgeKeys.publicKey }, JSON.parse(JSON.stringify(wizzle.exportState())));
  assert.ok(restored.ready);
  assert.equal(bridge.open(decodeFrame(restored.seal(encodePacket({ id: 'p3', t: 'sync' })))).kind, 'data');
});

test('a maximum size file body seals and opens', (t) => {
  const key = nodeCrypto.randomBytes(32);
  const nonce = nodeCrypto.randomBytes(NONCE_BYTES);
  const aad = nodeCrypto.randomBytes(FRAME_HEADER_BYTES);
  const body = nodeCrypto.randomBytes(MAX_FILE_BYTES);
  const started = performance.now();
  const sealed = wizzleCrypto.aeadSeal(key, nonce, aad, body);
  const sealedAt = performance.now();
  const opened = wizzleCrypto.aeadOpen(key, nonce, aad, sealed) as Uint8Array;
  const openedAt = performance.now();
  t.diagnostic(`noble on V8: seal ${Math.round(sealedAt - started)} ms, open ${Math.round(openedAt - sealedAt)} ms for 16 MiB`);
  assert.ok(equal(opened, body));
  assert.ok(equal(nodeCrypto.aeadOpen(key, nonce, aad, sealed) as Uint8Array, body));
});
