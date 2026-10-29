import { SYSTEM_CONV, store } from '../store/index.ts';
import type { ConversationRow } from '../store/types.ts';

// A chat link carries its conversation id encoded; one that does not decode is used as it came.
export function decodeId(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function chatTitle(row: ConversationRow | undefined, conv: string): string {
  if (!row) return conv === SYSTEM_CONV ? 'System' : conv;
  return row.topic ? `${row.agent?.name ?? row.title} / ${row.title}` : row.title;
}

// The links carry the title, so the root layout can show it on the screen's first frame without the store.
export function chatHref(conv: string): string {
  const row = store.getSnapshot().conversations.find((one) => one.id === conv);
  return `/chat/${encodeURIComponent(conv)}?title=${encodeURIComponent(chatTitle(row, conv))}`;
}

export function profileHref(agentId: string): string {
  const agent = store.getSnapshot().agents.find((one) => one.id === agentId);
  return `/profile?agent=${encodeURIComponent(agentId)}&title=${encodeURIComponent(agent?.name ?? 'Profile')}`;
}
