import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceOnly, type Keychain } from '../src/storage/device-only.ts';

type Options = { service: string };
const DEVICE: Options = { service: 'device' };

// Items keyed by service then key, the way the keychain separates them.
function fakeKeychain(): { keychain: Keychain<Options>; items: Map<string, string> } {
  const items = new Map<string, string>();
  const at = (key: string, options?: Options) => `${options?.service ?? 'old'}/${key}`;
  return {
    items,
    keychain: {
      get: (key, options) => items.get(at(key, options)) ?? null,
      set: (key, value, options) => void items.set(at(key, options), value),
      remove: (key, options) => void items.delete(at(key, options)),
    },
  };
}

test('an item an older build wrote moves to the device-only items on its first read', () => {
  const { keychain, items } = fakeKeychain();
  items.set('old/wizzle.pairings', '[1]');
  const store = deviceOnly(keychain, DEVICE);
  assert.equal(store.get('wizzle.pairings'), '[1]');
  assert.deepEqual([...items], [['device/wizzle.pairings', '[1]']]);
  assert.equal(store.get('wizzle.pairings'), '[1]');
});

test('a write lands in the device-only items and drops the older copy', () => {
  const { keychain, items } = fakeKeychain();
  items.set('old/wizzle.session.p', 'old state');
  const store = deviceOnly(keychain, DEVICE);
  store.set('wizzle.session.p', 'new state');
  assert.deepEqual([...items], [['device/wizzle.session.p', 'new state']]);
  assert.equal(store.get('wizzle.session.p'), 'new state');
});

test('remove clears both copies and a missing item reads as null', () => {
  const { keychain, items } = fakeKeychain();
  items.set('old/wizzle.active', 'a');
  items.set('device/wizzle.active', 'a');
  const store = deviceOnly(keychain, DEVICE);
  store.remove('wizzle.active');
  assert.equal(items.size, 0);
  assert.equal(store.get('wizzle.active'), null);
  assert.equal(store.get('never.written'), null);
});
