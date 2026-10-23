import { useCallback, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { phoneCrypto } from '../crypto/index.ts';
import { deviceFiles } from '../files/device';
import { toB64Url } from '../protocol/index.ts';
import { connection } from '../relay/connection.ts';
import { SqliteCache } from './cache-sqlite';
import { WizzleStore } from './store.ts';
import type { ConversationState, ElementRef, StoreSnapshot, StoredElement } from './types.ts';

const cache = new SqliteCache();

export const store = new WizzleStore({
  link: connection,
  newId: () => toB64Url(phoneCrypto.randomBytes(9)),
  cache,
  files: deviceFiles,
});

// A different pairing invalidates everything the previous bridge sent; its cache takes over at once.
let paired = connection.getSnapshot().pairing?.pairingId ?? null;
let known = connection.getSnapshot().pairings.map((one) => one.pairingId);
store.hydrate(paired);
connection.subscribe(() => {
  const snapshot = connection.getSnapshot();
  const ids = snapshot.pairings.map((one) => one.pairingId);
  for (const id of known) if (!ids.includes(id)) store.forgetPairing(id);
  known = ids;
  const next = snapshot.pairing?.pairingId ?? null;
  if (next === paired) return;
  paired = next;
  store.hydrate(next);
});

// Pending cache rows reach disk before iOS may suspend the app.
AppState.addEventListener('change', (state) => {
  if (state === 'background') cache.flush();
});

export function useStore(): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useConversation(conv: string): ConversationState {
  const read = useCallback(() => store.conversation(conv), [conv]);
  return useSyncExternalStore(store.subscribe, read, read);
}

export function useElement(ref: ElementRef): StoredElement | undefined {
  const read = useCallback(() => store.element(ref.agentId, ref.id), [ref.agentId, ref.id]);
  return useSyncExternalStore(store.subscribe, read, read);
}

export { MAX_ATTACHMENTS, SYSTEM_CONV, attachmentFailure } from './store.ts';
export type * from './types.ts';
