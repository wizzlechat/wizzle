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
  const snapshot = store.getSnapshot();
  const room = snapshot.rooms.find((one) => one.id === conv);
  const title = room ? room.title : chatTitle(snapshot.conversations.find((one) => one.id === conv), conv);
  return `/chat/${encodeURIComponent(conv)}?title=${encodeURIComponent(title)}`;
}

export function profileHref(agentId: string): string {
  const agent = store.getSnapshot().agents.find((one) => one.id === agentId);
  return `/profile?agent=${encodeURIComponent(agentId)}&title=${encodeURIComponent(agent?.name ?? 'Profile')}`;
}
