import { Stack, useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { Button, Paragraph, Separator, Text, XStack, YStack } from 'tamagui';
import type { Pairing } from '../src/pairing/invite';
import { connection, useConnection, type Phase } from '../src/relay/connection';
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
      <YStack flex={1}>
        <FlatList
          data={conn.pairings}
          keyExtractor={(one) => one.pairingId}
          ItemSeparatorComponent={() => <Separator />}
          ListEmptyComponent={
            <YStack p="$6" items="center">
              <Paragraph color="$color11" text="center">
                No bridges yet. Pair one to get started.
              </Paragraph>
            </YStack>
          }
          renderItem={({ item }) => (
            <Row
              pairing={item}
              active={item.pairingId === activeId}
              phase={conn.phase}
              onPress={() => switchTo(item.pairingId)}
            />
          )}
        />
        <YStack p="$4" borderTopWidth={1} borderColor="$borderColor">
          <Button theme="accent" onPress={() => router.push('/pair')}>
            Add a bridge
          </Button>
        </YStack>
      </YStack>
    </>
  );
}

function Row({
  pairing,
  active,
  phase,
  onPress,
}: {
  pairing: Pairing;
  active: boolean;
  phase: Phase;
  onPress: () => void;
}) {
  return (
    <YStack px="$4" py="$3" gap="$1" pressStyle={{ bg: '$color3' }} onPress={onPress}>
      <XStack items="center" gap="$2">
        {active ? <StatusDot phase={phase} /> : null}
        <Text flex={1} fontWeight="600" numberOfLines={1}>
          {pairing.name ?? 'Bridge'}
        </Text>
        {active ? (
          <Text fontSize="$1" color="$blue10" fontWeight="700">
            Active
          </Text>
        ) : null}
      </XStack>
      <Text fontSize="$2" color="$color11" numberOfLines={1}>
        {pairing.relay}
      </Text>
    </YStack>
  );
}
