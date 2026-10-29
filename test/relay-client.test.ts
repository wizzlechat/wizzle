import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import {
  FRAME_DATA,
  Session,
  decodeFrame,
  decodePacket,
  deriveRelaySecret,
  encodePacket,
  toB64Url,
  type DecodedPacket,
  type SessionState,
} from '../src/protocol/index.ts';
import { RelayClient, type RelayClientOptions } from '../src/relay/client.ts';
import type { Transport } from '../src/relay/transport.ts';
import { FakeBridge, FakeRelay, newPairing, wizzleKeys, wizzleSecrets, silentLog, sleep, until } from './fake-relay.ts';

type Pairing = ReturnType<typeof newPairing>;

type Harness = {
  client: RelayClient;
  packets: DecodedPacket[];
  states: SessionState[];
  sessions: number;
  fatal: string | null;
};

function wizzleClient(relay: FakeRelay, pairing: Pairing, overrides: Partial<RelayClientOptions> = {}, state?: SessionState): Harness {
  const session = new Session(nodeCrypto, 'wizzle', pairing.pairingId, wizzleKeys(pairing), state);
  const h: Harness = { client: null as unknown as RelayClient, packets: [], states: [], sessions: 0, fatal: null };
  h.client = new RelayClient({
    transport: relay.transport,
    relayUrl: 'fake',
    pairingId: pairing.pairingId,
    relaySecrets: () => wizzleSecrets(pairing),
    session,
    persist: (s) => void h.states.push(s),
    log: silentLog,
    onPacket: (plaintext) => void h.packets.push(decodePacket(plaintext)),
    onSession: () => {
      h.sessions += 1;
    },
    onFatal: (code) => {
      h.fatal = code;
    },
    reconnect: { minMs: 5, maxMs: 10 },
    ...overrides,
  });
  return h;
}

async function established(relay: FakeRelay, pairing: Pairing): Promise<{ wizzle: Harness; bridge: FakeBridge }> {
  const bridge = new FakeBridge(relay, pairing);
  await bridge.connect();
  const wizzle = wizzleClient(relay, pairing);
  wizzle.client.start();
  await until(() => wizzle.sessions === 1);
  return { wizzle, bridge };
}

test('hello carries wizzle role and the derived relay secret', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  relay.expectedSecret = toB64Url(deriveRelaySecret(nodeCrypto, pairing.secret));
  const wizzle = wizzleClient(relay, pairing);
  wizzle.client.start();
  await until(() => wizzle.client.state === 'ready');
  assert.equal(relay.online('wizzle'), true);
  assert.equal(wizzle.client.peerOnline, false);
  assert.equal(wizzle.client.session.ready, false);
  wizzle.client.stop();
  assert.equal(wizzle.client.state, 'stopped');
});

test('wizzle starts the handshake when the bridge is already online', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  assert.equal(wizzle.client.session.ready, true);
  assert.equal(bridge.session.ready, true);
  assert.equal(bridge.confirms, 1);
  assert.equal(wizzle.client.handshaking, false);
  const last = wizzle.states.at(-1);
  assert.ok(last);
  assert.equal(last.epochs.length, 1);
  assert.equal(last.send, last.epochs[0]?.id);
  await until(() => wizzle.client.pending === 0);
  wizzle.client.stop();
});

test('a bridge that comes online later triggers the handshake', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const wizzle = wizzleClient(relay, pairing);
  wizzle.client.start();
  await until(() => wizzle.client.state === 'ready');
  await sleep(10);
  assert.equal(wizzle.client.session.ready, false);
  const bridge = new FakeBridge(relay, pairing);
  await bridge.connect();
  await until(() => wizzle.sessions === 1);
  assert.equal(wizzle.client.peerOnline, true);
  wizzle.client.stop();
});

test('every reconnect of the bridge yields a fresh epoch', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  bridge.disconnect();
  await until(() => !wizzle.client.peerOnline);
  await bridge.connect();
  await until(() => wizzle.sessions === 2);
  assert.equal(wizzle.client.session.exportState().epochs.length, 2);
  assert.equal(bridge.session.exportState().epochs.length, 2);
  wizzle.client.stop();
});

test('packets flow both ways and acks let the relay drop its copies', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  assert.equal(wizzle.client.send(encodePacket({ id: 'a', t: 'sync' })), true);
  const sync = await bridge.nextOf('sync');
  assert.equal(sync.header.id, 'a');
  bridge.send({ t: 'agents', agents: [] });
  await until(() => wizzle.packets.length === 1);
  assert.equal(wizzle.packets[0]?.header.t, 'agents');
  await until(() => wizzle.client.pending === 0);
  assert.equal(relay.bufferedFor('wizzle'), 0);
  assert.equal(relay.bufferedFor('bridge'), 0);

  bridge.disconnect();
  await until(() => !wizzle.client.peerOnline);
  wizzle.client.send(encodePacket({ id: 'b', t: 'tasks' }));
  assert.equal(relay.bufferedFor('bridge'), 1);
  await bridge.connect();
  const tasks = await bridge.nextOf('tasks');
  assert.equal(tasks.header.id, 'b');
  await until(() => relay.bufferedFor('bridge') === 0);
  wizzle.client.stop();
});

test('session state is persisted before a frame reaches the relay', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const bridge = new FakeBridge(relay, pairing);
  await bridge.connect();
  let checked = 0;
  const h: { states: SessionState[] } = { states: [] };
  const spying: Transport = {
    connect: (url, handlers) => {
      const conn = relay.transport.connect(url, handlers);
      return {
        ...conn,
        sendBinary: (bytes) => {
          const frame = decodeFrame(bytes);
          if (frame.type === FRAME_DATA) {
            const epoch = h.states.at(-1)?.epochs.find((e) => e.id === toB64Url(frame.epoch));
            assert.equal(epoch?.sendSeq, frame.seq.toString());
            checked += 1;
          }
          conn.sendBinary(bytes);
        },
      };
    },
  };
  const wizzle = wizzleClient(relay, pairing, { transport: spying, persist: (s) => void h.states.push(s) });
  wizzle.client.start();
  await until(() => wizzle.sessions === 1);
  wizzle.client.send(encodePacket({ id: 'c', t: 'sync' }));
  await bridge.nextOf('sync');
  assert.equal(checked, 2);
  wizzle.client.stop();
});

test('unacked frames are resent after a reconnect and trimmed by acks', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  await until(() => wizzle.client.pending === 0);
  bridge.autoAck = false;
  wizzle.client.send(encodePacket({ id: 'x', t: 'sync' }));
  await bridge.nextOf('sync');
  assert.equal(wizzle.client.pending, 1);
  const before = relay.connections;
  relay.drop('wizzle');
  await until(() => relay.connections === before + 1 && wizzle.client.state === 'ready');
  await until(() => bridge.frames.length >= 3);
  const [, original, resent] = bridge.frames;
  assert.ok(original && resent);
  assert.equal(resent.seq, original.seq);
  await until(() => wizzle.sessions === 2);
  assert.equal(wizzle.client.pending, 2);
  bridge.ackFrame(original);
  await until(() => wizzle.client.pending === 1);
  bridge.ack();
  await until(() => wizzle.client.pending === 0);
  wizzle.client.stop();
});

test('wake skips the rest of a backoff wait', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const wizzle = wizzleClient(relay, pairing, { reconnect: { minMs: 1000, maxMs: 2000 } });
  wizzle.client.start();
  await until(() => wizzle.client.state === 'ready');
  relay.drop('wizzle');
  await until(() => !relay.online('wizzle'));
  await sleep(5);
  wizzle.client.wake();
  await until(() => wizzle.client.state === 'ready', 200);
  assert.equal(relay.connections, 2);
  wizzle.client.stop();
});

test('auth errors stop the client for good once every secret was refused', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  relay.expectedSecret = 'not-it';
  const wizzle = wizzleClient(relay, pairing);
  wizzle.client.start();
  await until(() => wizzle.fatal === 'auth');
  assert.equal(wizzle.client.state, 'stopped');
  await sleep(40);
  assert.equal(relay.connections, 2);
});

test('a refused invite secret is followed by the paired one on the spot', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const [invite, paired] = wizzleSecrets(pairing) as [Uint8Array, Uint8Array];
  relay.expectedSecret = toB64Url(paired);
  const wizzle = wizzleClient(relay, pairing, { reconnect: { minMs: 1000, maxMs: 2000 } });
  wizzle.client.start();
  await until(() => wizzle.client.state === 'ready', 200);
  assert.deepEqual(relay.hellos, [toB64Url(invite), toB64Url(paired)]);
  assert.equal(wizzle.fatal, null);
  relay.drop('wizzle');
  await until(() => relay.hellos.length === 4 && wizzle.client.state === 'ready', 3000);
  assert.deepEqual(relay.hellos.slice(2), [toB64Url(invite), toB64Url(paired)]);
  wizzle.client.stop();
});

test('revoke tells the relay, which cuts off the bridge, and stops the client', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  wizzle.client.revoke();
  await until(() => bridge.control.some((m) => m.t === 'error' && m.code === 'revoked'));
  assert.equal(relay.revoked, 1);
  assert.equal(wizzle.client.state, 'stopped');
});

test('a persisted session opens buffered frames without a new handshake', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  await until(() => wizzle.client.pending === 0);
  wizzle.client.stop();
  const saved = wizzle.states.at(-1);
  assert.ok(saved);
  assert.equal(wizzle.client.peerOnline, false);
  await until(() => !relay.online('wizzle'));
  bridge.send({ t: 'agents', agents: [{ id: 'a1', name: 'main', status: 'idle' }] });
  await until(() => relay.bufferedFor('wizzle') === 1);
  bridge.disconnect();
  const restored = wizzleClient(relay, pairing, {}, saved);
  restored.client.start();
  await until(() => restored.packets.length === 1);
  assert.equal(restored.sessions, 0);
  assert.equal(restored.client.peerOnline, false);
  await until(() => relay.bufferedFor('wizzle') === 0);
  restored.client.stop();
});

test('the push token goes out after every welcome and at once while attached', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const wizzle = wizzleClient(relay, pairing);
  const first = 'a'.repeat(64);
  const second = 'b'.repeat(64);
  wizzle.client.setPushToken(first);
  wizzle.client.start();
  await until(() => relay.pushes.length === 1);
  assert.deepEqual(relay.pushes[0], { platform: 'ios', token: first });
  wizzle.client.setPushToken(first);
  wizzle.client.setPushToken(second);
  await until(() => relay.pushes.length === 2);
  assert.equal(relay.pushes[1]?.token, second);
  relay.drop('wizzle');
  await until(() => relay.pushes.length === 3);
  assert.equal(relay.pushes[2]?.token, second);
  wizzle.client.setPushToken(null);
  relay.drop('wizzle');
  await until(() => relay.connections === 3 && wizzle.client.state === 'ready');
  assert.equal(relay.pushes.length, 3);
  wizzle.client.stop();
});

test('the fake relay records a wake from the bridge', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const bridge = new FakeBridge(relay, pairing);
  await bridge.connect();
  bridge.wake();
  await until(() => relay.wakes === 1);
  bridge.disconnect();
});

test('unacked frames are resent when the bridge comes back and the bridge drops the duplicates', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  await until(() => wizzle.client.pending === 0);
  bridge.autoAck = false;
  wizzle.client.send(encodePacket({ id: 'r', t: 'sync' }));
  const sync = await bridge.nextOf('sync');
  assert.equal(sync.header.id, 'r');
  const original = bridge.frames.at(-1);
  assert.ok(original);
  bridge.disconnect();
  await until(() => !wizzle.client.peerOnline);
  await bridge.connect();
  await until(() => wizzle.sessions === 2);
  const copies = bridge.frames.filter((f) => toB64Url(f.epoch) === toB64Url(original.epoch) && f.seq === original.seq);
  assert.equal(copies.length, 2);
  assert.equal(bridge.received.length, 0);
  bridge.autoAck = true;
  bridge.ackFrame(original);
  bridge.ack();
  await until(() => wizzle.client.pending === 0);
  wizzle.client.stop();
});

test('a stopped client sends nothing and delivers its outbox once started again', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { wizzle, bridge } = await established(relay, pairing);
  await until(() => wizzle.client.pending === 0);
  wizzle.client.stop();
  await until(() => !relay.online('wizzle'));
  assert.equal(wizzle.client.send(encodePacket({ id: 's', t: 'sync' })), true);
  assert.equal(wizzle.client.pending, 1);
  await sleep(10);
  assert.equal(relay.bufferedFor('bridge'), 0);
  assert.equal(bridge.received.length, 0);
  wizzle.client.start();
  const sync = await bridge.nextOf('sync');
  assert.equal(sync.header.id, 's');
  assert.equal(wizzle.client.session.exportState().epochs.length, 2);
  await until(() => wizzle.client.pending === 0);
  wizzle.client.stop();
});
