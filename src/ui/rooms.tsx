import { useRouter } from 'expo-router';
import { memo } from 'react';
import { Text, XStack, YStack } from 'tamagui';
import { mentionHandle, type Mentionable } from '../protocol/index.ts';
import { store } from '../store/index.ts';
import type { AgentProfile, RoomRow } from '../store/types.ts';
import { Face, faceColor } from './face.tsx';
import { Pencil, People, Trash } from './icons.tsx';
import { Badge, ListRow } from './list.tsx';
import { previewOf } from './plain.ts';
import { ThinkingDot, activityLabel } from './status.tsx';
import { shortTime } from './time.ts';
import { ConfirmPrompt, Menu, TitlePrompt } from './topics.tsx';

const ROW_FACES = 3;

// One room member as the room's screens draw it; handle is what the bridge matches, from the host's name.
export type Member = { id: string; name: string; handle: string; color: string; look: AgentProfile | undefined; paused: boolean };

export function roomMembers(room: RoomRow, profiles: Record<string, AgentProfile>): Member[] {
  return room.agents.map((agent) => {
    const look = profiles[agent.id];
    return {
      id: agent.id,
      name: agent.name,
      handle: mentionHandle(agent.hostName ?? agent.name),
      color: faceColor(agent.id, look?.hue),
      look,
      paused: agent.status === 'paused',
    };
  });
}

// A nickname never decides who a mention wakes, so mentions match handles only.
export function mentionables(members: Member[]): Mentionable[] {
  return members.map((member) => ({ id: member.id, name: member.handle }));
}

export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function membersHref(conv: string): string {
  return `/create-room?conv=${encodeURIComponent(conv)}`;
}

// The newest speakers lead; each face overlaps the one before it.
export function RoomFaces({ room, profiles, size = 20 }: { room: RoomRow; profiles: Record<string, AgentProfile>; size?: number }) {
  const shown = room.speakers.slice(0, ROW_FACES);
  const extra = room.speakers.length - shown.length;
  return (
    <XStack items="center">
      {shown.map((id, i) => (
        <YStack key={id} ml={i === 0 ? 0 : -Math.round(size * 0.3)} rounded={size} borderWidth={2} borderColor="$color3" style={{ zIndex: shown.length - i }}>
          <Face seed={id} look={profiles[id]} size={size} />
        </YStack>
      ))}
      {extra > 0 ? (
        <Text ml="$1" fontSize="$1" color="$color11">
          {`+${extra}`}
        </Text>
      ) : null}
    </XStack>
  );
}

// A room's bubble on the Rooms page; a long press opens its menu.
export const RoomListRow = memo(function RoomListRow({
  room,
  profiles,
  onOpen,
  onManage,
}: {
  room: RoomRow;
  profiles: Record<string, AgentProfile>;
  onOpen: (conv: string) => void;
  onManage: (room: RoomRow) => void;
}) {
  const busy = room.activities[0];
  const busyAgent = busy ? room.agents.find((agent) => agent.id === busy.speaker) : undefined;
  const last = room.last;
  const lastAgent = last?.speaker ? room.agents.find((agent) => agent.id === last.speaker) : undefined;
  const who = busy ? busyAgent : lastAgent;
  const prefix = busy ? (busyAgent ? `${busyAgent.name}: ` : '') : last?.role === 'user' ? 'You: ' : lastAgent ? `${lastAgent.name}: ` : '';
  const line = busy ? activityLabel(busy) : previewOf(last);
  return (
    <YStack
      mx="$3"
      px="$4"
      py="$3"
      gap="$1"
      rounded="$8"
      bg="$color3"
      pressStyle={{ bg: '$color4' }}
      onPress={() => onOpen(room.id)}
      onLongPress={() => onManage(room)}
    >
      <XStack items="center" gap="$2">
        <RoomFaces room={room} profiles={profiles} />
        {busy ? <ThinkingDot /> : null}
        <Text flex={1} fontWeight="600" numberOfLines={1}>
          {room.title}
        </Text>
        {room.questions > 0 ? <Badge count={room.questions} /> : null}
        {room.lastAt ? (
          <Text fontSize="$1" color="$color11">
            {shortTime(room.lastAt)}
          </Text>
        ) : null}
      </XStack>
      <XStack mt="$1.5" items="center" gap="$2">
        <Text flex={1} fontSize="$2" color={busy ? '$blue10' : '$color11'} numberOfLines={1}>
          {prefix.length > 0 ? (
            <Text fontWeight="700" style={who ? { color: faceColor(who.id, profiles[who.id]?.hue) } : undefined}>
              {prefix}
            </Text>
          ) : null}
          {line || 'No messages yet'}
        </Text>
        {room.unread > 0 ? <Badge count={room.unread} /> : null}
      </XStack>
    </YStack>
  );
});

export type RoomPrompt = 'menu' | 'rename' | 'clear' | 'delete';

// The room's menu and what it opens, from the Rooms page and from the room itself.
export function RoomPrompts({
  room,
  prompt,
  setPrompt,
  onClose,
}: {
  room: RoomRow;
  prompt: RoomPrompt;
  setPrompt: (next: RoomPrompt) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  if (prompt === 'menu') {
    return (
      <Menu title={room.title} onClose={onClose}>
        <ListRow
          icon={People}
          label="Members"
          onPress={() => {
            onClose();
            router.push(membersHref(room.id));
          }}
        />
        <ListRow icon={Pencil} label="Rename room" onPress={() => setPrompt('rename')} />
        <ListRow icon={Trash} label="Clear chat" danger onPress={() => setPrompt('clear')} />
        <ListRow icon={Trash} label="Delete room" danger onPress={() => setPrompt('delete')} />
      </Menu>
    );
  }
  if (prompt === 'rename') {
    return (
      <TitlePrompt
        heading="Rename room"
        initial={room.title}
        action="Save"
        submit={(title) => store.renameRoom(room.id, title)}
        onClose={onClose}
        onDone={onClose}
      />
    );
  }
  if (prompt === 'clear') {
    return (
      <ConfirmPrompt
        heading="Clear this room?"
        body="Its messages are deleted from wizzle and the bridge, and every member starts this room fresh."
        action="Clear"
        submit={() => store.clearChat(room.id)}
        onClose={onClose}
        onDone={onClose}
      />
    );
  }
  return (
    <ConfirmPrompt
      heading={`Delete ${room.title}?`}
      body="The room and its transcript go from wizzle and the bridge. Its members and their own chats are untouched."
      action="Delete"
      submit={() => store.deleteRoom(room.id)}
      onClose={onClose}
      onDone={onClose}
    />
  );
}
