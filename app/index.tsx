import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Platform, Text as NativeText, type ColorValue } from 'react-native';
import { Button, H4, Paragraph, Text, XStack, YStack } from 'tamagui';
import type { Agent } from '../src/protocol/index';
import { useConnection, type Phase } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import type { AgentGroup, ConversationRow, Notice } from '../src/store/types';
import { AgentMenuItems, AgentPrompts, canManage, type AgentPrompt } from '../src/ui/agent-actions';
import { Face } from '../src/ui/face';
import { Cards, Dots, Gear, Pencil, Plus, Server, Trash } from '../src/ui/icons';
import { LINE, ListCard, ListRow } from '../src/ui/list';
import { ConnectionBanner, PhaseDot, ThinkingDot, activityLabel } from '../src/ui/status';
import { DeleteTopic, Menu, RenameTopic, TitlePrompt } from '../src/ui/topics';
import { shortTime } from '../src/ui/time';

type AgentAction = { agent: Agent; prompt: 'menu' | AgentPrompt };

type TopicAction = { row: ConversationRow; prompt: 'menu' | 'rename' | 'delete' };

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
  const [prompt, setPrompt] = useState<Agent | null>(null);
  const [action, setAction] = useState<AgentAction | null>(null);
  const [topicAction, setTopicAction] = useState<TopicAction | null>(null);
  const items = useMemo(() => flatten(snapshot.agentGroups), [snapshot.agentGroups]);
  const canTopic = snapshot.capabilities?.topics === true;
  const canCreate = snapshot.capabilities?.createAgent === true;
  if (conn.phase === 'unpaired' || !conn.pairing) return <Redirect href="/pair" />;

  function openChat(conv: string): void {
    router.push(`/chat/${encodeURIComponent(conv)}`);
  }

  function manage(agent: Agent | null): (() => void) | undefined {
    if (!agent || !canManage(agent, snapshot.capabilities)) return undefined;
    return () => setAction({ agent, prompt: 'menu' });
  }

  // A topic's long press is about that topic; the agent's own actions sit on its card's menu.
  function manageRow(row: ConversationRow): (() => void) | undefined {
    if (row.topic) return canTopic ? () => setTopicAction({ row, prompt: 'menu' }) : undefined;
    return manage(row.agent);
  }

  const bridgeButton = (
    <Button
      size="$3"
      circular
      chromeless
      scaleIcon={1.3}
      aria-label="Switch bridge"
      icon={<Server />}
      onPress={() => router.push('/installs')}
    />
  );
  const actions = (
    <XStack items="center">
      <Button
        size="$3"
        circular
        chromeless
        scaleIcon={1.3}
        aria-label="Elements"
        icon={<Cards />}
        onPress={() => router.push('/elements')}
      />
      {canCreate ? (
        <Button
          size="$3"
          circular
          chromeless
          scaleIcon={1.3}
          aria-label="New agent"
          icon={<Plus size={22} />}
          onPress={() => router.push('/create-agent')}
        />
      ) : null}
      <Button
        size="$3"
        circular
        chromeless
        scaleIcon={1.3}
        aria-label="Settings"
        icon={<Gear />}
        onPress={() => router.push('/settings')}
      />
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
          <NoticeRow key={notice.id} notice={notice} />
        ))}
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
                    canTopic={canTopic}
                    onNewTopic={() => setPrompt(item.group.agent)}
                    onManage={manage(item.group.agent)}
                  />
                  {item.group.conversations.map((row) => (
                    <Row key={row.id} row={row} grouped onPress={() => openChat(row.id)} onManage={manageRow(row)} />
                  ))}
                </ListCard>
              </YStack>
            ) : (
              <Row row={item.row} grouped={false} onPress={() => openChat(item.row.id)} onManage={manageRow(item.row)} />
            )
          }
        />
        {prompt ? (
          <TitlePrompt
            heading={`New topic for ${prompt.name}`}
            note="Its own session, so this agent keeps the topic apart from its other work."
            action="Create"
            submit={(title) => store.createTopic(prompt.id, title)}
            onClose={() => setPrompt(null)}
            onDone={(conv) => {
              setPrompt(null);
              openChat(conv);
            }}
          />
        ) : null}
        {topicAction?.prompt === 'menu' ? (
          <Menu title={topicAction.row.title} onClose={() => setTopicAction(null)}>
            <ListRow icon={Pencil} label="Rename topic" onPress={() => setTopicAction({ row: topicAction.row, prompt: 'rename' })} />
            <ListRow
              icon={Trash}
              label="Delete topic"
              danger
              onPress={() => setTopicAction({ row: topicAction.row, prompt: 'delete' })}
            />
          </Menu>
        ) : topicAction?.prompt === 'rename' ? (
          <RenameTopic row={topicAction.row} onClose={() => setTopicAction(null)} />
        ) : topicAction?.prompt === 'delete' ? (
          <DeleteTopic row={topicAction.row} onClose={() => setTopicAction(null)} />
        ) : null}
        {action?.prompt === 'menu' ? (
          <Menu title={action.agent.name} onClose={() => setAction(null)}>
            <AgentMenuItems
              agent={action.agent}
              capabilities={snapshot.capabilities}
              onPick={(next) => setAction({ agent: action.agent, prompt: next })}
              onResumed={() => setAction(null)}
              onKeys={() => {
                setAction(null);
                router.push(`/agent-keys?agent=${encodeURIComponent(action.agent.id)}`);
              }}
            />
          </Menu>
        ) : action ? (
          <AgentPrompts agent={action.agent} prompt={action.prompt} onClose={() => setAction(null)} />
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

function AgentHeader({
  group,
  canTopic,
  onNewTopic,
  onManage,
}: {
  group: AgentGroup;
  canTopic: boolean;
  onNewTopic: () => void;
  onManage: (() => void) | undefined;
}) {
  const paused = group.agent.status === 'paused';
  const unread = group.conversations.reduce((sum, row) => sum + row.unread, 0);
  return (
    <XStack items="center" gap="$2" pl="$4" pr="$2" py="$2" minH={48} borderBottomWidth={LINE} borderColor="$color5">
      <Face seed={group.agent.id} />
      <Text flex={1} fontSize="$2" fontWeight="700" color="$color11" numberOfLines={1}>
        {group.agent.name}
      </Text>
      {unread > 0 ? <Badge count={unread} /> : null}
      {paused ? <PausedLabel /> : null}
      {canTopic && !paused ? (
        <Button size="$2" chromeless icon={<Plus size={16} />} aria-label={`New topic for ${group.agent.name}`} onPress={onNewTopic}>
          New topic
        </Button>
      ) : null}
      {onManage ? (
        <Button size="$2" circular chromeless icon={<Dots size={18} />} aria-label={`Manage ${group.agent.name}`} onPress={onManage} />
      ) : null}
    </XStack>
  );
}

function PausedLabel() {
  return (
    <XStack bg="$color4" rounded="$10" px="$2" items="center">
      <Text fontSize="$1" color="$color11" fontWeight="700">
        Paused
      </Text>
    </XStack>
  );
}

// A row inside its agent's card, or a bubble of its own; a long press opens the agent's actions.
function Row({ row, grouped, onPress, onManage }: { row: ConversationRow; grouped: boolean; onPress: () => void; onManage: (() => void) | undefined }) {
  const paused = row.agent?.status === 'paused';
  const busy = row.activity !== null && !paused;
  const preview = busy && row.activity ? activityLabel(row.activity) : row.preview;
  const body = (
    <>
      <XStack items="center" gap="$2">
        {grouped ? null : <Face seed={row.agentId} />}
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
  if (grouped) {
    return (
      <YStack pl="$4" pressStyle={{ bg: '$color4' }} opacity={paused ? 0.6 : 1} onPress={onPress} onLongPress={onManage}>
        <YStack py="$3" pr="$4" gap="$1" borderBottomWidth={LINE} borderColor="$color5">
          {body}
        </YStack>
      </YStack>
    );
  }
  return (
    <YStack
      mx="$3"
      px="$4"
      py="$3"
      gap="$1"
      rounded="$8"
      bg="$color3"
      pressStyle={{ bg: '$color4' }}
      opacity={paused ? 0.6 : 1}
      onPress={onPress}
      onLongPress={onManage}
    >
      {body}
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
