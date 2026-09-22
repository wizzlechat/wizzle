import type { SessionState } from '../protocol/index.ts';
import { secureStorage } from '../storage/secure';
import type { Pairing } from './invite.ts';

const PAIRINGS_KEY = 'wizzle.pairings';
const ACTIVE_KEY = 'wizzle.active';
const ONE_PAIRING_KEY = 'wizzle.pairing';
const ONE_SESSION_KEY = 'wizzle.session';

// Secure store keys take letters, digits, dot, dash and underscore, which covers base64url ids.
function sessionKey(pairingId: string): string {
  return `wizzle.session.${pairingId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

function readJson<T>(key: string, valid: (value: unknown) => value is T): T | null {
  const raw = secureStorage.get(key);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return valid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPairing(value: unknown): value is Pairing {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v['relay'] === 'string' && typeof v['pairingId'] === 'string' && typeof v['secret'] === 'string';
}

function isPairingList(value: unknown): value is Pairing[] {
  return Array.isArray(value) && value.every(isPairing);
}

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['epochs']) && (v['send'] === null || typeof v['send'] === 'string');
}

let migrated = false;

// The phone used to hold exactly one bridge, so lift that pairing into the list on first read.
function migrate(): void {
  if (migrated) return;
  migrated = true;
  if (secureStorage.get(PAIRINGS_KEY)) return;
  const only = readJson(ONE_PAIRING_KEY, isPairing);
  if (!only) return;
  savePairings([only]);
  saveActiveId(only.pairingId);
  const session = secureStorage.get(ONE_SESSION_KEY);
  if (session) secureStorage.set(sessionKey(only.pairingId), session);
  secureStorage.remove(ONE_PAIRING_KEY);
  secureStorage.remove(ONE_SESSION_KEY);
}

export function loadPairings(): Pairing[] {
  migrate();
  return readJson(PAIRINGS_KEY, isPairingList) ?? [];
}

export function savePairings(pairings: Pairing[]): void {
  secureStorage.set(PAIRINGS_KEY, JSON.stringify(pairings));
}

export function loadActiveId(): string | null {
  migrate();
  return secureStorage.get(ACTIVE_KEY);
}

export function saveActiveId(pairingId: string | null): void {
  if (pairingId) secureStorage.set(ACTIVE_KEY, pairingId);
  else secureStorage.remove(ACTIVE_KEY);
}

export function loadSessionState(pairingId: string): SessionState | null {
  return readJson(sessionKey(pairingId), isSessionState);
}

export function saveSessionState(pairingId: string, state: SessionState): void {
  secureStorage.set(sessionKey(pairingId), JSON.stringify(state));
}

export function clearSessionState(pairingId: string): void {
  secureStorage.remove(sessionKey(pairingId));
}
