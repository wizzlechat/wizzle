import { useState } from 'react';
import { Text, XStack, YStack } from 'tamagui';
import { store } from '../store/index.ts';
import type { ConversationRow, SendFailure } from '../store/types.ts';
import { Field, Pill } from './controls.tsx';
import { ListCard } from './list.tsx';

// Tamagui's Dialog and Sheet need a portal this app does not mount, so overlays are plain absolute stacks.
function Scrim({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <YStack style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} items="center" pt="$8" px="$4">
      <YStack
        style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.4)' }}
        onPress={onClose}
      />
      {children}
    </YStack>
  );
}

export function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <Scrim onClose={onClose}>
      <YStack width="100%" maxW={420} gap="$3" p="$4" rounded="$8" bg="$color3">
        {children}
      </YStack>
    </Scrim>
  );
}

// A menu is one grouped list of ListRows with its title on top.
export function Menu({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <Scrim onClose={onClose}>
      <YStack width="100%" maxW={420}>
        <ListCard title={title}>{children}</ListCard>
      </YStack>
    </Scrim>
  );
}

// Both create and rename ask for one title and answer with the conversation id.
export function TitlePrompt({
  heading,
  note,
  initial,
  action,
  submit,
  onClose,
  onDone,
}: {
  heading: string;
  note?: string;
  initial?: string;
  action: string;
  submit: (title: string) => Promise<string>;
  onClose: () => void;
  onDone: (conv: string) => void;
}) {
  const [title, setTitle] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendFailure | null>(null);

  function run(): void {
    if (busy || title.trim().length === 0) return;
    setBusy(true);
    setError(null);
    submit(title).then(
      (conv) => onDone(conv),
      (failure: SendFailure) => {
        setBusy(false);
        setError(failure);
      },
    );
  }

  return (
    <Overlay onClose={onClose}>
      <Text fontWeight="700">{heading}</Text>
      {note ? (
        <Text fontSize="$2" color="$color11">
          {note}
        </Text>
      ) : null}
      <Field value={title} onChangeText={setTitle} placeholder="Title" maxLength={60} autoFocus onSubmitEditing={run} />
      {error ? (
        <Text fontSize="$2" color="$red10">
          {error.message}
        </Text>
      ) : null}
      <XStack gap="$2">
        <Pill flex={1} disabled={busy} onPress={onClose}>
          Cancel
        </Pill>
        <Pill flex={1} kind="primary" busy={busy} disabled={title.trim().length === 0} onPress={run}>
          {action}
        </Pill>
      </XStack>
    </Overlay>
  );
}

export function ConfirmPrompt({
  heading,
  body,
  action,
  submit,
  onClose,
  onDone,
}: {
  heading: string;
  body: string;
  action: string;
  submit: () => Promise<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendFailure | null>(null);

  function run(): void {
    if (busy) return;
    setBusy(true);
    setError(null);
    submit().then(
      () => onDone(),
      (failure: SendFailure) => {
        setBusy(false);
        setError(failure);
      },
    );
  }

  return (
    <Overlay onClose={onClose}>
      <Text fontWeight="700">{heading}</Text>
      <Text fontSize="$2" color="$color11">
        {body}
      </Text>
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
          {action}
        </Pill>
      </XStack>
    </Overlay>
  );
}

export function RenameTopic({ row, onClose }: { row: ConversationRow; onClose: () => void }) {
  return (
    <TitlePrompt
      heading="Rename topic"
      initial={row.title}
      action="Save"
      submit={(title) => store.renameTopic(row.id, title)}
      onClose={onClose}
      onDone={onClose}
    />
  );
}

export function DeleteTopic({ row, onClose }: { row: ConversationRow; onClose: () => void }) {
  const agentName = row.agent?.name ?? row.title;
  return (
    <ConfirmPrompt
      heading={`Delete ${row.title}?`}
      body={`The transcript goes from the phone and ${agentName} loses its memory of this thread. The default conversation is untouched.`}
      action="Delete"
      submit={() => store.deleteTopic(row.id)}
      onClose={onClose}
      onDone={onClose}
    />
  );
}

export function ClearChat({ row, onClose }: { row: ConversationRow; onClose: () => void }) {
  const agentName = row.agent?.name ?? row.title;
  return (
    <ConfirmPrompt
      heading="Clear this chat?"
      body={`Its messages and files are deleted from the phone and the bridge, and ${agentName} starts this chat fresh. Its memory and elements stay.`}
      action="Clear"
      submit={() => store.clearChat(row.id)}
      onClose={onClose}
      onDone={onClose}
    />
  );
}
