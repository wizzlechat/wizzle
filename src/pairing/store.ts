import type { SessionState } from '../protocol/index.ts';
import { secureStorage } from '../storage/secure';
import type { Pairing } from './invite.ts';

const PAIRINGS_KEY = 'wizzle.pairings';
const ACTIVE_KEY = 'wizzle.active';

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

// Pairings from before static keys lack them and are dropped, since that bridge has to pair again anyway.
function isPairing(value: unknown): value is Pairing {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return ['relay', 'pairingId', 'secret', 'bridgeKey', 'wizzlePublic', 'wizzlePrivate'].every((key) => typeof v[key] === 'string');
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isSessionState(value: unknown): value is SessionState {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['epochs']) && (v['send'] === null || typeof v['send'] === 'string');
}

export function loadPairings(): Pairing[] {
  return (readJson(PAIRINGS_KEY, isArray) ?? []).filter(isPairing);
}

export function savePairings(pairings: Pairing[]): void {
  secureStorage.set(PAIRINGS_KEY, JSON.stringify(pairings));
}

export function loadActiveId(): string | null {
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
