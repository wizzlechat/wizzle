// The relay's alert carries the pairing id as `p` next to `aps`; nothing else is read from it.
const PAIRING_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function pairingIdFromNotification(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const p = (data as Record<string, unknown>)['p'];
  return typeof p === 'string' && PAIRING_ID.test(p) ? p : null;
}
