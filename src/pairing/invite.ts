import { INVITE_SCHEME, parseInvite, toB64Url, type PairingInvite } from '../protocol/index.ts';

// What secure storage holds for the paired bridge. Byte fields are base64url strings.
export type Pairing = {
  relay: string;
  pairingId: string;
  secret: string;
  name?: string;
  runtime?: string;
  pairedAt: number;
};

export function pairingFromInvite(invite: PairingInvite, pairedAt: number): Pairing {
  const pairing: Pairing = {
    relay: invite.relay,
    pairingId: toB64Url(invite.pairingId),
    secret: toB64Url(invite.secret),
    pairedAt,
  };
  if (invite.name !== undefined) pairing.name = invite.name;
  if (invite.runtime !== undefined) pairing.runtime = invite.runtime;
  return pairing;
}

export function parsePairing(text: string, now = Date.now()): Pairing {
  return pairingFromInvite(parseInvite(text.trim()), now);
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
  if (!relay || !pairingId || !secret) return null;
  const query = new URLSearchParams();
  query.set('r', relay);
  query.set('p', pairingId);
  query.set('s', secret);
  const name = first(params['n']);
  const runtime = first(params['rt']);
  if (name) query.set('n', name);
  if (runtime) query.set('rt', runtime);
  return `${INVITE_SCHEME}//pair?${query.toString()}`;
}

export function inviteError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/invalid url|not a wizzle invite/i.test(message)) return 'That is not a wizzle invite. It starts with wizzle://pair?';
  if (message === 'invite missing fields') return 'The invite is incomplete.';
  if (message === 'relay must be a websocket url') return 'The relay address must start with wss:// or ws://.';
  if (/^bad (pairing|base64url)/.test(message)) return 'The invite is damaged. Ask the bridge for a new one.';
  return message;
}
