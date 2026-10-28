import { SYSTEM_CONV } from '../store/store.ts';
import type { StoreSnapshot } from '../store/types.ts';

// A chat link carries its conversation id encoded; one that does not decode is used as it came.
export function decodeId(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// The root layout reads these too, so a screen's first frame shows its title and not its route name.
export function chatTitle(snapshot: StoreSnapshot, conv: string): string {
  const row = snapshot.conversations.find((item) => item.id === conv);
  if (!row) return conv === SYSTEM_CONV ? 'System' : conv;
  return row.topic ? `${row.agent?.name ?? row.title} / ${row.title}` : row.title;
}

export function profileTitle(snapshot: StoreSnapshot, agentId: string): string {
  return snapshot.agents.find((agent) => agent.id === agentId)?.name ?? 'Profile';
}
