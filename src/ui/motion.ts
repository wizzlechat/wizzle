import { useSyncExternalStore } from 'react';
import { AccessibilityInfo } from 'react-native';
import { secureStorage } from '../storage/secure';

const KEY = 'wizzle.animations';
const listeners = new Set<() => void>();

function read(): boolean | null {
  const raw = secureStorage.get(KEY);
  return raw === 'on' ? true : raw === 'off' ? false : null;
}

// Unset follows the system's Reduce Motion; a choice made here wins over it and is the only thing stored.
let chosen = read();
let reduceMotion = false;
let watching = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function watch(): void {
  if (watching) return;
  watching = true;
  void AccessibilityInfo.isReduceMotionEnabled()
    .then((on) => {
      reduceMotion = on;
      notify();
    })
    .catch(() => undefined);
  AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
    reduceMotion = on;
    notify();
  });
}

export function setAnimations(next: boolean): void {
  if (next === chosen) return;
  chosen = next;
  secureStorage.set(KEY, next ? 'on' : 'off');
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  watch();
  return () => void listeners.delete(listener);
}

function snapshot(): boolean {
  return chosen ?? !reduceMotion;
}

// Whether faces blink, glance, hop and fly in, or hold still.
export function useAnimations(): boolean {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
