import { Stack, useRouter } from 'expo-router';
import { Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui';
import { connection, useConnection, type Phase } from '../src/relay/connection';
import { Plus, Server } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';
import { StatusDot } from '../src/ui/status';

export default function Installs() {
  const conn = useConnection();
  const router = useRouter();
  const activeId = conn.pairing?.pairingId ?? null;

  function switchTo(pairingId: string): void {
    connection.select(pairingId);
    router.back();
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Bridges' }} />
      <ScrollView>
        <YStack p="$4" gap="$6">
          {conn.pairings.length === 0 ? (
            <Paragraph color="$color11" text="center">
              No bridges yet. Pair one to get started.
            </Paragraph>
          ) : (
            <ListSection>
              {conn.pairings.map((pairing) => (
                <ListRow
                  key={pairing.pairingId}
                  icon={Server}
                  label={pairing.name ?? 'Bridge'}
                  detail={pairing.relay}
                  trailing={pairing.pairingId === activeId ? <Active phase={conn.phase} /> : null}
                  onPress={() => switchTo(pairing.pairingId)}
                />
              ))}
            </ListSection>
          )}
          <ListSection>
            <ListRow icon={Plus} label="Add a bridge" chevron onPress={() => router.push('/pair')} />
          </ListSection>
        </YStack>
      </ScrollView>
    </>
  );
}

function Active({ phase }: { phase: Phase }) {
  return (
    <XStack items="center" gap="$2">
      <StatusDot phase={phase} size={8} />
      <Text fontSize="$1" color="$blue10" fontWeight="700">
        Active
      </Text>
    </XStack>
  );
}
