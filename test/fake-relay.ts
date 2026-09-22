import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import {
  FRAME_ACK,
  FRAME_DATA,
  FRAME_HS,
  MAX_FRAME_BYTES,
  RELAY_PROTOCOL_VERSION,
  Session,
  decodeControl,
  decodeFrame,
  decodePacket,
  derivePsk,
  deriveRelaySecret,
  encodeControl,
  encodeFrame,
  encodePacket,
  toB64Url,
  type BridgeMessage,
  type DecodedPacket,
  type Frame,
  type RelayControl,
  type Role,
  type SessionState,
} from '../src/protocol/index.ts';
import type { Logger } from '../src/relay/client.ts';
import type { Transport, TransportConn, TransportHandlers } from '../src/relay/transport.ts';

type Client = { role: Role | null; handlers: TransportHandlers; open: boolean };

function other(role: Role): Role {
  return role === 'phone' ? 'bridge' : 'phone';
}

// In-process stand-in for the relay: hello/welcome, peer notices, buffering while a side is offline.
export class FakeRelay {
  private readonly clients = new Map<Role, Client>();
  private readonly buffered: Record<Role, Uint8Array[]> = { phone: [], bridge: [] };
  connections = 0;
  expectedSecret: string | null = null;
  readonly transport: Transport = { connect: (_url, handlers) => this.connect(handlers) };

  online(role: Role): boolean {
    return this.clients.has(role);
  }

  bufferedFor(role: Role): number {
    return this.buffered[role].length;
  }

  drop(role: Role): void {
    const client = this.clients.get(role);
    if (client) this.disconnect(client, 1006, 'dropped');
  }

  private connect(handlers: TransportHandlers): TransportConn {
    const client: Client = { role: null, handlers, open: true };
    this.connections += 1;
    queueMicrotask(() => {
      if (client.open) handlers.onOpen();
    });
    return {
      sendText: (text) => this.onText(client, text),
      sendBinary: (bytes) => this.onBinary(client, bytes),
      close: () => this.disconnect(client, 1000, 'closed'),
    };
  }

  // Queued in order, so a message sent before a disconnect still lands before onClose.
  private deliverText(client: Client, msg: RelayControl): void {
    if (!client.open) return;
    const text = encodeControl(msg);
    queueMicrotask(() => client.handlers.onText(text));
  }

  private deliverBinary(client: Client, bytes: Uint8Array): void {
    if (!client.open) return;
    queueMicrotask(() => client.handlers.onBinary(bytes));
  }

  private onText(client: Client, text: string): void {
    const msg = decodeControl(text);
    if (msg.t !== 'hello') return;
    if (msg.v !== RELAY_PROTOCOL_VERSION) {
      this.deliverText(client, { t: 'error', code: 'proto', message: 'unsupported version' });
      this.disconnect(client, 4002, 'proto');
      return;
    }
    if (this.expectedSecret !== null && msg.secret !== this.expectedSecret) {
      this.deliverText(client, { t: 'error', code: 'auth', message: 'bad secret' });
      this.disconnect(client, 4001, 'auth');
      return;
    }
    const previous = this.clients.get(msg.role);
    if (previous && previous !== client) this.disconnect(previous, 4000, 'replaced');
    client.role = msg.role;
    this.clients.set(msg.role, client);
    const peer = this.clients.get(other(msg.role));
    const pending = this.buffered[msg.role];
    this.buffered[msg.role] = [];
    this.deliverText(client, { t: 'welcome', peer: peer !== undefined, buffered: pending.length, maxFrameBytes: MAX_FRAME_BYTES });
    for (const frame of pending) this.deliverBinary(client, frame);
    if (peer) this.deliverText(peer, { t: 'peer', online: true });
  }

  private onBinary(client: Client, bytes: Uint8Array): void {
    if (!client.role || !client.open) return;
    if (bytes.length > MAX_FRAME_BYTES) {
      this.deliverText(client, { t: 'error', code: 'frame', message: 'frame too large' });
      return;
    }
    const frame = decodeFrame(bytes);
    const target = other(client.role);
    const peer = this.clients.get(target);
    if (frame.type === FRAME_ACK) {
      // The relay stops holding frames the receiver has acknowledged.
      this.buffered[client.role] = this.buffered[client.role].filter(
        (held) => !(toB64Url(decodeFrame(held).epoch) === toB64Url(frame.epoch) && decodeFrame(held).seq <= frame.seq),
      );
    }
    if (peer) this.deliverBinary(peer, bytes);
    else if (frame.type !== FRAME_ACK) this.buffered[target].push(bytes);
  }

  private disconnect(client: Client, code: number, reason: string): void {
    if (!client.open) return;
    client.open = false;
    if (client.role && this.clients.get(client.role) === client) {
      this.clients.delete(client.role);
      const peer = this.clients.get(other(client.role));
      if (peer) this.deliverText(peer, { t: 'peer', online: false });
    }
    queueMicrotask(() => client.handlers.onClose(code, reason));
  }
}

// Minimal bridge: answers handshakes, confirms, acks, and records what the phone sends.
export class FakeBridge {
  readonly session: Session;
  readonly received: DecodedPacket[] = [];
  readonly control: RelayControl[] = [];
  readonly frames: Frame[] = [];
  confirms = 0;
  autoAck = true;
  private conn: TransportConn | null = null;
  private readonly relay: FakeRelay;
  private readonly pairingId: Uint8Array;
  private readonly relaySecret: Uint8Array;
  private waiters: Array<() => void> = [];
  private welcomeWaiter: (() => void) | null = null;

  constructor(relay: FakeRelay, pairingId: Uint8Array, secret: Uint8Array, state?: SessionState) {
    this.relay = relay;
    this.pairingId = pairingId;
    this.relaySecret = deriveRelaySecret(nodeCrypto, secret);
    this.session = new Session(nodeCrypto, 'bridge', pairingId, derivePsk(nodeCrypto, secret), state);
  }

  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.welcomeWaiter = resolve;
      this.conn = this.relay.transport.connect('fake', {
        onOpen: () => {
          this.conn?.sendText(
            encodeControl({ t: 'hello', v: 1, pairing: toB64Url(this.pairingId), role: 'bridge', secret: toB64Url(this.relaySecret) }),
          );
        },
        onText: (text) => {
          const msg = decodeControl(text) as RelayControl;
          this.control.push(msg);
          if (msg.t === 'welcome') {
            this.welcomeWaiter?.();
            this.welcomeWaiter = null;
          }
        },
        onBinary: (bytes) => this.onFrame(bytes),
        onClose: () => {
          this.conn = null;
        },
      });
    });
  }

  disconnect(): void {
    this.conn?.close();
    this.conn = null;
  }

  send(packet: BridgeMessage & { id?: string }, body?: Uint8Array): void {
    const withId = { id: packet.id ?? `b-${this.frames.length}-${Date.now()}`, ...packet };
    this.conn?.sendBinary(this.session.seal(encodePacket(withId, body)));
  }

  // Acknowledges the newest frame opened, like the real bridge does after each open.
  ack(): void {
    const ack = this.session.ack();
    if (ack) this.conn?.sendBinary(ack);
  }

  ackFrame(frame: Frame): void {
    this.conn?.sendBinary(encodeFrame({ type: FRAME_ACK, epoch: frame.epoch, seq: frame.seq, payload: new Uint8Array(0) }));
  }

  next(): Promise<DecodedPacket> {
    const queued = this.received.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.waiters.push(() => resolve(this.received.shift() as DecodedPacket));
    });
  }

  async nextOf(type: string): Promise<DecodedPacket> {
    for (;;) {
      const packet = await this.next();
      if (packet.header.t === type) return packet;
    }
  }

  private onFrame(bytes: Uint8Array): void {
    const frame = decodeFrame(bytes);
    if (frame.type === FRAME_HS) {
      const reply = this.session.handleHandshake(frame);
      if (reply) this.conn?.sendBinary(reply);
      return;
    }
    if (frame.type !== FRAME_DATA) return;
    this.frames.push(frame);
    const result = this.session.open(frame);
    if (result.kind === 'confirm') {
      this.confirms += 1;
      if (result.reply) this.conn?.sendBinary(result.reply);
      if (this.autoAck) this.ack();
      return;
    }
    if (result.kind === 'duplicate') {
      if (this.autoAck) this.ack();
      return;
    }
    if (result.kind !== 'data') return;
    if (this.autoAck) this.ack();
    this.received.push(decodePacket(result.plaintext));
    const waiter = this.waiters.shift();
    waiter?.();
  }
}

export const silentLog: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function collectingLog(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    info: (msg) => void lines.push(`info ${msg}`),
    warn: (msg) => void lines.push(`warn ${msg}`),
    error: (msg) => void lines.push(`error ${msg}`),
  };
}

export async function until(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function newPairing(): { pairingId: Uint8Array; secret: Uint8Array } {
  return { pairingId: nodeCrypto.randomBytes(16), secret: nodeCrypto.randomBytes(32) };
}
