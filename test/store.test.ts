import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import {
  Session,
  decodePacket,
  derivePsk,
  deriveRelaySecret,
  encodePacket,
  type BridgeMessage,
  type Capabilities,
  type ChatMessage,
  type DecodedPacket,
  type PhoneMessage,
} from '../src/protocol/index.ts';
import { RelayClient } from '../src/relay/client.ts';
import { WizzleStore, type StoreLink } from '../src/store/store.ts';
import { FakeBridge, FakeRelay, newPairing, silentLog, until } from './fake-relay.ts';

const CONV = 'wizzle:agent-1';

const CAPABILITIES: Capabilities = {
  streaming: false,
  questions: true,
  approvals: true,
  tasks: false,
  files: true,
  history: true,
  clearSession: false,
  abort: false,
  createAgent: true,
};

type Wired = { store: WizzleStore; bridge: FakeBridge; relay: FakeRelay; client: RelayClient; stop(): void };

// The store over a real RelayClient, so every test drives it with packets FakeBridge actually sealed.
async function wired(): Promise<Wired> {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const bridge = new FakeBridge(relay, pairing.pairingId, pairing.secret);
  await bridge.connect();
  const listeners = new Set<(packet: DecodedPacket) => void>();
  let n = 0;
  const client = new RelayClient({
    transport: relay.transport,
    relayUrl: 'fake',
    pairingId: pairing.pairingId,
    relaySecret: deriveRelaySecret(nodeCrypto, pairing.secret),
    session: new Session(nodeCrypto, 'phone', pairing.pairingId, derivePsk(nodeCrypto, pairing.secret)),
    persist: () => undefined,
    log: silentLog,
    onPacket: (plaintext) => {
      const packet = decodePacket(plaintext);
      for (const listener of listeners) listener(packet);
    },
    onSession: () => void link.send({ t: 'sync' }),
    reconnect: { minMs: 5, maxMs: 10 },
  });
  const link: StoreLink = {
    send: (message: PhoneMessage, body?: Uint8Array) => {
      const id = `p${(n += 1)}`;
      return client.send(encodePacket({ id, ...message }, body)) ? id : null;
    },
    onPacket: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
  const store = new WizzleStore({ link, newId: () => `m${(n += 1)}` });
  client.start();
  await bridge.nextOf('sync');
  return {
    store,
    bridge,
    relay,
    client,
    stop: () => {
      store.destroy();
      client.stop();
      bridge.disconnect();
    },
  };
}

function catalog(bridge: FakeBridge): void {
  bridge.send({
    t: 'hello',
    protocol: 1,
    runtime: 'nanoclaw',
    runtimeVersion: '2.1.0',
    bridgeVersion: '0.1.0',
    host: 'pi',
    capabilities: CAPABILITIES,
  });
  bridge.send({ t: 'agents', agents: [{ id: 'agent-1', name: 'main', status: 'idle' }, { id: 'system', name: 'System', status: 'idle' }] });
  bridge.send({
    t: 'conversations',
    conversations: [
      { id: CONV, agentId: 'agent-1', title: 'main', lastAt: 1000 },
      { id: 'wizzle:system', agentId: 'system', title: 'System' },
    ],
  });
}

function message(msgId: string, at: number, text: string, role: ChatMessage['role'] = 'agent'): ChatMessage {
  return { conv: CONV, msgId, role, text, format: 'markdown', at };
}

test('sync brings the catalog in and the snapshot exposes it', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 2);
  const snapshot = w.store.getSnapshot();
  assert.equal(snapshot.hello?.runtime, 'nanoclaw');
  assert.equal(snapshot.capabilities?.history, true);
  assert.equal(snapshot.capabilities?.streaming, false);
  assert.equal(snapshot.agents.length, 2);
  assert.equal(snapshot.conversations[0]?.id, CONV);
  assert.equal(snapshot.conversations[0]?.agent?.name, 'main');
  assert.equal(snapshot.conversations[1]?.id, 'wizzle:system');
  w.stop();
});

test('an agent packet updates one agent without dropping the rest', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().agents.length === 2);
  w.bridge.send({ t: 'agent', agent: { id: 'agent-1', name: 'main', status: 'running', model: 'opus' } });
  await until(() => w.store.getSnapshot().agents[0]?.status === 'running');
  assert.equal(w.store.getSnapshot().agents.length, 2);
  assert.equal(w.store.getSnapshot().conversations[0]?.agent?.model, 'opus');
  w.stop();
});

test('an incoming message lands in the conversation and in the row preview', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'message', message: message('a1', 2000, 'All 20 passed.\nDetails follow.') });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  const entry = w.store.conversation(CONV).messages[0];
  assert.equal(entry?.role, 'agent');
  assert.equal(entry?.format, 'markdown');
  const row = w.store.getSnapshot().conversations[0];
  assert.equal(row?.preview, 'All 20 passed. Details follow.');
  assert.equal(row?.lastAt, 2000);
  w.stop();
});

test('messages stay ordered by time whatever order they arrive in', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'message', message: message('a2', 3000, 'second') });
  w.bridge.send({ t: 'message', message: message('a1', 1500, 'first') });
  w.bridge.send({ t: 'message', message: message('a3', 4000, 'third') });
  await until(() => w.store.conversation(CONV).messages.length === 3);
  assert.deepEqual(w.store.conversation(CONV).messages.map((m) => m.text), ['first', 'second', 'third']);
  w.stop();
});

test('send echoes locally at once and reaches the bridge with the same msgId', async () => {
  const w = await wired();
  catalog(w.bridge);
  const msgId = w.store.send(CONV, '  run the tests  ');
  assert.ok(msgId);
  const entry = w.store.conversation(CONV).messages[0];
  assert.equal(entry?.text, 'run the tests');
  assert.equal(entry?.role, 'user');
  assert.ok(entry?.local?.packetId);
  const sent = await w.bridge.nextOf('send');
  assert.equal(sent.header['msgId'], msgId);
  assert.equal(sent.header['conv'], CONV);
  assert.equal(sent.header['text'], 'run the tests');
  assert.equal(w.store.send(CONV, '   '), null);
  w.stop();
});

test('an error with a ref marks that message failed and retry sends a fresh msgId', async () => {
  const w = await wired();
  catalog(w.bridge);
  const msgId = w.store.send('wizzle:system', 'hello');
  const sent = await w.bridge.nextOf('send');
  w.bridge.send({ t: 'error', ref: sent.header.id, code: 'read_only', message: 'No agent is wired to the System conversation' });
  await until(() => w.store.conversation('wizzle:system').messages[0]?.local?.failure !== undefined);
  const failed = w.store.conversation('wizzle:system').messages[0];
  assert.equal(failed?.local?.failure?.code, 'read_only');
  assert.equal(w.store.getSnapshot().notices.length, 0);

  const retried = w.store.retry('wizzle:system', msgId as string);
  assert.notEqual(retried, msgId);
  const again = await w.bridge.nextOf('send');
  assert.equal(again.header['msgId'], retried);
  const messages = w.store.conversation('wizzle:system').messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.local?.failure, undefined);
  w.stop();
});

test('discard removes a failed message', async () => {
  const w = await wired();
  const msgId = w.store.send(CONV, 'nope') as string;
  await w.bridge.nextOf('send');
  w.store.discard(CONV, msgId);
  assert.equal(w.store.conversation(CONV).messages.length, 0);
  w.stop();
});

test('an error with no ref becomes a dismissible notice', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'error', code: 'unknown', message: 'Unknown packet type fnord' });
  await until(() => w.store.getSnapshot().notices.length === 1);
  const notice = w.store.getSnapshot().notices[0];
  assert.equal(notice?.code, 'unknown');
  w.store.dismiss(notice?.id as string);
  assert.equal(w.store.getSnapshot().notices.length, 0);
  w.stop();
});

test('an error for a history request notices that conversation and stops the spinner', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().capabilities !== null);
  w.store.open(CONV);
  const asked = await w.bridge.nextOf('history');
  assert.equal(w.store.conversation(CONV).loading, true);
  w.bridge.send({ t: 'error', ref: asked.header.id, code: 'unknown_conv', message: 'No such conversation' });
  await until(() => w.store.conversation(CONV).notices.length === 1);
  assert.equal(w.store.conversation(CONV).loading, false);
  assert.equal(w.store.getSnapshot().notices.length, 0);
  w.store.dismiss(w.store.conversation(CONV).notices[0]?.id as string, CONV);
  assert.equal(w.store.conversation(CONV).notices.length, 0);
  w.stop();
});

test('history is asked for once on open, pages back, and stops when a page repeats', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().capabilities !== null);
  w.store.open(CONV);
  w.store.open(CONV);
  const asked = await w.bridge.nextOf('history');
  assert.equal(asked.header['limit'], 50);
  assert.equal(asked.header['before'], undefined);
  w.bridge.send({ t: 'history', conv: CONV, messages: [message('h2', 2000, 'older'), message('h3', 3000, 'newer')], hasMore: true });
  await until(() => w.store.conversation(CONV).messages.length === 2);
  assert.equal(w.store.conversation(CONV).hasMore, true);
  assert.equal(w.store.conversation(CONV).loading, false);

  w.store.loadOlder(CONV);
  const older = await w.bridge.nextOf('history');
  assert.equal(older.header['before'], 'h2');
  w.bridge.send({ t: 'history', conv: CONV, messages: [message('h1', 1000, 'oldest')], hasMore: true });
  await until(() => w.store.conversation(CONV).messages.length === 3);
  assert.deepEqual(w.store.conversation(CONV).messages.map((m) => m.text), ['oldest', 'older', 'newer']);

  w.store.loadOlder(CONV);
  await w.bridge.nextOf('history');
  w.bridge.send({ t: 'history', conv: CONV, messages: [message('h1', 1000, 'oldest')], hasMore: true });
  await until(() => w.store.conversation(CONV).hasMore === false);
  assert.equal(w.store.conversation(CONV).messages.length, 3);
  w.store.loadOlder(CONV);
  assert.equal(w.store.conversation(CONV).loading, false);
  w.stop();
});

test('history does not duplicate a message this phone already echoed', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.store.send(CONV, 'run the tests');
  await w.bridge.nextOf('send');
  w.store.open(CONV);
  await w.bridge.nextOf('history');
  w.bridge.send({ t: 'history', conv: CONV, messages: [message('nanoclaw-99', 1200, 'run the tests', 'user')], hasMore: false });
  await until(() => w.store.conversation(CONV).loading === false);
  const messages = w.store.conversation(CONV).messages;
  assert.equal(messages.length, 1);
  assert.ok(messages[0]?.local);
  w.stop();
});

test('history is not requested when the bridge says it has none', async () => {
  const w = await wired();
  w.bridge.send({
    t: 'hello',
    protocol: 1,
    runtime: 'openclaw',
    bridgeVersion: '0.1.0',
    host: 'pi',
    capabilities: { ...CAPABILITIES, history: false },
  });
  await until(() => w.store.getSnapshot().capabilities?.history === false);
  w.store.open(CONV);
  assert.equal(w.store.conversation(CONV).requested, false);
  assert.equal(w.store.conversation(CONV).loading, false);
  w.stop();
});

test('delta, edit and reaction change a message in place', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'message', message: message('a1', 1000, 'Running') });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  w.bridge.send({ t: 'delta', conv: CONV, msgId: 'a1', append: ' the tests' });
  await until(() => w.store.conversation(CONV).messages[0]?.text === 'Running the tests');
  w.bridge.send({ t: 'edit', conv: CONV, msgId: 'a1', text: 'All 20 passed', terminal: { resolution: 'done' } });
  await until(() => w.store.conversation(CONV).messages[0]?.edited === true);
  assert.equal(w.store.conversation(CONV).messages[0]?.resolution, 'done');
  w.bridge.send({ t: 'reaction', conv: CONV, msgId: 'a1', emoji: '✅', op: 'add' });
  await until(() => w.store.conversation(CONV).messages[0]?.reactions?.length === 1);
  w.bridge.send({ t: 'reaction', conv: CONV, msgId: 'a1', emoji: '✅', op: 'remove' });
  await until(() => w.store.conversation(CONV).messages[0]?.reactions?.length === 0);
  w.stop();
});

test('a delta for an unknown message starts one', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'delta', conv: CONV, msgId: 'ghost', append: 'partial' });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  assert.equal(w.store.conversation(CONV).messages[0]?.text, 'partial');
  w.stop();
});

test('cards and files become entries the UI can render', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'card', conv: CONV, msgId: 'c1', card: { kind: 'diff' }, fallbackText: '3 files changed', at: 5000 });
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'f1', file: { name: 'log.txt', mime: 'text/plain', size: 12 }, caption: 'the log', at: 6000 }, new Uint8Array(12));
  await until(() => w.store.conversation(CONV).messages.length === 2);
  const [card, file] = w.store.conversation(CONV).messages;
  assert.equal(card?.kind, 'card');
  assert.equal(card?.text, '3 files changed');
  assert.deepEqual(card?.card, { kind: 'diff' });
  assert.equal(file?.kind, 'file');
  assert.equal(file?.file?.name, 'log.txt');
  assert.equal(w.store.getSnapshot().conversations[0]?.preview, 'the log');
  w.stop();
});

test('activity is held per conversation and idle clears it', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'activity', activity: { conv: CONV, state: 'tool', tool: 'Bash', label: 'npm test', startedAt: 10 } });
  await until(() => w.store.conversation(CONV).activity !== null);
  assert.equal(w.store.conversation(CONV).activity?.label, 'npm test');
  await until(() => w.store.getSnapshot().conversations[0]?.activity?.tool === 'Bash');
  w.bridge.send({ t: 'activity', activity: { conv: CONV, state: 'idle' } });
  await until(() => w.store.conversation(CONV).activity === null);
  w.stop();
});

test('a question is answered and question_resolved closes it', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({
    t: 'question',
    question: {
      conv: CONV,
      questionId: 'q1',
      title: 'Deploy',
      question: 'Ship it?',
      options: [{ label: 'Yes', value: 'yes', style: 'primary' }, { label: 'No', value: 'no' }],
      expiresAt: 9999,
    },
  });
  await until(() => w.store.conversation(CONV).questions.length === 1);
  assert.equal(w.store.getSnapshot().conversations[0]?.questions, 1);
  w.store.answer(CONV, 'q1', 'yes');
  assert.equal(w.store.conversation(CONV).questions[0]?.answered, 'yes');
  const answered = await w.bridge.nextOf('answer');
  assert.equal(answered.header['questionId'], 'q1');
  assert.equal(answered.header['value'], 'yes');
  w.bridge.send({ t: 'question_resolved', questionId: 'q1', value: 'yes', by: 'phone' });
  await until(() => w.store.conversation(CONV).questions.length === 0);
  assert.equal(w.store.conversation(CONV).messages.at(-1)?.text, 'Answered by phone: yes');
  w.stop();
});

test('an approval is resolved and closes the same way', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({
    t: 'approval',
    approval: { conv: 'wizzle:system', approvalId: 'ap1', title: 'Run rm -rf', command: 'rm -rf build', decisions: ['allow', 'deny', 'allow_always'] },
  });
  await until(() => w.store.conversation('wizzle:system').approvals.length === 1);
  w.store.decide('wizzle:system', 'ap1', 'deny');
  assert.equal(w.store.conversation('wizzle:system').approvals[0]?.decided, 'deny');
  const resolved = await w.bridge.nextOf('resolve');
  assert.equal(resolved.header['approvalId'], 'ap1');
  assert.equal(resolved.header['decision'], 'deny');
  w.bridge.send({ t: 'approval_resolved', approvalId: 'ap1', decision: 'deny' });
  await until(() => w.store.conversation('wizzle:system').approvals.length === 0);
  assert.equal(w.store.conversation('wizzle:system').messages.at(-1)?.text, 'Approval deny');
  w.stop();
});

test('a session event is written into the transcript', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'session', conv: CONV, event: 'cleared', detail: 'by the owner' });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  const entry = w.store.conversation(CONV).messages[0];
  assert.equal(entry?.role, 'system');
  assert.equal(entry?.text, 'Session cleared: by the owner');
  w.stop();
});

test('malformed packets are dropped instead of breaking the store', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'message', message: { conv: CONV } } as unknown as BridgeMessage);
  w.bridge.send({ t: 'activity', activity: {} } as unknown as BridgeMessage);
  w.bridge.send({ t: 'question', question: { conv: CONV } } as unknown as BridgeMessage);
  w.bridge.send({ t: 'nonsense' } as unknown as BridgeMessage);
  w.bridge.send({ t: 'message', message: message('a1', 1000, 'still here') });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  assert.equal(w.store.dropped, 3);
  assert.equal(w.store.conversation(CONV).messages[0]?.text, 'still here');
  w.stop();
});

test('a conversation object only changes when that conversation does', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 2);
  const system = w.store.conversation('wizzle:system');
  const before = w.store.conversation(CONV);
  w.bridge.send({ t: 'message', message: message('a1', 1000, 'hello') });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  assert.notEqual(w.store.conversation(CONV), before);
  assert.equal(w.store.conversation('wizzle:system'), system);
  w.stop();
});

test('reset clears everything the old pairing sent', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'message', message: message('a1', 1000, 'hello') });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  w.store.reset();
  assert.equal(w.store.getSnapshot().conversations.length, 0);
  assert.equal(w.store.getSnapshot().agents.length, 0);
  assert.equal(w.store.getSnapshot().hello, null);
  assert.equal(w.store.conversation(CONV).messages.length, 0);
  w.stop();
});
