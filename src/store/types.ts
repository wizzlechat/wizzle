import type {
  Activity,
  Agent,
  Approval,
  ApprovalDecision,
  BridgeMessage,
  Capabilities,
  ChatRole,
  Conversation,
  FileMeta,
  Question,
  TemplateInfo,
  TextFormat,
  UiElement,
} from '../protocol/index.ts';

export type BridgeHello = Extract<BridgeMessage, { t: 'hello' }>;

export type EntryKind = 'text' | 'card' | 'file';

export type SendFailure = { code: string; message: string };

// Present on messages this phone created, so the UI can mark and retry them.
export type LocalSend = { packetId: string | null; failure?: SendFailure };

// A file the bridge sent; uri is set once its bytes are saved, as the file store's own reference.
export type ReceivedFile = FileMeta & { uri?: string };

// A file this phone sends, already copied into the app's files folder; uri as above.
export type Attachment = FileMeta & { uri: string };

// Elements are keyed by the agent that sent them and their own id; a newer file with the same id replaces one.
export type ElementRef = { agentId: string; id: string };
export type StoredElement = { agentId: string; conv: string; receivedAt: number; element: UiElement };

// One row of a transcript, whichever packet produced it.
export type ChatEntry = {
  conv: string;
  msgId: string;
  role: ChatRole;
  text: string;
  format: TextFormat;
  at: number;
  kind: EntryKind;
  card?: unknown;
  file?: ReceivedFile;
  element?: ElementRef;
  elementError?: string;
  attachments?: Attachment[];
  edited?: boolean;
  resolution?: string;
  reactions?: string[];
  local?: LocalSend;
};

export type Notice = { id: string; code: string; message: string };

export type OpenQuestion = { question: Question; answered?: string | string[] };
export type OpenApproval = { approval: Approval; decided?: ApprovalDecision };

export type ConversationState = {
  id: string;
  messages: ChatEntry[];
  activity: Activity | null;
  questions: OpenQuestion[];
  approvals: OpenApproval[];
  notices: Notice[];
  hasMore: boolean;
  loading: boolean;
  requested: boolean;
};

export type ConversationRow = Conversation & {
  agent: Agent | null;
  preview: string;
  activity: Activity | null;
  questions: number;
  topic: boolean;
};

// One create_agent, from the tap until its conversation exists or the host refuses.
export type CreateState = {
  name: string;
  packetId: string | null;
  state: 'sending' | 'created' | 'failed';
  error?: SendFailure;
  agentId?: string;
  conv?: string;
  startedAt: number;
};

// One agent with its default conversation and its topics, in list order.
export type AgentGroup = { agent: Agent; conversations: ConversationRow[] };

export type StoreSnapshot = {
  hello: BridgeHello | null;
  capabilities: Capabilities | null;
  agents: Agent[];
  conversations: ConversationRow[];
  agentGroups: AgentGroup[];
  templates: TemplateInfo[];
  create: CreateState | null;
  notices: Notice[];
  elements: StoredElement[];
};
