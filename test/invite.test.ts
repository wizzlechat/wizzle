import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inviteError, inviteFromParams, parsePairing } from '../src/pairing/invite.ts';
import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import { encodeInvite, newInvite, toB64Url } from '../src/protocol/index.ts';

const relay = 'wss://relay.example.com/ws';

test('a pasted invite becomes a pairing record', () => {
  const invite = newInvite(nodeCrypto, relay, { name: 'Studio', runtime: 'nanoclaw' });
  const pairing = parsePairing(`  ${encodeInvite(invite)}\n`, 42);
  assert.deepEqual(pairing, {
    relay,
    pairingId: toB64Url(invite.pairingId),
    secret: toB64Url(invite.secret),
    name: 'Studio',
    runtime: 'nanoclaw',
    pairedAt: 42,
  });
});

test('deep link params rebuild the same invite', () => {
  const invite = newInvite(nodeCrypto, relay, { name: 'Home box' });
  const params = {
    r: relay,
    p: toB64Url(invite.pairingId),
    s: [toB64Url(invite.secret)],
    n: 'Home box',
  };
  const text = inviteFromParams(params);
  assert.ok(text);
  assert.equal(text, encodeInvite(invite));
  assert.equal(parsePairing(text, 1).name, 'Home box');
  assert.equal(inviteFromParams({ r: relay, p: params.p }), null);
});

test('bad invites produce readable errors', () => {
  const cases: Array<[string, RegExp]> = [
    ['https://example.com', /not a wizzle invite/],
    ['garbage', /not a wizzle invite/],
    ['wizzle://pair?r=wss://x', /incomplete/],
    ['wizzle://pair?r=https://x&p=AAAAAAAAAAAAAAAAAAAAAA&s=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', /wss:\/\//],
    ['wizzle://pair?r=wss://x&p=AAAA&s=AAAA', /damaged/],
  ];
  for (const [text, expected] of cases) {
    assert.throws(() => parsePairing(text), (err) => expected.test(inviteError(err)), text);
  }
});
