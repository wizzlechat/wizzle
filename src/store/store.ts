import type {
  Activity,
  ActivityState,
  Agent,
  AgentStatus,
  Approval,
  ApprovalDecision,
  Capabilities,
  ChatMessage,
  ChatRole,
  Conversation,
  DecodedPacket,
  FileMeta,
  PhoneMessage,
  Question,
  QuestionOption,
  SessionEvent,
  TextFormat,
} from '../protocol/index.ts';
import type {
  BridgeHello,
  ChatEntry,
  ConversationRow,
  ConversationState,
  Notice,
  OpenApproval,
  OpenQuestion,
  StoreSnapshot,
} from './types.ts';

export const SYSTEM_CONV = 'wizzle:system';

const HISTORY_PAGE = 50;
const MAX_PENDING = 128;
const PREVIEW_CHARS = 140;

export type PacketListener = (packet: DecodedPacket) => void;

// What the store needs from the relay connection. The tests supply their own.
export type StoreLink = {
  send(message: PhoneMessage, body?: Uint8Array): string | null;
  onPacket(listener: PacketListener): () => void;
};

export type StoreOptions = { link: StoreLink; newId: () => string; now?: () => number };

type PendingSend = { t: string; conv?: string; msgId?: string };

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
  const known: AgentStatus[] = ['idle', 'running', 'waiting', 'offline', 'error'];
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
  return { id, agentId, title: str(value['title']) ?? id, ...(lastAt !== null && { lastAt }) };
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

function previewOf(entry: ChatEntry): string {
  const text = entry.kind === 'file' ? (entry.text || (entry.file?.name ?? 'File')) : entry.text;
  return text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_CHARS);
}

function emptyConversation(id: string): ConversationState {
  return { id, messages: [], activity: null, questions: [], approvals: [], notices: [], hasMore: false, loading: false, requested: false };
}

// Receiving side of sync: every bridge packet lands here and the screens read it back.
export class WizzleStore {
  private readonly link: StoreLink;
  private readonly newId: () => string;
  private readonly now: () => number;
  private readonly convs = new Map<string, ConversationState>();
  private readonly sent = new Map<string, PendingSend>();
  private readonly questionHome = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private agents: Agent[] = [];
  private catalog: Conversation[] = [];
  private hello: BridgeHello | null = null;
  private notices: Notice[] = [];
  private snapshot: StoreSnapshot | null = null;
  private readonly detach: () => void;
  dropped = 0;

  constructor(opts: StoreOptions) {
    this.link = opts.link;
    this.newId = opts.newId;
    this.now = opts.now ?? Date.now;
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
  send(conv: string, text: string): string | null {
    const body = text.trim();
    if (body.length === 0) return null;
    const msgId = this.newId();
    const packetId = this.link.send({ t: 'send', conv, msgId, text: body });
    if (packetId) this.track(packetId, { t: 'send', conv, msgId });
    const entry: ChatEntry = {
      conv,
      msgId,
      role: 'user',
      text: body,
      format: 'text',
      at: this.now(),
      kind: 'text',
      local: packetId
        ? { packetId }
        : { packetId: null, failure: { code: 'offline', message: 'Not connected to the bridge yet.' } },
    };
    this.upsert(conv, entry);
    return msgId;
  }

  // Retry drops the failed echo and sends a fresh msgId, which the bridge treats as a new message.
  retry(conv: string, msgId: string): string | null {
    const entry = this.conversation(conv).messages.find((m) => m.msgId === msgId);
    if (!entry?.local) return null;
    this.discard(conv, msgId);
    return this.send(conv, entry.text);
  }

  discard(conv: string, msgId: string): void {
    const state = this.conversation(conv);
    const messages = state.messages.filter((m) => m.msgId !== msgId);
    if (messages.length === state.messages.length) return;
    this.patch(conv, { messages });
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
    this.convs.clear();
    this.sent.clear();
    this.questionHome.clear();
    this.agents = [];
    this.catalog = [];
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
    this.patch(conv, { loading: true, requested: true });
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
    this.convs.set(conv, { ...this.conversation(conv), ...change });
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
        this.changed();
        return;
      }
      case 'agents': {
        const raw = Array.isArray(h['agents']) ? h['agents'] : [];
        this.agents = raw.map(toAgent).filter((agent): agent is Agent => agent !== null);
        this.changed();
        return;
      }
      case 'agent': {
        const agent = toAgent(h['agent']);
        if (!agent) return void this.drop();
        const at = this.agents.findIndex((a) => a.id === agent.id);
        this.agents = at === -1 ? [...this.agents, agent] : this.agents.map((a) => (a.id === agent.id ? agent : a));
        this.changed();
        return;
      }
      case 'conversations': {
        const raw = Array.isArray(h['conversations']) ? h['conversations'] : [];
        this.catalog = raw.map(toConversation).filter((conv): conv is Conversation => conv !== null);
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
        this.upsert(conv, {
          conv,
          msgId,
          role: 'agent',
          text: str(h['caption']) ?? '',
          format: 'text',
          at: num(h['at']) ?? now,
          kind: 'file',
          file,
        });
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
        // A bridge that ignores `before` resends the same page, so a page with nothing new ends paging.
        this.patch(conv, { loading: false, requested: true, hasMore: h['hasMore'] === true && added > 0 });
        return;
      }
      case 'error': {
        const code = str(h['code']) ?? 'error';
        const message = str(h['message']) ?? 'The bridge rejected that.';
        const ref = str(h['ref']);
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

  // Older pages arrive with msgIds the phone has not seen, except its own echoed sends.
  private merge(conv: string, messages: ChatMessage[]): number {
    const state = this.conversation(conv);
    const known = new Set(state.messages.map((m) => m.msgId));
    const echoes = state.messages.filter((m) => m.local && m.role === 'user');
    let next = state.messages;
    let added = 0;
    for (const message of messages) {
      if (known.has(message.msgId)) continue;
      if (message.role === 'user' && echoes.some((echo) => echo.text === message.text)) continue;
      next = insert(next, this.entryOf(message));
      known.add(message.msgId);
      added += 1;
    }
    if (added > 0) this.patch(conv, { messages: next });
    return added;
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
    };
  }

  private compute(): StoreSnapshot {
    const conversations = this.catalog.map((conv) => this.row(conv)).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
    return {
      hello: this.hello,
      capabilities: this.hello?.capabilities ?? null,
      agents: this.agents,
      conversations,
      notices: this.notices,
    };
  }

  private changed(): void {
    this.snapshot = this.compute();
    for (const listener of this.listeners) listener();
  }
}
