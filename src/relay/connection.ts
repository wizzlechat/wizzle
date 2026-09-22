import { useSyncExternalStore } from 'react';
import { phoneCrypto } from '../crypto/index.ts';
import { parsePairing, type Pairing } from '../pairing/invite.ts';
import {
  clearSessionState,
  loadActiveId,
  loadPairings,
  loadSessionState,
  saveActiveId,
  savePairings,
  saveSessionState,
} from '../pairing/store.ts';
import {
  Session,
  decodePacket,
  derivePsk,
  deriveRelaySecret,
  encodePacket,
  fromB64Url,
  toB64Url,
  type BridgeMessage,
  type DecodedPacket,
  type PhoneMessage,
} from '../protocol/index.ts';
import { RelayClient, type Logger } from './client.ts';
import { webSocketTransport } from './transport.ts';

export type Phase = 'unpaired' | 'connecting' | 'waiting' | 'handshake' | 'connected' | 'failed';
export type BridgeHello = Extract<BridgeMessage, { t: 'hello' }>;

export type ConnectionSnapshot = {
  phase: Phase;
  pairing: Pairing | null;
  pairings: Pairing[];
  bridge: BridgeHello | null;
  error: string | null;
};

export type PacketListener = (packet: DecodedPacket) => void;

const log: Logger = {
  info: (msg, data) => console.info(msg, data ?? ''),
  warn: (msg, data) => console.warn(msg, data ?? ''),
  error: (msg, data) => console.error(msg, data ?? ''),
};

// App wide owner of the one relay client. Screens read it through useConnection.
class Connection {
  private loaded = false;
  private pairings: Pairing[] = [];
  private activeId: string | null = null;
  private client: RelayClient | null = null;
  private bridge: BridgeHello | null = null;
  private error: string | null = null;
  private snapshot: ConnectionSnapshot | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly packetListeners = new Set<PacketListener>();

  readonly getSnapshot = (): ConnectionSnapshot => {
    this.load();
    if (!this.snapshot) this.snapshot = this.compute();
    return this.snapshot;
  };

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  onPacket(listener: PacketListener): () => void {
    this.packetListeners.add(listener);
    return () => void this.packetListeners.delete(listener);
  }

  start(): void {
    this.load();
    const pairing = this.pairing;
    if (pairing && !this.client) this.open(pairing);
  }

  wake(): void {
    this.client?.wake();
  }

  // Throws with the protocol's message when the text is not a valid invite.
  pair(text: string, name?: string): Pairing {
    this.load();
    const pairing = parsePairing(text);
    const label = name?.trim();
    if (label) pairing.name = label;
    this.stop();
    clearSessionState(pairing.pairingId);
    this.pairings = [...this.pairings.filter((one) => one.pairingId !== pairing.pairingId), pairing];
    this.activeId = pairing.pairingId;
    this.bridge = null;
    this.error = null;
    this.persist();
    this.open(pairing);
    this.changed();
    return pairing;
  }

  // Switching drops the socket for the old bridge; the store resets itself on the new pairing id.
  select(pairingId: string): void {
    this.load();
    if (pairingId === this.activeId) return;
    const pairing = this.pairings.find((one) => one.pairingId === pairingId);
    if (!pairing) return;
    this.stop();
    this.activeId = pairingId;
    this.bridge = null;
    this.error = null;
    this.persist();
    this.open(pairing);
    this.changed();
  }

  // The invite's name is whatever the bridge calls itself, so the phone keeps its own label for it.
  rename(name: string, pairingId?: string): void {
    this.load();
    const id = pairingId ?? this.activeId;
    if (!id) return;
    const trimmed = name.trim();
    this.pairings = this.pairings.map((one) => {
      if (one.pairingId !== id) return one;
      const next: Pairing = { ...one };
      if (trimmed) next.name = trimmed;
      else delete next.name;
      return next;
    });
    this.persist();
    this.changed();
  }

  remove(pairingId?: string): void {
    this.load();
    const id = pairingId ?? this.activeId;
    if (!id) return;
    const wasActive = id === this.activeId;
    if (wasActive) this.stop();
    clearSessionState(id);
    this.pairings = this.pairings.filter((one) => one.pairingId !== id);
    if (wasActive) {
      this.activeId = this.pairings[0]?.pairingId ?? null;
      this.bridge = null;
      this.error = null;
      const next = this.pairing;
      if (next) this.open(next);
    }
    this.persist();
    this.changed();
  }

  // Returns the packet id so the caller can match the bridge's error ref, or null when nothing went out.
  send(message: PhoneMessage, body?: Uint8Array): string | null {
    if (!this.client) return null;
    const id = toB64Url(phoneCrypto.randomBytes(9));
    return this.client.send(encodePacket({ id, ...message }, body)) ? id : null;
  }

  private get pairing(): Pairing | null {
    return this.pairings.find((one) => one.pairingId === this.activeId) ?? null;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    this.pairings = loadPairings();
    const stored = loadActiveId();
    const known = stored && this.pairings.some((one) => one.pairingId === stored) ? stored : null;
    this.activeId = known ?? this.pairings[0]?.pairingId ?? null;
  }

  private persist(): void {
    savePairings(this.pairings);
    saveActiveId(this.activeId);
  }

  private stop(): void {
    this.client?.stop();
    this.client = null;
  }

  private open(pairing: Pairing): void {
    const secret = fromB64Url(pairing.secret);
    const pairingId = fromB64Url(pairing.pairingId);
    const psk = derivePsk(phoneCrypto, secret);
    let session: Session;
    try {
      session = new Session(phoneCrypto, 'phone', pairingId, psk, loadSessionState(pairing.pairingId) ?? undefined);
    } catch {
      log.warn('wizzle: stored session state unusable, starting fresh');
      clearSessionState(pairing.pairingId);
      session = new Session(phoneCrypto, 'phone', pairingId, psk);
    }
    const client = new RelayClient({
      transport: webSocketTransport,
      relayUrl: pairing.relay,
      pairingId,
      relaySecret: deriveRelaySecret(phoneCrypto, secret),
      session,
      persist: (state) => saveSessionState(pairing.pairingId, state),
      log,
      onPacket: (plaintext) => this.receive(plaintext),
      onChange: () => this.changed(),
      onSession: () => void this.send({ t: 'sync' }),
      onFatal: (code, message) => {
        this.error = `${code}: ${message}`;
        this.changed();
      },
    });
    this.client = client;
    client.start();
  }

  private receive(plaintext: Uint8Array): void {
    let packet: DecodedPacket;
    try {
      packet = decodePacket(plaintext);
    } catch {
      log.warn('wizzle: dropping undecodable packet');
      return;
    }
    if (packet.header.t === 'hello') {
      this.bridge = packet.header as unknown as BridgeHello;
      this.changed();
    }
    for (const listener of this.packetListeners) listener(packet);
  }

  private phase(): Phase {
    if (!this.pairing) return 'unpaired';
    if (this.error) return 'failed';
    const client = this.client;
    if (!client || client.state !== 'ready') return 'connecting';
    if (!client.peerOnline) return 'waiting';
    if (client.handshaking || !client.session.ready) return 'handshake';
    return 'connected';
  }

  private compute(): ConnectionSnapshot {
    return {
      phase: this.phase(),
      pairing: this.pairing,
      pairings: this.pairings,
      bridge: this.bridge,
      error: this.error,
    };
  }

  private changed(): void {
    this.snapshot = this.compute();
    for (const listener of this.listeners) listener();
  }
}

export const connection = new Connection();

export function useConnection(): ConnectionSnapshot {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot, connection.getSnapshot);
}
