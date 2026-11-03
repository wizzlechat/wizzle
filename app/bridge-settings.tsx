import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, H4, Input, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui';
import type { Capabilities } from '../src/protocol/index';
import { connection, useConnection } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import type { SendFailure } from '../src/store/types';
import { Close, Plus, Restart, Swap, Trash } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';
import { PHASE, StatusDot } from '../src/ui/status';
import { shortTime } from '../src/ui/time';

// Every capability has a row; a new one in the protocol fails to compile until it has a label here.
const FEATURES: Record<keyof Capabilities, string> = {
  history: 'History',
  questions: 'Questions',
  approvals: 'Approvals',
  files: 'Files',
  streaming: 'Streaming',
  createAgent: 'New agents',
  topics: 'Topics',
  templates: 'Templates',
  lifecycle: 'Pause and restart',
  deleteAgent: 'Delete agents',
  clearSession: 'Clear session',
  abort: 'Abort',
  tasks: 'Tasks',
  keys: 'Keys',
  rooms: 'Rooms',
  updateBridge: 'Update from the app',
};
const FEATURE_KEYS = Object.keys(FEATURES) as (keyof Capabilities)[];

export default function BridgeSettings() {
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const [updateError, setUpdateError] = useState<string | null>(null);
  if (!conn.pairing) return <Redirect href="/pair" />;
  const status = PHASE[conn.phase];
  const bridge = snapshot.hello;
  const update = snapshot.bridgeUpdate;
  const newer = bridge && update.latest !== null && update.latest !== bridge.bridgeVersion ? update.latest : null;

  function saveName(): void {
    connection.rename(draft);
    setRenaming(false);
  }

  function startUpdate(): void {
    setUpdateError(null);
    store.updateBridge().catch((failure: SendFailure) => setUpdateError(failure.message));
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

          {newer ? (
            <ListSection title="Update">
              {update.updating ? (
                <ListRow label={`Updating to ${newer}, the bridge restarts`} busy />
              ) : snapshot.capabilities?.updateBridge ? (
                <ListRow icon={Restart} label={`Update to ${newer}`} onPress={startUpdate} />
              ) : (
                <ListRow label={`${newer} is out; rerun the install on the host`} />
              )}
              {updateError ?? update.error ? (
                <Paragraph color="$red10" px="$4" pb="$3">
                  {updateError ?? update.error}
                </Paragraph>
              ) : null}
            </ListSection>
          ) : null}

          <ListSection title="What this bridge supports">
            {snapshot.capabilities ? (
              FEATURE_KEYS.map((key) => <ListRow key={key} label={FEATURES[key]} value={snapshot.capabilities?.[key] ? 'Yes' : 'No'} />)
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
