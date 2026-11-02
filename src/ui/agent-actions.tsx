import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, Spinner, Text, XStack, YStack } from 'tamagui';
import type { Agent, Capabilities } from '../protocol/index.ts';
import { store } from '../store/index.ts';
import type { AgentProfile, SendFailure } from '../store/types.ts';
import { Field, Pill } from './controls.tsx';
import { Face } from './face.tsx';
import { Clock, Key, Pause, Play, Restart, Trash } from './icons.tsx';
import { ListRow } from './list.tsx';
import { profileHref } from './titles.ts';
import { ConfirmPrompt, Menu, Overlay } from './topics.tsx';

export type AgentPrompt = 'pause' | 'restart' | 'delete';

const MAX_RESTART_CHARS = 2000;

export function canManage(agent: Agent | null | undefined, capabilities: Capabilities | null): boolean {
  if (!agent || agent.id === 'system' || !capabilities) return false;
  return capabilities.lifecycle || capabilities.deleteAgent || capabilities.keys || capabilities.tasks;
}

export function tasksHref(agent: Agent): string {
  return `/tasks?agent=${encodeURIComponent(agent.id)}&title=${encodeURIComponent(`${agent.name} tasks`)}`;
}

// The menu both screens open on an agent: its profile, whatever the caller adds, then the host's actions.
export function AgentMenu({
  title,
  seed,
  agent,
  look,
  capabilities,
  onPick,
  onClose,
  children,
}: {
  title: string;
  seed: string;
  agent: Agent | null;
  look: AgentProfile | undefined;
  capabilities: Capabilities | null;
  onPick: (prompt: AgentPrompt) => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <Menu title={title} onClose={onClose}>
      <ListRow
        leading={<Face seed={seed} look={look} size={22} />}
        label="Profile"
        onPress={() => {
          onClose();
          router.push(profileHref(seed));
        }}
      />
      {children}
      {agent && canManage(agent, capabilities) ? (
        <AgentMenuItems
          agent={agent}
          capabilities={capabilities}
          onPick={onPick}
          onResumed={onClose}
          onKeys={() => {
            onClose();
            router.push(`/agent-keys?agent=${encodeURIComponent(agent.id)}`);
          }}
          onTasks={() => {
            onClose();
            router.push(tasksHref(agent));
          }}
        />
      ) : null}
    </Menu>
  );
}

// The agent half of a menu; resume runs in place since it is the one action with nothing to confirm.
export function AgentMenuItems({
  agent,
  capabilities,
  onPick,
  onResumed,
  onKeys,
  onTasks,
}: {
  agent: Agent;
  capabilities: Capabilities | null;
  onPick: (prompt: AgentPrompt) => void;
  onResumed: () => void;
  onKeys: () => void;
  onTasks: () => void;
}) {
  const paused = agent.status === 'paused';
  return (
    <>
      {capabilities?.tasks ? <ListRow icon={Clock} label="Tasks" onPress={onTasks} /> : null}
      {capabilities?.keys ? <ListRow icon={Key} label="Keys" onPress={onKeys} /> : null}
      {capabilities?.lifecycle ? (
        paused ? (
          <ResumeRow agent={agent} onDone={onResumed} />
        ) : (
          <ListRow icon={Pause} label={`Pause ${agent.name}`} onPress={() => onPick('pause')} />
        )
      ) : null}
      {capabilities?.lifecycle && !paused ? (
        <ListRow icon={Restart} label={`Restart ${agent.name}`} onPress={() => onPick('restart')} />
      ) : null}
      {capabilities?.deleteAgent ? (
        <ListRow icon={Trash} label={`Delete ${agent.name}`} danger onPress={() => onPick('delete')} />
      ) : null}
    </>
  );
}

function useResume(agent: Agent, onDone?: () => void): { busy: boolean; error: SendFailure | null; run: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendFailure | null>(null);

  function run(): void {
    if (busy) return;
    setBusy(true);
    setError(null);
    store.resumeAgent(agent.id).then(
      () => {
        setBusy(false);
        onDone?.();
      },
      (failure: SendFailure) => {
        setBusy(false);
        setError(failure);
      },
    );
  }

  return { busy, error, run };
}

function ResumeRow({ agent, onDone }: { agent: Agent; onDone: () => void }) {
  const { busy, error, run } = useResume(agent, onDone);
  return (
    <>
      <ListRow icon={Play} label={`Resume ${agent.name}`} busy={busy} onPress={run} />
      {error ? (
        <Text px="$4" py="$2" fontSize="$2" color="$red10">
          {error.message}
        </Text>
      ) : null}
    </>
  );
}

export function ResumeButton({ agent }: { agent: Agent }) {
  const { busy, error, run } = useResume(agent);
  return (
    <YStack gap="$1">
      <Button size="$2" theme="accent" disabled={busy} onPress={run}>
        {busy ? <Spinner size="small" /> : `Resume ${agent.name}`}
      </Button>
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error.message}
        </Text>
      ) : null}
    </YStack>
  );
}

export function AgentPrompts({ agent, prompt, onClose }: { agent: Agent; prompt: AgentPrompt; onClose: () => void }) {
  if (prompt === 'pause') {
    const running = agent.status === 'running';
    const body =
      `Nothing wakes ${agent.name} until you resume it. Messages from other channels and scheduled tasks wait and run on resume, ` +
      'and questions it is waiting on are cancelled.' +
      (running ? ` ${agent.name} is working now, so the turn is killed mid way; text it already delivered stays.` : '');
    return (
      <ConfirmPrompt
        heading={`Pause ${agent.name}?`}
        body={body}
        action="Pause"
        submit={() => store.pauseAgent(agent.id)}
        onClose={onClose}
        onDone={onClose}
      />
    );
  }
  if (prompt === 'restart') return <RestartPrompt agent={agent} onClose={onClose} />;
  return <DeletePrompt agent={agent} onClose={onClose} />;
}

function RestartPrompt({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendFailure | null>(null);

  function run(): void {
    if (busy) return;
    setBusy(true);
    setError(null);
    store.restartAgent(agent.id, message).then(onClose, (failure: SendFailure) => {
      setBusy(false);
      setError(failure);
    });
  }

  return (
    <Overlay onClose={onClose}>
      <Text fontWeight="700">{`Restart ${agent.name}?`}</Text>
      <Text fontSize="$2" color="$color11">
        {`A running container stops and starts fresh with the same conversation. With a message, ${agent.name} wakes on it; without one, it waits for the next message.`}
      </Text>
      <Field
        multiline
        maxH={120}
        value={message}
        onChangeText={setMessage}
        placeholder="Message after restart (optional)"
        maxLength={MAX_RESTART_CHARS}
      />
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error.message}
        </Text>
      ) : null}
      <XStack gap="$2">
        <Pill flex={1} disabled={busy} onPress={onClose}>
          Cancel
        </Pill>
        <Pill flex={1} kind="primary" busy={busy} onPress={run}>
          Restart
        </Pill>
      </XStack>
    </Overlay>
  );
}

function DeletePrompt({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [removeWorkspace, setRemoveWorkspace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendFailure | null>(null);

  function run(): void {
    if (busy) return;
    setBusy(true);
    setError(null);
    store.deleteAgent(agent.id, removeWorkspace).then(onClose, (failure: SendFailure) => {
      setBusy(false);
      setError(failure);
    });
  }

  const body = removeWorkspace
    ? `${agent.name} and all its conversations leave wizzle and the host. Its workspace folder is renamed with a .deleted suffix; nothing on disk is erased.`
    : `${agent.name} and all its conversations leave wizzle and the host. Its workspace folder stays where it is, so a new agent with the same name gets a suffixed folder. Nothing on disk is erased.`;

  return (
    <Overlay onClose={onClose}>
      <Text fontWeight="700">{`Delete ${agent.name}?`}</Text>
      <Text fontSize="$2" color="$color11">
        {body}
      </Text>
      <XStack
        items="center"
        gap="$2"
        role="checkbox"
        aria-checked={removeWorkspace}
        disabled={busy}
        onPress={() => setRemoveWorkspace((on) => !on)}
      >
        <YStack
          width={20}
          height={20}
          rounded="$2"
          borderWidth={2}
          borderColor={removeWorkspace ? '$blue10' : '$color8'}
          bg={removeWorkspace ? '$blue10' : 'transparent'}
        />
        <Text flex={1} fontSize="$2">
          Also move its workspace folder aside
        </Text>
      </XStack>
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error.message}
        </Text>
      ) : null}
      <XStack gap="$2">
        <Pill flex={1} disabled={busy} onPress={onClose}>
          Cancel
        </Pill>
        <Pill flex={1} kind="danger" busy={busy} onPress={run}>
          Delete
        </Pill>
      </XStack>
    </Overlay>
  );
}
