import { setStringAsync } from 'expo-clipboard';
import { memo, useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Button, Text, XStack, YStack, useTheme } from 'tamagui';
import type { Agent } from '../protocol/index.ts';
import { store } from '../store/index.ts';
import type { ChatEntry } from '../store/types.ts';
import { ResumeButton } from './agent-actions.tsx';
import { FileView } from './attachments.tsx';
import { ElementLink } from './element.tsx';
import { Check, Copy, Speaker } from './icons.tsx';
import { Markdown } from './markdown.tsx';
import { MessageMore } from './message-more.tsx';
import { useMessageFont } from './text-size.ts';
import { shortTime } from './time.ts';

// A hold this long lights an agent message; a scroll that starts on one ends sooner.
const HOLD_MS = 150;
// How long the copy button shows its check.
const COPIED_MS = 1500;

// Your own messages sit on the right in a bubble with the time under it; the rest keep a name and time above.
// Memoized: a streaming delta replaces one entry, and the rows around it keep their render.
export const Entry = memo(function Entry({
  entry,
  agentName,
  nameColor,
  conv,
  agent,
}: {
  entry: ChatEntry;
  agentName: string;
  nameColor: string;
  conv: string;
  agent: Agent | null;
}) {
  const failure = entry.local?.failure;
  const mine = entry.role === 'user';
  const copyable = entry.role === 'agent' && entry.kind === 'text' && entry.text.length > 0;
  const [holding, setHolding] = useState(false);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(holdTimer.current), []);
  // iOS's own Copy answers a long press on the text; this only shows the hold registered.
  const hold = copyable
    ? {
        onPressIn: () => {
          holdTimer.current = setTimeout(() => setHolding(true), HOLD_MS);
        },
        onPressOut: () => {
          clearTimeout(holdTimer.current);
          setHolding(false);
        },
      }
    : {};
  const stamp = (
    <>
      <Text fontSize="$1" color="$color10">
        {shortTime(entry.at)}
      </Text>
      {entry.edited ? (
        <Text fontSize="$1" color="$color10">
          edited
        </Text>
      ) : null}
    </>
  );
  return (
    <YStack
      px="$4"
      py="$3"
      gap="$1"
      opacity={failure ? 0.6 : 1}
      items={mine ? 'flex-end' : undefined}
      bg={holding ? '$color3' : undefined}
      {...hold}
    >
      {mine ? (
        <YStack maxW="80%" px="$4" py="$3" rounded="$8" bg="$color4">
          <Body entry={entry} />
        </YStack>
      ) : (
        <>
          <XStack items="center" gap="$2">
            <Text
              fontSize="$1"
              fontWeight="700"
              color={entry.role === 'system' ? '$color11' : undefined}
              style={entry.role === 'system' ? undefined : { color: nameColor }}
            >
              {entry.role === 'system' ? 'system' : agentName}
            </Text>
            {stamp}
          </XStack>
          <Body entry={entry} />
          {copyable ? <MessageActions text={entry.text} /> : null}
        </>
      )}
      {mine ? (
        <XStack items="center" gap="$2" px="$2">
          {stamp}
        </XStack>
      ) : null}
      {entry.reactions?.length ? (
        <XStack gap="$2">
          {entry.reactions.map((reaction) => (
            <Text key={reaction} fontSize="$2">
              {reaction}
            </Text>
          ))}
        </XStack>
      ) : null}
      {entry.resolution ? (
        <Text fontSize="$1" color="$color10">
          {entry.resolution}
        </Text>
      ) : null}
      {failure ? (
        <YStack gap="$2" mt="$1" pl="$3" borderLeftWidth={2} borderColor="$red10">
          <Text fontSize="$2" color="$red10">
            {failure.message}
          </Text>
          <XStack gap="$2" items="flex-start">
            {failure.code === 'paused' && agent?.status === 'paused' ? <ResumeButton agent={agent} /> : null}
            <Button size="$2" onPress={() => store.retry(conv, entry.msgId)}>
              Retry
            </Button>
            <Button size="$2" chromeless onPress={() => store.discard(conv, entry.msgId)}>
              Discard
            </Button>
          </XStack>
        </YStack>
      ) : null}
    </YStack>
  );
});

// Copy takes the message as the agent wrote it, markdown included; the speaker waits for read aloud.
function MessageActions({ text }: { text: string }) {
  const theme = useTheme();
  const ink = theme.color10.val;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <XStack items="center" gap="$3" pt={10}>
      <XStack
        role="button"
        aria-label="Copy"
        hitSlop={8}
        pressStyle={{ opacity: 0.5 }}
        onPress={() => {
          void setStringAsync(text);
          setCopied(true);
        }}
      >
        <CopyMark copied={copied} color={ink} />
      </XStack>
      <XStack aria-label="Read aloud" hitSlop={8}>
        <Speaker size={18} color={ink} />
      </XStack>
      <MessageMore text={text} color={ink} />
    </XStack>
  );
}

// The copy icon shrinks away as the check springs in with a little overshoot, and the reverse when it times out.
function CopyMark({ copied, color }: { copied: boolean; color: string }) {
  const swap = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = copied
      ? Animated.spring(swap, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true })
      : Animated.timing(swap, { toValue: 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [copied, swap]);
  const away = {
    opacity: swap.interpolate({ inputRange: [0, 0.6], outputRange: [1, 0], extrapolate: 'clamp' }),
    transform: [{ scale: swap.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4], extrapolate: 'clamp' }) }],
  };
  const into = {
    position: 'absolute' as const,
    opacity: swap.interpolate({ inputRange: [0.2, 1], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ scale: swap.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }],
  };
  return (
    <View style={{ width: 18, height: 18 }}>
      <Animated.View style={away}>
        <Copy size={18} color={color} />
      </Animated.View>
      <Animated.View style={into}>
        <Check size={18} color={color} />
      </Animated.View>
    </View>
  );
}

function Body({ entry }: { entry: ChatEntry }) {
  const font = useMessageFont();
  if (entry.kind === 'file' && entry.element) {
    return (
      <YStack gap="$2" pt="$2">
        {entry.text ? <Text {...font}>{entry.text}</Text> : null}
        <ElementLink reference={entry.element} />
      </YStack>
    );
  }
  if (entry.kind === 'file' && entry.file) {
    return (
      <YStack gap="$2">
        {entry.text ? <Text {...font}>{entry.text}</Text> : null}
        <FileView file={entry.file} />
        {entry.elementError ? (
          <Text fontSize="$1" color="$red10">
            {entry.elementError}
          </Text>
        ) : null}
      </YStack>
    );
  }
  if (entry.attachments?.length) {
    return (
      <YStack gap="$2">
        {entry.text ? <Text {...font}>{entry.text}</Text> : null}
        {entry.attachments.map((attachment) => (
          <FileView key={attachment.uri} file={attachment} />
        ))}
      </YStack>
    );
  }
  if (entry.kind === 'card') {
    return (
      <YStack gap="$2">
        {entry.text ? <Text {...font}>{entry.text}</Text> : null}
        <YStack p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$1" color="$color11">
            {describeCard(entry.card)}
          </Text>
        </YStack>
      </YStack>
    );
  }
  if (entry.format === 'markdown' && entry.role !== 'user') return <Markdown value={entry.text} />;
  return <Text {...font}>{entry.text}</Text>;
}

function describeCard(card: unknown): string {
  try {
    const text = JSON.stringify(card, null, 2) ?? '';
    return text.length > 800 ? `${text.slice(0, 800)}...` : text;
  } catch {
    return String(card);
  }
}
