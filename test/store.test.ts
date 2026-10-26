import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nodeCrypto } from '../src/protocol/crypto-node.ts';
import {
  Session,
  decodePacket,
  encodePacket,
  utf8,
  type BridgeMessage,
  type Capabilities,
  type ChatMessage,
  type DecodedPacket,
  type PhoneMessage,
} from '../src/protocol/index.ts';
import type { FileStore } from '../src/files/types.ts';
import { RelayClient } from '../src/relay/client.ts';
import type { CachedConversation, CachedMeta, CachedPairing, ReadMarks, StoreCache } from '../src/store/cache.ts';
import { WizzleStore, attachmentFailure, plainMessage, type StoreLink } from '../src/store/store.ts';
import type { Attachment, ChatEntry, SendFailure, StoredElement } from '../src/store/types.ts';
import { FakeBridge, FakeRelay, newPairing, phoneKeys, phoneSecrets, silentLog, until } from './fake-relay.ts';

const CONV = 'wizzle:agent-1';
const PAIRING = 'pairing-1';

// Holds rows the way the SQLite cache would, keyed by pairing then conversation.
class FakeCache implements StoreCache {
  readonly meta = new Map<string, CachedMeta>();
  readonly rows = new Map<string, Map<string, CachedConversation>>();
  readonly elements = new Map<string, StoredElement[]>();
  readonly read = new Map<string, ReadMarks>();
  flushed = 0;

  load(pairingId: string): CachedPairing | null {
    const meta = this.meta.get(pairingId);
    const rows = this.rows.get(pairingId);
    const elements = this.elements.get(pairingId);
    const read = this.read.get(pairingId);
    if (!meta && !rows && !elements && !read) return null;
    return { hello: null, agents: [], catalog: [], ...meta, conversations: new Map(rows ?? []), elements: elements ?? [], read: read ?? null };
  }
  saveMeta(pairingId: string, meta: CachedMeta): void {
    this.meta.set(pairingId, meta);
  }
  saveConversation(pairingId: string, conv: string, data: CachedConversation): void {
    const rows = this.rows.get(pairingId) ?? new Map<string, CachedConversation>();
    rows.set(conv, data);
    this.rows.set(pairingId, rows);
  }
  saveElements(pairingId: string, elements: StoredElement[]): void {
    this.elements.set(pairingId, elements);
  }
  saveRead(pairingId: string, read: ReadMarks): void {
    this.read.set(pairingId, read);
  }
  forgetConversation(pairingId: string, conv: string): void {
    this.rows.get(pairingId)?.delete(conv);
  }
  forgetPairing(pairingId: string): void {
    this.meta.delete(pairingId);
    this.rows.delete(pairingId);
    this.read.delete(pairingId);
  }
  flush(): void {
    this.flushed += 1;
  }
}

// Files are uris of the form fake://<pairing>/<conv>/<id>-<name> with their bytes beside them.
class FakeFiles implements FileStore {
  readonly saved = new Map<string, Uint8Array>();

  async save(pairingId: string, conv: string, msgId: string, name: string, bytes: Uint8Array): Promise<string | null> {
    const uri = `fake://${pairingId}/${conv}/${msgId}-${name}`;
    this.saved.set(uri, bytes);
    return uri;
  }
  async keep(pairingId: string, conv: string, id: string, name: string, sourceUri: string): Promise<{ uri: string; size: number } | null> {
    const bytes = this.saved.get(sourceUri);
    if (!bytes) return null;
    const uri = `fake://${pairingId}/${conv}/${id}-${name}`;
    this.saved.set(uri, bytes);
    return { uri, size: bytes.length };
  }
  async read(uri: string): Promise<Uint8Array | null> {
    await new Promise((resolve) => setTimeout(resolve, 2));
    return this.saved.get(uri) ?? null;
  }
  remove(uri: string): void {
    this.saved.delete(uri);
  }
  forgetConversation(pairingId: string, conv: string): void {
    for (const uri of [...this.saved.keys()]) if (uri.startsWith(`fake://${pairingId}/${conv}/`)) this.saved.delete(uri);
  }
  forgetPairing(pairingId: string): void {
    for (const uri of [...this.saved.keys()]) if (uri.startsWith(`fake://${pairingId}/`)) this.saved.delete(uri);
  }
}

function attachment(files: FakeFiles, name: string, size: number, mime = 'text/plain'): Attachment {
  const uri = `fake://picked/${name}`;
  files.saved.set(uri, new Uint8Array(size).fill(7));
  return { name, mime, size, uri };
}

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
  topics: true,
  templates: true,
  lifecycle: true,
  deleteAgent: true,
  keys: true,
};

type Wired = { store: WizzleStore; bridge: FakeBridge; relay: FakeRelay; client: RelayClient; stop(): void };

type Fakes = { cache?: FakeCache; files?: FakeFiles };

// The store over a real RelayClient, so every test drives it with packets FakeBridge actually sealed.
async function wired(fakes: Fakes = {}): Promise<Wired> {
  const relay = new FakeRelay();
  const pairing = newPairing();
  const bridge = new FakeBridge(relay, pairing);
  await bridge.connect();
  const listeners = new Set<(packet: DecodedPacket) => void>();
  let n = 0;
  const client = new RelayClient({
    transport: relay.transport,
    relayUrl: 'fake',
    pairingId: pairing.pairingId,
    relaySecrets: () => phoneSecrets(pairing),
    session: new Session(nodeCrypto, 'phone', pairing.pairingId, phoneKeys(pairing)),
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
  const store = new WizzleStore({ link, newId: () => `m${(n += 1)}`, ...fakes });
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

test('the row preview drops the markup of agent markdown but keeps your own text as typed', async () => {
  const w = await wired();
  catalog(w.bridge);
  const text = '## Done\n\n**All 20** passed, see `npm test` and [the log](https://x.test).\n\n- one\n- [ ] _two_\n\n> \\*quoted\\*';
  w.bridge.send({ t: 'message', message: message('a1', 2000, text) });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  assert.equal(w.store.getSnapshot().conversations[0]?.preview, 'Done All 20 passed, see npm test and the log. one two *quoted*');
  w.bridge.send({ t: 'message', message: message('u1', 3000, '**mine**', 'user') });
  await until(() => w.store.conversation(CONV).messages.length === 2);
  assert.equal(w.store.getSnapshot().conversations[0]?.preview, '**mine**');
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
  w.bridge.send({ t: 'session', conv: CONV, event: 'compacted', detail: 'by the owner' });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  const entry = w.store.conversation(CONV).messages[0];
  assert.equal(entry?.role, 'system');
  assert.equal(entry?.text, 'Session compacted: by the owner');
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

const TOPIC_A = 'wizzle:agent:agent-1:ops';
const TOPIC_B = 'wizzle:agent:agent-1:release';

function withTopics(bridge: FakeBridge): void {
  catalog(bridge);
  bridge.send({
    t: 'conversations',
    conversations: [
      { id: CONV, agentId: 'agent-1', title: 'main', lastAt: 1000 },
      { id: TOPIC_A, agentId: 'agent-1', title: 'Ops review', lastAt: 3000, topic: true, createdAt: 900 },
      { id: TOPIC_B, agentId: 'agent-1', title: 'Release', lastAt: 4000, topic: true, createdAt: 950 },
      { id: 'wizzle:system', agentId: 'system', title: 'System' },
    ],
  });
}

function failureOf(promise: Promise<string>): Promise<SendFailure | null> {
  return promise.then(
    () => null,
    (failure: SendFailure) => failure,
  );
}

test('the catalog groups topics under their agent, default first and System last', async () => {
  const w = await wired();
  withTopics(w.bridge);
  await until(() => w.store.getSnapshot().agentGroups.length === 2);
  const [agent, system] = w.store.getSnapshot().agentGroups;
  assert.equal(agent?.agent.name, 'main');
  assert.deepEqual(
    agent?.conversations.map((row) => row.id),
    [CONV, TOPIC_B, TOPIC_A],
  );
  assert.equal(agent?.conversations[0]?.topic, false);
  assert.equal(agent?.conversations[1]?.topic, true);
  assert.equal(system?.agent.name, 'System');
  assert.deepEqual(
    system?.conversations.map((row) => row.id),
    ['wizzle:system'],
  );
  w.stop();
});

test('createTopic answers with the conversation the bridge announces', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 2);
  const created = w.store.createTopic('agent-1', 'Ops review');
  const asked = await w.bridge.nextOf('create_conversation');
  assert.equal(asked.header['agentId'], 'agent-1');
  assert.equal(asked.header['title'], 'Ops review');
  w.bridge.send({
    t: 'conversation',
    conversation: { id: TOPIC_A, agentId: 'agent-1', title: 'Ops review', topic: true, createdAt: 900 },
  });
  assert.equal(await created, TOPIC_A);
  const row = w.store.getSnapshot().conversations.find((item) => item.id === TOPIC_A);
  assert.equal(row?.topic, true);
  assert.equal(row?.agent?.name, 'main');
  w.stop();
});

test('a rename keeps the conversation id and the transcript it already holds', async () => {
  const w = await wired();
  withTopics(w.bridge);
  w.bridge.send({ t: 'message', message: { conv: TOPIC_A, msgId: 't1', role: 'agent', text: 'on it', format: 'text', at: 3100 } });
  await until(() => w.store.conversation(TOPIC_A).messages.length === 1);
  const renamed = w.store.renameTopic(TOPIC_A, 'Ops');
  const asked = await w.bridge.nextOf('rename_conversation');
  assert.equal(asked.header['conv'], TOPIC_A);
  assert.equal(asked.header['title'], 'Ops');
  w.bridge.send({
    t: 'conversation',
    conversation: { id: TOPIC_A, agentId: 'agent-1', title: 'Ops', lastAt: 3100, topic: true, createdAt: 900 },
  });
  assert.equal(await renamed, TOPIC_A);
  const row = w.store.getSnapshot().conversations.find((item) => item.id === TOPIC_A);
  assert.equal(row?.title, 'Ops');
  assert.equal(w.store.conversation(TOPIC_A).messages.length, 1);
  w.stop();
});

test('conversation_deleted drops the row, its transcript and its open question', async () => {
  const w = await wired();
  withTopics(w.bridge);
  w.bridge.send({ t: 'message', message: { conv: TOPIC_A, msgId: 't1', role: 'agent', text: 'on it', format: 'text', at: 3100 } });
  w.bridge.send({ t: 'question', question: { conv: TOPIC_A, questionId: 'q9', question: 'ship it?', options: [{ label: 'Yes', value: 'y' }] } });
  await until(() => w.store.conversation(TOPIC_A).questions.length === 1);
  const deleted = w.store.deleteTopic(TOPIC_A);
  const asked = await w.bridge.nextOf('delete_conversation');
  assert.equal(asked.header['conv'], TOPIC_A);
  w.bridge.send({ t: 'conversation_deleted', conv: TOPIC_A });
  assert.equal(await deleted, TOPIC_A);
  assert.equal(
    w.store.getSnapshot().conversations.some((row) => row.id === TOPIC_A),
    false,
  );
  assert.equal(w.store.conversation(TOPIC_A).messages.length, 0);
  assert.equal(w.store.conversation(TOPIC_A).questions.length, 0);
  w.stop();
});

test('a catalog that no longer lists a topic drops what the phone cached for it', async () => {
  const w = await wired();
  withTopics(w.bridge);
  w.bridge.send({ t: 'message', message: { conv: TOPIC_A, msgId: 't1', role: 'agent', text: 'on it', format: 'text', at: 3100 } });
  await until(() => w.store.conversation(TOPIC_A).messages.length === 1);
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 2);
  assert.equal(w.store.conversation(TOPIC_A).messages.length, 0);
  w.stop();
});

test('a message in one topic leaves the other topic and the default alone', async () => {
  const w = await wired();
  withTopics(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 4);
  w.bridge.send({ t: 'message', message: { conv: TOPIC_A, msgId: 't1', role: 'agent', text: 'ops only', format: 'text', at: 3100 } });
  await until(() => w.store.conversation(TOPIC_A).messages.length === 1);
  assert.equal(w.store.conversation(TOPIC_B).messages.length, 0);
  assert.equal(w.store.conversation(CONV).messages.length, 0);
  const rows = w.store.getSnapshot().conversations;
  assert.equal(rows.find((row) => row.id === TOPIC_A)?.preview, 'ops only');
  assert.equal(rows.find((row) => row.id === TOPIC_B)?.preview, '');
  w.stop();
});

test('an error answers the topic request that asked for it and stays off the notice list', async () => {
  const w = await wired();
  withTopics(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 4);

  const created = failureOf(w.store.createTopic('agent-1', 'Ops review'));
  const create = await w.bridge.nextOf('create_conversation');
  w.bridge.send({ t: 'error', ref: create.header.id, code: 'name_taken', message: 'That agent already has a topic with that title' });
  assert.equal((await created)?.code, 'name_taken');

  const renamed = failureOf(w.store.renameTopic(CONV, 'Anything'));
  const rename = await w.bridge.nextOf('rename_conversation');
  w.bridge.send({ t: 'error', ref: rename.header.id, code: 'read_only', message: 'The default conversation cannot be renamed' });
  assert.equal((await renamed)?.code, 'read_only');

  const removed = failureOf(w.store.deleteTopic(TOPIC_A));
  const remove = await w.bridge.nextOf('delete_conversation');
  w.bridge.send({ t: 'error', ref: remove.header.id, code: 'busy', message: 'The agent is still stopping' });
  assert.equal((await removed)?.code, 'busy');

  w.bridge.send({ t: 'message', message: { conv: CONV, msgId: 'c1', role: 'agent', text: 'kept', format: 'text', at: 3100 } });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  const refused = failureOf(w.store.clearChat(CONV));
  const clear = await w.bridge.nextOf('clear');
  w.bridge.send({ t: 'error', ref: clear.header.id, code: 'has_tasks', message: 'This chat holds 1 scheduled task; cancel it before clearing.' });
  assert.equal((await refused)?.code, 'has_tasks');
  assert.equal(w.store.conversation(CONV).messages.length, 1);

  assert.equal(w.store.getSnapshot().notices.length, 0);
  assert.equal(w.store.conversation(TOPIC_A).notices.length, 0);
  w.stop();
});

test('a title with no letter or digit never reaches the bridge', async () => {
  const w = await wired();
  withTopics(w.bridge);
  const failure = await failureOf(w.store.createTopic('agent-1', '???'));
  assert.equal(failure?.code, 'bad_request');
  assert.equal(
    w.bridge.received.some((packet) => packet.header.t === 'create_conversation'),
    false,
  );
  w.stop();
});

test('the templates the bridge lists reach the snapshot, once per connection', async () => {
  const w = await wired();
  catalog(w.bridge);
  const asked = await w.bridge.nextOf('templates');
  assert.ok(asked.header.id);
  w.bridge.send({
    t: 'templates',
    templates: [
      { ref: 'sales/sdr', name: 'SDR', agentName: 'Scout', description: 'Outbound', version: '1.2.0', tasks: 2, mcpServers: 1, skills: 3 },
      { ref: 'ops/oncall', name: 'On call', tasks: 0, mcpServers: 0, skills: 0 },
    ],
  });
  await until(() => w.store.getSnapshot().templates.length === 2);
  const [first, second] = w.store.getSnapshot().templates;
  assert.equal(first?.ref, 'sales/sdr');
  assert.equal(first?.agentName, 'Scout');
  assert.equal(first?.tasks, 2);
  assert.equal(second?.description, undefined);
  assert.equal(w.bridge.received.filter((packet) => packet.header.t === 'templates').length, 0);
  w.stop();
});

test('createAgent resolves with the conversation the host announces', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 2);
  const started = w.store.createAgent({ name: '  Scout  ', purpose: 'Watch the inbox', template: 'sales/sdr' });
  assert.equal(started?.state, 'sending');
  assert.equal(started?.name, 'Scout');
  const sent = await w.bridge.nextOf('create_agent');
  assert.equal(sent.header['name'], 'Scout');
  assert.equal(sent.header['purpose'], 'Watch the inbox');
  assert.equal(sent.header['template'], 'sales/sdr');
  assert.equal(sent.header['timezone'], Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(sent.header['copyFrom'], undefined);

  w.bridge.send({ t: 'agent', agent: { id: 'agent-2', name: 'Scout', status: 'idle' } });
  await until(() => w.store.getSnapshot().create?.state === 'created');
  assert.equal(w.store.getSnapshot().create?.agentId, 'agent-2');
  assert.equal(w.store.getSnapshot().create?.conv, undefined);

  w.bridge.send({
    t: 'conversations',
    conversations: [
      { id: CONV, agentId: 'agent-1', title: 'main', lastAt: 1000 },
      { id: 'wizzle:agent:agent-2', agentId: 'agent-2', title: 'Scout' },
      { id: 'wizzle:system', agentId: 'system', title: 'System' },
    ],
  });
  await until(() => w.store.getSnapshot().create?.conv === 'wizzle:agent:agent-2');
  w.stop();
});

test('an error with the create ref fails that create and leaves the notice list alone', async () => {
  const w = await wired();
  catalog(w.bridge);
  const started = w.store.createAgent({ name: 'Scout' });
  const sent = await w.bridge.nextOf('create_agent');
  assert.equal(started?.packetId, sent.header.id);
  w.bridge.send({ t: 'error', ref: sent.header.id, code: 'name_taken', message: 'An agent is already called Scout' });
  await until(() => w.store.getSnapshot().create?.state === 'failed');
  assert.equal(w.store.getSnapshot().create?.error?.code, 'name_taken');
  assert.equal(w.store.getSnapshot().create?.name, 'Scout');
  assert.equal(w.store.getSnapshot().notices.length, 0);
  w.stop();
});

test('a second create is refused while one is in flight and allowed once it settles', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.store.createAgent({ name: 'Scout' });
  const sent = await w.bridge.nextOf('create_agent');
  assert.equal(w.store.createAgent({ name: 'Other' }), null);
  assert.equal(w.store.getSnapshot().create?.name, 'Scout');
  w.bridge.send({ t: 'error', ref: sent.header.id, code: 'create_failed', message: 'The host gave up' });
  await until(() => w.store.getSnapshot().create?.state === 'failed');
  assert.equal(w.store.createAgent({ name: 'Other' })?.state, 'sending');
  const again = await w.bridge.nextOf('create_agent');
  assert.equal(again.header['name'], 'Other');
  w.stop();
});

test('a name with no letter or digit and a purpose over the cap never reach the bridge', async () => {
  const w = await wired();
  catalog(w.bridge);
  assert.equal(w.store.createAgent({ name: '???' })?.error?.code, 'bad_request');
  assert.equal(w.store.createAgent({ name: 'System' })?.error?.code, 'bad_request');
  assert.equal(w.store.createAgent({ name: 'Scout', purpose: 'x'.repeat(2001) })?.error?.code, 'too_long');
  assert.equal(
    w.bridge.received.some((packet) => packet.header.t === 'create_agent'),
    false,
  );
  w.stop();
});

test('a system message becomes a system row and history keeps one beside a local echo', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 2);
  w.bridge.send({
    t: 'message',
    message: { conv: CONV, msgId: 's1', role: 'system', text: 'Setting up. Scout is reading your purpose.', format: 'text', at: 2000 },
  });
  await until(() => w.store.conversation(CONV).messages.length === 1);
  assert.equal(w.store.conversation(CONV).messages[0]?.role, 'system');

  w.store.send(CONV, 'go');
  const sent = await w.bridge.nextOf('send');
  assert.equal(sent.header['text'], 'go');
  w.store.open(CONV);
  await w.bridge.nextOf('history');
  w.bridge.send({
    t: 'history',
    conv: CONV,
    messages: [
      { conv: CONV, msgId: 'h1', role: 'user', text: 'go', format: 'text', at: 2100 },
      { conv: CONV, msgId: 'h2', role: 'system', text: 'go', format: 'text', at: 2200 },
    ],
    hasMore: false,
  });
  await until(() => w.store.conversation(CONV).messages.length === 3);
  const ids = w.store.conversation(CONV).messages.map((entry) => entry.msgId);
  assert.equal(ids.includes('h2'), true);
  assert.equal(ids.includes('h1'), false);
  assert.equal(w.store.conversation(CONV).messages.filter((entry) => entry.role === 'system').length, 2);
  w.stop();
});

test('a create while the link cannot send fails at once and blocks nothing', () => {
  const store = new WizzleStore({ link: { send: () => null, onPacket: () => () => undefined }, newId: () => 'm1' });
  const first = store.createAgent({ name: 'Scout' });
  assert.equal(first?.state, 'failed');
  assert.equal(first?.error?.code, 'offline');
  assert.equal(store.getSnapshot().create?.packetId, null);
  assert.notEqual(store.createAgent({ name: 'Scout' }), null);
});

test('pause and resume answer with the agent the bridge sends back, and the status reaches the row', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().agents.length === 2);
  assert.equal(w.store.getSnapshot().capabilities?.lifecycle, true);
  assert.equal(w.store.getSnapshot().capabilities?.deleteAgent, true);

  const paused = w.store.pauseAgent('agent-1');
  const pause = await w.bridge.nextOf('pause_agent');
  assert.equal(pause.header['agentId'], 'agent-1');
  // A running update before the pause lands must not answer the pause.
  w.bridge.send({ t: 'agent', agent: { id: 'agent-1', name: 'main', status: 'running' } });
  w.bridge.send({ t: 'agent', agent: { id: 'agent-1', name: 'main', status: 'paused' } });
  assert.equal(await paused, 'agent-1');
  assert.equal(w.store.getSnapshot().conversations.find((row) => row.id === CONV)?.agent?.status, 'paused');

  const resumed = w.store.resumeAgent('agent-1');
  await w.bridge.nextOf('resume_agent');
  w.bridge.send({ t: 'agent', agent: { id: 'agent-1', name: 'main', status: 'idle' } });
  assert.equal(await resumed, 'agent-1');
  w.stop();
});

test('restart sends a trimmed message only when there is one, and an error answers it', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().agents.length === 2);

  const plain = w.store.restartAgent('agent-1', '   ');
  const first = await w.bridge.nextOf('restart_agent');
  assert.equal('message' in first.header, false);
  w.bridge.send({ t: 'agent', agent: { id: 'agent-1', name: 'main', status: 'idle' } });
  assert.equal(await plain, 'agent-1');

  const failed = failureOf(w.store.restartAgent('agent-1', ' check the tool '));
  const second = await w.bridge.nextOf('restart_agent');
  assert.equal(second.header['message'], 'check the tool');
  w.bridge.send({ t: 'error', ref: second.header.id, code: 'restart_failed', message: 'no runtime' });
  assert.equal((await failed)?.code, 'restart_failed');
  assert.equal(w.store.getSnapshot().notices.length, 0);
  w.stop();
});

test('a send refused as paused marks the echo failed with that code', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().conversations.length === 2);
  const msgId = w.store.send(CONV, 'hello');
  const sent = await w.bridge.nextOf('send');
  w.bridge.send({ t: 'error', ref: sent.header.id, code: 'paused', message: 'main is paused. Resume it to send messages.' });
  await until(() => w.store.conversation(CONV).messages[0]?.local?.failure !== undefined);
  const entry = w.store.conversation(CONV).messages.find((m) => m.msgId === msgId);
  assert.equal(entry?.local?.failure?.code, 'paused');
  w.stop();
});

test('agent_deleted drops the agent, its conversations and their questions, and answers the delete', async () => {
  const w = await wired();
  withTopics(w.bridge);
  w.bridge.send({ t: 'question', question: { conv: TOPIC_A, questionId: 'q9', question: 'ship it?', options: [{ label: 'Yes', value: 'y' }] } });
  await until(() => w.store.conversation(TOPIC_A).questions.length === 1);

  const deleted = w.store.deleteAgent('agent-1', false);
  const asked = await w.bridge.nextOf('delete_agent');
  assert.equal(asked.header['agentId'], 'agent-1');
  assert.equal(asked.header['removeWorkspace'], false);
  w.bridge.send({ t: 'agent_deleted', agentId: 'agent-1' });
  assert.equal(await deleted, 'agent-1');

  const snapshot = w.store.getSnapshot();
  assert.deepEqual(
    snapshot.agents.map((agent) => agent.id),
    ['system'],
  );
  assert.deepEqual(
    snapshot.conversations.map((row) => row.id),
    ['wizzle:system'],
  );
  assert.equal(w.store.conversation(TOPIC_A).questions.length, 0);
  w.stop();
});

test('an error answers a delete and leaves the agent listed', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().agents.length === 2);
  const removed = failureOf(w.store.deleteAgent('agent-1', true));
  const remove = await w.bridge.nextOf('delete_agent');
  w.bridge.send({ t: 'error', ref: remove.header.id, code: 'busy', message: 'main is still stopping' });
  assert.equal((await removed)?.code, 'busy');
  assert.equal(w.store.getSnapshot().agents.length, 2);
  w.stop();
});

function cachedEntry(msgId: string, at: number, text: string, extra: Partial<ChatEntry> = {}): ChatEntry {
  return { conv: CONV, msgId, role: 'agent', text, format: 'markdown', at, kind: 'text', ...extra };
}

function cachedCatalog(cache: FakeCache): void {
  cache.saveMeta(PAIRING, {
    hello: { t: 'hello', protocol: 1, runtime: 'nanoclaw', bridgeVersion: '0.1.0', host: 'pi', capabilities: CAPABILITIES },
    agents: [{ id: 'agent-1', name: 'main', status: 'idle' }],
    catalog: [{ id: CONV, agentId: 'agent-1', title: 'main', lastAt: 1000 }],
  });
}

test('hydrate brings the cached catalog and transcript up before the bridge says anything', async () => {
  const cache = new FakeCache();
  cachedCatalog(cache);
  cache.saveConversation(PAIRING, CONV, {
    messages: [cachedEntry('a1', 1000, 'hello'), cachedEntry('a2', 2000, 'again')],
    questions: [
      { question: { conv: CONV, questionId: 'q-old', question: 'late?', options: [], expiresAt: 10 } },
      { question: { conv: CONV, questionId: 'q-new', question: 'still?', options: [], expiresAt: Date.now() + 60_000 } },
    ],
    approvals: [{ approval: { conv: CONV, approvalId: 'ap-old', title: 'Old', decisions: ['allow', 'deny'], expiresAt: 10 } }],
  });
  const w = await wired({ cache });
  w.store.hydrate(PAIRING);
  const snapshot = w.store.getSnapshot();
  assert.equal(snapshot.capabilities?.files, true);
  assert.equal(snapshot.agents.length, 1);
  assert.equal(snapshot.conversations[0]?.preview, 'again');
  const state = w.store.conversation(CONV);
  assert.deepEqual(state.messages.map((m) => m.text), ['hello', 'again']);
  assert.deepEqual(state.questions.map((q) => q.question.questionId), ['q-new']);
  assert.equal(state.approvals.length, 0);
  assert.equal(state.requested, false);

  // The question still answers through question_resolved, so the store knows its home.
  w.bridge.send({ t: 'question_resolved', questionId: 'q-new', value: 'yes' });
  await until(() => w.store.conversation(CONV).questions.length === 0);
  w.stop();
});

test('hydrate drops an echo row an older bridge cached as the phone message', async () => {
  const cache = new FakeCache();
  cachedCatalog(cache);
  cache.saveConversation(PAIRING, CONV, {
    messages: [
      cachedEntry('msg-1', 1000, 'Good morning'),
      cachedEntry('msg-1:echo:sess-1', 1001, 'Good morning', { role: 'user', format: 'text' }),
    ],
    questions: [],
    approvals: [],
  });
  const w = await wired({ cache });
  w.store.hydrate(PAIRING);
  assert.deepEqual(w.store.conversation(CONV).messages.map((m) => [m.msgId, m.role]), [['msg-1', 'agent']]);
  w.stop();
});

test('hydrate marks an unconfirmed send failed and history with its msgId clears that', async () => {
  const cache = new FakeCache();
  cachedCatalog(cache);
  cache.saveConversation(PAIRING, CONV, {
    messages: [
      cachedEntry('m-sent', 1000, 'did this land', { role: 'user', format: 'text', local: { packetId: 'p9' } }),
      cachedEntry('m-failed', 1100, 'nope', { role: 'user', format: 'text', local: { packetId: null, failure: { code: 'paused', message: 'paused' } } }),
    ],
    questions: [],
    approvals: [],
  });
  const w = await wired({ cache });
  w.store.hydrate(PAIRING);
  const [sent, failed] = w.store.conversation(CONV).messages;
  assert.equal(sent?.local?.failure?.code, 'unconfirmed');
  assert.equal(failed?.local?.failure?.code, 'paused');

  w.store.open(CONV);
  await w.bridge.nextOf('history');
  w.bridge.send({ t: 'history', conv: CONV, messages: [message('m-sent', 1000, 'did this land', 'user')], hasMore: false });
  await until(() => w.store.conversation(CONV).messages[0]?.local === undefined);
  assert.equal(w.store.conversation(CONV).messages.length, 2);
  assert.equal(w.store.conversation(CONV).messages[1]?.local?.failure?.code, 'paused');
  w.stop();
});

test('history keeps the edited text and the attachments of an entry it confirms', async () => {
  const cache = new FakeCache();
  const files = new FakeFiles();
  cachedCatalog(cache);
  cache.saveConversation(PAIRING, CONV, {
    messages: [cachedEntry('a1', 1000, 'All 20 passed', { edited: true })],
    questions: [],
    approvals: [],
  });
  const w = await wired({ cache, files });
  w.store.hydrate(PAIRING);
  const photo = attachment(files, 'shot.png', 3, 'image/png');
  const msgId = w.store.send(CONV, 'see this', [photo]) as string;
  await w.bridge.nextOf('send');
  w.store.open(CONV);
  await w.bridge.nextOf('history');
  w.bridge.send({
    t: 'history',
    conv: CONV,
    messages: [message('a1', 1000, 'Running the tests'), message(msgId, 1500, 'see this', 'user')],
    hasMore: false,
  });
  await until(() => w.store.conversation(CONV).messages[1]?.local === undefined);
  const [edited, own] = w.store.conversation(CONV).messages;
  assert.equal(edited?.text, 'All 20 passed');
  assert.equal(own?.attachments?.[0]?.name, 'shot.png');
  assert.ok(own?.attachments?.[0]?.uri);
  assert.equal(w.store.conversation(CONV).messages.length, 2);
  w.stop();
});

test('a file packet saves its body through the file store and the entry gets the uri', async () => {
  const files = new FakeFiles();
  const w = await wired({ files });
  w.store.hydrate(PAIRING);
  catalog(w.bridge);
  const bytes = new Uint8Array([1, 2, 3, 4]);
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'f1', file: { name: 'log.txt', mime: 'text/plain', size: 4 }, at: 6000 }, bytes);
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'f2', file: { name: 'empty.txt', mime: 'text/plain', size: 0 }, at: 6001 });
  await until(() => w.store.conversation(CONV).messages[0]?.file?.uri !== undefined);
  const [full, empty] = w.store.conversation(CONV).messages;
  assert.equal(full?.file?.uri, `fake://${PAIRING}/${CONV}/f1-log.txt`);
  assert.deepEqual(files.saved.get(full?.file?.uri as string), bytes);
  assert.equal(empty?.file?.name, 'empty.txt');
  assert.equal(empty?.file?.uri, undefined);
  w.stop();
});

function elementFile(id: string, title: string): Uint8Array {
  const element = { wizzle: 1, id, kind: 'Flash cards', title, content: { type: 'reveal', front: { type: 'text', text: 'tener' }, back: { type: 'text', text: 'to have' } } };
  return utf8(JSON.stringify(element));
}

test('an element file is stored, linked from its chat row, replaced by a newer copy and kept in the cache', async () => {
  const cache = new FakeCache();
  const w = await wired({ cache });
  w.store.hydrate(PAIRING);
  catalog(w.bridge);
  const meta = (size: number) => ({ name: 'verbs.wizzle.json', mime: 'application/json', size });
  const first = elementFile('verbs', 'Spanish verbs');
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'e1', file: meta(first.length), at: 5000 }, first);
  await until(() => w.store.getSnapshot().elements.length === 1);
  const row = w.store.conversation(CONV).messages[0];
  assert.deepEqual(row?.element, { agentId: 'agent-1', id: 'verbs' });
  assert.equal(w.store.element('agent-1', 'verbs')?.element.title, 'Spanish verbs');

  const newer = elementFile('verbs', 'Spanish verbs, 2');
  const older = elementFile('verbs', 'Spanish verbs, old');
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'e2', file: meta(newer.length), at: 7000 }, newer);
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'e3', file: meta(older.length), at: 6000 }, older);
  await until(() => w.store.conversation(CONV).messages.length === 3);
  assert.equal(w.store.getSnapshot().elements.length, 1);
  assert.equal(w.store.element('agent-1', 'verbs')?.element.title, 'Spanish verbs, 2');
  assert.equal(cache.elements.get(PAIRING)?.[0]?.element.title, 'Spanish verbs, 2');

  w.store.hydrate(PAIRING);
  assert.equal(w.store.element('agent-1', 'verbs')?.receivedAt, 7000);
  w.store.reset();
  assert.equal(w.store.getSnapshot().elements.length, 0);
  w.stop();
});

test('a broken element file stays a file row with the reason', async () => {
  const w = await wired();
  catalog(w.bridge);
  const junk = utf8('{ not json');
  const empty = utf8(JSON.stringify({ wizzle: 1, id: 'x', title: 'X', content: { type: 'chart' } }));
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'b1', file: { name: 'junk.wizzle.json', mime: 'application/json', size: junk.length }, at: 5000 }, junk);
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'b2', file: { name: 'empty.wizzle.json', mime: 'application/json', size: empty.length }, at: 5001 }, empty);
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'b3', file: { name: 'notes.json', mime: 'application/json', size: junk.length }, at: 5002 }, junk);
  await until(() => w.store.conversation(CONV).messages.length === 3);
  const [bad, unknown, plain] = w.store.conversation(CONV).messages;
  assert.equal(bad?.elementError, 'This element file is not valid JSON.');
  assert.match(unknown?.elementError ?? '', /unknown node type 'chart'/);
  assert.equal(plain?.elementError, undefined);
  assert.equal(w.store.getSnapshot().elements.length, 0);
  w.stop();
});

test('forgetting a conversation or a pairing drops its cache rows and files', async () => {
  const cache = new FakeCache();
  const files = new FakeFiles();
  const w = await wired({ cache, files });
  w.store.hydrate(PAIRING);
  withTopics(w.bridge);
  w.bridge.send({ t: 'file', conv: TOPIC_A, msgId: 'f1', file: { name: 'a.txt', mime: 'text/plain', size: 1 }, at: 6000 }, new Uint8Array([1]));
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'f2', file: { name: 'b.txt', mime: 'text/plain', size: 1 }, at: 6000 }, new Uint8Array([2]));
  await until(() => w.store.conversation(TOPIC_A).messages[0]?.file?.uri !== undefined && w.store.conversation(CONV).messages[0]?.file?.uri !== undefined);
  assert.ok(cache.rows.get(PAIRING)?.has(TOPIC_A));
  assert.equal(files.saved.size, 2);

  w.bridge.send({ t: 'conversation_deleted', conv: TOPIC_A });
  await until(() => !w.store.getSnapshot().conversations.some((row) => row.id === TOPIC_A));
  assert.equal(cache.rows.get(PAIRING)?.has(TOPIC_A), false);
  assert.ok(cache.rows.get(PAIRING)?.has(CONV));
  assert.equal(files.saved.size, 1);

  w.store.forgetPairing(PAIRING);
  assert.equal(cache.rows.has(PAIRING), false);
  assert.equal(cache.meta.has(PAIRING), false);
  assert.equal(files.saved.size, 0);
  w.stop();
});

test('a cleared chat keeps its row and loses its transcript, questions, cache rows and files', async () => {
  const cache = new FakeCache();
  const files = new FakeFiles();
  const w = await wired({ cache, files });
  w.store.hydrate(PAIRING);
  withTopics(w.bridge);
  w.bridge.send({ t: 'file', conv: CONV, msgId: 'f1', file: { name: 'a.txt', mime: 'text/plain', size: 1 }, at: 6000 }, new Uint8Array([1]));
  w.bridge.send({ t: 'file', conv: TOPIC_A, msgId: 'f2', file: { name: 'b.txt', mime: 'text/plain', size: 1 }, at: 6000 }, new Uint8Array([2]));
  w.bridge.send({ t: 'question', question: { conv: CONV, questionId: 'q9', question: 'ship it?', options: [{ label: 'Yes', value: 'y' }] } });
  await until(
    () =>
      w.store.conversation(CONV).questions.length === 1 &&
      w.store.conversation(CONV).messages[0]?.file?.uri !== undefined &&
      w.store.conversation(TOPIC_A).messages[0]?.file?.uri !== undefined,
  );

  const cleared = w.store.clearChat(CONV);
  const asked = await w.bridge.nextOf('clear');
  assert.equal(asked.header['conv'], CONV);
  w.bridge.send({ t: 'session', conv: CONV, event: 'cleared' });
  assert.equal(await cleared, CONV);

  assert.equal(w.store.conversation(CONV).messages.length, 0);
  assert.equal(w.store.conversation(CONV).questions.length, 0);
  assert.ok(w.store.getSnapshot().conversations.some((row) => row.id === CONV));
  assert.equal(cache.rows.get(PAIRING)?.get(CONV)?.messages.length, 0);
  assert.equal(files.saved.size, 1);
  assert.equal(w.store.conversation(TOPIC_A).messages.length, 1);
  w.stop();
});

test('attachments go out as uploads ahead of their send, and a quick second send waits its turn', async () => {
  const files = new FakeFiles();
  const w = await wired({ files });
  w.store.hydrate(PAIRING);
  catalog(w.bridge);
  const a = attachment(files, 'a.txt', 3);
  const b = attachment(files, 'b.png', 5, 'image/png');
  const first = w.store.send(CONV, '', [a, b]) as string;
  const second = w.store.send(CONV, 'and then') as string;
  const echo = w.store.conversation(CONV).messages[0];
  assert.equal(echo?.attachments?.length, 2);
  assert.equal(echo?.local?.packetId, null);
  assert.equal(echo?.local?.failure, undefined);

  const up1 = await w.bridge.nextOf('upload');
  const up2 = await w.bridge.nextOf('upload');
  const send1 = await w.bridge.nextOf('send');
  const send2 = await w.bridge.nextOf('send');
  assert.deepEqual(up1.header['file'], { name: 'a.txt', mime: 'text/plain', size: 3 });
  assert.deepEqual(Array.from(up1.body), [7, 7, 7]);
  assert.deepEqual(up2.header['file'], { name: 'b.png', mime: 'image/png', size: 5 });
  assert.equal(send1.header['msgId'], first);
  assert.equal(send1.header['text'], '');
  assert.deepEqual(send1.header['attachments'], [up1.header['uploadId'], up2.header['uploadId']]);
  assert.equal(send2.header['msgId'], second);
  assert.equal(send2.header['attachments'], undefined);
  await until(() => w.store.conversation(CONV).messages[0]?.local?.packetId === send1.header.id);
  assert.equal(w.store.conversation(CONV).messages[1]?.local?.packetId, send2.header.id);
  w.stop();
});

test('too many files, a file over the cap, or a message over the total are refused before anything is sent', async () => {
  const files = new FakeFiles();
  const w = await wired({ files });
  w.store.hydrate(PAIRING);
  const small = (name: string): Attachment => ({ name, mime: 'text/plain', size: 10, uri: `fake://picked/${name}` });
  const five = ['1', '2', '3', '4', '5'].map(small);
  assert.equal(w.store.send(CONV, 'x', five), null);
  assert.equal(attachmentFailure(five.slice(0, 4), small('6'))?.code, 'too_many');
  const huge: Attachment = { name: 'huge.bin', mime: 'application/octet-stream', size: 16 * 1024 * 1024 + 1, uri: 'fake://picked/huge' };
  assert.equal(w.store.send(CONV, '', [huge]), null);
  assert.equal(attachmentFailure([], huge)?.code, 'too_large');
  const big = (name: string): Attachment => ({ name, mime: 'application/octet-stream', size: 12 * 1024 * 1024, uri: `fake://picked/${name}` });
  assert.equal(w.store.send(CONV, '', [big('a'), big('b'), big('c')]), null);
  assert.equal(attachmentFailure([big('a'), big('b')], big('c'))?.code, 'too_large');
  assert.equal(w.store.send(CONV, '   '), null);
  assert.equal(w.store.conversation(CONV).messages.length, 0);
  assert.equal(w.bridge.received.length, 0);
  w.stop();
});

test('a refused upload fails the echo and retry sends the files again under a fresh msgId', async () => {
  const files = new FakeFiles();
  const w = await wired({ files });
  w.store.hydrate(PAIRING);
  catalog(w.bridge);
  const a = attachment(files, 'a.txt', 3);
  const msgId = w.store.send(CONV, 'take this', [a]) as string;
  const upload = await w.bridge.nextOf('upload');
  await w.bridge.nextOf('send');
  w.bridge.send({ t: 'error', ref: upload.header.id, code: 'too_large', message: 'The bridge refused the file' });
  await until(() => w.store.conversation(CONV).messages[0]?.local?.failure !== undefined);
  assert.equal(w.store.conversation(CONV).messages[0]?.local?.failure?.code, 'too_large');

  const retried = w.store.retry(CONV, msgId) as string;
  assert.notEqual(retried, msgId);
  const again = await w.bridge.nextOf('upload');
  assert.deepEqual(Array.from(again.body), [7, 7, 7]);
  const sent = await w.bridge.nextOf('send');
  assert.equal(sent.header['msgId'], retried);
  assert.deepEqual(sent.header['attachments'], [again.header['uploadId']]);
  const messages = w.store.conversation(CONV).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.attachments?.[0]?.uri, a.uri);
  assert.ok(files.saved.has(a.uri));

  // Discarding is what lets the file go.
  w.store.discard(CONV, retried);
  assert.equal(files.saved.has(a.uri), false);
  w.stop();
});

test('attach copies a picked file into the files folder and unattach removes it', async () => {
  const files = new FakeFiles();
  const w = await wired({ files });
  w.store.hydrate(PAIRING);
  files.saved.set('file:///tmp/pick.jpg', new Uint8Array(9));
  const kept = await w.store.attach(CONV, { name: 'pick.jpg', mime: 'image/jpeg', size: 0, uri: 'file:///tmp/pick.jpg' });
  assert.equal(kept?.size, 9);
  assert.ok(kept?.uri.startsWith(`fake://${PAIRING}/${CONV}/`));
  w.store.unattach(kept as Attachment);
  assert.equal(files.saved.has(kept?.uri as string), false);
  assert.equal(await w.store.attach(CONV, { name: 'gone.jpg', mime: 'image/jpeg', size: 0, uri: 'file:///tmp/gone.jpg' }), null);
  w.stop();
});

test('the cache is written as the transcript changes and the first history page keeps paging open', async () => {
  const cache = new FakeCache();
  const w = await wired({ cache });
  w.store.hydrate(PAIRING);
  catalog(w.bridge);
  await until(() => cache.meta.get(PAIRING)?.catalog.length === 2);
  w.bridge.send({ t: 'message', message: message('a1', 1000, 'hello') });
  await until(() => cache.rows.get(PAIRING)?.get(CONV)?.messages.length === 1);

  // A cached transcript already holds the first page, which must not read as the end of history.
  w.store.open(CONV);
  await w.bridge.nextOf('history');
  w.bridge.send({ t: 'history', conv: CONV, messages: [message('a1', 1000, 'hello')], hasMore: true });
  await until(() => w.store.conversation(CONV).loading === false);
  assert.equal(w.store.conversation(CONV).hasMore, true);
  w.stop();
});

test('agent messages count as unread until the chat is read, and the user\'s own never do', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'message', message: message('a1', 1000, 'one') });
  w.bridge.send({ t: 'message', message: message('u1', 1500, 'mine', 'user') });
  w.bridge.send({ t: 'message', message: message('a2', 2000, 'two') });
  await until(() => w.store.getSnapshot().conversations.find((c) => c.id === CONV)?.unread === 2);

  w.store.markRead(CONV);
  assert.equal(w.store.getSnapshot().conversations.find((c) => c.id === CONV)?.unread, 0);
  w.bridge.send({ t: 'message', message: message('a3', 3000, 'three') });
  await until(() => w.store.getSnapshot().conversations.find((c) => c.id === CONV)?.unread === 1);
  assert.equal(w.store.getSnapshot().agentGroups[0]?.conversations[0]?.unread, 1);
  w.stop();
});

test('read marks survive a restart and history from before the first run counts as read', async () => {
  const cache = new FakeCache();
  cachedCatalog(cache);
  cache.saveConversation(PAIRING, CONV, { messages: [cachedEntry('a1', 1000, 'old')], questions: [], approvals: [] });
  const w = await wired({ cache });
  w.store.hydrate(PAIRING);
  assert.equal(w.store.getSnapshot().conversations[0]?.unread, 0);
  const floor = cache.read.get(PAIRING)?.floor ?? 0;
  assert.ok(floor > 1000);

  w.bridge.send({ t: 'message', message: message('a2', floor + 1000, 'new') });
  w.bridge.send({ t: 'message', message: message('a3', floor + 2000, 'newer') });
  await until(() => w.store.getSnapshot().conversations[0]?.unread === 2);
  w.store.hydrate(PAIRING);
  assert.equal(w.store.getSnapshot().conversations[0]?.unread, 2);

  w.store.markRead(CONV);
  w.store.hydrate(PAIRING);
  assert.equal(cache.read.get(PAIRING)?.marks[CONV], floor + 2000);
  assert.equal(w.store.getSnapshot().conversations[0]?.unread, 0);
  w.stop();
});

test('a catalog naming an agent message the phone lacks fetches the latest page, and one it holds does not', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'message', message: message('a1', 1000, 'held') });
  await until(() => w.store.conversation(CONV).messages.length === 1);

  w.bridge.send({ t: 'conversations', conversations: [{ id: CONV, agentId: 'agent-1', title: 'main', lastAgentAt: 900 }] });
  await until(() => w.store.getSnapshot().conversations[0]?.lastAgentAt === 900);
  assert.equal(w.store.conversation(CONV).loading, false);

  w.bridge.send({ t: 'conversations', conversations: [{ id: CONV, agentId: 'agent-1', title: 'main', lastAgentAt: 2000 }] });
  const asked = await w.bridge.nextOf('history');
  assert.equal(asked.header['conv'], CONV);
  assert.equal(asked.header['before'], undefined);
  w.bridge.send({ t: 'history', conv: CONV, messages: [message('a1', 1000, 'held'), message('a2', 2000, 'lost')], hasMore: false });
  await until(() => w.store.conversation(CONV).messages.length === 2);
  assert.equal(w.store.getSnapshot().conversations[0]?.unread, 2);
  w.stop();
});

test('library templates keep their category and download state, and counts only when the host has them', async () => {
  const w = await wired();
  catalog(w.bridge);
  await w.bridge.nextOf('templates');
  w.bridge.send({
    t: 'templates',
    templates: [
      { ref: 'data/analyst', name: 'analyst', description: 'Answers data questions', category: 'data', downloaded: false },
      { ref: 'sales/sdr', name: 'sdr', tasks: 1, mcpServers: 0, skills: 2, category: 'sales', downloaded: true },
    ],
  });
  await until(() => w.store.getSnapshot().templates.length === 2);
  assert.deepEqual(w.store.getSnapshot().templates, [
    { ref: 'data/analyst', name: 'analyst', description: 'Answers data questions', category: 'data', downloaded: false },
    { ref: 'sales/sdr', name: 'sdr', tasks: 1, mcpServers: 0, skills: 2, category: 'sales', downloaded: true },
  ]);
  w.store.loadTemplates(true);
  await w.bridge.nextOf('templates');
  w.stop();
});

test('the vault and an agent\'s keys reach the snapshot, and a listing error stays off the notice list', async () => {
  const w = await wired();
  catalog(w.bridge);
  await until(() => w.store.getSnapshot().capabilities?.keys === true);
  assert.equal(w.store.getSnapshot().secrets, null);
  w.store.loadSecrets();
  await w.bridge.nextOf('secrets');
  w.bridge.send({
    t: 'secrets',
    secrets: [
      { id: 's1', name: 'GitHub', type: 'generic', host: 'api.github.com', injection: { headerName: 'Authorization', valueFormat: 'Bearer {value}' } },
      { id: 's2', name: 'Bot', type: 'generic', host: 'api.telegram.org', injection: { pathTemplate: '/bot{value}' } },
      { id: 's3', name: 'Broken', type: 'mystery' } as never,
    ],
  });
  await until(() => w.store.getSnapshot().secrets?.length === 2);
  assert.deepEqual(w.store.getSnapshot().secrets?.[1], { id: 's2', name: 'Bot', type: 'generic', host: 'api.telegram.org', injection: { pathTemplate: '/bot{value}' } });

  w.store.loadAgentSecrets('agent-1');
  const asked = await w.bridge.nextOf('agent_secrets');
  assert.equal(asked.header['agentId'], 'agent-1');
  w.bridge.send({ t: 'agent_secrets', agentId: 'agent-1', secretIds: ['s1'] });
  await until(() => w.store.getSnapshot().agentSecrets['agent-1']?.length === 1);

  w.store.loadSecrets();
  const again = await w.bridge.nextOf('secrets');
  w.bridge.send({ t: 'error', ref: again.header.id, code: 'keys_unavailable', message: 'OneCLI could not be reached' });
  await until(() => w.store.getSnapshot().keysError !== null);
  assert.equal(w.store.getSnapshot().keysError?.code, 'keys_unavailable');
  assert.equal(w.store.getSnapshot().secrets?.length, 2);
  assert.equal(w.store.getSnapshot().notices.length, 0);
  w.stop();
});

test('createSecret resolves with the saved id and marks it newest, and updateSecret replaces the row', async () => {
  const w = await wired();
  catalog(w.bridge);
  const input = { name: 'GitHub', type: 'generic' as const, host: 'api.github.com', injection: { headerName: 'Authorization' }, value: 'ghp_x' };
  const created = w.store.createSecret(input);
  const sent = await w.bridge.nextOf('create_secret');
  assert.deepEqual(sent.header['secret'], input);
  w.bridge.send({ t: 'secret', ref: 'someone-else', secret: { id: 's0', name: 'Other', type: 'generic', host: 'a.example.com' } });
  w.bridge.send({ t: 'secret', ref: sent.header.id, secret: { id: 's1', name: 'GitHub', type: 'generic', host: 'api.github.com', injection: { headerName: 'Authorization' } } });
  assert.equal(await created, 's1');
  assert.deepEqual(w.store.getSnapshot().newestSecret, { id: 's1', seq: 1 });
  assert.deepEqual(w.store.getSnapshot().secrets?.map((secret) => secret.id), ['s0', 's1']);

  const updated = w.store.updateSecret('s1', { name: 'GitHub main', path: null });
  const change = await w.bridge.nextOf('update_secret');
  assert.deepEqual(change.header['changes'], { name: 'GitHub main', path: null });
  w.bridge.send({ t: 'secret', ref: change.header.id, secret: { id: 's1', name: 'GitHub main', type: 'generic', host: 'api.github.com' } });
  assert.equal(await updated, 's1');
  assert.equal(w.store.getSnapshot().secrets?.find((secret) => secret.id === 's1')?.name, 'GitHub main');
  assert.equal(w.store.getSnapshot().newestSecret?.seq, 1);

  const refused = w.store.createSecret({ ...input, host: 'https://x' });
  const bad = await w.bridge.nextOf('create_secret');
  w.bridge.send({ t: 'error', ref: bad.header.id, code: 'bad_request', message: 'Enter a hostname, not a URL' });
  await assert.rejects(refused, (failure: SendFailure) => failure.message === 'Enter a hostname, not a URL');
  assert.equal(w.store.getSnapshot().notices.length, 0);
  w.stop();
});

test('deleteSecret drops the key from the vault and from every agent\'s list', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.bridge.send({ t: 'secrets', secrets: [{ id: 's1', name: 'GitHub', type: 'generic', host: 'api.github.com' }, { id: 's2', name: 'Bot', type: 'generic', host: 'api.telegram.org' }] });
  w.bridge.send({ t: 'agent_secrets', agentId: 'agent-1', secretIds: ['s1', 's2'] });
  await until(() => w.store.getSnapshot().agentSecrets['agent-1']?.length === 2);
  const deleted = w.store.deleteSecret('s1');
  assert.equal((await w.bridge.nextOf('delete_secret')).header['secretId'], 's1');
  w.bridge.send({ t: 'secret_deleted', secretId: 's1' });
  assert.equal(await deleted, 's1');
  assert.deepEqual(w.store.getSnapshot().secrets?.map((secret) => secret.id), ['s2']);
  assert.deepEqual(w.store.getSnapshot().agentSecrets['agent-1'], ['s2']);
  w.stop();
});

test('attach and detach resolve once the agent\'s keys show the change, and an error answers them', async () => {
  const w = await wired();
  catalog(w.bridge);
  const attached = w.store.attachSecret('agent-1', 's1');
  const ask = await w.bridge.nextOf('attach_secret');
  assert.deepEqual([ask.header['agentId'], ask.header['secretId']], ['agent-1', 's1']);
  let settled = false;
  void attached.then(() => void (settled = true));
  w.bridge.send({ t: 'agent_secrets', agentId: 'agent-1', secretIds: [] });
  w.bridge.send({ t: 'agent_secrets', agentId: 'agent-2', secretIds: ['s1'] });
  await until(() => w.store.getSnapshot().agentSecrets['agent-2'] !== undefined);
  assert.equal(settled, false);
  w.bridge.send({ t: 'agent_secrets', agentId: 'agent-1', secretIds: ['s1'] });
  assert.equal(await attached, 'agent-1');

  const detached = w.store.detachSecret('agent-1', 's1');
  await w.bridge.nextOf('detach_secret');
  w.bridge.send({ t: 'agent_secrets', agentId: 'agent-1', secretIds: [] });
  assert.equal(await detached, 'agent-1');

  const failing = w.store.attachSecret('agent-1', 's9');
  const refused = await w.bridge.nextOf('attach_secret');
  w.bridge.send({ t: 'error', ref: refused.header.id, code: 'not_found', message: 'Secret not found' });
  await assert.rejects(failing, (failure: SendFailure) => failure.code === 'not_found');
  w.stop();
});

test('createAgent carries the picked keys, and none when nothing is picked', async () => {
  const w = await wired();
  catalog(w.bridge);
  w.store.createAgent({ name: 'Scout', template: 'data/analyst', secrets: ['s1', 's2'] });
  const sent = await w.bridge.nextOf('create_agent');
  assert.deepEqual(sent.header['secrets'], ['s1', 's2']);
  w.bridge.send({ t: 'error', ref: sent.header.id, code: 'unknown_secret', message: 'A key you picked is no longer in the vault' });
  await until(() => w.store.getSnapshot().create?.state === 'failed');
  w.store.createAgent({ name: 'Scout', secrets: [] });
  assert.equal((await w.bridge.nextOf('create_agent')).header['secrets'], undefined);
  w.stop();
});

test('copy as plain text drops the markdown and keeps blocks, list items, code and link addresses', () => {
  const markdown = [
    '# Weekly report',
    '',
    'Two **wins** and one `flag`, see [the board](https://example.com/b).',
    '',
    '- shipped keys',
    '- fixed clear chat',
    '',
    '3. first',
    '4. second',
    '',
    '> quoted line',
    '',
    '```',
    'npm test',
    '```',
    '',
    '---',
    '',
    '| Agent | Status |',
    '| --- | --- |',
    '| Nano | idle |',
    '',
    'Raw https://example.com/x stays.',
  ].join('\n');
  assert.equal(
    plainMessage(markdown),
    [
      'Weekly report',
      'Two wins and one flag, see the board (https://example.com/b).',
      '\u2022 shipped keys\n\u2022 fixed clear chat',
      '3. first\n4. second',
      'quoted line',
      'npm test',
      'Agent\tStatus\nNano\tidle',
      'Raw https://example.com/x stays.',
    ].join('\n\n'),
  );
});
