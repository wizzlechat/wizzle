import { INVITE_SCHEME, parseInvite, toB64Url, type CryptoProvider, type KeyPair, type PairingInvite } from '../protocol/index.ts';

// What secure storage holds for one paired bridge. Byte fields are base64url strings.
// phonePublic and phonePrivate are this phone's static key for that bridge; confirmed is set by the first handshake.
export type Pairing = {
  relay: string;
  pairingId: string;
  secret: string;
  bridgeKey: string;
  phonePublic: string;
  phonePrivate: string;
  confirmed?: boolean;
  name?: string;
  runtime?: string;
  pairedAt: number;
};

export type PairOptions = { now?: number };

export function pairingFromInvite(invite: PairingInvite, pairedAt: number, own: KeyPair): Pairing {
  const pairing: Pairing = {
    relay: invite.relay,
    pairingId: toB64Url(invite.pairingId),
    secret: toB64Url(invite.secret),
    bridgeKey: toB64Url(invite.bridgeKey),
    phonePublic: toB64Url(own.publicKey),
    phonePrivate: toB64Url(own.privateKey),
    pairedAt,
  };
  if (invite.name !== undefined) pairing.name = invite.name;
  if (invite.runtime !== undefined) pairing.runtime = invite.runtime;
  return pairing;
}

export function parsePairing(text: string, crypto: CryptoProvider, opts: PairOptions = {}): Pairing {
  const invite = parseInvite(text.trim());
  const now = opts.now ?? Date.now();
  if (invite.expiresAt * 1000 <= now) throw new Error('invite expired');
  return pairingFromInvite(invite, now, crypto.x25519KeyPair());
}

function first(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return null;
}

// Deep links arrive as decoded query params; rebuilding the invite keeps one parser for both paths.
export function inviteFromParams(params: Record<string, unknown>): string | null {
  const relay = first(params['r']);
  const pairingId = first(params['p']);
  const secret = first(params['s']);
  const bridgeKey = first(params['k']);
  const expiresAt = first(params['e']);
  if (!relay || !pairingId || !secret || !bridgeKey || !expiresAt) return null;
  const query = new URLSearchParams();
  query.set('r', relay);
  query.set('p', pairingId);
  query.set('s', secret);
  query.set('k', bridgeKey);
  query.set('e', expiresAt);
  const name = first(params['n']);
  const runtime = first(params['rt']);
  if (name) query.set('n', name);
  if (runtime) query.set('rt', runtime);
  return `${INVITE_SCHEME}//pair?${query.toString()}`;
}

export function inviteError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/invalid url|not a wizzle invite/i.test(message)) return 'That is not a wizzle invite. It starts with wizzle://pair?';
  if (message === 'invite missing fields') return 'The invite is incomplete, or from an older bridge. Ask the bridge for a new one.';
  if (message === 'invite expired') return 'This code has expired. Run ncl wizzle pair on the bridge for a new one.';
  if (message === 'relay must be a websocket url') return 'The relay address must start with wss:// or ws://.';
  if (/^bad (pairing|base64url|bridge key|expiry)/.test(message)) return 'The invite is damaged. Ask the bridge for a new one.';
  return message;
}
