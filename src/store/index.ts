import { useCallback, useSyncExternalStore } from 'react';
import { newId } from '../crypto/index.ts';
import { deviceFiles } from '../files/device';
import { protectStorage } from '../native/privacy.ts';
import type { Capabilities } from '../protocol/index.ts';
import { connection } from '../relay/connection.ts';
import { SqliteCache } from './cache-sqlite';
import { WizzleStore } from './store.ts';
import type { AgentProfile, ConversationRow, ConversationState, ElementRef, RoomRow, StoreSnapshot, StoredElement } from './types.ts';

// Before the cache opens: the cache and saved files stay out of backups and locked with the phone.
protectStorage();

const DIST_URL = 'https://wizzle.app/dist';

// The newest published bridge for a runtime: one version number in a text file on the site.
async function latestBridge(runtime: string): Promise<string | null> {
  const response = await fetch(`${DIST_URL}/${encodeURIComponent(runtime)}/latest`);
  if (!response.ok) return null;
  const text = (await response.text()).trim();
  return /^\d+\.\d+\.\d+$/.test(text) ? text : null;
}

export const store = new WizzleStore({
  link: connection,
  newId,
  cache: new SqliteCache(),
  files: deviceFiles,
  pairing: () => connection.getSnapshot().pairing?.pairingId ?? null,
  latest: latestBridge,
});

// A different pairing invalidates everything the previous bridge sent; a removed one takes its cache with it.
export function startStore(): () => void {
  let paired = connection.getSnapshot().pairing?.pairingId ?? null;
  let known = connection.getSnapshot().pairings.map((one) => one.pairingId);
  return connection.subscribe(() => {
    const snapshot = connection.getSnapshot();
    const ids = snapshot.pairings.map((one) => one.pairingId);
    for (const id of known) if (!ids.includes(id)) store.forgetPairing(id);
    known = ids;
    const next = snapshot.pairing?.pairingId ?? null;
    if (next === paired) return;
    paired = next;
    store.hydrate(next);
  });
}

export function useStore(): StoreSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

// Re-renders only when the selected value changes, so it must come back the same object while nothing did.
export function useSelector<T>(select: (snapshot: StoreSnapshot) => T): T {
  const read = () => select(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, read, read);
}

export function useCapabilities(): Capabilities | null {
  return useSelector((snapshot) => snapshot.capabilities);
}

export function useRow(conv: string): ConversationRow | undefined {
  return useSelector((snapshot) => snapshot.conversations.find((row) => row.id === conv));
}

export function useRoom(conv: string): RoomRow | undefined {
  return useSelector((snapshot) => snapshot.rooms.find((room) => room.id === conv));
}

export function useProfile(agentId: string): AgentProfile | undefined {
  return useSelector((snapshot) => snapshot.profiles[agentId]);
}

export function useConversation(conv: string): ConversationState {
  const read = useCallback(() => store.peek(conv), [conv]);
  return useSyncExternalStore(store.subscribe, read, read);
}

export function useElement(ref: ElementRef): StoredElement | undefined {
  const read = useCallback(() => store.element(ref.agentId, ref.id), [ref.agentId, ref.id]);
  return useSyncExternalStore(store.subscribe, read, read);
}

export { SYSTEM_CONV } from './store.ts';
export { MAX_ATTACHMENTS, attachmentFailure } from './validate.ts';
export type * from './types.ts';
