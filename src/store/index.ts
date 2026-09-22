import { useCallback, useSyncExternalStore } from 'react';
import { phoneCrypto } from '../crypto/index.ts';
import { toB64Url } from '../protocol/index.ts';
import { connection } from '../relay/connection.ts';
import { WizzleStore } from './store.ts';
import type { ConversationState, StoreSnapshot } from './types.ts';

export const store = new WizzleStore({ link: connection, newId: () => toB64Url(phoneCrypto.randomBytes(9)) });

// A different pairing invalidates everything the previous bridge sent.
let paired = connection.getSnapshot().pairing?.pairingId ?? null;
connection.subscribe(() => {
  const next = connection.getSnapshot().pairing?.pairingId ?? null;
  if (next === paired) return;
  paired = next;
  store.reset();
});

export function useStore(): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useConversation(conv: string): ConversationState {
  const read = useCallback(() => store.conversation(conv), [conv]);
  return useSyncExternalStore(store.subscribe, read, read);
}

export { SYSTEM_CONV } from './store.ts';
export type * from './types.ts';
