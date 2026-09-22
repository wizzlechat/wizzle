import {
  FRAME_ACK,
  FRAME_DATA,
  FRAME_HS,
  MAX_FRAME_BYTES,
  RELAY_PROTOCOL_VERSION,
  decodeControl,
  decodeFrame,
  encodeControl,
  equal,
  toB64Url,
  type Session,
  type SessionState,
} from '../protocol/index.ts';
import type { Transport, TransportConn } from './transport.ts';

export type Logger = {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
};

export type RelayClientOptions = {
  transport: Transport;
  relayUrl: string;
  pairingId: Uint8Array;
  relaySecret: Uint8Array;
  session: Session;
  persist(state: SessionState): void;
  log: Logger;
  onPacket(plaintext: Uint8Array): void;
  onChange?(): void;
  onSession?(): void;
  onFatal?(code: string, message: string): void;
  reconnect?: { minMs: number; maxMs: number };
};

export type RelayClientState = 'stopped' | 'connecting' | 'open' | 'ready';

type Pending = { epoch: Uint8Array; seq: bigint; bytes: Uint8Array };

const MAX_OUTBOX_FRAMES = 256;
const MAX_OUTBOX_BYTES = 64 * 1024 * 1024;

// Phone side of one pairing: hello, reconnects, handshakes, sealing, and resend until acked.
export class RelayClient {
  private readonly opts: RelayClientOptions;
  private conn: TransportConn | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private outbox: Pending[] = [];
  private outboxBytes = 0;
  state: RelayClientState = 'stopped';
  peerOnline = false;
  handshaking = false;

  constructor(opts: RelayClientOptions) {
    this.opts = opts;
  }

  get session(): Session {
    return this.opts.session;
  }

  get pending(): number {
    return this.outbox.length;
  }

  start(): void {
    if (this.state !== 'stopped') return;
    this.connect();
  }

  stop(): void {
    this.state = 'stopped';
    this.peerOnline = false;
    this.handshaking = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const conn = this.conn;
    this.conn = null;
    conn?.close();
    this.opts.onChange?.();
  }

  // Skips the rest of a backoff wait, for when the app returns to the foreground.
  wake(): void {
    if (this.state === 'stopped' || !this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.connect();
  }

  // Seals and queues a packet. Returns false while no epoch exists yet.
  send(plaintext: Uint8Array): boolean {
    const session = this.opts.session;
    if (!session.ready) return false;
    const bytes = session.seal(plaintext);
    if (bytes.length > MAX_FRAME_BYTES) throw new Error('frame exceeds relay limit');
    // The counter is persisted before the frame leaves so a crash never reuses a nonce.
    this.opts.persist(session.exportState());
    this.enqueue(bytes);
    return true;
  }

  private enqueue(bytes: Uint8Array): void {
    const frame = decodeFrame(bytes);
    this.outbox.push({ epoch: frame.epoch, seq: frame.seq, bytes });
    this.outboxBytes += bytes.length;
    while (this.outbox.length > MAX_OUTBOX_FRAMES || this.outboxBytes > MAX_OUTBOX_BYTES) {
      const dropped = this.outbox.shift();
      if (!dropped) break;
      this.outboxBytes -= dropped.bytes.length;
      this.opts.log.warn('wizzle: outbox full, dropping oldest unacked frame', { seq: dropped.seq.toString() });
    }
    if (this.state === 'ready') this.conn?.sendBinary(bytes);
  }

  private connect(): void {
    this.state = 'connecting';
    this.peerOnline = false;
    this.opts.onChange?.();
    let conn: TransportConn | null = null;
    conn = this.opts.transport.connect(this.opts.relayUrl, {
      onOpen: () => {
        if (this.conn !== conn) return;
        this.state = 'open';
        conn?.sendText(
          encodeControl({
            t: 'hello',
            v: RELAY_PROTOCOL_VERSION,
            pairing: toB64Url(this.opts.pairingId),
            role: 'phone',
            secret: toB64Url(this.opts.relaySecret),
          }),
        );
        this.opts.onChange?.();
      },
      onText: (text) => {
        if (this.conn === conn) this.handleControl(text);
      },
      onBinary: (bytes) => {
        if (this.conn === conn) this.handleFrame(bytes);
      },
      onClose: (code, reason) => {
        if (this.conn !== conn) return;
        this.conn = null;
        this.peerOnline = false;
        this.handshaking = false;
        if (this.state === 'stopped') return;
        this.opts.log.warn('wizzle: relay connection closed', { code, reason });
        this.scheduleReconnect();
      },
    });
    this.conn = conn;
  }

  private scheduleReconnect(): void {
    const { minMs, maxMs } = this.opts.reconnect ?? { minMs: 1000, maxMs: 30_000 };
    const base = Math.min(maxMs, minMs * 2 ** Math.min(this.attempts, 10));
    const delay = Math.round(base * (0.5 + Math.random() * 0.5));
    this.attempts += 1;
    this.state = 'connecting';
    this.opts.onChange?.();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.state !== 'stopped') this.connect();
    }, delay);
  }

  // A fresh epoch every time both sides are online is the forward secrecy boundary.
  private beginHandshake(): void {
    if (this.handshaking || this.state !== 'ready') return;
    this.handshaking = true;
    this.conn?.sendBinary(this.opts.session.beginHandshake());
  }

  private handleControl(text: string): void {
    let msg;
    try {
      msg = decodeControl(text);
    } catch {
      this.opts.log.warn('wizzle: ignoring malformed relay control message');
      return;
    }
    switch (msg.t) {
      case 'welcome':
        this.state = 'ready';
        this.attempts = 0;
        this.peerOnline = msg.peer;
        this.opts.log.info('wizzle: relay ready', { peer: msg.peer, buffered: msg.buffered });
        for (const pending of this.outbox) this.conn?.sendBinary(pending.bytes);
        if (msg.peer) this.beginHandshake();
        this.opts.onChange?.();
        return;
      case 'peer':
        this.peerOnline = msg.online;
        if (msg.online) this.beginHandshake();
        else this.handshaking = false;
        this.opts.onChange?.();
        return;
      case 'error':
        this.opts.log.error('wizzle: relay error', { code: msg.code, message: msg.message });
        if (msg.code === 'auth' || msg.code === 'revoked') {
          this.stop();
          this.opts.onFatal?.(msg.code, msg.message);
        }
        return;
      default:
        return;
    }
  }

  private handleFrame(bytes: Uint8Array): void {
    let frame;
    try {
      frame = decodeFrame(bytes);
    } catch {
      this.opts.log.warn('wizzle: ignoring malformed frame');
      return;
    }
    const session = this.opts.session;
    if (frame.type === FRAME_HS) {
      let confirm: Uint8Array | null;
      try {
        confirm = session.handleHandshake(frame);
      } catch (err) {
        this.opts.log.warn('wizzle: rejected handshake frame', { err });
        return;
      }
      this.opts.persist(session.exportState());
      // The confirm rides the outbox so it is resent until the bridge acknowledges it.
      if (confirm) this.enqueue(confirm);
      this.opts.onChange?.();
      return;
    }
    if (frame.type === FRAME_ACK) {
      this.trimOutbox(frame.epoch, frame.seq);
      return;
    }
    if (frame.type !== FRAME_DATA) return;
    const result = session.open(frame);
    switch (result.kind) {
      case 'data':
        this.opts.persist(session.exportState());
        this.sendAck();
        this.opts.onPacket(result.plaintext);
        return;
      case 'confirm':
        this.opts.persist(session.exportState());
        this.sendAck();
        this.handshaking = false;
        this.opts.log.info('wizzle: session established');
        this.opts.onSession?.();
        this.opts.onChange?.();
        return;
      case 'duplicate':
        this.sendAck();
        return;
      case 'unknownEpoch':
        this.opts.log.warn('wizzle: frame for unknown epoch dropped');
        return;
      case 'badTag':
        this.opts.log.warn('wizzle: frame failed authentication');
        return;
      default:
        return;
    }
  }

  private sendAck(): void {
    const ack = this.opts.session.ack();
    if (ack) this.conn?.sendBinary(ack);
  }

  private trimOutbox(epoch: Uint8Array, seq: bigint): void {
    const kept: Pending[] = [];
    let bytes = 0;
    for (const pending of this.outbox) {
      if (equal(pending.epoch, epoch) && pending.seq <= seq) continue;
      kept.push(pending);
      bytes += pending.bytes.length;
    }
    this.outbox = kept;
    this.outboxBytes = bytes;
  }
}
