import { Redirect, Stack, useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { Button, Paragraph, Separator, Text, XStack, YStack } from 'tamagui';
import { useConnection, type Phase } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import type { ConversationRow, Notice } from '../src/store/types';
import { Gear, Layers } from '../src/ui/icons';
import { ConnectionBanner, ThinkingDot, activityLabel } from '../src/ui/status';
import { shortTime } from '../src/ui/time';

export default function Conversations() {
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  if (conn.phase === 'unpaired' || !conn.pairing) return <Redirect href="/pair" />;
  return (
    <>
      <Stack.Screen
        options={{
          title: conn.pairing.name ?? 'wizzle',
          headerLeft: () => (
            <Button
              size="$3"
              circular
              chromeless
              scaleIcon={1.3}
              aria-label="Switch bridge"
              icon={<Layers />}
              onPress={() => router.push('/installs')}
            />
          ),
          headerRight: () => (
            <Button
              size="$3"
              circular
              chromeless
              scaleIcon={1.3}
              aria-label="Settings"
              icon={<Gear />}
              onPress={() => router.push('/settings')}
            />
          ),
        }}
      />
      <YStack flex={1}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        {snapshot.notices.map((notice) => (
          <NoticeRow key={notice.id} notice={notice} />
        ))}
        <FlatList
          data={snapshot.conversations}
          keyExtractor={(row) => row.id}
          ItemSeparatorComponent={() => <Separator />}
          ListEmptyComponent={<Empty phase={conn.phase} />}
          renderItem={({ item }) => (
            <Row row={item} onPress={() => router.push(`/chat/${encodeURIComponent(item.id)}`)} />
          )}
        />
      </YStack>
    </>
  );
}

function Row({ row, onPress }: { row: ConversationRow; onPress: () => void }) {
  const busy = row.activity !== null;
  const preview = busy && row.activity ? activityLabel(row.activity) : row.preview;
  return (
    <YStack px="$4" py="$3" gap="$1" pressStyle={{ bg: '$color3' }} onPress={onPress}>
      <XStack items="center" gap="$2">
        {busy ? <ThinkingDot /> : null}
        <Text flex={1} fontWeight="600" numberOfLines={1}>
          {row.title}
        </Text>
        {row.questions > 0 ? <Badge count={row.questions} /> : null}
        {row.lastAt ? (
          <Text fontSize="$1" color="$color11">
            {shortTime(row.lastAt)}
          </Text>
        ) : null}
      </XStack>
      <Text fontSize="$2" color={busy ? '$blue10' : '$color11'} numberOfLines={2}>
        {preview || 'No messages yet'}
      </Text>
    </YStack>
  );
}

function Badge({ count }: { count: number }) {
  return (
    <XStack theme="accent" bg="$color9" rounded="$10" px="$2" items="center">
      <Text fontSize="$1" color="$color1" fontWeight="700">
        {count}
      </Text>
    </XStack>
  );
}

function NoticeRow({ notice }: { notice: Notice }) {
  return (
    <XStack theme="red" items="center" gap="$2" px="$4" py="$2" bg="$color3">
      <Text flex={1} fontSize="$2" color="$color11">
        {notice.message}
      </Text>
      <Button size="$1" chromeless onPress={() => store.dismiss(notice.id)}>
        Dismiss
      </Button>
    </XStack>
  );
}

function Empty({ phase }: { phase: Phase }) {
  return (
    <YStack p="$6" items="center" gap="$2">
      <Paragraph color="$color11" text="center">
        {phase === 'connected' ? 'The bridge has no conversations yet.' : 'Waiting for the bridge to come online.'}
      </Paragraph>
    </YStack>
  );
}
