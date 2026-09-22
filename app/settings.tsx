import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, H4, Input, Paragraph, ScrollView, Separator, Spinner, Text, XStack, YStack } from 'tamagui';
import type { Capabilities } from '../src/protocol/index';
import { connection, useConnection } from '../src/relay/connection';
import { useStore } from '../src/store';
import { PHASE, StatusDot } from '../src/ui/status';
import { shortTime } from '../src/ui/time';

const FEATURES: Array<{ key: keyof Capabilities; label: string }> = [
  { key: 'history', label: 'History' },
  { key: 'questions', label: 'Questions' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'files', label: 'Files' },
  { key: 'streaming', label: 'Streaming' },
  { key: 'createAgent', label: 'New agents' },
  { key: 'clearSession', label: 'Clear session' },
  { key: 'abort', label: 'Abort' },
  { key: 'tasks', label: 'Tasks' },
];

export default function Settings() {
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
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView>
        <YStack p="$4" gap="$6">
          <YStack gap="$2">
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

          <YStack gap="$2">
            <Row label="Relay" value={conn.pairing.relay} />
            <Row label="Runtime" value={bridge ? runtimeLabel(bridge.runtime, bridge.runtimeVersion) : (conn.pairing.runtime ?? 'unknown')} />
            {bridge ? <Row label="Host" value={bridge.host} /> : null}
            {bridge ? <Row label="Bridge" value={bridge.bridgeVersion} /> : null}
            <Row label="Paired" value={shortTime(conn.pairing.pairedAt)} />
          </YStack>

          <YStack gap="$2">
            <Text fontWeight="600">What this bridge supports</Text>
            <Separator />
            {snapshot.capabilities ? (
              FEATURES.map((feature) => (
                <Row
                  key={feature.key}
                  label={feature.label}
                  value={snapshot.capabilities?.[feature.key] ? 'Yes' : 'No'}
                />
              ))
            ) : (
              <XStack items="center" gap="$2">
                <Spinner size="small" />
                <Text color="$color11">Waiting for the bridge to answer sync</Text>
              </XStack>
            )}
          </YStack>

          <YStack gap="$3">
            <Button onPress={() => router.push('/installs')}>Switch bridge</Button>
            <Button onPress={() => router.push('/pair')}>Add another bridge</Button>
            {confirmRemove ? (
              <XStack gap="$3">
                <Button flex={1} onPress={() => setConfirmRemove(false)}>
                  Keep
                </Button>
                <Button
                  flex={1}
                  theme="red"
                  onPress={() => {
                    connection.remove();
                    router.replace('/');
                  }}
                >
                  Remove
                </Button>
              </XStack>
            ) : (
              <Button chromeless onPress={() => setConfirmRemove(true)}>
                Remove this bridge
              </Button>
            )}
          </YStack>
        </YStack>
      </ScrollView>
    </>
  );
}

function runtimeLabel(runtime: string, version?: string): string {
  return version ? `${runtime} ${version}` : runtime;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3">
      <Text color="$color11">{label}</Text>
      <Text flex={1} text="right" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  );
}
