import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairingIdFromNotification } from '../src/push/notification.ts';

test('the pairing id is read from p and nothing else', () => {
  const id = 'AbC-_0123456789xyzXYZw';
  assert.equal(pairingIdFromNotification({ aps: { alert: 'x' }, p: id }), id);
  assert.equal(pairingIdFromNotification({ p: id, extra: 1 }), id);
});

test('payloads without a usable p yield nothing', () => {
  assert.equal(pairingIdFromNotification(null), null);
  assert.equal(pairingIdFromNotification(undefined), null);
  assert.equal(pairingIdFromNotification('p'), null);
  assert.equal(pairingIdFromNotification({}), null);
  assert.equal(pairingIdFromNotification({ p: 7 }), null);
  assert.equal(pairingIdFromNotification({ p: '' }), null);
  assert.equal(pairingIdFromNotification({ p: 'has space' }), null);
  assert.equal(pairingIdFromNotification({ p: 'a+b/c=' }), null);
  assert.equal(pairingIdFromNotification({ p: 'x'.repeat(65) }), null);
});
