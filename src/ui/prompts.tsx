import { useRouter } from 'expo-router';
import type { Capabilities } from '../protocol/index.ts';
import { store } from '../store/index.ts';
import type { AgentProfile, ConversationRow } from '../store/types.ts';
import { AgentMenu, AgentPrompts, type AgentPrompt } from './agent-actions.tsx';
import { Cards, ChatPlus, Pencil, Trash } from './icons.tsx';
import { ListRow } from './list.tsx';
import { chatHref } from './titles.ts';
import { ClearChat, DeleteTopic, RenameTopic, TitlePrompt } from './topics.tsx';

// Which overlay the chat has up, if any.
export type Prompt = 'menu' | 'new' | 'rename' | 'delete' | 'clear' | 'attach' | { agent: AgentPrompt } | null;

// New topic sits here as well, so an agent with one conversation still has a way to make its first.
export function TopicPrompts({
  row,
  look,
  prompt,
  setPrompt,
  canTopic,
  canClear,
  capabilities,
}: {
  row: ConversationRow;
  look: AgentProfile | undefined;
  prompt: Prompt;
  setPrompt: (next: Prompt) => void;
  canTopic: boolean;
  canClear: boolean;
  capabilities: Capabilities | null;
}) {
  const router = useRouter();
  const agentName = row.agent?.name ?? row.title;
  const close = () => setPrompt(null);
  if (typeof prompt === 'object' && prompt !== null) {
    return row.agent ? <AgentPrompts agent={row.agent} prompt={prompt.agent} onClose={close} /> : null;
  }
  if (prompt === 'menu') {
    return (
      <AgentMenu
        title={row.title}
        seed={row.agentId}
        agent={row.agent}
        look={look}
        capabilities={capabilities}
        onPick={(next) => setPrompt({ agent: next })}
        onClose={close}
      >
        <ListRow
          icon={Cards}
          label="Elements"
          onPress={() => {
            close();
            router.push(`/elements?agent=${encodeURIComponent(row.agentId)}`);
          }}
        />
        {canTopic ? <ListRow icon={ChatPlus} label="New topic" onPress={() => setPrompt('new')} /> : null}
        {canTopic && row.topic ? <ListRow icon={Pencil} label="Rename topic" onPress={() => setPrompt('rename')} /> : null}
        {canClear ? <ListRow icon={Trash} label="Clear chat" danger onPress={() => setPrompt('clear')} /> : null}
        {canTopic && row.topic ? <ListRow icon={Trash} label="Delete topic" danger onPress={() => setPrompt('delete')} /> : null}
      </AgentMenu>
    );
  }
  if (prompt === 'new') {
    return (
      <TitlePrompt
        heading={`New topic for ${agentName}`}
        note="Its own session, so this agent keeps the topic apart from its other work."
        action="Create"
        submit={(title) => store.createTopic(row.agentId, title)}
        onClose={close}
        onDone={(conv) => {
          close();
          router.push(chatHref(conv));
        }}
      />
    );
  }
  if (prompt === 'rename') return <RenameTopic row={row} onClose={close} />;
  if (prompt === 'delete') return <DeleteTopic row={row} onClose={close} />;
  if (prompt === 'clear') return <ClearChat row={row} onClose={close} />;
  return null;
}
