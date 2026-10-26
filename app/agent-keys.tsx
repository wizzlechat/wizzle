import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, YStack } from 'tamagui';
import { useConnection } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import type { SendFailure } from '../src/store/types';
import { KeyRows, useAddedSecret } from '../src/ui/keys';
import { ListSection } from '../src/ui/list';
import { ConnectionBanner } from '../src/ui/status';

// One agent's keys: a tap attaches or detaches a vault key, and a key added from here is attached.
export default function AgentKeys() {
  const { agent: agentId } = useLocalSearchParams<{ agent?: string }>();
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<SendFailure | null>(null);
  const agent = snapshot.agents.find((one) => one.id === agentId);
  const held = agentId ? snapshot.agentSecrets[agentId] : undefined;
  const keys = snapshot.capabilities?.keys === true;

  useEffect(() => {
    if (!keys || !agentId) return;
    store.loadSecrets();
    store.loadAgentSecrets(agentId);
  }, [keys, agentId]);

  const change = useCallback(
    (secretId: string, attach: boolean) => {
      if (!agentId) return;
      setPending((current) => new Set([...current, secretId]));
      setError(null);
      const run = attach ? store.attachSecret(agentId, secretId) : store.detachSecret(agentId, secretId);
      run
        .catch((failure: SendFailure) => setError(failure))
        .finally(() => setPending((current) => new Set([...current].filter((one) => one !== secretId))));
    },
    [agentId],
  );

  useAddedSecret(snapshot.newestSecret, (secretId) => change(secretId, true));

  function toggle(secretId: string): void {
    if (pending.has(secretId) || held === undefined) return;
    change(secretId, !held.includes(secretId));
  }

  const name = agent?.name ?? 'This agent';

  return (
    <>
      <Stack.Screen options={{ title: `${name} keys` }} />
      <YStack flex={1}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        <ScrollView>
          <YStack p="$4" gap="$3">
            <ListSection title="Vault">
              <KeyRows
                secrets={held === undefined && snapshot.keysError === null ? null : (snapshot.secrets ?? [])}
                ticked={new Set(held ?? [])}
                busy={pending}
                onToggle={toggle}
                onAdd={() => router.push('/key')}
              />
            </ListSection>
            {error ?? snapshot.keysError ? (
              <Text px="$4" fontSize="$2" color="$red10">
                {(error ?? snapshot.keysError)?.message}
              </Text>
            ) : null}
            <Text px="$4" fontSize="$2" color="$color11">
              {`A ticked key is added to ${name}'s requests to that key's host. Its model key is attached on its own each time it starts.`}
            </Text>
          </YStack>
        </ScrollView>
      </YStack>
    </>
  );
}
