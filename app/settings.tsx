import { Stack, useRouter } from 'expo-router';
import { Platform, Switch } from 'react-native';
import { ScrollView, YStack } from 'tamagui';
import { enableNotifications, useNotificationStatus, type NotificationStatus } from '../src/push';
import { useConnection } from '../src/relay/connection';
import { useStore } from '../src/store';
import { APPEARANCES, useAppearance } from '../src/ui/appearance';
import { Face } from '../src/ui/face';
import { Bell, Contrast, Key, Letters, Plug, Plus } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';
import { setAnimations, useAnimations } from '../src/ui/motion';
import { setSleeping, useSleeping } from '../src/ui/sleeping';
import { TEXT_SIZES, useTextSize } from '../src/ui/text-size';

const NOTIFICATIONS: Record<NotificationStatus, string> = { granted: 'On', denied: 'Off', undetermined: 'Not asked' };

export default function Settings() {
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const appearance = useAppearance();
  const textSize = useTextSize();
  const sleeping = useSleeping();
  const animated = useAnimations();
  const notifications = useNotificationStatus();

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
            <ListRow
              icon={Letters}
              label="Message text size"
              value={TEXT_SIZES.find((option) => option.key === textSize)?.label}
              chevron
              onPress={() => router.push('/text-size')}
            />
            {Platform.OS === 'ios' ? (
              <ListRow
                icon={Bell}
                label="Notifications"
                value={notifications ? NOTIFICATIONS[notifications] : undefined}
                chevron
                onPress={() => void enableNotifications(notifications)}
              />
            ) : null}
          </ListSection>

          <ListSection title="Agents">
            <ListRow
              leading={<Face seed="motion" size={22} />}
              label="Face animations"
              trailing={<Switch value={animated} onValueChange={setAnimations} />}
              onPress={() => setAnimations(!animated)}
            />
            <ListRow
              leading={<Face seed="sleeping" size={22} />}
              label="Sleeping faces"
              trailing={<Switch value={sleeping} onValueChange={setSleeping} />}
              onPress={() => setSleeping(!sleeping)}
            />
          </ListSection>

          <ListSection title="Bridge">
            {conn.pairing ? (
              <ListRow icon={Plug} label="Bridge settings" chevron onPress={() => router.push('/bridge-settings')} />
            ) : (
              <ListRow icon={Plus} label="Pair a bridge" chevron onPress={() => router.push('/pair')} />
            )}
            {conn.pairing && snapshot.capabilities?.keys ? (
              <ListRow icon={Key} label="Keys" chevron onPress={() => router.push('/keys')} />
            ) : null}
          </ListSection>
        </YStack>
      </ScrollView>
    </>
  );
}
