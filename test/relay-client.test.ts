import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import {
  FRAME_DATA,
  Session,
  decodeFrame,
  decodePacket,
  derivePsk,
  deriveRelaySecret,
  encodePacket,
  toB64Url,
  type DecodedPacket,
  type SessionState,
} from '../src/protocol/index.ts';
import { RelayClient, type RelayClientOptions } from '../src/relay/client.ts';
import type { Transport } from '../src/relay/transport.ts';
import { FakeBridge, FakeRelay, newPairing, silentLog, sleep, until } from './fake-relay.ts';

type Pairing = ReturnType<typeof newPairing>;

type Harness = {
  client: RelayClient;
  packets: DecodedPacket[];
  states: SessionState[];
  sessions: number;
  fatal: string | null;
};

function phoneClient(relay: FakeRelay, pairing: Pairing, overrides: Partial<RelayClientOptions> = {}, state?: SessionState): Harness {
  const session = new Session(nodeCrypto, 'phone', pairing.pairingId, derivePsk(nodeCrypto, pairing.secret), state);
  const h: Harness = { client: null as unknown as RelayClient, packets: [], states: [], sessions: 0, fatal: null };
  h.client = new RelayClient({
    transport: relay.transport,
    relayUrl: 'fake',
    pairingId: pairing.pairingId,
    relaySecret: deriveRelaySecret(nodeCrypto, pairing.secret),
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

async function established(relay: FakeRelay, pairing: Pairing): Promise<{ phone: Harness; bridge: FakeBridge }> {
  const bridge = new FakeBridge(relay, pairing.pairingId, pairing.secret);
  await bridge.connect();
  const phone = phoneClient(relay, pairing);
  phone.client.start();
  await until(() => phone.sessions === 1);
  return { phone, bridge };
}

test('hello carries the phone role and the derived relay secret', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  relay.expectedSecret = toB64Url(deriveRelaySecret(nodeCrypto, pairing.secret));
  const phone = phoneClient(relay, pairing);
  phone.client.start();
  await until(() => phone.client.state === 'ready');
  assert.equal(relay.online('phone'), true);
  assert.equal(phone.client.peerOnline, false);
  assert.equal(phone.client.session.ready, false);
  phone.client.stop();
  assert.equal(phone.client.state, 'stopped');
});

test('the phone starts the handshake when the bridge is already online', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { phone, bridge } = await established(relay, pairing);
  assert.equal(phone.client.session.ready, true);
  assert.equal(bridge.session.ready, true);
  assert.equal(bridge.confirms, 1);
  assert.equal(phone.client.handshaking, false);
  const last = phone.states.at(-1);
  assert.ok(last);
  assert.equal(last.epochs.length, 1);
  assert.equal(last.send, last.epochs[0]?.id);
  await until(() => phone.client.pending === 0);
  phone.client.stop();
});

test('a bridge that comes online later triggers the handshake', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const phone = phoneClient(relay, pairing);
  phone.client.start();
  await until(() => phone.client.state === 'ready');
  await sleep(10);
  assert.equal(phone.client.session.ready, false);
  const bridge = new FakeBridge(relay, pairing.pairingId, pairing.secret);
  await bridge.connect();
  await until(() => phone.sessions === 1);
  assert.equal(phone.client.peerOnline, true);
  phone.client.stop();
});

test('every reconnect of the bridge yields a fresh epoch', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { phone, bridge } = await established(relay, pairing);
  bridge.disconnect();
  await until(() => !phone.client.peerOnline);
  await bridge.connect();
  await until(() => phone.sessions === 2);
  assert.equal(phone.client.session.exportState().epochs.length, 2);
  assert.equal(bridge.session.exportState().epochs.length, 2);
  phone.client.stop();
});

test('packets flow both ways and acks let the relay drop its copies', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { phone, bridge } = await established(relay, pairing);
  assert.equal(phone.client.send(encodePacket({ id: 'a', t: 'sync' })), true);
  const sync = await bridge.nextOf('sync');
  assert.equal(sync.header.id, 'a');
  bridge.send({ t: 'agents', agents: [] });
  await until(() => phone.packets.length === 1);
  assert.equal(phone.packets[0]?.header.t, 'agents');
  await until(() => phone.client.pending === 0);
  assert.equal(relay.bufferedFor('phone'), 0);
  assert.equal(relay.bufferedFor('bridge'), 0);

  bridge.disconnect();
  await until(() => !phone.client.peerOnline);
  phone.client.send(encodePacket({ id: 'b', t: 'tasks' }));
  assert.equal(relay.bufferedFor('bridge'), 1);
  await bridge.connect();
  const tasks = await bridge.nextOf('tasks');
  assert.equal(tasks.header.id, 'b');
  await until(() => relay.bufferedFor('bridge') === 0);
  phone.client.stop();
});

test('session state is persisted before a frame reaches the relay', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const bridge = new FakeBridge(relay, pairing.pairingId, pairing.secret);
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
  const phone = phoneClient(relay, pairing, { transport: spying, persist: (s) => void h.states.push(s) });
  phone.client.start();
  await until(() => phone.sessions === 1);
  phone.client.send(encodePacket({ id: 'c', t: 'sync' }));
  await bridge.nextOf('sync');
  assert.equal(checked, 2);
  phone.client.stop();
});

test('unacked frames are resent after a reconnect and trimmed by acks', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { phone, bridge } = await established(relay, pairing);
  await until(() => phone.client.pending === 0);
  bridge.autoAck = false;
  phone.client.send(encodePacket({ id: 'x', t: 'sync' }));
  await bridge.nextOf('sync');
  assert.equal(phone.client.pending, 1);
  const before = relay.connections;
  relay.drop('phone');
  await until(() => relay.connections === before + 1 && phone.client.state === 'ready');
  await until(() => bridge.frames.length >= 3);
  const [, original, resent] = bridge.frames;
  assert.ok(original && resent);
  assert.equal(resent.seq, original.seq);
  await until(() => phone.sessions === 2);
  assert.equal(phone.client.pending, 2);
  bridge.ackFrame(original);
  await until(() => phone.client.pending === 1);
  bridge.ack();
  await until(() => phone.client.pending === 0);
  phone.client.stop();
});

test('wake skips the rest of a backoff wait', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const phone = phoneClient(relay, pairing, { reconnect: { minMs: 1000, maxMs: 2000 } });
  phone.client.start();
  await until(() => phone.client.state === 'ready');
  relay.drop('phone');
  await until(() => !relay.online('phone'));
  await sleep(5);
  phone.client.wake();
  await until(() => phone.client.state === 'ready', 200);
  assert.equal(relay.connections, 2);
  phone.client.stop();
});

test('auth errors stop the client for good', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  relay.expectedSecret = 'not-it';
  const phone = phoneClient(relay, pairing);
  phone.client.start();
  await until(() => phone.fatal === 'auth');
  assert.equal(phone.client.state, 'stopped');
  await sleep(40);
  assert.equal(relay.connections, 1);
});

test('a persisted session opens buffered frames without a new handshake', async () => {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const { phone, bridge } = await established(relay, pairing);
  await until(() => phone.client.pending === 0);
  phone.client.stop();
  const saved = phone.states.at(-1);
  assert.ok(saved);
  assert.equal(phone.client.peerOnline, false);
  await until(() => !relay.online('phone'));
  bridge.send({ t: 'agents', agents: [{ id: 'a1', name: 'main', status: 'idle' }] });
  await until(() => relay.bufferedFor('phone') === 1);
  bridge.disconnect();
  const restored = phoneClient(relay, pairing, {}, saved);
  restored.client.start();
  await until(() => restored.packets.length === 1);
  assert.equal(restored.sessions, 0);
  assert.equal(restored.client.peerOnline, false);
  await until(() => relay.bufferedFor('phone') === 0);
  restored.client.stop();
});
