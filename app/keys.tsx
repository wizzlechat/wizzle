import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, Text, YStack } from 'tamagui';
import { useConnection } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import { Plus } from '../src/ui/icons';
import { secretDetail } from '../src/ui/keys';
import { ListRow, ListSection } from '../src/ui/list';
import { ConnectionBanner } from '../src/ui/status';

// Every key in the host's vault; an agent gets one from its own Keys.
export default function Keys() {
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const keys = snapshot.capabilities?.keys === true;
  useEffect(() => {
    if (keys) store.loadSecrets();
  }, [keys]);

  return (
    <>
      <Stack.Screen options={{ title: 'Keys' }} />
      <YStack flex={1}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        <ScrollView>
          <YStack p="$4" gap="$3">
            <ListSection title="Vault">
              {snapshot.secrets === null && snapshot.keysError === null ? <ListRow label="Loading keys" busy /> : null}
              {(snapshot.secrets ?? []).map((secret) => (
                <ListRow
                  key={secret.id}
                  label={secret.name}
                  detail={secretDetail(secret)}
                  chevron
                  onPress={() => router.push(`/key?id=${encodeURIComponent(secret.id)}`)}
                />
              ))}
              <ListRow icon={Plus} label="Add key" chevron disabled={!keys} onPress={() => router.push('/key')} />
            </ListSection>
            {snapshot.keysError ? (
              <Text px="$4" fontSize="$2" color="$red10">
                {snapshot.keysError.message}
              </Text>
            ) : null}
            <Text px="$4" fontSize="$2" color="$color11">
              {keys
                ? 'Keys live in OneCLI on the bridge host and are added to agents\' requests there. A value goes in once and is never shown again. Attach a key to an agent from that agent\'s menu.'
                : 'This bridge has no key vault to manage.'}
            </Text>
          </YStack>
        </ScrollView>
      </YStack>
    </>
  );
}
