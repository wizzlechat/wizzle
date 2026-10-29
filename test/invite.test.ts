import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteError, inviteFromParams, parsePairing } from '../src/pairing/invite.ts';
import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import { encodeInvite, fromB64Url, newInvite, toB64Url, type PairingInvite } from '../src/protocol/index.ts';

const relay = 'wss://relay.example.com/ws';
const now = 1_800_000_000_000;
const bridgeKey = nodeCrypto.x25519KeyPair().publicKey;

function invite(extra: { name?: string; runtime?: string; relay?: string; expiresAt?: number } = {}): PairingInvite {
  const { relay: url = relay, expiresAt = now / 1000 + 900, ...rest } = extra;
  return newInvite(nodeCrypto, { relay: url, bridgeKey, expiresAt, ...rest });
}

test('a pasted invite becomes a pairing record with a fresh wizzle key', () => {
  const one = invite({ name: 'Studio', runtime: 'nanoclaw' });
  const pairing = parsePairing(`  ${encodeInvite(one)}\n`, nodeCrypto, { now });
  const { wizzlePublic, wizzlePrivate, ...rest } = pairing;
  assert.deepEqual(rest, {
    relay,
    pairingId: toB64Url(one.pairingId),
    secret: toB64Url(one.secret),
    bridgeKey: toB64Url(bridgeKey),
    name: 'Studio',
    runtime: 'nanoclaw',
    pairedAt: now,
  });
  assert.deepEqual(nodeCrypto.x25519(fromB64Url(wizzlePrivate), bridgeKey).length, 32);
  assert.notEqual(parsePairing(encodeInvite(one), nodeCrypto, { now }).wizzlePublic, wizzlePublic);
});

test('deep link params rebuild the same invite', () => {
  const one = invite({ name: 'Home box' });
  const params = {
    r: relay,
    p: toB64Url(one.pairingId),
    s: [toB64Url(one.secret)],
    k: toB64Url(bridgeKey),
    e: String(one.expiresAt),
    n: 'Home box',
  };
  const text = inviteFromParams(params);
  assert.ok(text);
  assert.equal(text, encodeInvite(one));
  assert.equal(parsePairing(text, nodeCrypto, { now }).name, 'Home box');
  assert.equal(inviteFromParams({ r: relay, p: params.p, s: params.s }), null);
});

test('expired invites are refused', () => {
  const expired = encodeInvite(invite({ expiresAt: now / 1000 }));
  assert.throws(() => parsePairing(expired, nodeCrypto, { now }), (err) => /expired/.test(inviteError(err)));
});

test('bad invites produce readable errors', () => {
  const k = toB64Url(bridgeKey);
  const cases: Array<[string, RegExp]> = [
    ['https://example.com', /not a wizzle invite/],
    ['garbage', /not a wizzle invite/],
    ['wizzle://pair?r=wss://x', /incomplete/],
    ['wizzle://pair?r=wss://x&p=AAAAAAAAAAAAAAAAAAAAAA&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', /older bridge/],
    [`wizzle://pair?r=https://x&p=AAAAAAAAAAAAAAAAAAAAAA&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&k=${k}&e=1`, /wss:\/\//],
    [`wizzle://pair?r=wss://x&p=AAAA&s=AAAA&k=${k}&e=1`, /damaged/],
    ['wizzle://pair?r=wss://x&p=AAAAAAAAAAAAAAAAAAAAAA&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&k=AAAA&e=1', /damaged/],
  ];
  for (const [text, expected] of cases) {
    assert.throws(() => parsePairing(text, nodeCrypto, { now }), (err) => expected.test(inviteError(err)), text);
  }
});
