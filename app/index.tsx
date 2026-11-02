import { Redirect, Stack, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, ScrollView, Text as NativeText, View, useWindowDimensions, type ColorValue } from 'react-native';
import { Button, H4, Paragraph, Text, XStack, YStack, getTokenValue } from 'tamagui';
import type { Agent } from '../src/protocol/index';
import { useConnection, type Phase } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import type { AgentGroup, AgentProfile, ConversationRow, RoomRow } from '../src/store/types';
import { AgentMenu, AgentPrompts, type AgentPrompt } from '../src/ui/agent-actions';
import { Banner } from '../src/ui/banner';
import { Pill } from '../src/ui/controls';
import { Face, useAsleep } from '../src/ui/face';
import { Cards, Dots, Gear, Pencil, Plug, Plus, Trash } from '../src/ui/icons';
import { Badge, LINE, ListCard, ListRow } from '../src/ui/list';
import { previewOf } from '../src/ui/plain';
import { RoomListRow, RoomPrompts, type RoomPrompt } from '../src/ui/rooms';
import { ConnectionBanner, PhaseDot, ThinkingDot, activityLabel } from '../src/ui/status';
import { chatHref, profileHref } from '../src/ui/titles';
import { DeleteTopic, Menu, RenameTopic, TitlePrompt } from '../src/ui/topics';
import { shortTime } from '../src/ui/time';

// Whatever sits over the list: one at a time.
type Overlay =
  | { kind: 'newTopic'; agent: Agent }
  | { kind: 'topic'; row: ConversationRow; prompt: 'menu' | 'rename' | 'delete' }
  | { kind: 'agent'; agent: Agent; prompt: 'menu' | AgentPrompt }
  | { kind: 'room'; room: RoomRow; prompt: RoomPrompt };

const PAGES = ['Agents', 'Rooms'] as const;

// The face in an agent's large list style.
const LARGE_FACE = 40;

// An accessory stands above a large face; the row's own top padding covers part of that.
function headroom(look: AgentProfile | undefined, padding: '$2' | '$3'): number {
  return look?.accessory ? Math.max(0, Math.round(LARGE_FACE * 0.45) - getTokenValue(padding, 'space')) : 0;
}

type ListItem = { key: string; kind: 'group'; group: AgentGroup } | { key: string; kind: 'row'; row: ConversationRow };

// An agent with one conversation keeps a bubble of its own; one with topics gets one card holding them all.
function flatten(groups: AgentGroup[]): ListItem[] {
  const items: ListItem[] = [];
  for (const group of groups) {
    if (group.conversations.length > 1) items.push({ key: `agent:${group.agent.id}`, kind: 'group', group });
    else for (const row of group.conversations) items.push({ key: row.id, kind: 'row', row });
  }
  return items;
}

export default function Conversations() {
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const items = useMemo(() => flatten(snapshot.agentGroups), [snapshot.agentGroups]);
  const canTopic = snapshot.capabilities?.topics === true;
  const canCreate = snapshot.capabilities?.createAgent === true;
  const canRooms = snapshot.capabilities?.rooms === true;
  const { width } = useWindowDimensions();
  const pager = useRef<ScrollView>(null);
  const [page, setPage] = useState(0);
  const onRooms = canRooms && page === 1;
  // Stable callbacks, so a row whose data did not change keeps its render while another streams.
  const openChat = useCallback((conv: string) => router.push(chatHref(conv)), [router]);
  const openProfile = useCallback((agentId: string) => router.push(profileHref(agentId)), [router]);
  const newTopic = useCallback((agent: Agent) => setOverlay({ kind: 'newTopic', agent }), []);
  const manageAgent = useCallback((agent: Agent) => setOverlay({ kind: 'agent', agent, prompt: 'menu' }), []);
  // A topic's long press is about that topic; a default conversation's is about its agent.
  const manageRow = useCallback((row: ConversationRow) => {
    if (row.topic) setOverlay({ kind: 'topic', row, prompt: 'menu' });
    else if (row.agent) setOverlay({ kind: 'agent', agent: row.agent, prompt: 'menu' });
  }, []);
  const manageRoom = useCallback((room: RoomRow) => setOverlay({ kind: 'room', room, prompt: 'menu' }), []);
  const close = () => setOverlay(null);
  if (conn.phase === 'unpaired' || !conn.pairing) return <Redirect href="/pair" />;

  const manageable = (row: ConversationRow): boolean => (row.topic ? canTopic : row.agent !== null);

  const bridgeButton = (
    <Button size="$3" circular chromeless scaleIcon={1.3} aria-label="Switch bridge" icon={<Plug />} onPress={() => router.push('/installs')} />
  );
  const actions = (
    <XStack items="center">
      <Button size="$3" circular chromeless scaleIcon={1.3} aria-label="Elements" icon={<Cards />} onPress={() => router.push('/elements')} />
      {onRooms ? (
        <Button size="$3" circular chromeless scaleIcon={1.3} aria-label="New room" icon={<Plus size={22} />} onPress={() => router.push('/create-room')} />
      ) : canCreate ? (
        <Button size="$3" circular chromeless scaleIcon={1.3} aria-label="New agent" icon={<Plus size={22} />} onPress={() => router.push('/create-agent')} />
      ) : null}
      <Button size="$3" circular chromeless scaleIcon={1.3} aria-label="Settings" icon={<Gear />} onPress={() => router.push('/settings')} />
    </XStack>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: conn.pairing.name ?? 'wizzle',
          headerTitle: ({ children, tintColor }) => <BridgeTitle title={children} color={tintColor} phase={conn.phase} />,
          headerLeft: () => bridgeButton,
          headerRight: () => actions,
        }}
      />
      <YStack flex={1}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        {snapshot.notices.map((notice) => (
          <Banner key={notice.id} danger action="Dismiss" onAction={() => store.dismiss(notice.id)}>
            {notice.message}
          </Banner>
        ))}
        <Pages enabled={canRooms} page={page} width={width} pager={pager} onPage={setPage}>
          <FlatList
            data={items}
            keyExtractor={(item) => item.key}
            contentContainerStyle={{ paddingVertical: 12 }}
            ItemSeparatorComponent={() => <YStack height="$0.75" />}
            ListHeaderComponent={
              <H4 px="$4" pb="$2.5">
                Agents
              </H4>
            }
            ListEmptyComponent={<Empty phase={conn.phase} />}
            renderItem={({ item }) =>
              item.kind === 'group' ? (
                <YStack mx="$3">
                  <ListCard>
                    <AgentHeader
                      group={item.group}
                      look={snapshot.profiles[item.group.agent.id]}
                      canTopic={canTopic}
                      onNewTopic={newTopic}
                      onManage={manageAgent}
                      onProfile={openProfile}
                    />
                    {item.group.conversations.map((row) => (
                      <Row key={row.id} row={row} grouped onOpen={openChat} onManage={manageable(row) ? manageRow : undefined} />
                    ))}
                  </ListCard>
                </YStack>
              ) : (
                <Row
                  row={item.row}
                  grouped={false}
                  look={snapshot.profiles[item.row.agentId]}
                  onOpen={openChat}
                  onManage={manageable(item.row) ? manageRow : undefined}
                  onProfile={openProfile}
                />
              )
            }
          />
          {canRooms ? (
            <FlatList
              data={snapshot.rooms}
              keyExtractor={(room) => room.id}
              contentContainerStyle={{ paddingVertical: 12 }}
              ItemSeparatorComponent={() => <YStack height="$0.75" />}
              ListHeaderComponent={
                <H4 px="$4" pb="$2.5">
                  Rooms
                </H4>
              }
              ListEmptyComponent={<RoomsEmpty onNew={() => router.push('/create-room')} />}
              renderItem={({ item }) => <RoomListRow room={item} profiles={snapshot.profiles} onOpen={openChat} onManage={manageRoom} />}
            />
          ) : null}
        </Pages>
        {overlay?.kind === 'room' ? (
          <RoomPrompts room={overlay.room} prompt={overlay.prompt} setPrompt={(next) => setOverlay({ ...overlay, prompt: next })} onClose={close} />
        ) : null}
        {overlay?.kind === 'newTopic' ? (
          <TitlePrompt
            heading={`New topic for ${overlay.agent.name}`}
            note="Its own session, so this agent keeps the topic apart from its other work."
            action="Create"
            submit={(title) => store.createTopic(overlay.agent.id, title)}
            onClose={close}
            onDone={(conv) => {
              close();
              openChat(conv);
            }}
          />
        ) : null}
        {overlay?.kind === 'topic' ? (
          overlay.prompt === 'menu' ? (
            <Menu title={overlay.row.title} onClose={close}>
              <ListRow icon={Pencil} label="Rename topic" onPress={() => setOverlay({ ...overlay, prompt: 'rename' })} />
              <ListRow icon={Trash} label="Delete topic" danger onPress={() => setOverlay({ ...overlay, prompt: 'delete' })} />
            </Menu>
          ) : overlay.prompt === 'rename' ? (
            <RenameTopic row={overlay.row} onClose={close} />
          ) : (
            <DeleteTopic row={overlay.row} onClose={close} />
          )
        ) : null}
        {overlay?.kind === 'agent' ? (
          overlay.prompt === 'menu' ? (
            <AgentMenu
              title={overlay.agent.name}
              seed={overlay.agent.id}
              agent={overlay.agent}
              look={snapshot.profiles[overlay.agent.id]}
              capabilities={snapshot.capabilities}
              onPick={(next) => setOverlay({ ...overlay, prompt: next })}
              onClose={close}
            />
          ) : (
            <AgentPrompts agent={overlay.agent} prompt={overlay.prompt} onClose={close} />
          )
        ) : null}
      </YStack>
    </>
  );
}

// The native header's own title type, with the dot slot mirrored on the right so the name stays centered.
const TITLE_STYLE = Platform.select({ ios: { fontSize: 17, fontWeight: '600' as const }, default: { fontSize: 20, fontWeight: '500' as const } });

function BridgeTitle({ title, color, phase }: { title: string; color?: ColorValue; phase: Phase }) {
  return (
    <XStack items="center" gap="$2">
      <PhaseDot phase={phase} />
      <NativeText numberOfLines={1} style={[TITLE_STYLE, { color }]}>
        {title}
      </NativeText>
      <YStack width={8} />
    </XStack>
  );
}

const AgentHeader = memo(function AgentHeader({
  group,
  look,
  canTopic,
  onNewTopic,
  onManage,
  onProfile,
}: {
  group: AgentGroup;
  look: AgentProfile | undefined;
  canTopic: boolean;
  onNewTopic: (agent: Agent) => void;
  onManage: (agent: Agent) => void;
  onProfile: (agentId: string) => void;
}) {
  const { agent } = group;
  const paused = agent.status === 'paused';
  const unread = group.conversations.reduce((sum, row) => sum + row.unread, 0);
  const lastAt = group.conversations.reduce((at, row) => Math.max(at, row.lastAt ?? row.createdAt ?? 0), 0);
  const repliedAt = group.conversations.reduce((at, row) => Math.max(at, row.repliedAt ?? 0), 0);
  const asleep = useAsleep(lastAt > 0 ? lastAt : undefined, group.conversations.some((row) => row.activity !== null));
  const large = look?.listStyle === 'large';
  const newest = group.conversations.reduce<ConversationRow | null>(
    (best, row) => (best === null || (row.lastAt ?? 0) > (best.lastAt ?? 0) ? row : best),
    null,
  );
  return (
    <XStack items="center" gap={large ? '$2.5' : '$2'} pl="$4" pr="$2" py="$2" minH={48} borderBottomWidth={LINE} borderColor="$color5">
      <FaceButton name={agent.name} headroom={large ? headroom(look, '$2') : 0} onPress={() => onProfile(agent.id)}>
        <Face seed={agent.id} look={look} size={large ? LARGE_FACE : undefined} asleep={asleep} hopAt={repliedAt > 0 ? repliedAt : undefined} />
      </FaceButton>
      {large ? (
        <YStack flex={1} gap="$1">
          <Text fontWeight="600" numberOfLines={1}>
            {agent.name}
          </Text>
          <Text fontSize="$2" color="$color11" numberOfLines={1}>
            {previewOf(newest?.last) || 'No messages yet'}
          </Text>
        </YStack>
      ) : (
        <Text flex={1} fontSize="$2" fontWeight="700" color="$color11" numberOfLines={1}>
          {agent.name}
        </Text>
      )}
      {unread > 0 ? <Badge count={unread} /> : null}
      {paused ? <PausedLabel /> : null}
      {canTopic && !paused ? (
        <Button size="$2" chromeless icon={<Plus size={16} />} aria-label={`New topic for ${agent.name}`} onPress={() => onNewTopic(agent)}>
          New topic
        </Button>
      ) : null}
      <Button size="$2" circular chromeless icon={<Dots size={18} />} aria-label={`Manage ${agent.name}`} onPress={() => onManage(agent)} />
    </XStack>
  );
});

function PausedLabel() {
  return (
    <XStack bg="$color4" rounded="$10" px="$2" items="center">
      <Text fontSize="$1" color="$color11" fontWeight="700">
        Paused
      </Text>
    </XStack>
  );
}

function FaceButton({
  name,
  headroom = 0,
  onPress,
  children,
}: {
  name: string;
  headroom?: number;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <YStack role="button" aria-label={`${name} profile`} pt={headroom} hitSlop={8} pressStyle={{ opacity: 0.7 }} onPress={onPress}>
      {children}
    </YStack>
  );
}

// A row inside its agent's card, or a bubble of its own; a long press opens the agent's actions.
const Row = memo(function Row({
  row,
  grouped,
  look,
  onOpen,
  onManage,
  onProfile,
}: {
  row: ConversationRow;
  grouped: boolean;
  look?: AgentProfile;
  onOpen: (conv: string) => void;
  onManage: ((row: ConversationRow) => void) | undefined;
  onProfile?: (agentId: string) => void;
}) {
  const paused = row.agent?.status === 'paused';
  const busy = row.activity !== null && !paused;
  const preview = busy && row.activity ? activityLabel(row.activity) : previewOf(row.last);
  const asleep = useAsleep(grouped ? undefined : (row.lastAt ?? row.createdAt), row.activity !== null);
  const large = !grouped && look?.listStyle === 'large';
  const face = <Face seed={row.agentId} look={look} size={large ? LARGE_FACE : undefined} asleep={asleep} hopAt={row.repliedAt} />;
  const avatar = grouped ? null : onProfile ? (
    <FaceButton name={row.agent?.name ?? row.title} headroom={large ? headroom(look, '$3') : 0} onPress={() => onProfile(row.agentId)}>
      {face}
    </FaceButton>
  ) : (
    face
  );
  const lines = (
    <>
      <XStack items="center" gap="$2">
        {large ? null : avatar}
        {busy ? <ThinkingDot /> : null}
        {row.topic ? (
          <Text fontWeight="600" color="$color10">
            #
          </Text>
        ) : null}
        <Text flex={1} fontWeight="600" numberOfLines={1}>
          {row.title}
        </Text>
        {paused && !grouped ? <PausedLabel /> : null}
        {row.questions > 0 ? <Badge count={row.questions} /> : null}
        {row.lastAt ? (
          <Text fontSize="$1" color="$color11">
            {shortTime(row.lastAt)}
          </Text>
        ) : null}
      </XStack>
      <XStack mt="$1.5" items="center" gap="$2">
        <Text flex={1} fontSize="$2" color={busy ? '$blue10' : '$color11'} numberOfLines={1}>
          {preview || 'No messages yet'}
        </Text>
        {row.unread > 0 ? <Badge count={row.unread} /> : null}
      </XStack>
    </>
  );
  const body = large ? (
    <XStack items="center" gap="$2.5">
      {avatar}
      <YStack flex={1}>{lines}</YStack>
    </XStack>
  ) : (
    lines
  );
  const open = () => onOpen(row.id);
  const manage = onManage ? () => onManage(row) : undefined;
  if (grouped) {
    return (
      <YStack pl="$4" pressStyle={{ bg: '$color4' }} opacity={paused ? 0.6 : 1} onPress={open} onLongPress={manage}>
        <YStack py="$3" pr="$4" gap="$1" borderBottomWidth={LINE} borderColor="$color5">
          {body}
        </YStack>
      </YStack>
    );
  }
  return (
    <YStack mx="$3" px="$4" py="$3" gap="$1" rounded="$8" bg="$color3" pressStyle={{ bg: '$color4' }} opacity={paused ? 0.6 : 1} onPress={open} onLongPress={manage}>
      {body}
    </YStack>
  );
});

// Without rooms the agents list is the whole screen, as before. Each page takes the pager's measured
// size, so the lists inside have a height to scroll in.
function Pages({
  enabled,
  page,
  width,
  pager,
  onPage,
  children,
}: {
  enabled: boolean;
  page: number;
  width: number;
  pager: React.RefObject<ScrollView | null>;
  onPage: (page: number) => void;
  children: React.ReactNode;
}) {
  const [height, setHeight] = useState(0);
  // A new width (a rotation) leaves the offset at the old page's x, so it moves to the same page.
  useEffect(() => {
    pager.current?.scrollTo({ x: page * width, animated: false });
  }, [width]);
  if (!enabled) return <>{children}</>;
  const pages = Array.isArray(children) ? children.filter(Boolean) : [children];
  return (
    <ScrollView
      ref={pager}
      horizontal
      pagingEnabled
      style={{ flex: 1 }}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      onMomentumScrollEnd={(event) => onPage(Math.round(event.nativeEvent.contentOffset.x / width))}
    >
      {pages.map((child, i) => (
        <View key={PAGES[i] ?? i} style={{ width, height }}>
          {child}
        </View>
      ))}
    </ScrollView>
  );
}

function RoomsEmpty({ onNew }: { onNew: () => void }) {
  return (
    <YStack px="$4" gap="$3" items="flex-start">
      <Paragraph color="$color11">
        Rooms put several agents in one chat. Name one with @ to give it work, and they hand tasks to each other the same way.
      </Paragraph>
      <Pill kind="primary" onPress={onNew}>
        New room
      </Pill>
    </YStack>
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
