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
  TextFormat,
} from '../protocol/index.ts';

export type BridgeHello = Extract<BridgeMessage, { t: 'hello' }>;

export type EntryKind = 'text' | 'card' | 'file';

export type SendFailure = { code: string; message: string };

// Present on messages this phone created, so the UI can mark and retry them.
export type LocalSend = { packetId: string | null; failure?: SendFailure };

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
  file?: FileMeta;
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
};

export type StoreSnapshot = {
  hello: BridgeHello | null;
  capabilities: Capabilities | null;
  agents: Agent[];
  conversations: ConversationRow[];
  notices: Notice[];
};
