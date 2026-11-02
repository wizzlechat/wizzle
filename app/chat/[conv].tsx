import { Stack, useIsFocused, useLocalSearchParams, useRouter } from 'expo-router';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, type ListRenderItem, type ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, KeyboardGestureArea } from 'react-native-keyboard-controller';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import { useConnection } from '../../src/relay/connection';
import { MAX_ATTACHMENTS, SYSTEM_CONV, store, useCapabilities, useConversation, useProfile, useRoom, useRow, useSelector } from '../../src/store';
import type { AgentView, ChatEntry } from '../../src/store/types';
import { AgentMenu, AgentPrompts, ResumeButton, type AgentPrompt } from '../../src/ui/agent-actions';
import { Banner } from '../../src/ui/banner';
import { ApprovalCard } from '../../src/ui/cards';
import { AttachMenu, Composer, useComposer } from '../../src/ui/composer';
import { useDeadline } from '../../src/ui/deadline';
import { Entry, type EntryRoom } from '../../src/ui/entry';
import { faceColor } from '../../src/ui/face';
import { Dots } from '../../src/ui/icons';
import { KeyboardRider } from '../../src/ui/keyboard';
import { TopicPrompts, type Prompt } from '../../src/ui/prompts';
import { AvatarStrip, ContinueRow, withMention, type RoomContext } from '../../src/ui/room-chat';
import { RoomPrompts, mentionables, roomMembers, type RoomPrompt } from '../../src/ui/rooms';
import { ConnectionBanner } from '../../src/ui/status';
import { ThinkingRow } from '../../src/ui/thinking';
import { chatHref, chatTitle, decodeId } from '../../src/ui/titles';

const RIDER = { position: 'absolute', left: 0, right: 0, bottom: 0 } as const;

// How long a freshly created agent may stay silent before the chat says its container may not have started.
const STALL_MS = 5 * 60_000;

export default function Chat() {
  const params = useLocalSearchParams<{ conv: string }>();
  const conv = decodeId(params.conv);
  // One id per chat: a chat closing on top of another drops only its own keyboard registration.
  const composerId = `composer:${conv}`;
  const conn = useConnection();
  const router = useRouter();
  const row = useRow(conv);
  const capabilities = useCapabilities();
  const state = useConversation(conv);
  const seed = row?.agentId ?? conv;
  const look = useProfile(seed);
  const listed = useSelector((snapshot) => snapshot.conversations.length > 0);
  // Only the agent wizzle just made: nothing else here knows when a container was asked to start.
  const created = useSelector((snapshot) => (snapshot.create?.conv === conv ? snapshot.create : null));
  const insets = useSafeAreaInsets();
  const riderHeight = useSharedValue(0);
  const renderScroll = useCallback((props: ScrollViewProps) => <ChatScroll {...props} under={riderHeight} />, [riderHeight]);
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [hushed, setHushed] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const composer = useComposer(conv);
  const theme = useTheme();
  const room = useRoom(conv);
  const agents = useSelector((snapshot) => snapshot.agents);
  const profiles = useSelector((snapshot) => snapshot.profiles);
  const [roomPrompt, setRoomPrompt] = useState<RoomPrompt | null>(null);
  const [memberMenu, setMemberMenu] = useState<{ agent: AgentView; prompt: 'menu' | AgentPrompt } | null>(null);
  // Once a room, always a room: a room missing from the catalog was deleted.
  const wasRoom = useRef(false);
  if (room) wasRoom.current = true;
  const members = useMemo(() => (room ? roomMembers(room, profiles) : []), [room, profiles]);
  const working = useMemo(() => new Set((room?.activities ?? []).flatMap((one) => (one.speaker ? [one.speaker] : []))), [room?.activities]);
  const roomContext = useMemo<RoomContext | undefined>(() => (room ? { members, working } : undefined), [room, members, working]);
  const blue = theme.blue10.val;
  const ink = theme.color.val;
  const entryRoom = useMemo<EntryRoom | undefined>(() => {
    if (!room) return undefined;
    const people: EntryRoom['people'] = {};
    for (const agent of agents) people[agent.id] = { name: agent.name, color: faceColor(agent.id, profiles[agent.id]?.hue), look: profiles[agent.id] };
    const named = mentionables(members);
    const color = (id: string | null) => (id === null ? blue : (members.find((member) => member.id === id)?.color ?? ink));
    return { members, people, mentions: { members: named, color } };
  }, [room, agents, profiles, members, blue, ink]);

  const agentName = row?.agent?.name ?? row?.title ?? 'agent';
  const nameColor = faceColor(seed, look?.hue);
  const readOnly = conv === SYSTEM_CONV;
  const canTopic = capabilities?.topics === true && !readOnly && row !== undefined;
  const canClear = capabilities?.clearSession === true && !readOnly && row !== undefined;
  const agent = row?.agent ?? null;
  const canAttach = capabilities?.files === true && !readOnly;
  const paused = agent?.status === 'paused';
  const composing = !readOnly && !(paused && agent);
  // The catalog dropped this conversation, so it was deleted here or by another client.
  const gone = wasRoom.current ? room === undefined : listed && row === undefined && !readOnly;
  const system = useConversation(SYSTEM_CONV);
  const waitingInSystem = readOnly ? 0 : system.approvals.filter((open) => open.decided === undefined).length;
  const silent = created !== null && !state.messages.some((entry) => entry.role === 'agent');
  const stalled = useDeadline(silent && created ? created.startedAt + STALL_MS : undefined) && !hushed;
  // A history request while the bridge is offline sends nothing, so try again once it is back.
  useEffect(() => {
    store.open(conv);
  }, [conv, conn.phase]);

  // Whatever lands while this chat is the screen in front is read as it arrives.
  const focused = useIsFocused();
  useEffect(() => {
    if (focused) store.markRead(conv);
  }, [conv, focused, state.messages]);

  useEffect(() => {
    if (!gone) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [gone, router]);

  // An open question is a row at the time it arrived, so its card stays in place and scrolls with the chat.
  const newestFirst = useMemo(() => {
    const asked: ChatEntry[] = state.questions.map((open) => ({
      conv,
      msgId: `question:${open.question.questionId}`,
      role: 'agent',
      text: '',
      format: 'text',
      at: open.at,
      kind: 'question',
      question: open,
      ...(open.question.speaker !== undefined && { speaker: open.question.speaker }),
    }));
    return [...state.messages, ...asked].sort((a, b) => a.at - b.at).reverse();
  }, [state.messages, state.questions, conv]);
  const renderItem: ListRenderItem<ChatEntry> = useCallback(
    ({ item }) => <Entry entry={item} agentName={agentName} nameColor={nameColor} conv={conv} agent={agent} {...(entryRoom && { room: entryRoom })} />,
    [agentName, nameColor, conv, agent, entryRoom],
  );

  const menuButton = (
    <Button
      size="$3"
      circular
      chromeless
      scaleIcon={1.3}
      aria-label={room ? 'Room menu' : 'Conversation menu'}
      icon={<Dots />}
      onPress={() => (room ? setRoomPrompt('menu') : setPrompt('menu'))}
    />
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: room ? room.title : chatTitle(row, conv),
          ...((row || room) && !readOnly && {
            headerRight: () => menuButton,
          }),
        }}
      />
      {/* A drag down the list starts taking the keyboard once the finger reaches the input bar. */}
      <KeyboardGestureArea style={{ flex: 1 }} textInputNativeID={composerId} offset={composerHeight}>
        <YStack flex={1}>
          {roomContext ? (
            <AvatarStrip
              context={roomContext}
              onTap={(member) => composer.setDraft((draft) => withMention(draft, member.handle))}
              onHold={(member) => {
                const view = agents.find((one) => one.id === member.id);
                if (view) setMemberMenu({ agent: view, prompt: 'menu' });
              }}
            />
          ) : null}
          <ConnectionBanner phase={conn.phase} error={conn.error} />
          {state.notices.map((notice) => (
            <Banner key={notice.id} danger action="Dismiss" onAction={() => store.dismiss(notice.id, conv)}>
              {notice.message}
            </Banner>
          ))}
          {stalled ? (
            <Banner action="Dismiss" onAction={() => setHushed(true)}>
              {`${agentName} has not said anything yet. Its container may still be starting, or it may have failed to start.`}
            </Banner>
          ) : null}
          {waitingInSystem > 0 ? (
            <Banner action="Open" onAction={() => router.push(chatHref(SYSTEM_CONV))}>
              {waitingInSystem === 1 ? 'An approval is waiting in System.' : `${waitingInSystem} approvals are waiting in System.`}
            </Banner>
          ) : null}
          <FlatList
            inverted
            data={newestFirst}
            keyExtractor={(entry) => entry.msgId}
            contentContainerStyle={{ paddingVertical: 8 }}
            keyboardDismissMode="interactive"
            renderScrollComponent={renderScroll}
            onEndReachedThreshold={0.4}
            onEndReached={() => store.loadOlder(conv)}
            ListFooterComponent={state.loading ? <Spinner size="small" py="$3" /> : null}
            ListEmptyComponent={<Empty loading={state.loading} readOnly={readOnly} />}
            renderItem={renderItem}
          />
          {/* Cards, activity and the input bar ride the keyboard by transform, so they track it frame for frame.
              They float over the list, which scrolls on underneath the input bar. */}
          <KeyboardRider
            rest={insets.bottom}
            style={RIDER}
            onLayout={(event) => {
              riderHeight.value = event.nativeEvent.layout.height;
            }}
          >
            {state.approvals.map((open) => (
              <ApprovalCard key={open.approval.approvalId} open={open} conv={conv} />
            ))}
            {room && room.held.length > 0 ? <ContinueRow held={room.held} members={members} onContinue={() => store.continueRoom(conv)} /> : null}
            {/* One row per member, so each rises and drops on its own. */}
            {room ? (
              members.map((member) => (
                <ThinkingRow
                  key={member.id}
                  activity={room.activities.find((one) => one.speaker === member.id) ?? null}
                  seed={member.id}
                  look={member.look}
                />
              ))
            ) : (
              <ThinkingRow activity={state.activity} seed={seed} look={look} />
            )}
            {readOnly ? (
              <XStack px="$4" py="$3" bg="$background" borderTopWidth={1} borderColor="$borderColor">
                <Text fontSize="$2" color="$color11">
                  This conversation is read only.
                </Text>
              </XStack>
            ) : paused && agent ? (
              <XStack items="center" gap="$2" px="$4" py="$2" bg="$background" borderTopWidth={1} borderColor="$borderColor">
                <Text flex={1} fontSize="$2" color="$color11">
                  Paused. Resume to send.
                </Text>
                {capabilities?.lifecycle ? <ResumeButton agent={agent} /> : null}
              </XStack>
            ) : (
              <Composer
                composer={composer}
                canAttach={canAttach}
                nativeID={composerId}
                onAttach={() => setPrompt('attach')}
                onLayout={setComposerHeight}
                {...(roomContext && { room: roomContext })}
              />
            )}
            {/* Sits behind the keyboard once it is up; at rest the list shows through it only under the input bar. */}
            <YStack height={insets.bottom} bg={composing ? undefined : '$background'} />
          </KeyboardRider>
          {row && prompt && prompt !== 'attach' ? (
            <TopicPrompts row={row} look={look} prompt={prompt} setPrompt={setPrompt} canTopic={canTopic} canClear={canClear} capabilities={capabilities} />
          ) : null}
          {room && roomPrompt ? <RoomPrompts room={room} prompt={roomPrompt} setPrompt={setRoomPrompt} onClose={() => setRoomPrompt(null)} /> : null}
          {memberMenu ? (
            memberMenu.prompt === 'menu' ? (
              <AgentMenu
                title={memberMenu.agent.name}
                seed={memberMenu.agent.id}
                agent={memberMenu.agent}
                look={profiles[memberMenu.agent.id]}
                capabilities={capabilities}
                onPick={(next) => setMemberMenu({ agent: memberMenu.agent, prompt: next })}
                onClose={() => setMemberMenu(null)}
              />
            ) : (
              <AgentPrompts agent={memberMenu.agent} prompt={memberMenu.prompt} onClose={() => setMemberMenu(null)} />
            )
          ) : null}
          {prompt === 'attach' ? (
            <AttachMenu
              remaining={MAX_ATTACHMENTS - composer.attachments.length}
              onPick={(pick) => {
                setPrompt(null);
                void composer.add(pick);
              }}
              onClose={() => setPrompt(null)}
            />
          ) : null}
        </YStack>
      </KeyboardGestureArea>
    </>
  );
}

// The list takes its keyboard room from content inset on the keyboard's own frames, not from a layout change.
// `under` is the height floating over its bottom edge, so the newest message clears the input bar.
const ChatScroll = forwardRef<React.ComponentRef<typeof KeyboardChatScrollView>, ScrollViewProps & { under: SharedValue<number> }>(
  ({ under, ...props }, ref) => {
    const insets = useSafeAreaInsets();
    return (
      <KeyboardChatScrollView
        ref={ref}
        automaticallyAdjustContentInsets={false}
        contentInsetAdjustmentBehavior="never"
        {...props}
        inverted
        offset={insets.bottom}
        extraContentPadding={under}
      />
    );
  },
);

function Empty({ loading, readOnly }: { loading: boolean; readOnly: boolean }) {
  if (loading) return null;
  return (
    <YStack p="$6" items="center" style={{ transform: [{ scaleY: -1 }] }}>
      <Text color="$color11" text="center">
        {readOnly ? 'Nothing from the bridge yet.' : 'No messages yet. Say something.'}
      </Text>
    </YStack>
  );
}
