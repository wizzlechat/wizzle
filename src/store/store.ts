import type { FileStore } from '../files/types.ts';
import {
  fromUtf8,
  isElementFile,
  validateElement,
  type Agent,
  type AgentStatus,
  type ApprovalDecision,
  type Capabilities,
  type ChatMessage,
  type Conversation,
  type DecodedPacket,
  type FileMeta,
  type WizzleMessage,
  type Secret,
  type SecretChanges,
  type SecretInput,
  type SessionEvent,
  type TemplateInfo,
} from '../protocol/index.ts';
import type { PacketListener } from '../relay/connection.ts';
import type { CachedConversation, StoreCache } from './cache.ts';
import {
  isRecord,
  num,
  str,
  toActivity,
  toAgent,
  toApproval,
  toChatMessage,
  toConversation,
  toFileMeta,
  toFormat,
  toHello,
  toProfile,
  toQuestion,
  toSecret,
  toTemplateInfo,
} from './parse.ts';
import type {
  AgentGroup,
  AgentProfile,
  AgentView,
  Attachment,
  BridgeHello,
  ChatEntry,
  ConversationRow,
  ConversationState,
  CreateState,
  Notice,
  OpenApproval,
  OpenQuestion,
  SendFailure,
  StoreSnapshot,
  StoredElement,
} from './types.ts';
import { attachmentsFailure, deviceTimezone, nameFailure, purposeFailure, titleFailure } from './validate.ts';

export const SYSTEM_CONV = 'wizzle:system';

function elementKey(agentId: string, id: string): string {
  return `${agentId}\0${id}`;
}

const HISTORY_PAGE = 50;
const MAX_PENDING = 128;

// What the store needs from the relay connection. The tests supply their own.
export type StoreLink = {
  send(message: WizzleMessage, body?: Uint8Array): string | null;
  onPacket(listener: PacketListener): () => void;
};

// `pairing` names the pairing whose cache the store loads on first use; without it the store starts empty.
export type StoreOptions = {
  link: StoreLink;
  newId: () => string;
  now?: () => number;
  cache?: StoreCache;
  files?: FileStore;
  pairing?: () => string | null;
};

// What the create screen collects. Only one of template and copyFrom is ever set.
export type CreateRequest = { name: string; purpose?: string; template?: string; copyFrom?: string; secrets?: string[] };

type PendingSend = { t: string; conv?: string; msgId?: string };

type Settle = { resolve: (conv: string) => void; reject: (failure: SendFailure) => void };

// A topic, agent or key request answers the screen that asked, so its error never becomes a notice.
type PendingRequest = Settle &
  (
    | { kind: 'create'; agentId: string; title: string }
    | { kind: 'rename'; conv: string }
    | { kind: 'delete'; conv: string }
    | { kind: 'clear'; conv: string }
    | { kind: 'pause' | 'resume' | 'restart' | 'deleteAgent'; agentId: string }
    | { kind: 'createSecret' | 'updateSecret' }
    | { kind: 'deleteSecret'; secretId: string }
    | { kind: 'attach' | 'detach'; agentId: string; secretId: string }
  );

// What a row was built from; the row is reused while all four are the same objects and number.
type RowSource = { conv: Conversation; state: ConversationState | undefined; agent: AgentView | null; mark: number };

type ListCache = { agents: AgentView[]; rows: ConversationRow[]; conversations: ConversationRow[]; agentGroups: AgentGroup[] };

const OFFLINE: SendFailure = { code: 'offline', message: 'Not connected to the bridge yet.' };
const UNCONFIRMED: SendFailure = { code: 'unconfirmed', message: 'The app closed before the bridge confirmed this message.' };

function sessionText(event: SessionEvent, detail: string | null): string {
  const base =
    event === 'cleared' ? 'Session cleared' : event === 'compacted' ? 'Session compacted' : event === 'reset' ? 'Session reset' : 'Session error';
  return detail ? `${base}: ${detail}` : base;
}

function answerText(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ');
  return typeof value === 'string' ? value : '';
}

// Keeps the transcript ordered by time without reshuffling equal timestamps.
function insert(list: ChatEntry[], entry: ChatEntry): ChatEntry[] {
  const next = list.slice();
  let i = next.length;
  while (i > 0) {
    const previous = next[i - 1];
    if (!previous || previous.at <= entry.at) break;
    i -= 1;
  }
  next.splice(i, 0, entry);
  return next;
}

// Agent rows carry the bridge's clock, so read marks compare against them and never wizzle's.
function newestAgentAt(messages: ChatEntry[]): number | undefined {
  let at: number | undefined;
  for (const entry of messages) if (entry.role === 'agent' && (at === undefined || entry.at > at)) at = entry.at;
  return at;
}

function unreadOf(messages: ChatEntry[], mark: number): number {
  let count = 0;
  for (const entry of messages) if (entry.role === 'agent' && entry.at > mark) count += 1;
  return count;
}

function emptyConversation(): ConversationState {
  return { messages: [], activity: null, questions: [], approvals: [], notices: [], hasMore: false, loading: false, requested: false };
}

// What a screen reads for a conversation the store holds nothing on; one object, so it never looks changed.
const EMPTY = emptyConversation();

function expired(expiresAt: number | undefined, now: number): boolean {
  return expiresAt !== undefined && expiresAt <= now;
}

// An older bridge sent a runtime's echo copy of an agent message as wizzle's own; those cached rows go on load.
const ECHO_MARK = ':echo:';

// A send the app was closed on may or may not have reached the bridge, so it shows as failed until history says.
function unconfirmed(entry: ChatEntry): ChatEntry {
  if (!entry.local || entry.local.failure) return entry;
  return { ...entry, local: { packetId: null, failure: UNCONFIRMED } };
}

// What a history row adds to an entry wizzle already holds: the send is confirmed, the rest stays.
function confirm(existing: ChatEntry, message: ChatMessage): ChatEntry {
  const { local: _local, ...kept } = existing;
  return { ...kept, text: existing.edited ? existing.text : message.text };
}

// Receiving side of sync: every bridge packet lands here and the screens read it back.
export class WizzleStore {
  private readonly link: StoreLink;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly pairingOf: (() => string | null) | null;
  private loaded = false;
  private readonly convs = new Map<string, ConversationState>();
  private readonly sent = new Map<string, PendingSend>();
  // Which conversation each open question or approval belongs to, by its id.
  private readonly promptHome = new Map<string, string>();
  private readonly requests = new Map<string, PendingRequest>();
  private readonly listeners = new Set<() => void>();
  private agents: Agent[] = [];
  private catalog: Conversation[] = [];
  private templates: TemplateInfo[] = [];
  private templatesRequested = false;
  private secrets: Secret[] | null = null;
  private agentSecrets: Record<string, string[]> = {};
  private keysError: SendFailure | null = null;
  private newestSecret: { id: string; seq: number } | null = null;
  private create: CreateState | null = null;
  private hello: BridgeHello | null = null;
  private notices: Notice[] = [];
  private snapshot: StoreSnapshot | null = null;
  private readonly detach: () => void;
  private readonly cache: StoreCache | null;
  private readonly files: FileStore | null;
  private readonly historyBefore = new Map<string, string | undefined>();
  private readonly elements = new Map<string, StoredElement>();
  private elementList: StoredElement[] = [];
  private readonly readMarks = new Map<string, number>();
  private readFloor = 0;
  private readonly profiles = new Map<string, AgentProfile>();
  private profileView: Record<string, AgentProfile> = {};
  // Derived views kept between snapshots, so a packet for one conversation rebuilds one row.
  private readonly viewCache = new Map<string, { agent: Agent; nickname: string | undefined; view: AgentView }>();
  private readonly rowCache = new Map<string, { source: RowSource; row: ConversationRow }>();
  private list: ListCache | null = null;
  // Sends wait their turn here, so a message never overtakes one still reading its files.
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;
  private pairingId: string | null = null;
  dropped = 0;

  constructor(opts: StoreOptions) {
    this.link = opts.link;
    this.newId = opts.newId;
    this.now = opts.now ?? Date.now;
    this.cache = opts.cache ?? null;
    this.files = opts.files ?? null;
    this.pairingOf = opts.pairing ?? null;
    this.detach = opts.link.onPacket((packet) => this.receive(packet));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  readonly getSnapshot = (): StoreSnapshot => {
    this.load();
    if (!this.snapshot) this.snapshot = this.compute();
    return this.snapshot;
  };

  // Stable until that element is replaced, so a chat row re-renders only when its element changes.
  readonly element = (agentId: string, id: string): StoredElement | undefined => {
    this.load();
    return this.elements.get(elementKey(agentId, id));
  };

  // Stable per conversation object so untouched screens do not re-render. Reading never creates state.
  readonly peek = (conv: string): ConversationState => {
    this.load();
    return this.convs.get(conv) ?? EMPTY;
  };

  get capabilities(): Capabilities | null {
    this.load();
    return this.hello?.capabilities ?? null;
  }

  // Echoes the message locally at once: the bridge only answers on failure.
  send(conv: string, text: string, attachments: Attachment[] = []): string | null {
    const body = text.trim();
    if (body.length === 0 && attachments.length === 0) return null;
    if (attachmentsFailure(attachments)) return null;
    const msgId = this.newId();
    this.upsert(conv, {
      conv,
      msgId,
      role: 'user',
      text: body,
      format: 'text',
      at: this.now(),
      kind: 'text',
      ...(attachments.length > 0 && { attachments }),
      local: { packetId: null },
    });
    // Plain text with nothing ahead of it goes out on this tick; dispatch only awaits when it reads files.
    if (attachments.length === 0 && this.queued === 0) {
      void this.dispatch(conv, msgId, body, []);
      return msgId;
    }
    this.queued += 1;
    // A send that throws is marked failed here, so the chain stays usable for the ones behind it.
    this.chain = this.chain
      .then(() => this.dispatch(conv, msgId, body, attachments))
      .catch(() => this.fail(conv, msgId, { code: 'send_failed', message: 'The message could not be sent.' }))
      .finally(() => void (this.queued -= 1));
    return msgId;
  }

  // Retry drops the failed echo and sends a fresh msgId, which the bridge treats as a new message.
  retry(conv: string, msgId: string): string | null {
    const entry = this.conversation(conv).messages.find((m) => m.msgId === msgId);
    if (!entry?.local) return null;
    this.discard(conv, msgId, true);
    return this.send(conv, entry.text, entry.attachments ?? []);
  }

  discard(conv: string, msgId: string, keepFiles = false): void {
    const state = this.conversation(conv);
    const entry = state.messages.find((m) => m.msgId === msgId);
    if (!entry) return;
    if (!keepFiles) for (const file of entry.attachments ?? []) this.files?.remove(file.uri);
    this.patch(conv, { messages: state.messages.filter((m) => m.msgId !== msgId) });
  }

  // Copies a picked file into wizzle's files folder so a send, or a later retry, can read it.
  async attach(conv: string, picked: FileMeta & { uri: string }): Promise<Attachment | null> {
    this.load();
    if (!this.files || !this.pairingId) return null;
    const kept = await this.files.keep(this.pairingId, conv, this.newId(), picked.name, picked.uri);
    return kept ? { name: picked.name, mime: picked.mime, size: kept.size || picked.size, uri: kept.uri } : null;
  }

  // Drops a picked file the user removed before sending.
  unattach(attachment: Attachment): void {
    this.files?.remove(attachment.uri);
  }

  // Replaces everything with what the cache holds for this pairing, before the bridge says anything.
  hydrate(pairingId: string | null): void {
    this.loaded = true;
    this.reset();
    this.pairingId = pairingId;
    if (!pairingId) return;
    const now = this.now();
    const cached = this.cache?.load(pairingId) ?? null;
    // What wizzle held before it kept read marks, or before this pairing, counts as read.
    if (cached?.read && typeof cached.read.floor === 'number') {
      this.readFloor = cached.read.floor;
      for (const [conv, at] of Object.entries(cached.read.marks ?? {})) if (typeof at === 'number') this.readMarks.set(conv, at);
    } else {
      this.readFloor = now;
      this.persistRead();
    }
    if (!cached) return;
    this.hello = cached.hello;
    this.agents = cached.agents;
    this.catalog = cached.catalog;
    for (const [agentId, raw] of Object.entries(cached.profiles)) {
      const profile = toProfile(raw);
      if (profile) this.profiles.set(agentId, profile);
    }
    this.profileView = Object.fromEntries(this.profiles);
    for (const stored of cached.elements) this.elements.set(elementKey(stored.agentId, stored.element.id), stored);
    this.sortElements();
    for (const [conv, data] of cached.conversations) {
      const questions = data.questions.filter((open) => !expired(open.question.expiresAt, now));
      const approvals = data.approvals.filter((open) => !expired(open.approval.expiresAt, now));
      for (const open of questions) this.promptHome.set(open.question.questionId, conv);
      for (const open of approvals) this.promptHome.set(open.approval.approvalId, conv);
      const messages = data.messages.filter((entry) => !entry.msgId.includes(ECHO_MARK)).map(unconfirmed);
      this.convs.set(conv, { ...emptyConversation(), messages, questions, approvals });
    }
    this.changed();
  }

  // A pairing wizzle removed takes its cached rows and saved files with it.
  forgetPairing(pairingId: string): void {
    this.cache?.forgetPairing(pairingId);
    this.files?.forgetPairing(pairingId);
  }

  // Pending cache rows reach disk now, for when iOS is about to suspend the app.
  flush(): void {
    this.cache?.flush();
  }

  answer(conv: string, questionId: string, value: string | string[]): void {
    const state = this.conversation(conv);
    const questions = state.questions.map((open) =>
      open.question.questionId === questionId ? { ...open, answered: value } : open,
    );
    this.patch(conv, { questions });
    const packetId = this.link.send({ t: 'answer', questionId, value });
    if (packetId) this.track(packetId, { t: 'answer', conv });
  }

  decide(conv: string, approvalId: string, decision: ApprovalDecision): void {
    const state = this.conversation(conv);
    const approvals = state.approvals.map((open) =>
      open.approval.approvalId === approvalId ? { ...open, decided: decision } : open,
    );
    this.patch(conv, { approvals });
    const packetId = this.link.send({ t: 'resolve', approvalId, decision });
    if (packetId) this.track(packetId, { t: 'resolve', conv });
  }

  // Resolves with the new conversation id once the bridge announces it.
  createTopic(agentId: string, title: string): Promise<string> {
    const failure = titleFailure(title);
    if (failure) return Promise.reject(failure);
    const name = title.trim();
    return this.ask({ t: 'create_conversation', agentId, title: name }, (settle) => ({ kind: 'create', agentId, title: name, ...settle }));
  }

  renameTopic(conv: string, title: string): Promise<string> {
    const failure = titleFailure(title);
    if (failure) return Promise.reject(failure);
    return this.ask({ t: 'rename_conversation', conv, title: title.trim() }, (settle) => ({ kind: 'rename', conv, ...settle }));
  }

  deleteTopic(conv: string): Promise<string> {
    return this.ask({ t: 'delete_conversation', conv }, (settle) => ({ kind: 'delete', conv, ...settle }));
  }

  // Resolves once the bridge has dropped the session; the chat stays listed, empty.
  clearChat(conv: string): Promise<string> {
    return this.ask({ t: 'clear', conv }, (settle) => ({ kind: 'clear', conv, ...settle }));
  }

  // Each resolves with the agent id once the bridge sends the agent back, or agent_deleted for a delete.
  pauseAgent(agentId: string): Promise<string> {
    return this.ask({ t: 'pause_agent', agentId }, (settle) => ({ kind: 'pause', agentId, ...settle }));
  }

  resumeAgent(agentId: string): Promise<string> {
    return this.ask({ t: 'resume_agent', agentId }, (settle) => ({ kind: 'resume', agentId, ...settle }));
  }

  restartAgent(agentId: string, message?: string): Promise<string> {
    const text = message?.trim();
    return this.ask(
      { t: 'restart_agent', agentId, ...(text !== undefined && text.length > 0 && { message: text }) },
      (settle) => ({ kind: 'restart', agentId, ...settle }),
    );
  }

  deleteAgent(agentId: string, removeWorkspace: boolean): Promise<string> {
    return this.ask({ t: 'delete_agent', agentId, removeWorkspace }, (settle) => ({ kind: 'deleteAgent', agentId, ...settle }));
  }

  // Once per connection, and again with force: the library may have been out of reach the first time.
  loadTemplates(force = false): void {
    this.load();
    if ((this.templatesRequested && !force) || !this.hello?.capabilities.templates) return;
    const packetId = this.link.send({ t: 'templates' });
    if (!packetId) return;
    this.templatesRequested = true;
    this.track(packetId, { t: 'templates' });
  }

  // Asked each time a screen shows keys, since the vault also changes on the host.
  loadSecrets(): void {
    this.load();
    if (!this.hello?.capabilities.keys) return;
    const packetId = this.link.send({ t: 'secrets' });
    if (packetId) this.track(packetId, { t: 'secrets' });
  }

  loadAgentSecrets(agentId: string): void {
    this.load();
    if (!this.hello?.capabilities.keys) return;
    const packetId = this.link.send({ t: 'agent_secrets', agentId });
    if (packetId) this.track(packetId, { t: 'agent_secrets' });
  }

  // Each resolves with the key's id once the bridge has saved it.
  createSecret(secret: SecretInput): Promise<string> {
    return this.ask({ t: 'create_secret', secret }, (settle) => ({ kind: 'createSecret', ...settle }));
  }

  updateSecret(secretId: string, changes: SecretChanges): Promise<string> {
    return this.ask({ t: 'update_secret', secretId, changes }, (settle) => ({ kind: 'updateSecret', ...settle }));
  }

  deleteSecret(secretId: string): Promise<string> {
    return this.ask({ t: 'delete_secret', secretId }, (settle) => ({ kind: 'deleteSecret', secretId, ...settle }));
  }

  // Each resolves with the agent id once the bridge lists the agent's keys with the change.
  attachSecret(agentId: string, secretId: string): Promise<string> {
    return this.ask({ t: 'attach_secret', agentId, secretId }, (settle) => ({ kind: 'attach', agentId, secretId, ...settle }));
  }

  detachSecret(agentId: string, secretId: string): Promise<string> {
    return this.ask({ t: 'detach_secret', agentId, secretId }, (settle) => ({ kind: 'detach', agentId, secretId, ...settle }));
  }

  // One create at a time: a second tap while the host is working is refused, not queued.
  createAgent(request: CreateRequest): CreateState | null {
    this.load();
    if (this.create?.state === 'sending') return null;
    const name = request.name.trim();
    const purpose = request.purpose?.trim();
    const startedAt = this.now();
    const failure = nameFailure(name) ?? (purpose ? purposeFailure(purpose) : null);
    if (failure) {
      this.create = { name, packetId: null, state: 'failed', error: failure, startedAt };
      this.changed();
      return this.create;
    }
    const timezone = deviceTimezone();
    const packetId = this.link.send({
      t: 'create_agent',
      name,
      ...(purpose !== undefined && purpose.length > 0 && { purpose }),
      ...(request.template !== undefined && { template: request.template }),
      ...(request.copyFrom !== undefined && { copyFrom: request.copyFrom }),
      ...(timezone !== undefined && { timezone }),
      ...(request.secrets !== undefined && request.secrets.length > 0 && { secrets: request.secrets }),
    });
    this.create = packetId
      ? { name, packetId, state: 'sending', startedAt }
      : { name, packetId: null, state: 'failed', error: OFFLINE, startedAt };
    this.changed();
    return this.create;
  }

  // Only wizzle sees a nickname or a look; an empty profile brings back the host's name and the face from the id.
  setProfile(agentId: string, profile: AgentProfile): void {
    this.load();
    const next = toProfile(profile);
    if (JSON.stringify(next) === JSON.stringify(this.profiles.get(agentId) ?? null)) return;
    if (next) this.profiles.set(agentId, next);
    else this.profiles.delete(agentId);
    this.profilesChanged();
    this.changed();
  }

  // Called while a chat is on screen, so what the agent sent there so far is read.
  markRead(conv: string): void {
    this.load();
    const newest = newestAgentAt(this.convs.get(conv)?.messages ?? []);
    if (newest === undefined || newest <= this.readMark(conv)) return;
    this.readMarks.set(conv, newest);
    this.persistRead();
    this.changed();
  }

  // Called when a chat screen opens. The first page is fetched once per app run.
  open(conv: string): void {
    const state = this.conversation(conv);
    if (state.requested || state.loading) return;
    this.requestHistory(conv);
  }

  loadOlder(conv: string): void {
    const state = this.conversation(conv);
    if (!state.hasMore || state.loading) return;
    const oldest = state.messages.find((m) => !m.local);
    this.requestHistory(conv, oldest?.msgId);
  }

  dismiss(id: string, conv?: string): void {
    this.load();
    if (conv === undefined) {
      this.notices = this.notices.filter((notice) => notice.id !== id);
      this.changed();
      return;
    }
    const state = this.conversation(conv);
    this.patch(conv, { notices: state.notices.filter((notice) => notice.id !== id) });
  }

  reset(): void {
    for (const pending of this.requests.values()) pending.reject(OFFLINE);
    this.requests.clear();
    this.convs.clear();
    this.sent.clear();
    this.promptHome.clear();
    this.historyBefore.clear();
    this.elements.clear();
    this.elementList = [];
    this.readMarks.clear();
    this.readFloor = 0;
    this.profiles.clear();
    this.profileView = {};
    this.viewCache.clear();
    this.rowCache.clear();
    this.list = null;
    this.agents = [];
    this.catalog = [];
    this.templates = [];
    this.templatesRequested = false;
    this.secrets = null;
    this.agentSecrets = {};
    this.keysError = null;
    this.newestSecret = null;
    this.create = null;
    this.hello = null;
    this.notices = [];
    this.changed();
  }

  destroy(): void {
    this.detach();
    this.listeners.clear();
  }

  // The first touch brings in the cache for the current pairing; without one there is nothing to load.
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const pairingId = this.pairingOf?.() ?? null;
    if (pairingId) this.hydrate(pairingId);
  }

  // The writer's view of a conversation: it exists from here on, so patches have somewhere to land.
  private conversation(conv: string): ConversationState {
    this.load();
    const existing = this.convs.get(conv);
    if (existing) return existing;
    const fresh = emptyConversation();
    this.convs.set(conv, fresh);
    return fresh;
  }

  private requestHistory(conv: string, before?: string): void {
    if (this.hello && !this.hello.capabilities.history) return;
    const packetId = this.link.send({ t: 'history', conv, limit: HISTORY_PAGE, ...(before !== undefined && { before }) });
    if (!packetId) return;
    this.track(packetId, { t: 'history', conv });
    this.historyBefore.set(conv, before);
    this.patch(conv, { loading: true, requested: true });
  }

  // Uploads go out one by one ahead of the send that names them; the first step that fails marks the echo.
  private async dispatch(conv: string, msgId: string, text: string, attachments: Attachment[]): Promise<void> {
    const uploads: string[] = [];
    for (const file of attachments) {
      const bytes = await this.files?.read(file.uri);
      if (!this.conversation(conv).messages.some((m) => m.msgId === msgId)) return;
      if (!bytes) return this.fail(conv, msgId, { code: 'file_missing', message: `${file.name} is no longer in wizzle.` });
      const uploadId = this.newId();
      const packetId = this.trySend({ t: 'upload', uploadId, file: { name: file.name, mime: file.mime, size: bytes.length } }, bytes);
      if (!packetId) return this.fail(conv, msgId, OFFLINE);
      this.track(packetId, { t: 'upload', conv, msgId });
      uploads.push(uploadId);
    }
    const packetId = this.trySend({ t: 'send', conv, msgId, text, ...(uploads.length > 0 && { attachments: uploads }) });
    if (!packetId) return this.fail(conv, msgId, OFFLINE);
    this.track(packetId, { t: 'send', conv, msgId });
    this.edit(conv, msgId, { local: { packetId } });
  }

  // The relay client throws on a frame over its limit, which counts as not sent.
  private trySend(message: WizzleMessage, body?: Uint8Array): string | null {
    try {
      return this.link.send(message, body);
    } catch {
      return null;
    }
  }

  private fail(conv: string, msgId: string, failure: SendFailure): void {
    this.edit(conv, msgId, { local: { packetId: null, failure } });
  }

  private ask(message: WizzleMessage, make: (settle: Settle) => PendingRequest): Promise<string> {
    this.load();
    return new Promise<string>((resolve, reject) => {
      const packetId = this.link.send(message);
      if (!packetId) {
        reject(OFFLINE);
        return;
      }
      this.requests.set(packetId, make({ resolve, reject }));
    });
  }

  private settle(match: (pending: PendingRequest) => boolean, value: string): void {
    for (const [packetId, pending] of [...this.requests]) {
      if (!match(pending)) continue;
      this.requests.delete(packetId);
      pending.resolve(value);
    }
  }

  // Everything wizzle cached for a conversation the catalog no longer lists.
  private forget(conv: string): void {
    this.convs.delete(conv);
    this.historyBefore.delete(conv);
    this.rowCache.delete(conv);
    if (this.readMarks.delete(conv)) this.persistRead();
    for (const [promptId, home] of [...this.promptHome]) {
      if (home === conv) this.promptHome.delete(promptId);
    }
    if (!this.pairingId) return;
    this.cache?.forgetConversation(this.pairingId, conv);
    this.files?.forgetConversation(this.pairingId, conv);
  }

  // A cleared chat keeps its place in the list and starts over from an empty transcript.
  private wipe(conv: string): void {
    this.historyBefore.delete(conv);
    for (const [promptId, home] of [...this.promptHome]) {
      if (home === conv) this.promptHome.delete(promptId);
    }
    if (this.pairingId) this.files?.forgetConversation(this.pairingId, conv);
    this.patch(conv, { ...emptyConversation(), requested: true });
  }

  // The chat row links to the stored element; an older copy of the same id never replaces a newer one.
  private receiveElement(conv: string, body: Uint8Array, at: number): Pick<ChatEntry, 'element' | 'elementError'> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fromUtf8(body));
    } catch {
      return { elementError: 'This element file is not valid JSON.' };
    }
    const { element, issues } = validateElement(parsed);
    if (!element) {
      const first = issues[0];
      return { elementError: first ? `This element could not be opened: ${first.path}: ${first.message}` : 'This element could not be opened.' };
    }
    const agentId = this.catalog.find((c) => c.id === conv)?.agentId ?? conv;
    const key = elementKey(agentId, element.id);
    const existing = this.elements.get(key);
    if (!existing || existing.receivedAt <= at) {
      this.elements.set(key, { agentId, conv, receivedAt: at, element });
      this.sortElements();
      if (this.pairingId) this.cache?.saveElements(this.pairingId, this.elementList);
    }
    return { element: { agentId, id: element.id } };
  }

  private sortElements(): void {
    this.elementList = [...this.elements.values()].sort((a, b) => b.receivedAt - a.receivedAt);
  }

  private readMark(conv: string): number {
    return this.readMarks.get(conv) ?? this.readFloor;
  }

  private persistRead(): void {
    if (this.pairingId) this.cache?.saveRead(this.pairingId, { floor: this.readFloor, marks: Object.fromEntries(this.readMarks) });
  }

  // An agent message the bridge holds and wizzle does not means frames were lost, so the latest page comes again.
  private catchUp(): void {
    for (const conv of this.catalog) {
      const state = this.convs.get(conv.id);
      if (conv.lastAgentAt === undefined || state?.loading) continue;
      if (conv.lastAgentAt > (newestAgentAt(state?.messages ?? []) ?? 0)) this.requestHistory(conv.id);
    }
  }

  private profilesChanged(): void {
    this.profileView = Object.fromEntries(this.profiles);
    if (this.pairingId) this.cache?.saveProfiles(this.pairingId, this.profileView);
  }

  private persistMeta(): void {
    if (this.pairingId) this.cache?.saveMeta(this.pairingId, { hello: this.hello, agents: this.agents, catalog: this.catalog });
  }

  private track(packetId: string, pending: PendingSend): void {
    this.sent.set(packetId, pending);
    while (this.sent.size > MAX_PENDING) {
      const oldest = this.sent.keys().next();
      if (oldest.done) break;
      this.sent.delete(oldest.value);
    }
  }

  private patch(conv: string, change: Partial<ConversationState>): void {
    const next = { ...this.conversation(conv), ...change };
    this.convs.set(conv, next);
    if (this.pairingId && this.cache && ('messages' in change || 'questions' in change || 'approvals' in change)) {
      const data: CachedConversation = { messages: next.messages, questions: next.questions, approvals: next.approvals };
      this.cache.saveConversation(this.pairingId, conv, data);
    }
    this.changed();
  }

  private upsert(conv: string, entry: ChatEntry): void {
    const state = this.conversation(conv);
    const at = state.messages.findIndex((m) => m.msgId === entry.msgId);
    if (at === -1) {
      this.patch(conv, { messages: insert(state.messages, entry) });
      return;
    }
    const messages = state.messages.slice();
    messages[at] = { ...(messages[at] as ChatEntry), ...entry };
    this.patch(conv, { messages });
  }

  private edit(conv: string, msgId: string, change: Partial<ChatEntry>): boolean {
    const state = this.conversation(conv);
    const at = state.messages.findIndex((m) => m.msgId === msgId);
    if (at === -1) return false;
    const messages = state.messages.slice();
    messages[at] = { ...(messages[at] as ChatEntry), ...change };
    this.patch(conv, { messages });
    return true;
  }

  private entryOf(message: ChatMessage): ChatEntry {
    return { ...message, kind: 'text' };
  }

  private note(conv: string | undefined, code: string, message: string): void {
    const notice: Notice = { id: this.newId(), code, message };
    if (conv === undefined) {
      this.notices = [...this.notices, notice];
      this.changed();
      return;
    }
    this.patch(conv, { notices: [...this.conversation(conv).notices, notice] });
  }

  private receive(packet: DecodedPacket): void {
    this.load();
    const h = packet.header;
    const now = this.now();
    switch (h.t) {
      case 'hello': {
        this.hello = toHello(h);
        // A new connection starts with nothing running; the sync reply that follows reports what still is.
        for (const [id, state] of this.convs) if (state.activity) this.convs.set(id, { ...state, activity: null });
        this.templatesRequested = false;
        this.loadTemplates();
        this.persistMeta();
        this.changed();
        return;
      }
      case 'agents': {
        const raw = Array.isArray(h['agents']) ? h['agents'] : [];
        this.agents = raw.map(toAgent).filter((agent): agent is Agent => agent !== null);
        this.persistMeta();
        this.changed();
        return;
      }
      case 'agent': {
        const agent = toAgent(h['agent']);
        if (!agent) return void this.drop();
        const at = this.agents.findIndex((a) => a.id === agent.id);
        this.agents = at === -1 ? [...this.agents, agent] : this.agents.map((a) => (a.id === agent.id ? agent : a));
        this.resolveCreate(agent);
        // Matching the status keeps an unrelated agent update from answering a pause or resume early.
        this.settle(
          (pending) =>
            'agentId' in pending &&
            pending.agentId === agent.id &&
            ((pending.kind === 'pause' && agent.status === 'paused') ||
              (pending.kind === 'resume' && agent.status !== 'paused') ||
              pending.kind === 'restart'),
          agent.id,
        );
        this.persistMeta();
        this.changed();
        return;
      }
      case 'agent_deleted': {
        const agentId = str(h['agentId']);
        if (!agentId) return void this.drop();
        this.agents = this.agents.filter((a) => a.id !== agentId);
        this.viewCache.delete(agentId);
        if (this.profiles.delete(agentId)) this.profilesChanged();
        for (const conv of this.catalog) if (conv.agentId === agentId) this.forget(conv.id);
        this.catalog = this.catalog.filter((c) => c.agentId !== agentId);
        this.settle((pending) => pending.kind === 'deleteAgent' && pending.agentId === agentId, agentId);
        this.persistMeta();
        this.changed();
        return;
      }
      case 'conversations': {
        const raw = Array.isArray(h['conversations']) ? h['conversations'] : [];
        this.catalog = raw.map(toConversation).filter((conv): conv is Conversation => conv !== null);
        const live = new Set(this.catalog.map((conv) => conv.id));
        live.add(SYSTEM_CONV);
        for (const id of [...this.convs.keys()]) if (!live.has(id)) this.forget(id);
        this.linkCreatedConversation();
        this.catchUp();
        this.persistMeta();
        this.changed();
        return;
      }
      case 'conversation': {
        const conversation = toConversation(h['conversation']);
        if (!conversation) return void this.drop();
        const at = this.catalog.findIndex((c) => c.id === conversation.id);
        this.catalog = at === -1 ? [...this.catalog, conversation] : this.catalog.map((c) => (c.id === conversation.id ? conversation : c));
        this.settle(
          (pending) =>
            (pending.kind === 'create' && pending.agentId === conversation.agentId && pending.title === conversation.title) ||
            (pending.kind === 'rename' && pending.conv === conversation.id),
          conversation.id,
        );
        this.persistMeta();
        this.changed();
        return;
      }
      case 'conversation_deleted': {
        const conv = str(h['conv']);
        if (!conv) return void this.drop();
        this.catalog = this.catalog.filter((c) => c.id !== conv);
        this.forget(conv);
        this.settle((pending) => pending.kind === 'delete' && pending.conv === conv, conv);
        this.persistMeta();
        this.changed();
        return;
      }
      case 'message': {
        const message = toChatMessage(h['message'], now);
        if (!message) return void this.drop();
        this.upsert(message.conv, this.entryOf(message));
        return;
      }
      case 'delta': {
        const conv = str(h['conv']);
        const msgId = str(h['msgId']);
        const append = str(h['append']);
        if (!conv || !msgId || append === null) return void this.drop();
        const existing = this.conversation(conv).messages.find((m) => m.msgId === msgId);
        if (existing) this.edit(conv, msgId, { text: existing.text + append });
        else this.upsert(conv, { conv, msgId, role: 'agent', text: append, format: 'markdown', at: now, kind: 'text' });
        return;
      }
      case 'edit': {
        const conv = str(h['conv']);
        const msgId = str(h['msgId']);
        const text = str(h['text']);
        if (!conv || !msgId || text === null) return void this.drop();
        const terminal = isRecord(h['terminal']) ? str(h['terminal']['resolution']) : null;
        const change: Partial<ChatEntry> = { text, edited: true, ...(terminal !== null && { resolution: terminal }) };
        if (str(h['format']) !== null) change.format = toFormat(h['format']);
        if (this.edit(conv, msgId, change)) return;
        // An edit of an open question is its resolution line, which question_resolved reports.
        if (this.promptHome.has(msgId)) return;
        this.upsert(conv, { conv, msgId, role: 'agent', text, format: toFormat(h['format']), at: now, kind: 'text', edited: true });
        return;
      }
      case 'reaction': {
        const conv = str(h['conv']);
        const msgId = str(h['msgId']);
        const emoji = str(h['emoji']);
        if (!conv || !msgId || !emoji) return void this.drop();
        const entry = this.conversation(conv).messages.find((m) => m.msgId === msgId);
        if (!entry) return;
        const current = entry.reactions ?? [];
        const reactions = h['op'] === 'remove' ? current.filter((e) => e !== emoji) : [...current, emoji];
        this.edit(conv, msgId, { reactions });
        return;
      }
      case 'card': {
        const conv = str(h['conv']);
        const msgId = str(h['msgId']);
        if (!conv || !msgId) return void this.drop();
        this.upsert(conv, {
          conv,
          msgId,
          role: 'agent',
          text: str(h['fallbackText']) ?? '',
          format: 'text',
          at: num(h['at']) ?? now,
          kind: 'card',
          card: h['card'],
        });
        return;
      }
      case 'file': {
        const conv = str(h['conv']);
        const msgId = str(h['msgId']);
        const file = toFileMeta(h['file']);
        if (!conv || !msgId || !file) return void this.drop();
        const at = num(h['at']) ?? now;
        const entry: ChatEntry = { conv, msgId, role: 'agent', text: str(h['caption']) ?? '', format: 'text', at, kind: 'file', file };
        if (isElementFile(file.name)) Object.assign(entry, this.receiveElement(conv, packet.body, at));
        this.upsert(conv, entry);
        this.saveFile(conv, msgId, file, packet.body);
        return;
      }
      case 'activity': {
        const activity = toActivity(h['activity']);
        if (!activity) return void this.drop();
        this.patch(activity.conv, { activity: activity.state === 'idle' ? null : activity });
        return;
      }
      case 'question': {
        const question = toQuestion(h['question']);
        if (!question) return void this.drop();
        this.promptHome.set(question.questionId, question.conv);
        const state = this.conversation(question.conv);
        const open: OpenQuestion = { question };
        const at = state.questions.findIndex((q) => q.question.questionId === question.questionId);
        const questions = at === -1 ? [...state.questions, open] : state.questions.map((q, i) => (i === at ? open : q));
        this.patch(question.conv, { questions });
        return;
      }
      case 'question_resolved': {
        const questionId = str(h['questionId']);
        if (!questionId) return void this.drop();
        const conv = this.promptHome.get(questionId);
        this.promptHome.delete(questionId);
        if (!conv) return;
        const state = this.conversation(conv);
        const questions = state.questions.filter((q) => q.question.questionId !== questionId);
        this.patch(conv, { questions });
        const value = answerText(h['value']);
        const by = str(h['by']);
        if (!value) return;
        this.upsert(conv, {
          conv,
          msgId: `resolved:${questionId}`,
          role: 'system',
          text: by ? `Answered by ${by}: ${value}` : `Answered: ${value}`,
          format: 'text',
          at: now,
          kind: 'text',
        });
        return;
      }
      case 'approval': {
        const approval = toApproval(h['approval']);
        if (!approval) return void this.drop();
        this.promptHome.set(approval.approvalId, approval.conv);
        const state = this.conversation(approval.conv);
        const open: OpenApproval = { approval };
        const at = state.approvals.findIndex((a) => a.approval.approvalId === approval.approvalId);
        const approvals = at === -1 ? [...state.approvals, open] : state.approvals.map((a, i) => (i === at ? open : a));
        this.patch(approval.conv, { approvals });
        return;
      }
      case 'approval_resolved': {
        const approvalId = str(h['approvalId']);
        if (!approvalId) return void this.drop();
        const conv = this.promptHome.get(approvalId);
        this.promptHome.delete(approvalId);
        if (!conv) return;
        const state = this.conversation(conv);
        this.patch(conv, { approvals: state.approvals.filter((a) => a.approval.approvalId !== approvalId) });
        const decision = str(h['decision']);
        if (!decision) return;
        this.upsert(conv, {
          conv,
          msgId: `resolved:${approvalId}`,
          role: 'system',
          text: `Approval ${decision.replace('_', ' ')}`,
          format: 'text',
          at: now,
          kind: 'text',
        });
        return;
      }
      case 'session': {
        const conv = str(h['conv']);
        const event = h['event'];
        if (!conv || typeof event !== 'string') return void this.drop();
        // The bridge clears a chat by dropping its session, so the transcript goes with it.
        if (event === 'cleared') {
          this.wipe(conv);
          this.settle((pending) => pending.kind === 'clear' && pending.conv === conv, conv);
          return;
        }
        this.upsert(conv, {
          conv,
          msgId: `session:${this.newId()}`,
          role: 'system',
          text: sessionText(event as SessionEvent, str(h['detail'])),
          format: 'text',
          at: now,
          kind: 'text',
        });
        return;
      }
      case 'history': {
        const conv = str(h['conv']);
        if (!conv) return void this.drop();
        const raw = Array.isArray(h['messages']) ? h['messages'] : [];
        const messages = raw
          .map((m) => toChatMessage(m, now))
          .filter((m): m is ChatMessage => m !== null && m.conv === conv);
        const added = this.merge(conv, messages);
        // A bridge that ignores `before` resends the same page, so an older page with nothing new ends paging.
        const paged = this.historyBefore.get(conv) !== undefined;
        this.patch(conv, { loading: false, requested: true, hasMore: h['hasMore'] === true && (added > 0 || !paged) });
        return;
      }
      case 'templates': {
        const raw = Array.isArray(h['templates']) ? h['templates'] : [];
        this.templates = raw.map(toTemplateInfo).filter((info): info is TemplateInfo => info !== null);
        this.changed();
        return;
      }
      case 'secrets': {
        const raw = Array.isArray(h['secrets']) ? h['secrets'] : [];
        this.secrets = raw.map(toSecret).filter((secret): secret is Secret => secret !== null);
        this.keysError = null;
        this.changed();
        return;
      }
      case 'secret': {
        const secret = toSecret(h['secret']);
        if (!secret) return void this.drop();
        const list = this.secrets ?? [];
        this.secrets = list.some((one) => one.id === secret.id)
          ? list.map((one) => (one.id === secret.id ? secret : one))
          : [...list, secret];
        const ref = str(h['ref']);
        const pending = ref ? this.requests.get(ref) : undefined;
        if (ref && pending && (pending.kind === 'createSecret' || pending.kind === 'updateSecret')) {
          this.requests.delete(ref);
          if (pending.kind === 'createSecret') this.newestSecret = { id: secret.id, seq: (this.newestSecret?.seq ?? 0) + 1 };
          pending.resolve(secret.id);
        }
        this.changed();
        return;
      }
      case 'secret_deleted': {
        const secretId = str(h['secretId']);
        if (!secretId) return void this.drop();
        if (this.secrets) this.secrets = this.secrets.filter((one) => one.id !== secretId);
        this.agentSecrets = Object.fromEntries(
          Object.entries(this.agentSecrets).map(([agentId, ids]) => [agentId, ids.filter((id) => id !== secretId)]),
        );
        this.settle((pending) => pending.kind === 'deleteSecret' && pending.secretId === secretId, secretId);
        this.changed();
        return;
      }
      case 'agent_secrets': {
        const agentId = str(h['agentId']);
        if (!agentId) return void this.drop();
        const raw = Array.isArray(h['secretIds']) ? h['secretIds'] : [];
        const ids = raw.filter((id): id is string => typeof id === 'string');
        this.agentSecrets = { ...this.agentSecrets, [agentId]: ids };
        this.keysError = null;
        this.settle(
          (pending) =>
            (pending.kind === 'attach' && pending.agentId === agentId && ids.includes(pending.secretId)) ||
            (pending.kind === 'detach' && pending.agentId === agentId && !ids.includes(pending.secretId)),
          agentId,
        );
        this.changed();
        return;
      }
      case 'error': {
        const code = str(h['code']) ?? 'error';
        const message = str(h['message']) ?? 'The bridge rejected that.';
        const ref = str(h['ref']);
        const request = ref ? this.requests.get(ref) : undefined;
        if (ref && request) {
          this.requests.delete(ref);
          request.reject({ code, message });
          return;
        }
        if (ref && this.create?.packetId === ref && this.create.state === 'sending') {
          this.create = { ...this.create, state: 'failed', error: { code, message } };
          this.sent.delete(ref);
          this.changed();
          return;
        }
        const pending = ref ? this.sent.get(ref) : undefined;
        if (ref) this.sent.delete(ref);
        if (pending?.msgId && pending.conv) {
          const failed = this.edit(pending.conv, pending.msgId, { local: { packetId: ref, failure: { code, message } } });
          if (failed) return;
        }
        if (pending?.conv && pending.t === 'history') this.patch(pending.conv, { loading: false });
        // A key screen shows its own listing failure.
        if (pending?.t === 'secrets' || pending?.t === 'agent_secrets') {
          this.keysError = { code, message };
          this.changed();
          return;
        }
        this.note(pending?.conv, code, message);
        return;
      }
      default:
        return;
    }
  }

  // A known msgId confirms what wizzle holds; an unknown one is new, unless it is an echo
  // from a bridge without stable ids, which the text match catches.
  private merge(conv: string, messages: ChatMessage[]): number {
    const state = this.conversation(conv);
    const known = new Set(state.messages.map((m) => m.msgId));
    const echoes = state.messages.filter((m) => m.local && m.role === 'user');
    let next = state.messages;
    let added = 0;
    let confirmed = 0;
    for (const message of messages) {
      if (known.has(message.msgId)) {
        const at = next.findIndex((m) => m.msgId === message.msgId);
        const existing = next[at];
        if (!existing || !existing.local) continue;
        next = next.slice();
        next[at] = confirm(existing, message);
        confirmed += 1;
        continue;
      }
      if (message.role === 'user' && echoes.some((echo) => echo.text === message.text)) continue;
      next = insert(next, this.entryOf(message));
      known.add(message.msgId);
      added += 1;
    }
    if (added > 0 || confirmed > 0) this.patch(conv, { messages: next });
    return added;
  }

  // The body is written off the packet path; the uri lands on the entry once it is on disk.
  private saveFile(conv: string, msgId: string, file: FileMeta, body: Uint8Array): void {
    if (!this.files || !this.pairingId || body.length === 0) return;
    void this.files.save(this.pairingId, conv, msgId, file.name, body).then((uri) => {
      if (!uri) return;
      const entry = this.conversation(conv).messages.find((m) => m.msgId === msgId);
      if (entry?.file) this.edit(conv, msgId, { file: { ...entry.file, uri } });
    });
  }

  // The host answers a create with the agent, then the catalog carries its conversation.
  private resolveCreate(agent: Agent): void {
    const create = this.create;
    if (!create || create.state !== 'sending') return;
    if (agent.name.trim().toLowerCase() !== create.name.toLowerCase()) return;
    this.create = { ...create, state: 'created', agentId: agent.id };
    this.linkCreatedConversation();
  }

  private linkCreatedConversation(): void {
    const create = this.create;
    if (!create || create.state !== 'created' || create.conv !== undefined || create.agentId === undefined) return;
    const conv = this.catalog.find((c) => c.agentId === create.agentId && c.topic !== true);
    if (conv) this.create = { ...create, conv: conv.id };
  }

  private drop(): void {
    this.dropped += 1;
  }

  // A nickname replaces the host's name everywhere wizzle shows one. The view holds while agent and nickname do.
  private shown(agent: Agent): AgentView {
    const nickname = this.profiles.get(agent.id)?.nickname;
    const cached = this.viewCache.get(agent.id);
    if (cached && cached.agent === agent && cached.nickname === nickname) return cached.view;
    const view = nickname && nickname !== agent.name ? { ...agent, name: nickname, hostName: agent.name } : agent;
    this.viewCache.set(agent.id, { agent, nickname, view });
    return view;
  }

  private agentViews(): AgentView[] {
    const views = this.agents.map((agent) => this.shown(agent));
    const previous = this.list?.agents;
    if (previous && previous.length === views.length && previous.every((view, i) => view === views[i])) return previous;
    return views;
  }

  private row(conv: Conversation, agents: AgentView[]): ConversationRow {
    const state = this.convs.get(conv.id);
    const agent = agents.find((a) => a.id === conv.agentId) ?? null;
    const mark = this.readMark(conv.id);
    const cached = this.rowCache.get(conv.id);
    if (cached && cached.source.conv === conv && cached.source.state === state && cached.source.agent === agent && cached.source.mark === mark) {
      return cached.row;
    }
    const last = state?.messages[state.messages.length - 1] ?? null;
    const lastAt = Math.max(conv.lastAt ?? 0, last?.at ?? 0);
    const repliedAt = state ? newestAgentAt(state.messages) : undefined;
    const row: ConversationRow = {
      ...conv,
      // The default conversation is titled with the agent's name, so a nickname retitles it too.
      ...(agent?.hostName !== undefined && conv.topic !== true && { title: agent.name }),
      ...(lastAt > 0 && { lastAt }),
      ...(repliedAt !== undefined && { repliedAt }),
      agent,
      last,
      activity: state?.activity ?? null,
      questions: (state?.questions.length ?? 0) + (state?.approvals.length ?? 0),
      unread: state ? unreadOf(state.messages, mark) : 0,
      topic: conv.topic === true,
    };
    this.rowCache.set(conv.id, { source: { conv, state, agent, mark }, row });
    return row;
  }

  // The default conversation leads its agent, topics follow it newest first, System sits last.
  private group(rows: ConversationRow[], agents: AgentView[]): AgentGroup[] {
    const byAgent = new Map<string, ConversationRow[]>();
    for (const row of rows) {
      const list = byAgent.get(row.agentId);
      if (list) list.push(row);
      else byAgent.set(row.agentId, [row]);
    }
    const groups: AgentGroup[] = [];
    for (const [agentId, list] of byAgent) {
      const agent = agents.find((a) => a.id === agentId) ?? { id: agentId, name: list[0]?.title ?? agentId, status: 'idle' as AgentStatus };
      groups.push({ agent, conversations: list.slice().sort((a, b) => Number(a.topic) - Number(b.topic) || (b.lastAt ?? 0) - (a.lastAt ?? 0)) });
    }
    const newest = (group: AgentGroup): number => group.conversations.reduce((at, conv) => Math.max(at, conv.lastAt ?? 0), 0);
    const isSystem = (group: AgentGroup): boolean => group.conversations.some((conv) => conv.id === SYSTEM_CONV);
    return groups.sort((a, b) => Number(isSystem(a)) - Number(isSystem(b)) || newest(b) - newest(a));
  }

  // The sorted list and its groups are rebuilt only when a row or an agent view changed.
  private lists(): ListCache {
    const agents = this.agentViews();
    const rows = this.catalog.map((conv) => this.row(conv, agents));
    const last = this.list;
    if (last && last.agents === agents && last.rows.length === rows.length && last.rows.every((row, i) => row === rows[i])) return last;
    const conversations = rows.slice().sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    this.list = { agents, rows, conversations, agentGroups: this.group(conversations, agents) };
    return this.list;
  }

  private compute(): StoreSnapshot {
    const { agents, conversations, agentGroups } = this.lists();
    return {
      hello: this.hello,
      capabilities: this.hello?.capabilities ?? null,
      agents,
      profiles: this.profileView,
      conversations,
      agentGroups,
      templates: this.templates,
      secrets: this.secrets,
      agentSecrets: this.agentSecrets,
      keysError: this.keysError,
      newestSecret: this.newestSecret,
      create: this.create,
      notices: this.notices,
      elements: this.elementList,
    };
  }

  // The snapshot is dropped, not rebuilt: the next read computes it, and only what changed is rebuilt.
  private changed(): void {
    this.snapshot = null;
    for (const listener of this.listeners) listener();
  }
}
