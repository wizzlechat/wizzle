import { useSyncExternalStore } from 'react';
import { secureStorage } from '../storage/secure';

export type TextSize = 'small' | 'default' | 'large' | 'larger';

export const TEXT_SIZES: Array<{ key: TextSize; label: string; scale: number }> = [
  { key: 'small', label: 'Small', scale: 0.875 },
  { key: 'default', label: 'Default', scale: 1 },
  { key: 'large', label: 'Large', scale: 1.125 },
  { key: 'larger', label: 'Larger', scale: 1.25 },
];

type Font = { fontSize: number; lineHeight: number };

// One object per size, so memoized rows and the markdown parser see the same style until the size changes.
const FONTS = Object.fromEntries(TEXT_SIZES.map(({ key, scale }) => [key, { fontSize: 16 * scale, lineHeight: 24 * scale }])) as Record<TextSize, Font>;

const KEY = 'wizzle.textSize';
const listeners = new Set<() => void>();

function read(): TextSize {
  const raw = secureStorage.get(KEY);
  return TEXT_SIZES.find((option) => option.key === raw)?.key ?? 'default';
}

let current = read();

export function setTextSize(next: TextSize): void {
  if (next === current) return;
  current = next;
  if (next === 'default') secureStorage.remove(KEY);
  else secureStorage.set(KEY, next);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): TextSize {
  return current;
}

export function useTextSize(): TextSize {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function messageFont(size: TextSize): Font {
  return FONTS[size];
}

// What message text is drawn with at the chosen size.
export function useMessageFont(): Font {
  return FONTS[useTextSize()];
}
