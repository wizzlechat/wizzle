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
  FileMeta,
  Question,
  QuestionOption,
  Secret,
  SecretInjection,
  SecretType,
  TemplateInfo,
  TextFormat,
} from '../protocol/index.ts';
import type { AgentProfile, BridgeHello } from './types.ts';
import { ACCESSORIES, EYE_STYLES, LIST_STYLES, MAX_NAME_CHARS } from './validate.ts';

// Readers for what the bridge sends. Anything missing or of the wrong type is dropped or defaulted, never thrown.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function toRole(value: unknown): ChatRole {
  return value === 'user' || value === 'system' ? value : 'agent';
}

export function toFormat(value: unknown): TextFormat {
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

// Every capability once; a new one in the protocol type fails to compile until it is listed here.
const CAPABILITY_FLAGS: Record<keyof Capabilities, true> = {
  streaming: true,
  questions: true,
  approvals: true,
  tasks: true,
  files: true,
  history: true,
  clearSession: true,
  abort: true,
  createAgent: true,
  topics: true,
  templates: true,
  lifecycle: true,
  deleteAgent: true,
  keys: true,
};

export const CAPABILITY_KEYS = Object.keys(CAPABILITY_FLAGS) as (keyof Capabilities)[];

export function toCapabilities(value: unknown): Capabilities {
  const v = isRecord(value) ? value : {};
  const capabilities = {} as Record<keyof Capabilities, boolean>;
  for (const key of CAPABILITY_KEYS) capabilities[key] = v[key] === true;
  return capabilities;
}

export function toHello(h: Record<string, unknown>): BridgeHello {
  const runtimeVersion = str(h['runtimeVersion']);
  return {
    t: 'hello',
    protocol: num(h['protocol']) ?? 1,
    runtime: str(h['runtime']) ?? 'unknown',
    bridgeVersion: str(h['bridgeVersion']) ?? '0',
    host: str(h['host']) ?? '',
    capabilities: toCapabilities(h['capabilities']),
    ...(runtimeVersion !== null && { runtimeVersion }),
  };
}

export function toTemplateInfo(value: unknown): TemplateInfo | null {
  if (!isRecord(value)) return null;
  const ref = str(value['ref']);
  const name = str(value['name']);
  if (!ref || !name) return null;
  const agentName = str(value['agentName']);
  const description = str(value['description']);
  const version = str(value['version']);
  const tasks = num(value['tasks']);
  const mcpServers = num(value['mcpServers']);
  const skills = num(value['skills']);
  const category = str(value['category']);
  return {
    ref,
    name,
    ...(tasks !== null && { tasks }),
    ...(mcpServers !== null && { mcpServers }),
    ...(skills !== null && { skills }),
    ...(agentName !== null && { agentName }),
    ...(description !== null && { description }),
    ...(version !== null && { version }),
    ...(category !== null && { category, downloaded: value['downloaded'] === true }),
  };
}

function toInjection(value: unknown): SecretInjection | undefined {
  if (!isRecord(value)) return undefined;
  const headerName = str(value['headerName']);
  const valueFormat = str(value['valueFormat']);
  if (headerName) return { headerName, ...(valueFormat !== null && { valueFormat }) };
  const paramName = str(value['paramName']);
  const paramFormat = str(value['paramFormat']);
  if (paramName) return { paramName, ...(paramFormat !== null && { paramFormat }) };
  const pathTemplate = str(value['pathTemplate']);
  if (pathTemplate) return { pathTemplate };
  const pathRegex = str(value['pathRegex']);
  const pathReplacement = str(value['pathReplacement']);
  if (pathRegex && pathReplacement) return { pathRegex, pathReplacement };
  return undefined;
}

export function toSecret(value: unknown): Secret | null {
  if (!isRecord(value)) return null;
  const id = str(value['id']);
  const name = str(value['name']);
  const host = str(value['host']);
  const type = (['generic', 'anthropic', 'openai'] as SecretType[]).find((one) => one === value['type']);
  if (!id || name === null || host === null || !type) return null;
  const path = str(value['path']);
  const injection = toInjection(value['injection']);
  const createdAt = num(value['createdAt']);
  return {
    id,
    name,
    type,
    host,
    ...(path !== null && { path }),
    ...(injection !== undefined && { injection }),
    ...(createdAt !== null && { createdAt }),
  };
}

export function toAgent(value: unknown): Agent | null {
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

// Anything unknown or out of range is dropped, so a row another build wrote never breaks a face.
export function toProfile(value: unknown): AgentProfile | null {
  if (!isRecord(value)) return null;
  const nickname = str(value['nickname'])?.trim().slice(0, MAX_NAME_CHARS) ?? '';
  const hue = num(value['hue']);
  const eyes = EYE_STYLES.find((one) => one === value['eyes']);
  const accessory = ACCESSORIES.find((one) => one === value['accessory']);
  const listStyle = LIST_STYLES.find((one) => one === value['listStyle']);
  const profile: AgentProfile = {
    ...(nickname.length > 0 && { nickname }),
    ...(hue !== null && hue >= 0 && hue < 360 && { hue }),
    ...(eyes !== undefined && { eyes }),
    ...(accessory !== undefined && { accessory }),
    ...(listStyle !== undefined && { listStyle }),
  };
  return Object.keys(profile).length > 0 ? profile : null;
}

export function toConversation(value: unknown): Conversation | null {
  if (!isRecord(value)) return null;
  const id = str(value['id']);
  const agentId = str(value['agentId']);
  if (!id || !agentId) return null;
  const lastAt = num(value['lastAt']);
  const createdAt = num(value['createdAt']);
  const lastAgentAt = num(value['lastAgentAt']);
  return {
    id,
    agentId,
    title: str(value['title']) ?? id,
    ...(lastAt !== null && { lastAt }),
    ...(value['topic'] === true && { topic: true }),
    ...(createdAt !== null && { createdAt }),
    ...(lastAgentAt !== null && { lastAgentAt }),
  };
}

export function toChatMessage(value: unknown, now: number): ChatMessage | null {
  if (!isRecord(value)) return null;
  const conv = str(value['conv']);
  const msgId = str(value['msgId']);
  const text = str(value['text']);
  if (!conv || !msgId || text === null) return null;
  return { conv, msgId, role: toRole(value['role']), text, format: toFormat(value['format']), at: num(value['at']) ?? now };
}

export function toActivity(value: unknown): Activity | null {
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

export function toQuestion(value: unknown): Question | null {
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

export function toApproval(value: unknown): Approval | null {
  if (!isRecord(value)) return null;
  const conv = str(value['conv']);
  const approvalId = str(value['approvalId']);
  if (!conv || !approvalId) return null;
  const raw = Array.isArray(value['decisions']) ? value['decisions'] : [];
  const decisions = raw.filter((d): d is ApprovalDecision => d === 'allow' || d === 'deny' || d === 'allow_always');
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

export function toFileMeta(value: unknown): FileMeta | null {
  if (!isRecord(value)) return null;
  const name = str(value['name']);
  if (!name) return null;
  return { name, mime: str(value['mime']) ?? 'application/octet-stream', size: num(value['size']) ?? 0 };
}
