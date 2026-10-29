import type { Agent, Conversation } from '../protocol/index.ts';
import type { AgentProfile, BridgeHello, ChatEntry, OpenApproval, OpenQuestion, StoredElement } from './types.ts';

// Messages kept per conversation, newest first to go.
export const CACHE_MESSAGES = 2000;

export type CachedMeta = { hello: BridgeHello | null; agents: Agent[]; catalog: Conversation[] };

export type CachedConversation = { messages: ChatEntry[]; questions: OpenQuestion[]; approvals: OpenApproval[] };

// The newest agent message time read per conversation; floor stands for any conversation without one.
export type ReadMarks = { floor: number; marks: Record<string, number> };

export type CachedPairing = CachedMeta & {
  conversations: Map<string, CachedConversation>;
  elements: StoredElement[];
  read: ReadMarks | null;
  profiles: Record<string, unknown>;
};

// What the store keeps on disk per pairing. Notices and activity never go in.
export interface StoreCache {
  load(pairingId: string): CachedPairing | null;
  saveMeta(pairingId: string, meta: CachedMeta): void;
  saveConversation(pairingId: string, conv: string, data: CachedConversation): void;
  // wizzle is the only place elements are kept.
  saveElements(pairingId: string, elements: StoredElement[]): void;
  saveRead(pairingId: string, read: ReadMarks): void;
  saveProfiles(pairingId: string, profiles: Record<string, AgentProfile>): void;
  forgetConversation(pairingId: string, conv: string): void;
  forgetPairing(pairingId: string): void;
  flush(): void;
}

// Keeps a load from carrying more than the cap, whatever an older build wrote.
export function trimMessages(messages: ChatEntry[]): ChatEntry[] {
  return messages.length > CACHE_MESSAGES ? messages.slice(messages.length - CACHE_MESSAGES) : messages;
}
