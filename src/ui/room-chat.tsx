import { useEffect, useRef } from 'react';
import { Animated, ScrollView, View } from 'react-native';
import { Text, XStack, YStack, useTheme } from 'tamagui';
import { ROOM_LIMITS, mentionSpans, mentioned } from '../protocol/index.ts';
import { Pill } from './controls.tsx';
import { Face } from './face.tsx';
import { LINE } from './list.tsx';
import { useAnimations } from './motion.ts';
import { mentionables, nameList, type Member } from './rooms.tsx';

const PULSE_MS = 900;
const STRIP_FACE = 24;
const PICKER_ROWS = 5;

// The members a room screen draws, and who of them is at work right now.
export type RoomContext = { members: Member[]; working: ReadonlySet<string> };

// Who an agent's message hands off to: the members it names other than itself.
export function handoffOf(text: string, speaker: string, members: Member[]): string | null {
  const spans = mentionSpans(text, mentionables(members));
  if (spans.length === 0) return null;
  if (spans.some((span) => span.id === null)) return 'everyone';
  const named = mentioned(text, mentionables(members)).filter((id) => id !== speaker);
  if (named.length === 0) return null;
  return nameList(named.map((id) => members.find((member) => member.id === id)?.name ?? id));
}

// The draft as the bridge will read it: who it wakes.
export function addressees(draft: string, members: Member[]): string {
  const spans = mentionSpans(draft, mentionables(members));
  if (spans.some((span) => span.id === null)) return 'To everyone';
  const named = mentioned(draft, mentionables(members));
  if (named.length === 0) return 'To nobody. Name an agent with @';
  return `To ${nameList(named.map((id) => members.find((member) => member.id === id)?.name ?? id))}`;
}

// The `@word` the cursor is in, if any, and where it starts.
export function mentionQuery(draft: string, cursor: number): { start: number; query: string } | null {
  const before = draft.slice(0, Math.min(cursor, draft.length));
  const match = /(?:^|[^\p{L}\p{N}_])@([\p{L}\p{N}_.-]*)$/u.exec(before);
  if (!match) return null;
  const query = match[1] ?? '';
  return { start: before.length - query.length - 1, query };
}

// Adds `@handle ` at the end of the draft with a space before it when needed.
export function withMention(draft: string, handle: string): string {
  const gap = draft.length === 0 || /\s$/.test(draft) ? '' : ' ';
  return `${draft}${gap}@${handle} `;
}

// A ring around a working member's face that fades in and out; it holds still with animations off.
function Pulse({ active, color, children }: { active: boolean; color: string; children: React.ReactNode }) {
  const animated = useAnimations();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active || !animated) {
      pulse.setValue(active ? 1 : 0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.25, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, animated, pulse]);
  return (
    <View style={{ padding: 3 }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          borderRadius: STRIP_FACE,
          borderWidth: 2,
          borderColor: color,
          opacity: pulse,
        }}
      />
      {children}
    </View>
  );
}

// The members under the room's header; a tap names one in the draft, a long press opens its menu.
export function AvatarStrip({
  context,
  onTap,
  onHold,
}: {
  context: RoomContext;
  onTap: (member: Member) => void;
  onHold: (member: Member) => void;
}) {
  return (
    <YStack borderBottomWidth={LINE} borderColor="$color5">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, gap: 14 }}>
        {context.members.map((member) => {
          const working = context.working.has(member.id);
          return (
            <YStack
              key={member.id}
              items="center"
              gap="$1"
              py="$2"
              opacity={member.paused ? 0.4 : 1}
              role="button"
              aria-label={`Name ${member.name}`}
              pressStyle={{ opacity: 0.6 }}
              onPress={() => onTap(member)}
              onLongPress={() => onHold(member)}
            >
              <Pulse active={working} color={member.color}>
                <Face seed={member.id} look={member.look} size={STRIP_FACE} thinking={working} />
              </Pulse>
              <Text fontSize="$1" color="$color11" numberOfLines={1} maxW={72}>
                {member.name}
              </Text>
            </YStack>
          );
        })}
      </ScrollView>
    </YStack>
  );
}

// Plain text with each @mention bold in the named member's color, and @all in blue.
export function MentionText({ text, members, font }: { text: string; members: Member[]; font: { fontSize: number; lineHeight: number } }) {
  const theme = useTheme();
  const spans = mentionSpans(text, mentionables(members));
  if (spans.length === 0) return <Text {...font}>{text}</Text>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  spans.forEach((span, i) => {
    if (span.start > at) parts.push(text.slice(at, span.start));
    const color = span.id === null ? theme.blue10.val : members.find((member) => member.id === span.id)?.color;
    parts.push(
      <Text key={i} {...font} fontWeight="700" style={color ? { color } : undefined}>
        {text.slice(span.start, span.end)}
      </Text>,
    );
    at = span.end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <Text {...font}>{parts}</Text>;
}

export function HandoffDivider({ from, to }: { from: string; to: string }) {
  return (
    <XStack items="center" gap="$2" pt="$2">
      <YStack flex={1} height={LINE} bg="$color6" />
      <Text fontSize="$1" color="$color10" numberOfLines={1} shrink={1}>
        {`${from} handed off to ${to}`}
      </Text>
      <YStack flex={1} height={LINE} bg="$color6" />
    </XStack>
  );
}

// Members whose handle or name starts with what follows the @, with Everyone first.
export function MentionPicker({
  query,
  context,
  onPick,
}: {
  query: string;
  context: RoomContext;
  onPick: (handle: string) => void;
}) {
  const wanted = query.toLowerCase();
  const matches = (value: string) => value.toLowerCase().startsWith(wanted);
  const everyone = matches('all') || matches('everyone');
  const members = context.members.filter((member) => matches(member.handle) || matches(member.name)).slice(0, PICKER_ROWS);
  if (!everyone && members.length === 0) return null;
  return (
    <YStack rounded="$6" bg="$color3" borderWidth={1} borderColor="$color5" overflow="hidden">
      {everyone ? <PickerRow label="Everyone" detail="@all" onPress={() => onPick('all')} /> : null}
      {members.map((member) => (
        <PickerRow
          key={member.id}
          face={<Face seed={member.id} look={member.look} size={20} />}
          label={member.name}
          detail={context.working.has(member.id) ? 'working' : member.paused ? 'paused' : `@${member.handle}`}
          onPress={() => onPick(member.handle)}
        />
      ))}
    </YStack>
  );
}

function PickerRow({ face, label, detail, onPress }: { face?: React.ReactNode; label: string; detail: string; onPress: () => void }) {
  return (
    <XStack items="center" gap="$2.5" px="$3" py="$2" role="button" aria-label={label} pressStyle={{ bg: '$color4' }} onPress={onPress}>
      {face ?? <YStack width={20} />}
      <Text flex={1} numberOfLines={1}>
        {label}
      </Text>
      <Text fontSize="$1" color="$color10">
        {detail}
      </Text>
    </XStack>
  );
}

// The handoff cap held these members back; Continue wakes them.
export function ContinueRow({ held, members, onContinue }: { held: string[]; members: Member[]; onContinue: () => void }) {
  const names = held.map((id) => members.find((member) => member.id === id)?.name ?? 'An agent');
  const named = names.length === 1 ? `${names[0]} was named` : `${nameList(names)} were named`;
  return (
    <XStack mx="$3" mb="$2" p="$3" gap="$3" items="center" rounded="$6" bg="$color3" borderWidth={1} borderColor="$borderColor">
      <Text flex={1} fontSize="$2" color="$color11">
        {`${ROOM_LIMITS.handoffs} handoffs in a row without you. ${named} and not woken.`}
      </Text>
      <Pill small kind="primary" onPress={onContinue}>
        Continue
      </Pill>
    </XStack>
  );
}
