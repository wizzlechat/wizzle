import { lexer, type Token, type Tokens } from 'marked';
import type { FileStore } from '../files/types.ts';
import {
  MAX_FILE_BYTES,
  fromUtf8,
  isElementFile,
  validateElement,
  type Activity,
  type ActivityState,
  type Agent,
  type AgentStatus,
  type Approval,
  type ApprovalDecision,
  type Capabilities,
  type ChatMessage,
  type ChatRole,
  type Conversation,
  type DecodedPacket,
  type FileMeta,
  type PhoneMessage,
  type Question,
  type QuestionOption,
  type SessionEvent,
  type TemplateInfo,
  type TextFormat,
} from '../protocol/index.ts';
import type { CachedConversation, StoreCache } from './cache.ts';
import type {
  AgentGroup,
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

export const SYSTEM_CONV = 'wizzle:system';

function elementKey(agentId: string, id: string): string {
  return `${agentId}\0${id}`;
}

const HISTORY_PAGE = 50;
const MAX_PENDING = 128;
const PREVIEW_CHARS = 140;
const MAX_TITLE_CHARS = 60;

export const MAX_NAME_CHARS = 60;
export const MAX_PURPOSE_CHARS = 2000;
export const MAX_ATTACHMENTS = 4;
export const MAX_ATTACHMENT_TOTAL = 32 * 1024 * 1024;

export type PacketListener = (packet: DecodedPacket) => void;

// What the store needs from the relay connection. The tests supply their own.
export type StoreLink = {
  send(message: PhoneMessage, body?: Uint8Array): string | null;
  onPacket(listener: PacketListener): () => void;
};

export type StoreOptions = { link: StoreLink; newId: () => string; now?: () => number; cache?: StoreCache; files?: FileStore };

// What the create screen collects. Only one of template and copyFrom is ever set.
export type CreateRequest = { name: string; purpose?: string; template?: string; copyFrom?: string };

type PendingSend = { t: string; conv?: string; msgId?: string };

type Settle = { resolve: (conv: string) => void; reject: (failure: SendFailure) => void };

// A topic or agent request answers the screen that asked, so its error never becomes a notice.
type TopicPending = Settle &
  (
    | { kind: 'create'; agentId: string; title: string }
    | { kind: 'rename'; conv: string }
    | { kind: 'delete'; conv: string }
    | { kind: 'pause' | 'resume' | 'restart' | 'deleteAgent'; agentId: string }
  );

const OFFLINE: SendFailure = { code: 'offline', message: 'Not connected to the bridge yet.' };
const UNCONFIRMED: SendFailure = { code: 'unconfirmed', message: 'The app closed before the bridge confirmed this message.' };

function mib(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MiB`;
}

// Why one more file cannot join a message, checked when it is picked and again on send.
export function attachmentFailure(current: Attachment[], next: Attachment): SendFailure | null {
  if (current.length >= MAX_ATTACHMENTS) return { code: 'too_many', message: `At most ${MAX_ATTACHMENTS} files per message.` };
  if (next.size > MAX_FILE_BYTES) return { code: 'too_large', message: `${next.name} is over ${mib(MAX_FILE_BYTES)}, the most one file can be.` };
  const total = current.reduce((sum, file) => sum + file.size, 0) + next.size;
  if (total > MAX_ATTACHMENT_TOTAL) return { code: 'too_large', message: `Files in one message add up to at most ${mib(MAX_ATTACHMENT_TOTAL)}.` };
  return null;
}

export function attachmentsFailure(attachments: Attachment[]): SendFailure | null {
  for (let i = 0; i < attachments.length; i += 1) {
    const failure = attachmentFailure(attachments.slice(0, i), attachments[i] as Attachment);
    if (failure) return failure;
  }
  return null;
}

// The host slugs a title to lowercase letters and digits; one with none of them has no id.
export function titleFailure(title: string): SendFailure | null {
  const name = title.trim();
  if (name.length === 0 || !/[a-z0-9]/i.test(name)) return { code: 'bad_request', message: 'A topic title needs a letter or a digit.' };
  if (name.length > MAX_TITLE_CHARS) return { code: 'bad_request', message: `A topic title is at most ${MAX_TITLE_CHARS} characters.` };
  return null;
}

// Mirrors the host's slug so the form can show the folder before the host makes it.
export function agentFolder(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
    .slice(0, 63)
    .replace(/[-_]+$/, '');
}

export function nameFailure(name: string): SendFailure | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { code: 'bad_request', message: 'An agent needs a name.' };
  if (trimmed.length > MAX_NAME_CHARS) return { code: 'bad_request', message: `An agent name is at most ${MAX_NAME_CHARS} characters.` };
  if (agentFolder(trimmed).length === 0) return { code: 'bad_request', message: 'An agent name needs a letter or a digit.' };
  if (trimmed.toLowerCase() === 'system') return { code: 'bad_request', message: 'System is a reserved name.' };
  return null;
}

export function purposeFailure(purpose: string): SendFailure | null {
  if (purpose.trim().length > MAX_PURPOSE_CHARS) {
    return { code: 'too_long', message: `A purpose is at most ${MAX_PURPOSE_CHARS} characters.` };
  }
  return null;
}

// The host stamps the new agent's container clock from this, and refuses anything that is not an IANA id.
function deviceTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof zone !== 'string') return undefined;
    return zone === 'UTC' || /^[A-Za-z][A-Za-z_+-]*\/[A-Za-z0-9_+\-/]+$/.test(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(value: unknown): boolean {
  return value === true;
}

function toRole(value: unknown): ChatRole {
  return value === 'user' || value === 'system' ? value : 'agent';
}

function toFormat(value: unknown): TextFormat {
  return value === 'markdown' ? 'markdown' : 'text';
}

function toStatus(value: unknown): AgentStatus {
  const known: AgentStatus[] = ['idle', 'running', 'waiting', 'offline', 'error', 'paused'];
  return known.includes(value as AgentStatus) ? (value as AgentStatus) : 'idle';
}

function toActivityState(value: unknown): ActivityState {
  const known: ActivityState[] = ['idle', 'thinking', 'tool'];
  return known.includes(value as ActivityState) ? (value as ActivityState) : 'thinking';
}

function toCapabilities(value: unknown): Capabilities {
  const v = isRecord(value) ? value : {};
  return {
    streaming: bool(v['streaming']),
    questions: bool(v['questions']),
    approvals: bool(v['approvals']),
    tasks: bool(v['tasks']),
    files: bool(v['files']),
    history: bool(v['history']),
    clearSession: bool(v['clearSession']),
    abort: bool(v['abort']),
    createAgent: bool(v['createAgent']),
    topics: bool(v['topics']),
    templates: bool(v['templates']),
    lifecycle: bool(v['lifecycle']),
    deleteAgent: bool(v['deleteAgent']),
  };
}

function toTemplateInfo(value: unknown): TemplateInfo | null {
  if (!isRecord(value)) return null;
  const ref = str(value['ref']);
  const name = str(value['name']);
  if (!ref || !name) return null;
  const agentName = str(value['agentName']);
  const description = str(value['description']);
  const version = str(value['version']);
  return {
    ref,
    name,
    tasks: num(value['tasks']) ?? 0,
    mcpServers: num(value['mcpServers']) ?? 0,
    skills: num(value['skills']) ?? 0,
    ...(agentName !== null && { agentName }),
    ...(description !== null && { description }),
    ...(version !== null && { version }),
  };
}

function toAgent(value: unknown): Agent | null {
  if (!isRecord(value)) return null;
  const id = str(value['id']);
  const name = str(value['name']);
  if (!id || !name) return null;
  const description = str(value['description']);
  const model = str(value['model']);
  return {
    id,
    name,
    status: toStatus(value['status']),
    ...(description !== null && { description }),
    ...(model !== null && { model }),
  };
}

function toConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) return null;
  const id = str(value['id']);
  const agentId = str(value['agentId']);
  if (!id || !agentId) return null;
  const lastAt = num(value['lastAt']);
  const createdAt = num(value['createdAt']);
  return {
    id,
    agentId,
    title: str(value['title']) ?? id,
    ...(lastAt !== null && { lastAt }),
    ...(value['topic'] === true && { topic: true }),
    ...(createdAt !== null && { createdAt }),
  };
}

function toChatMessage(value: unknown, now: number): ChatMessage | null {
  if (!isRecord(value)) return null;
  const conv = str(value['conv']);
  const msgId = str(value['msgId']);
  const text = str(value['text']);
  if (!conv || !msgId || text === null) return null;
  return { conv, msgId, role: toRole(value['role']), text, format: toFormat(value['format']), at: num(value['at']) ?? now };
}

function toActivity(value: unknown): Activity | null {
  if (!isRecord(value)) return null;
  const conv = str(value['conv']);
  if (!conv) return null;
  const tool = str(value['tool']);
  const label = str(value['label']);
  const startedAt = num(value['startedAt']);
  const timeoutMs = num(value['timeoutMs']);
  return {
    conv,
    state: toActivityState(value['state']),
    ...(tool !== null && { tool }),
    ...(label !== null && { label }),
    ...(startedAt !== null && { startedAt }),
    ...(timeoutMs !== null && { timeoutMs }),
  };
}

function toOption(value: unknown): QuestionOption | null {
  if (!isRecord(value)) return null;
  const label = str(value['label']);
  if (!label) return null;
  const style = value['style'];
  const known = style === 'primary' || style === 'danger' || style === 'default';
  return { label, value: str(value['value']) ?? label, ...(known && { style }) };
}

function toQuestion(value: unknown): Question | null {
  if (!isRecord(value)) return null;
  const conv = str(value['conv']);
  const questionId = str(value['questionId']);
  if (!conv || !questionId) return null;
  const raw = Array.isArray(value['options']) ? value['options'] : [];
  const options = raw.map(toOption).filter((option): option is QuestionOption => option !== null);
  const title = str(value['title']);
  const expiresAt = num(value['expiresAt']);
  return {
    conv,
    questionId,
    question: str(value['question']) ?? '',
    options,
    ...(title !== null && { title }),
    ...(value['multi'] === true && { multi: true }),
    ...(expiresAt !== null && { expiresAt }),
  };
}

function toApproval(value: unknown): Approval | null {
  if (!isRecord(value)) return null;
  const conv = str(value['conv']);
  const approvalId = str(value['approvalId']);
  if (!conv || !approvalId) return null;
  const raw = Array.isArray(value['decisions']) ? value['decisions'] : [];
  const decisions = raw.filter(
    (d): d is ApprovalDecision => d === 'allow' || d === 'deny' || d === 'allow_always',
  );
  const description = str(value['description']);
  const command = str(value['command']);
  const expiresAt = num(value['expiresAt']);
  return {
    conv,
    approvalId,
    title: str(value['title']) ?? 'Approval',
    decisions: decisions.length > 0 ? decisions : ['allow', 'deny'],
    ...(description !== null && { description }),
    ...(command !== null && { command }),
    ...(expiresAt !== null && { expiresAt }),
  };
}

function toFileMeta(value: unknown): FileMeta | null {
  if (!isRecord(value)) return null;
  const name = str(value['name']);
  if (!name) return null;
  return { name, mime: str(value['mime']) ?? 'application/octet-stream', size: num(value['size']) ?? 0 };
}

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

// Every store change rebuilds every row, and entries are replaced rather than changed, so each is read once.
const previews = new WeakMap<ChatEntry, string>();

function previewOf(entry: ChatEntry): string {
  const cached = previews.get(entry);
  if (cached !== undefined) return cached;
  const raw = entry.kind === 'file' ? (entry.text || (entry.file?.name ?? 'File')) : entry.text || (entry.attachments?.[0]?.name ?? '');
  // The chat renders agent markdown, so the list shows the words it reads as, without the markup.
  const text = entry.format === 'markdown' && entry.role !== 'user' ? plainText(lexer(raw), ' ') : raw;
  const preview = text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
  previews.set(entry, preview);
  return preview;
}

// Block tokens join with `gap`; inline tokens inside them run together.
function plainText(tokens: Token[], gap: string): string {
  return tokens.map(plainToken).join(gap);
}

function plainToken(token: Token): string {
  switch (token.type) {
    case 'space':
    case 'hr':
    case 'br':
      return ' ';
    case 'html':
    case 'checkbox':
    case 'def':
      return '';
    case 'code':
    case 'codespan':
    case 'escape':
    case 'image':
      return token.text;
    case 'blockquote':
    case 'list_item':
      return plainText(token.tokens ?? [], ' ');
    case 'list':
      return plainText(token.items, ' ');
    case 'table':
      return [...token.header, ...token.rows.flat()].map((cell) => plainText(cell.tokens, '')).join(' ');
  }
  const rest = token as Tokens.Generic;
  if (rest.tokens) return plainText(rest.tokens, '');
  return typeof rest.text === 'string' ? rest.text : '';
}

function emptyConversation(id: string): ConversationState {
  return { id, messages: [], activity: null, questions: [], approvals: [], notices: [], hasMore: false, loading: false, requested: false };
}

function expired(expiresAt: number | undefined, now: number): boolean {
  return expiresAt !== undefined && expiresAt <= now;
}

// An older bridge sent a runtime's echo copy of an agent message as the phone's own; those cached rows go on load.
const ECHO_MARK = ':echo:';

// A send the app was closed on may or may not have reached the bridge, so it shows as failed until history says.
function unconfirmed(entry: ChatEntry): ChatEntry {
  if (!entry.local || entry.local.failure) return entry;
  return { ...entry, local: { packetId: null, failure: UNCONFIRMED } };
}

// What a history row adds to an entry the phone already holds: the send is confirmed, the rest stays.
function confirm(existing: ChatEntry, message: ChatMessage): ChatEntry {
  const { local: _local, ...kept } = existing;
  return { ...kept, text: existing.edited ? existing.text : message.text };
}

// Receiving side of sync: every bridge packet lands here and the screens read it back.
export class WizzleStore {
  private readonly link: StoreLink;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly convs = new Map<string, ConversationState>();
  private readonly sent = new Map<string, PendingSend>();
  private readonly questionHome = new Map<string, string>();
  private readonly topicRequests = new Map<string, TopicPending>();
  private readonly listeners = new Set<() => void>();
  private agents: Agent[] = [];
  private catalog: Conversation[] = [];
  private templates: TemplateInfo[] = [];
  private templatesRequested = false;
  private create: CreateState | null = null;
  private hello: BridgeHello | null = null;
  private notices: Notice[] = [];
  private snapshot: StoreSnapshot | null = null;
  private readonly detach: () => void;
  private readonly cache: StoreCache | null;
  private readonly files: FileStore | null;
  private readonly historyBefore = new Map<string, string | undefined>();
  private readonly elements = new Map<string, StoredElement>();
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
    this.detach = opts.link.onPacket((packet) => this.receive(packet));
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  readonly getSnapshot = (): StoreSnapshot => {
    if (!this.snapshot) this.snapshot = this.compute();
    return this.snapshot;
  };

  // Stable until that element is replaced, so a chat row re-renders only when its element changes.
  readonly element = (agentId: string, id: string): StoredElement | undefined => this.elements.get(elementKey(agentId, id));

  // Stable per conversation object so untouched screens do not re-render.
  readonly conversation = (conv: string): ConversationState => {
    const existing = this.convs.get(conv);
    if (existing) return existing;
    const fresh = emptyConversation(conv);
    this.convs.set(conv, fresh);
    return fresh;
  };

  get capabilities(): Capabilities | null {
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

  // Copies a picked file into this phone's files folder so a send, or a later retry, can read it.
  async attach(conv: string, picked: FileMeta & { uri: string }): Promise<Attachment | null> {
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
    this.reset();
    this.pairingId = pairingId;
    if (!pairingId || !this.cache) return;
    const cached = this.cache.load(pairingId);
    if (!cached) return;
    const now = this.now();
    this.hello = cached.hello;
    this.agents = cached.agents;
    this.catalog = cached.catalog;
    for (const stored of cached.elements) this.elements.set(elementKey(stored.agentId, stored.element.id), stored);
    for (const [conv, data] of cached.conversations) {
      const questions = data.questions.filter((open) => !expired(open.question.expiresAt, now));
      const approvals = data.approvals.filter((open) => !expired(open.approval.expiresAt, now));
      for (const open of questions) this.questionHome.set(open.question.questionId, conv);
      for (const open of approvals) this.questionHome.set(open.approval.approvalId, conv);
      const messages = data.messages.filter((entry) => !entry.msgId.includes(ECHO_MARK)).map(unconfirmed);
      this.convs.set(conv, { ...emptyConversation(conv), messages, questions, approvals });
    }
    this.changed();
  }

  // A pairing the phone removed takes its cached rows and saved files with it.
  forgetPairing(pairingId: string): void {
    this.cache?.forgetPairing(pairingId);
    this.files?.forgetPairing(pairingId);
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

  // Once per connection: the hello that advertises the capability asks for the list.
  loadTemplates(): void {
    if (this.templatesRequested || !this.hello?.capabilities.templates) return;
    const packetId = this.link.send({ t: 'templates' });
    if (!packetId) return;
    this.templatesRequested = true;
    this.track(packetId, { t: 'templates' });
  }

  // One create at a time: a second tap while the host is working is refused, not queued.
  createAgent(request: CreateRequest): CreateState | null {
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
    });
    this.create = packetId
      ? { name, packetId, state: 'sending', startedAt }
      : { name, packetId: null, state: 'failed', error: OFFLINE, startedAt };
    this.changed();
    return this.create;
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
    if (conv === undefined) {
      this.notices = this.notices.filter((notice) => notice.id !== id);
      this.changed();
      return;
    }
    const state = this.conversation(conv);
    this.patch(conv, { notices: state.notices.filter((notice) => notice.id !== id) });
  }

  reset(): void {
    for (const pending of this.topicRequests.values()) pending.reject(OFFLINE);
    this.topicRequests.clear();
    this.convs.clear();
    this.sent.clear();
    this.questionHome.clear();
    this.historyBefore.clear();
    this.elements.clear();
    this.agents = [];
    this.catalog = [];
    this.templates = [];
    this.templatesRequested = false;
    this.create = null;
    this.hello = null;
    this.notices = [];
    this.changed();
  }

  destroy(): void {
    this.detach();
    this.listeners.clear();
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
      if (!bytes) return this.fail(conv, msgId, { code: 'file_missing', message: `${file.name} is no longer on this phone.` });
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
  private trySend(message: PhoneMessage, body?: Uint8Array): string | null {
    try {
      return this.link.send(message, body);
    } catch {
      return null;
    }
  }

  private fail(conv: string, msgId: string, failure: SendFailure): void {
    this.edit(conv, msgId, { local: { packetId: null, failure } });
  }

  private ask(message: PhoneMessage, make: (settle: Settle) => TopicPending): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const packetId = this.link.send(message);
      if (!packetId) {
        reject(OFFLINE);
        return;
      }
      this.topicRequests.set(packetId, make({ resolve, reject }));
    });
  }

  private settleTopics(match: (pending: TopicPending) => boolean, conv: string): void {
    for (const [packetId, pending] of [...this.topicRequests]) {
      if (!match(pending)) continue;
      this.topicRequests.delete(packetId);
      pending.resolve(conv);
    }
  }

  // Everything the phone cached for a conversation the catalog no longer lists.
  private forget(conv: string): void {
    this.convs.delete(conv);
    this.historyBefore.delete(conv);
    for (const [questionId, home] of [...this.questionHome]) {
      if (home === conv) this.questionHome.delete(questionId);
    }
    if (!this.pairingId) return;
    this.cache?.forgetConversation(this.pairingId, conv);
    this.files?.forgetConversation(this.pairingId, conv);
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
      if (this.pairingId) this.cache?.saveElements(this.pairingId, [...this.elements.values()]);
    }
    return { element: { agentId, id: element.id } };
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
    const h = packet.header;
    const now = this.now();
    switch (h.t) {
      case 'hello': {
        this.hello = {
          t: 'hello',
          protocol: num(h['protocol']) ?? 1,
          runtime: str(h['runtime']) ?? 'unknown',
          bridgeVersion: str(h['bridgeVersion']) ?? '0',
          host: str(h['host']) ?? '',
          capabilities: toCapabilities(h['capabilities']),
          ...(str(h['runtimeVersion']) !== null && { runtimeVersion: str(h['runtimeVersion']) as string }),
        };
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
        this.settleTopics(
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
        for (const conv of this.catalog) if (conv.agentId === agentId) this.forget(conv.id);
        this.catalog = this.catalog.filter((c) => c.agentId !== agentId);
        this.settleTopics((pending) => pending.kind === 'deleteAgent' && pending.agentId === agentId, agentId);
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
        this.persistMeta();
        this.changed();
        return;
      }
      case 'conversation': {
        const conversation = toConversation(h['conversation']);
        if (!conversation) return void this.drop();
        const at = this.catalog.findIndex((c) => c.id === conversation.id);
        this.catalog = at === -1 ? [...this.catalog, conversation] : this.catalog.map((c) => (c.id === conversation.id ? conversation : c));
        this.settleTopics(
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
        this.settleTopics((pending) => pending.kind === 'delete' && pending.conv === conv, conv);
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
        if (this.questionHome.has(msgId)) return;
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
        this.questionHome.set(question.questionId, question.conv);
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
        const conv = this.questionHome.get(questionId);
        this.questionHome.delete(questionId);
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
        this.questionHome.set(approval.approvalId, approval.conv);
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
        const conv = this.questionHome.get(approvalId);
        this.questionHome.delete(approvalId);
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
      case 'error': {
        const code = str(h['code']) ?? 'error';
        const message = str(h['message']) ?? 'The bridge rejected that.';
        const ref = str(h['ref']);
        const topic = ref ? this.topicRequests.get(ref) : undefined;
        if (ref && topic) {
          this.topicRequests.delete(ref);
          topic.reject({ code, message });
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
        this.note(pending?.conv, code, message);
        return;
      }
      default:
        return;
    }
  }

  // A known msgId confirms what the phone holds; an unknown one is new, unless it is an echo
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

  private row(conv: Conversation): ConversationRow {
    const state = this.convs.get(conv.id);
    const last = state?.messages[state.messages.length - 1];
    const lastAt = Math.max(conv.lastAt ?? 0, last?.at ?? 0);
    return {
      ...conv,
      ...(lastAt > 0 && { lastAt }),
      agent: this.agents.find((a) => a.id === conv.agentId) ?? null,
      preview: last ? previewOf(last) : '',
      activity: state?.activity ?? null,
      questions: (state?.questions.length ?? 0) + (state?.approvals.length ?? 0),
      topic: conv.topic === true,
    };
  }

  // The default conversation leads its agent, topics follow it newest first, System sits last.
  private group(rows: ConversationRow[]): AgentGroup[] {
    const byAgent = new Map<string, ConversationRow[]>();
    for (const row of rows) {
      const list = byAgent.get(row.agentId);
      if (list) list.push(row);
      else byAgent.set(row.agentId, [row]);
    }
    const groups: AgentGroup[] = [];
    for (const [agentId, list] of byAgent) {
      const agent = this.agents.find((a) => a.id === agentId) ?? { id: agentId, name: list[0]?.title ?? agentId, status: 'idle' as AgentStatus };
      groups.push({ agent, conversations: list.slice().sort((a, b) => Number(a.topic) - Number(b.topic) || (b.lastAt ?? 0) - (a.lastAt ?? 0)) });
    }
    const newest = (group: AgentGroup): number => group.conversations.reduce((at, conv) => Math.max(at, conv.lastAt ?? 0), 0);
    const isSystem = (group: AgentGroup): boolean => group.conversations.some((conv) => conv.id === SYSTEM_CONV);
    return groups.sort((a, b) => Number(isSystem(a)) - Number(isSystem(b)) || newest(b) - newest(a));
  }

  private compute(): StoreSnapshot {
    const conversations = this.catalog.map((conv) => this.row(conv)).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    return {
      hello: this.hello,
      capabilities: this.hello?.capabilities ?? null,
      agents: this.agents,
      conversations,
      agentGroups: this.group(conversations),
      templates: this.templates,
      create: this.create,
      notices: this.notices,
      elements: [...this.elements.values()].sort((a, b) => b.receivedAt - a.receivedAt),
    };
  }

  private changed(): void {
    this.snapshot = this.compute();
    for (const listener of this.listeners) listener();
  }
}
