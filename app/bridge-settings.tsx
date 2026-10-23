import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, H4, Input, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui';
import type { Capabilities } from '../src/protocol/index';
import { connection, useConnection } from '../src/relay/connection';
import { useStore } from '../src/store';
import { Close, Plus, Swap, Trash } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';
import { PHASE, StatusDot } from '../src/ui/status';
import { shortTime } from '../src/ui/time';

const FEATURES: Array<{ key: keyof Capabilities; label: string }> = [
  { key: 'history', label: 'History' },
  { key: 'questions', label: 'Questions' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'files', label: 'Files' },
  { key: 'streaming', label: 'Streaming' },
  { key: 'createAgent', label: 'New agents' },
  { key: 'topics', label: 'Topics' },
  { key: 'templates', label: 'Templates' },
  { key: 'lifecycle', label: 'Pause and restart' },
  { key: 'deleteAgent', label: 'Delete agents' },
  { key: 'clearSession', label: 'Clear session' },
  { key: 'abort', label: 'Abort' },
  { key: 'tasks', label: 'Tasks' },
];

export default function BridgeSettings() {
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  if (!conn.pairing) return <Redirect href="/pair" />;
  const status = PHASE[conn.phase];
  const bridge = snapshot.hello;

  function saveName(): void {
    connection.rename(draft);
    setRenaming(false);
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Bridge settings' }} />
      <ScrollView>
        <YStack p="$4" gap="$6">
          <YStack gap="$2" px="$4">
            {renaming ? (
              <XStack items="center" gap="$2">
                <Input
                  flex={1}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Bridge"
                  maxLength={40}
                  autoFocus
                  onSubmitEditing={saveName}
                />
                <Button theme="accent" onPress={saveName}>
                  Save
                </Button>
              </XStack>
            ) : (
              <XStack items="center" gap="$2">
                <H4 flex={1} numberOfLines={1}>
                  {conn.pairing.name ?? 'Bridge'}
                </H4>
                <Button
                  size="$2"
                  chromeless
                  onPress={() => {
                    setDraft(conn.pairing?.name ?? '');
                    setRenaming(true);
                  }}
                >
                  Rename
                </Button>
              </XStack>
            )}
            <XStack items="center" gap="$2">
              <StatusDot phase={conn.phase} />
              <Text fontWeight="500">{status.label}</Text>
            </XStack>
            {conn.error ? <Paragraph color="$red10">{conn.error}</Paragraph> : null}
          </YStack>

          <ListSection title="Details">
            <ListRow label="Relay" value={conn.pairing.relay} />
            <ListRow
              label="Runtime"
              value={bridge ? runtimeLabel(bridge.runtime, bridge.runtimeVersion) : (conn.pairing.runtime ?? 'unknown')}
            />
            {bridge ? <ListRow label="Host" value={bridge.host} /> : null}
            {bridge ? <ListRow label="Bridge" value={bridge.bridgeVersion} /> : null}
            <ListRow label="Paired" value={shortTime(conn.pairing.pairedAt)} />
          </ListSection>

          <ListSection title="What this bridge supports">
            {snapshot.capabilities ? (
              FEATURES.map((feature) => (
                <ListRow
                  key={feature.key}
                  label={feature.label}
                  value={snapshot.capabilities?.[feature.key] ? 'Yes' : 'No'}
                />
              ))
            ) : (
              <ListRow label="Waiting for the bridge to answer sync" busy />
            )}
          </ListSection>

          <ListSection>
            <ListRow icon={Swap} label="Switch bridge" chevron onPress={() => router.push('/installs')} />
            <ListRow icon={Plus} label="Add another bridge" chevron onPress={() => router.push('/pair')} />
          </ListSection>

          <ListSection>
            {confirmRemove ? (
              <>
                <ListRow
                  icon={Trash}
                  label="Remove"
                  danger
                  onPress={() => {
                    connection.remove();
                    router.replace('/');
                  }}
                />
                <ListRow icon={Close} label="Keep" onPress={() => setConfirmRemove(false)} />
              </>
            ) : (
              <ListRow icon={Trash} label="Remove this bridge" danger onPress={() => setConfirmRemove(true)} />
            )}
          </ListSection>
        </YStack>
      </ScrollView>
    </>
  );
}

function runtimeLabel(runtime: string, version?: string): string {
  return version ? `${runtime} ${version}` : runtime;
}
