import { useSyncExternalStore } from 'react';
import { secureStorage } from '../storage/secure';

export type Appearance = 'system' | 'light' | 'dark';

export const APPEARANCES: Array<{ key: Appearance; label: string }> = [
  { key: 'system', label: 'System' },
  { key: 'light', label: 'Light' },
  { key: 'dark', label: 'Dark' },
];

const KEY = 'wizzle.appearance';
const listeners = new Set<() => void>();

function read(): Appearance {
  const raw = secureStorage.get(KEY);
  return raw === 'light' || raw === 'dark' ? raw : 'system';
}

let current = read();

export function setAppearance(next: Appearance): void {
  if (next === current) return;
  current = next;
  if (next === 'system') secureStorage.remove(KEY);
  else secureStorage.set(KEY, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Appearance {
  return current;
}

export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
