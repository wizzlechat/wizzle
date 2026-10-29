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
  Secret,
  TemplateInfo,
  TextFormat,
  UiElement,
} from '../protocol/index.ts';

export type BridgeHello = Extract<BridgeMessage, { t: 'hello' }>;

export type EntryKind = 'text' | 'card' | 'file';

export type SendFailure = { code: string; message: string };

// Present on messages wizzle created, so the UI can mark and retry them.
export type LocalSend = { packetId: string | null; failure?: SendFailure };

// A file the bridge sent; uri is set once its bytes are saved, as the file store's own reference.
export type ReceivedFile = FileMeta & { uri?: string };

// A file wizzle sends, already copied into the app's files folder; uri as above.
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

export type EyeStyle = 'pill' | 'dot' | 'wide' | 'visor';
export type Accessory = 'antenna' | 'sprout' | 'bow' | 'crown' | 'halo';
// Compact puts a small face beside the name; large puts a bigger one beside the name and the last message.
export type ListStyle = 'compact' | 'large';

// wizzle's own nickname and look for an agent; the host never sees either.
export type AgentProfile = { nickname?: string; hue?: number; eyes?: EyeStyle; accessory?: Accessory; listStyle?: ListStyle };

// hostName is set when a nickname shows in place of the name the host gave the agent.
export type AgentView = Agent & { hostName?: string };

export type ConversationRow = Conversation & {
  agent: AgentView | null;
  preview: string;
  activity: Activity | null;
  questions: number;
  unread: number;
  topic: boolean;
  // The newest agent message wizzle holds.
  repliedAt?: number;
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
export type AgentGroup = { agent: AgentView; conversations: ConversationRow[] };

export type StoreSnapshot = {
  hello: BridgeHello | null;
  capabilities: Capabilities | null;
  agents: AgentView[];
  profiles: Record<string, AgentProfile>;
  conversations: ConversationRow[];
  agentGroups: AgentGroup[];
  templates: TemplateInfo[];
  // The vault as the bridge last listed it; null until it has.
  secrets: Secret[] | null;
  agentSecrets: Record<string, string[]>;
  keysError: SendFailure | null;
  // The key wizzle created last; seq rises with each, so a screen that sent wizzle to add one can pick it.
  newestSecret: { id: string; seq: number } | null;
  create: CreateState | null;
  notices: Notice[];
  elements: StoredElement[];
};
