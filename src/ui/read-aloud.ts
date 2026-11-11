import { useSyncExternalStore } from 'react';
import { canReadAloud, readAloud, stopReadingAloud } from '../native/privacy.ts';
import { plainMessage } from './plain.ts';

export { canReadAloud };

const listeners = new Set<() => void>();
// The message being read, by key; one at a time.
let current: string | null = null;

function set(next: string | null): void {
  current = next;
  for (const listener of listeners) listener();
}

// A tap reads the message without its markdown, or stops it when it is the one being read.
export function toggleReadAloud(key: string, markdown: string): void {
  if (current === key) {
    set(null);
    void stopReadingAloud();
    return;
  }
  set(key);
  readAloud(plainMessage(markdown))
    .catch((error: unknown) => console.error('wizzle: could not read the message aloud', error))
    .finally(() => {
      if (current === key) set(null);
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingAloud(key: string): boolean {
  const snapshot = () => current === key;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
