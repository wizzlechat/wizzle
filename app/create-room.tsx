import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Paragraph, ScrollView, Text, YStack, useTheme } from 'tamagui';
import { ROOM_LIMITS } from '../src/protocol/index';
import { useConnection } from '../src/relay/connection';
import { SYSTEM_CONV, store, useStore } from '../src/store';
import type { SendFailure } from '../src/store/types';
import { Field, Pill } from '../src/ui/controls';
import { Face } from '../src/ui/face';
import { Check } from '../src/ui/icons';
import { KeyboardSpace } from '../src/ui/keyboard';
import { ListRow, ListSection, SectionTitle } from '../src/ui/list';
import { ConnectionBanner } from '../src/ui/status';
import { chatHref, decodeId } from '../src/ui/titles';

// New room, or with `conv` the members of that room.
export default function CreateRoom() {
  const params = useLocalSearchParams<{ conv?: string }>();
  const editing = params.conv ? decodeId(params.conv) : null;
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const room = editing ? snapshot.rooms.find((one) => one.id === editing) : undefined;
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<string[]>(() => room?.members ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendFailure | null>(null);

  const connected = conn.phase === 'connected';
  const systemAgentId = snapshot.conversations.find((row) => row.id === SYSTEM_CONV)?.agentId;
  const agents = snapshot.agents.filter((agent) => agent.id !== systemAgentId);
  const full = picked.length >= ROOM_LIMITS.maxMembers;
  const enough = picked.length >= ROOM_LIMITS.minMembers;
  const named = editing !== null || title.trim().length > 0;
  const blocked = !connected || busy || !enough || !named || (editing !== null && !room);

  function toggle(agentId: string): void {
    setPicked((current) => (current.includes(agentId) ? current.filter((one) => one !== agentId) : [...current, agentId]));
  }

  function submit(): void {
    if (blocked) return;
    setBusy(true);
    setError(null);
    const members = picked.filter((id) => agents.some((agent) => agent.id === id));
    const request = editing ? store.setRoomMembers(editing, members) : store.createRoom(title, members);
    request.then(
      (conv) => {
        if (editing) router.back();
        else router.replace(chatHref(conv));
      },
      (failure: SendFailure) => {
        setBusy(false);
        setError(failure);
      },
    );
  }

  const tick = <Check color={theme.color.val} />;

  return (
    <>
      <Stack.Screen options={{ title: editing ? 'Members' : 'New room' }} />
      <YStack flex={1}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        <ScrollView keyboardShouldPersistTaps="handled">
          <YStack p="$4" gap="$5">
            {editing ? null : (
              <YStack gap="$2">
                <SectionTitle>Name</SectionTitle>
                <Field value={title} onChangeText={setTitle} placeholder="Room name" maxLength={ROOM_LIMITS.title} autoFocus />
              </YStack>
            )}
            <YStack gap="$3">
              <ListSection title="Members">
                {agents.map((agent) => {
                  const on = picked.includes(agent.id);
                  return (
                    <ListRow
                      key={agent.id}
                      leading={<Face seed={agent.id} look={snapshot.profiles[agent.id]} size={22} />}
                      label={agent.name}
                      {...(agent.status === 'paused' && { detail: 'Paused, answers on resume' })}
                      trailing={on ? tick : null}
                      disabled={!on && full}
                      onPress={() => toggle(agent.id)}
                    />
                  );
                })}
              </ListSection>
              <YStack gap="$2">
                <Note>
                  {editing
                    ? 'A member you remove loses its session for this room; what it said stays in the room.'
                    : 'Each agent keeps the room and its own chat with you apart.'}
                </Note>
                <Note>{`Rooms hold ${ROOM_LIMITS.minMembers}-${ROOM_LIMITS.maxMembers} agents. An agent replies only when you or another agent names it with @.`}</Note>
              </YStack>
            </YStack>
          </YStack>
        </ScrollView>

        <YStack gap="$2" px="$4" pt="$2" pb="$4">
          <Pill kind="primary" busy={busy} disabled={blocked} onPress={submit}>
            {editing ? 'Save' : 'Create room'}
          </Pill>
          {error ? (
            <Paragraph fontSize="$2" color="$red10">
              {error.message}
            </Paragraph>
          ) : null}
          {!connected ? (
            <Paragraph fontSize="$2" color="$color11">
              {editing ? 'Connect to the bridge to change the members.' : 'Connect to the bridge to create a room.'}
            </Paragraph>
          ) : null}
        </YStack>
        <KeyboardSpace minimum={insets.bottom} />
      </YStack>
    </>
  );
}

function Note({ children }: { children: string }) {
  return (
    <Text px="$4" fontSize="$2" color="$color11">
      {children}
    </Text>
  );
}
