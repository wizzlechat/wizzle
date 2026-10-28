import { useSyncExternalStore } from 'react';
import { secureStorage } from '../storage/secure';

const KEY = 'wizzle.sleeping';
const listeners = new Set<() => void>();

// On unless turned off, so the key is only stored while it is off.
let current = secureStorage.get(KEY) !== 'off';

export function setSleeping(next: boolean): void {
  if (next === current) return;
  current = next;
  if (next) secureStorage.remove(KEY);
  else secureStorage.set(KEY, 'off');
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): boolean {
  return current;
}

export function useSleeping(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
