import { Stack, useRouter } from 'expo-router';
import { ScrollView, YStack } from 'tamagui';
import { useConnection } from '../src/relay/connection';
import { APPEARANCES, useAppearance } from '../src/ui/appearance';
import { Contrast, Plus, Server } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';

export default function Settings() {
  const conn = useConnection();
  const router = useRouter();
  const appearance = useAppearance();

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView>
        <YStack p="$4" gap="$6">
          <ListSection title="App">
            <ListRow
              icon={Contrast}
              label="Appearance"
              value={APPEARANCES.find((option) => option.key === appearance)?.label}
              chevron
              onPress={() => router.push('/appearance')}
            />
          </ListSection>

          <ListSection title="Bridge">
            {conn.pairing ? (
              <ListRow icon={Server} label="Bridge settings" chevron onPress={() => router.push('/bridge-settings')} />
            ) : (
              <ListRow icon={Plus} label="Pair a bridge" chevron onPress={() => router.push('/pair')} />
            )}
          </ListSection>
        </YStack>
      </ScrollView>
    </>
  );
}
