import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, type ScrollViewProps } from 'react-native';
import { KeyboardChatScrollView, KeyboardGestureArea } from 'react-native-keyboard-controller';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Spinner, Text, XStack, YStack, useTheme, useThemeName } from 'tamagui';
import { pickFiles, pickPhotos, type Picked } from '../../src/files/pick';
import type { Agent, ApprovalDecision, Capabilities } from '../../src/protocol/index';
import { useConnection } from '../../src/relay/connection';
import { MAX_ATTACHMENTS, SYSTEM_CONV, attachmentFailure, store, useConversation, useStore } from '../../src/store';
import type { Attachment, ChatEntry, ConversationRow, Notice, OpenApproval, OpenQuestion } from '../../src/store/types';
import { FileView } from '../../src/ui/attachments';
import { ArrowUp, Cards, ChatPlus, Close, Dots, File, Mic, Pencil, Photo, Plus, Trash } from '../../src/ui/icons';
import { KeyboardRider } from '../../src/ui/keyboard';
import { ListRow } from '../../src/ui/list';
import { Markdown } from '../../src/ui/markdown';
import { AgentMenuItems, AgentPrompts, ResumeButton, canManage, type AgentPrompt } from '../../src/ui/agent-actions';
import { ConnectionBanner } from '../../src/ui/status';
import { ThinkingRow } from '../../src/ui/thinking';
import { ElementLink } from '../../src/ui/element';
import { DeleteTopic, Menu, RenameTopic, TitlePrompt } from '../../src/ui/topics';
import { fileSize, shortTime } from '../../src/ui/time';

const DECISION: Record<ApprovalDecision, string> = { allow: 'Allow', deny: 'Deny', allow_always: 'Always allow' };

const COMPOSER_ID = 'composer';

// iOS 26 and later draw the input bar in Liquid Glass; elsewhere it stays a solid pill.
const GLASS = isGlassEffectAPIAvailable();
const BAR_RADIUS = 26;
const RIDER = { position: 'absolute', left: 0, right: 0, bottom: 0 } as const;

// How long a freshly created agent may stay silent before the chat says its container may not have started.
const STALL_MS = 5 * 60_000;

type Prompt = 'menu' | 'new' | 'rename' | 'delete' | 'attach' | { agent: AgentPrompt } | null;

export default function Chat() {
  const params = useLocalSearchParams<{ conv: string }>();
  const conv = decodeId(params.conv);
  const conn = useConnection();
  const router = useRouter();
  const snapshot = useStore();
  const state = useConversation(conv);
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const dark = useThemeName().startsWith('dark');
  const riderHeight = useSharedValue(0);
  const renderScroll = useCallback((props: ScrollViewProps) => <ChatScroll {...props} under={riderHeight} />, [riderHeight]);
  const [draft, setDraft] = useState('');
  const [prompt, setPrompt] = useState<Prompt>(null);
  const [hushed, setHushed] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [composerHeight, setComposerHeight] = useState(0);
  const unsent = useRef<Attachment[]>([]);
  unsent.current = attachments;
  // Files picked but never sent leave with the screen.
  useEffect(() => () => unsent.current.forEach((one) => store.unattach(one)), []);

  const row = snapshot.conversations.find((item) => item.id === conv);
  const agentName = row?.agent?.name ?? row?.title ?? 'agent';
  const readOnly = conv === SYSTEM_CONV;
  const canTopic = snapshot.capabilities?.topics === true && !readOnly && row !== undefined;
  const agent = row?.agent ?? null;
  const canAgent = !readOnly && canManage(agent, snapshot.capabilities);
  const canAttach = snapshot.capabilities?.files === true && !readOnly;
  const paused = agent?.status === 'paused';
  const composing = !readOnly && !(paused && agent);
  const title = row ? (row.topic ? `${agentName} / ${row.title}` : row.title) : readOnly ? 'System' : conv;
  // The catalog dropped this conversation, so it was deleted here or by another client.
  const gone = snapshot.conversations.length > 0 && row === undefined && !readOnly;
  const system = useConversation(SYSTEM_CONV);
  const waitingInSystem = readOnly ? 0 : system.approvals.filter((open) => open.decided === undefined).length;
  // Only the agent this phone just made: nothing else here knows when a container was asked to start.
  const created = snapshot.create?.conv === conv ? snapshot.create : null;
  const silent = created !== null && !state.messages.some((entry) => entry.role === 'agent');
  const stalled = useStalled(silent && created ? created.startedAt : undefined) && !hushed;
  // A history request while the bridge is offline sends nothing, so try again once it is back.
  useEffect(() => {
    store.open(conv);
  }, [conv, conn.phase]);

  useEffect(() => {
    if (!gone) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [gone, router]);

  const newestFirst = useMemo(() => state.messages.slice().reverse(), [state.messages]);

  function submit(): void {
    if (!store.send(conv, draft, attachments)) return;
    setDraft('');
    unsent.current = [];
    setAttachments([]);
    setAttachError(null);
  }

  // Each pick is copied into the app's files folder, then measured against the limits.
  async function add(pick: () => Promise<Picked[]>): Promise<void> {
    setPrompt(null);
    setAttaching(true);
    try {
      let current = attachments;
      for (const picked of await pick()) {
        const early = attachmentFailure(current, picked);
        if (early) {
          setAttachError(early.message);
          break;
        }
        const kept = await store.attach(conv, picked);
        if (!kept) {
          setAttachError(`${picked.name} could not be copied.`);
          break;
        }
        const failure = attachmentFailure(current, kept);
        if (failure) {
          store.unattach(kept);
          setAttachError(failure.message);
          break;
        }
        current = [...current, kept];
        setAttachError(null);
      }
      setAttachments(current);
    } finally {
      setAttaching(false);
    }
  }

  function drop(attachment: Attachment): void {
    store.unattach(attachment);
    setAttachments((current) => current.filter((one) => one.uri !== attachment.uri));
    setAttachError(null);
  }

  return (
    <>
      <Stack.Screen
        options={{
          title,
          ...(row && !readOnly && {
            headerRight: () => (
              <Button
                size="$3"
                circular
                chromeless
                scaleIcon={1.3}
                aria-label="Conversation menu"
                icon={<Dots />}
                onPress={() => setPrompt('menu')}
              />
            ),
          }),
        }}
      />
      {/* A drag down the list starts taking the keyboard once the finger reaches the input bar. */}
      <KeyboardGestureArea style={{ flex: 1 }} textInputNativeID={COMPOSER_ID} offset={composerHeight}>
        <YStack flex={1}>
          <ConnectionBanner phase={conn.phase} error={conn.error} />
          {state.notices.map((notice) => (
            <NoticeRow key={notice.id} notice={notice} conv={conv} />
          ))}
          {stalled ? (
            <XStack items="center" gap="$2" px="$4" py="$2" bg="$color3">
              <Text flex={1} fontSize="$2" color="$color11">
                {`${agentName} has not said anything yet. Its container may still be starting, or it may have failed to start.`}
              </Text>
              <Button size="$1" chromeless onPress={() => setHushed(true)}>
                Dismiss
              </Button>
            </XStack>
          ) : null}
          {waitingInSystem > 0 ? (
            <XStack items="center" gap="$2" px="$4" py="$2" bg="$color3">
              <Text flex={1} fontSize="$2" color="$color11">
                {waitingInSystem === 1 ? 'An approval is waiting in System.' : `${waitingInSystem} approvals are waiting in System.`}
              </Text>
              <Button size="$1" chromeless onPress={() => router.push(`/chat/${encodeURIComponent(SYSTEM_CONV)}`)}>
                Open
              </Button>
            </XStack>
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
            renderItem={({ item }) => <Entry entry={item} agentName={agentName} conv={conv} agent={agent} />}
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
            {state.questions.map((open) => (
              <QuestionCard key={open.question.questionId} open={open} conv={conv} />
            ))}
            {state.approvals.map((open) => (
              <ApprovalCard key={open.approval.approvalId} open={open} conv={conv} />
            ))}
            <ThinkingRow activity={state.activity} seed={row?.agentId ?? conv} />
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
                {snapshot.capabilities?.lifecycle ? <ResumeButton agent={agent} /> : null}
              </XStack>
            ) : (
              <YStack px="$3" pt="$1" pb="$2" gap="$2" onLayout={(event) => setComposerHeight(event.nativeEvent.layout.height)}>
                {attachError ? (
                  <XStack items="center" gap="$2" px="$2">
                    <Text flex={1} fontSize="$2" color="$red10">
                      {attachError}
                    </Text>
                    <Button size="$1" chromeless onPress={() => setAttachError(null)}>
                      Dismiss
                    </Button>
                  </XStack>
                ) : null}
                {attachments.length > 0 ? (
                  <XStack gap="$2" flexWrap="wrap">
                    {attachments.map((attachment) => (
                      <Chip key={attachment.uri} attachment={attachment} onRemove={() => drop(attachment)} />
                    ))}
                  </XStack>
                ) : null}
                <YStack
                  gap="$1"
                  rounded={BAR_RADIUS}
                  bg={GLASS ? undefined : '$color3'}
                  borderWidth={GLASS ? 0 : 1}
                  borderColor="$color5"
                >
                  {GLASS ? <GlassView colorScheme={dark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, { borderRadius: BAR_RADIUS }]} /> : null}
                  <Input
                    unstyled
                    multiline
                    minH={44}
                    maxH={120}
                    pt="$3"
                    pb="$1.5"
                    px="$3.5"
                    fontSize="$4"
                    color="$color"
                    placeholderTextColor="$color10"
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Ask anything"
                    nativeID={COMPOSER_ID}
                    onSubmitEditing={submit}
                    submitBehavior="submit"
                  />
                  <XStack items="center" gap="$2" px={10} pb={10}>
                    {canAttach ? (
                      <BarButton
                        label="Attach a file"
                        disabled={attaching || attachments.length >= MAX_ATTACHMENTS}
                        onPress={() => setPrompt('attach')}
                      >
                        {attaching ? <Spinner size="small" /> : <Plus />}
                      </BarButton>
                    ) : null}
                    <YStack flex={1} />
                    <BarButton label="Voice input">
                      <Mic size={20} />
                    </BarButton>
                    <BarButton
                      label="Send"
                      send
                      disabled={attaching || (draft.trim().length === 0 && attachments.length === 0)}
                      onPress={submit}
                    >
                      <ArrowUp size={20} color={theme.color1.val} />
                    </BarButton>
                  </XStack>
                </YStack>
              </YStack>
            )}
            {/* Sits behind the keyboard once it is up; at rest the list shows through it only under the input bar. */}
            <YStack height={insets.bottom} bg={composing ? undefined : '$background'} />
          </KeyboardRider>
          {row && prompt && prompt !== 'attach' ? (
            <TopicPrompts row={row} prompt={prompt} setPrompt={setPrompt} canTopic={canTopic} capabilities={canAgent ? snapshot.capabilities : null} />
          ) : null}
          {prompt === 'attach' ? (
            <Menu title="Attach" onClose={() => setPrompt(null)}>
              <ListRow
                icon={Photo}
                label="Photo library"
                onPress={() => void add(() => pickPhotos(MAX_ATTACHMENTS - attachments.length))}
              />
              <ListRow icon={File} label="Files" onPress={() => void add(pickFiles)} />
            </Menu>
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

// New topic sits here as well, so an agent with one conversation still has a way to make its first.
function TopicPrompts({
  row,
  prompt,
  setPrompt,
  canTopic,
  capabilities,
}: {
  row: ConversationRow;
  prompt: Prompt;
  setPrompt: (next: Prompt) => void;
  canTopic: boolean;
  capabilities: Capabilities | null;
}) {
  const router = useRouter();
  const agentName = row.agent?.name ?? row.title;
  if (typeof prompt === 'object' && prompt !== null) {
    return row.agent ? <AgentPrompts agent={row.agent} prompt={prompt.agent} onClose={() => setPrompt(null)} /> : null;
  }
  if (prompt === 'menu') {
    return (
      <Menu title={row.title} onClose={() => setPrompt(null)}>
        <ListRow
          icon={Cards}
          label="Elements"
          onPress={() => {
            setPrompt(null);
            router.push(`/elements?agent=${encodeURIComponent(row.agentId)}`);
          }}
        />
        {canTopic ? <ListRow icon={ChatPlus} label="New topic" onPress={() => setPrompt('new')} /> : null}
        {canTopic && row.topic ? <ListRow icon={Pencil} label="Rename topic" onPress={() => setPrompt('rename')} /> : null}
        {canTopic && row.topic ? (
          <ListRow icon={Trash} label="Delete topic" danger onPress={() => setPrompt('delete')} />
        ) : null}
        {row.agent && capabilities ? (
          <AgentMenuItems
            agent={row.agent}
            capabilities={capabilities}
            onPick={(next) => setPrompt({ agent: next })}
            onResumed={() => setPrompt(null)}
          />
        ) : null}
      </Menu>
    );
  }
  if (prompt === 'new') {
    return (
      <TitlePrompt
        heading={`New topic for ${agentName}`}
        note="Its own session, so this agent keeps the topic apart from its other work."
        action="Create"
        submit={(title) => store.createTopic(row.agentId, title)}
        onClose={() => setPrompt(null)}
        onDone={(conv) => {
          setPrompt(null);
          router.push(`/chat/${encodeURIComponent(conv)}`);
        }}
      />
    );
  }
  if (prompt === 'rename') return <RenameTopic row={row} onClose={() => setPrompt(null)} />;
  if (prompt === 'delete') return <DeleteTopic row={row} onClose={() => setPrompt(null)} />;
  return null;
}

function decodeId(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// Your own messages sit on the right in a bubble with the time under it; the rest keep a name and time above.
function Entry({ entry, agentName, conv, agent }: { entry: ChatEntry; agentName: string; conv: string; agent: Agent | null }) {
  const failure = entry.local?.failure;
  const mine = entry.role === 'user';
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
    <YStack px="$4" py="$2" gap="$1" opacity={failure ? 0.6 : 1} items={mine ? 'flex-end' : undefined}>
      {mine ? (
        <YStack maxW="80%" px="$4" py="$3" rounded="$8" bg="$color4">
          <Body entry={entry} />
        </YStack>
      ) : (
        <>
          <XStack items="center" gap="$2">
            <Text fontSize="$1" fontWeight="700" color="$color11">
              {entry.role === 'system' ? 'system' : agentName}
            </Text>
            {stamp}
          </XStack>
          <Body entry={entry} />
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
}

// The bar's round buttons; send is the same shape a little wider, in the text color so it stands out.
function BarButton({
  label,
  send,
  disabled,
  onPress,
  children,
}: {
  label: string;
  send?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  const live = onPress !== undefined && !disabled;
  return (
    <YStack
      width={send ? 52 : 36}
      height={36}
      rounded={18}
      items="center"
      justify="center"
      bg={send ? '$color12' : GLASS ? '$color01' : '$color5'}
      opacity={disabled ? 0.4 : 1}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      pressStyle={live ? { opacity: 0.7 } : undefined}
      onPress={live ? onPress : undefined}
    >
      {children}
    </YStack>
  );
}

// A picked file waiting in the composer.
function Chip({ attachment, onRemove }: { attachment: Attachment; onRemove: () => void }) {
  return (
    <XStack items="center" gap="$2" pl="$3" pr="$1" py="$1" rounded="$10" bg="$color3" maxW="100%">
      <Text fontSize="$2" numberOfLines={1} shrink={1}>
        {attachment.name}
      </Text>
      <Text fontSize="$1" color="$color11">
        {fileSize(attachment.size)}
      </Text>
      <Button size="$1" circular chromeless aria-label={`Remove ${attachment.name}`} icon={<Close />} onPress={onRemove} />
    </XStack>
  );
}

function Body({ entry }: { entry: ChatEntry }) {
  if (entry.kind === 'file' && entry.element) {
    return (
      <YStack gap="$2" pt="$2">
        {entry.text ? <Text fontSize="$3">{entry.text}</Text> : null}
        <ElementLink reference={entry.element} />
      </YStack>
    );
  }
  if (entry.kind === 'file' && entry.file) {
    return (
      <YStack gap="$2">
        {entry.text ? <Text fontSize="$3">{entry.text}</Text> : null}
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
        {entry.text ? <Text fontSize="$3">{entry.text}</Text> : null}
        {entry.attachments.map((attachment) => (
          <FileView key={attachment.uri} file={attachment} />
        ))}
      </YStack>
    );
  }
  if (entry.kind === 'card') {
    return (
      <YStack gap="$2">
        {entry.text ? <Text fontSize="$3">{entry.text}</Text> : null}
        <YStack p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$1" color="$color11">
            {describeCard(entry.card)}
          </Text>
        </YStack>
      </YStack>
    );
  }
  if (entry.format === 'markdown' && entry.role !== 'user') return <Markdown value={entry.text} />;
  return <Text fontSize="$3">{entry.text}</Text>;
}

function describeCard(card: unknown): string {
  try {
    const text = JSON.stringify(card, null, 2) ?? '';
    return text.length > 800 ? `${text.slice(0, 800)}...` : text;
  } catch {
    return String(card);
  }
}

// A question buffered while the phone was away can arrive spent, and an open one can run out.
function useExpired(expiresAt: number | undefined): boolean {
  const [expired, setExpired] = useState(() => expiresAt !== undefined && expiresAt <= Date.now());
  useEffect(() => {
    if (expiresAt === undefined) {
      setExpired(false);
      return;
    }
    const left = expiresAt - Date.now();
    if (left <= 0) {
      setExpired(true);
      return;
    }
    setExpired(false);
    const timer = setTimeout(() => setExpired(true), left);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  return expired;
}

// Waits out a silent container without ever asking the host again.
function useStalled(startedAt: number | undefined): boolean {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (startedAt === undefined) {
      setStalled(false);
      return;
    }
    const left = startedAt + STALL_MS - Date.now();
    if (left <= 0) {
      setStalled(true);
      return;
    }
    setStalled(false);
    const timer = setTimeout(() => setStalled(true), left);
    return () => clearTimeout(timer);
  }, [startedAt]);
  return stalled;
}

function QuestionCard({ open, conv }: { open: OpenQuestion; conv: string }) {
  const { question } = open;
  const [picked, setPicked] = useState<string[]>([]);
  const multi = question.multi === true;
  const expired = useExpired(question.expiresAt);

  function toggle(value: string): void {
    setPicked((current) => (current.includes(value) ? current.filter((one) => one !== value) : [...current, value]));
  }

  return (
    <Card>
      {question.title ? <Text fontWeight="700">{question.title}</Text> : null}
      <Text>{question.question}</Text>
      {question.expiresAt ? (
        <Text fontSize="$1" color="$color10">
          {`${expired ? 'Expired' : 'Expires'} ${shortTime(question.expiresAt)}`}
        </Text>
      ) : null}
      {open.answered !== undefined ? (
        <Text fontSize="$2" color="$color11">
          {`Answered: ${[open.answered].flat().join(', ')}`}
        </Text>
      ) : expired ? (
        <Text fontSize="$2" color="$color11">
          This expired before an answer reached the agent, which went on with its default.
        </Text>
      ) : (
        <YStack gap="$2">
          <XStack gap="$2" flexWrap="wrap">
            {question.options.map((option) => (
              <Button
                key={option.value}
                size="$3"
                theme={option.style === 'danger' ? 'red' : option.style === 'primary' ? 'accent' : undefined}
                bg={multi && picked.includes(option.value) ? '$color6' : undefined}
                onPress={() => (multi ? toggle(option.value) : store.answer(conv, question.questionId, option.value))}
              >
                {option.label}
              </Button>
            ))}
          </XStack>
          {multi ? (
            <Button
              theme="accent"
              disabled={picked.length === 0}
              onPress={() => store.answer(conv, question.questionId, picked)}
            >
              {picked.length === 0 ? 'Pick one or more' : `Send ${picked.length}`}
            </Button>
          ) : null}
        </YStack>
      )}
    </Card>
  );
}

function ApprovalCard({ open, conv }: { open: OpenApproval; conv: string }) {
  const { approval } = open;
  return (
    <Card>
      <Text fontWeight="700">{approval.title}</Text>
      {approval.description ? <Text>{approval.description}</Text> : null}
      {approval.command ? (
        <YStack p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$2">
            {approval.command}
          </Text>
        </YStack>
      ) : null}
      {approval.expiresAt ? (
        <Text fontSize="$1" color="$color10">
          {`Expires ${shortTime(approval.expiresAt)}`}
        </Text>
      ) : null}
      {open.decided ? (
        <Text fontSize="$2" color="$color11">
          {`Answered: ${DECISION[open.decided]}`}
        </Text>
      ) : (
        <XStack gap="$2" flexWrap="wrap">
          {approval.decisions.map((decision) => (
            <Button
              key={decision}
              size="$3"
              theme={decision === 'deny' ? 'red' : decision === 'allow' ? 'accent' : undefined}
              onPress={() => store.decide(conv, approval.approvalId, decision)}
            >
              {DECISION[decision]}
            </Button>
          ))}
        </XStack>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <YStack gap="$2" mx="$3" mb="$2" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color1">
      {children}
    </YStack>
  );
}

function NoticeRow({ notice, conv }: { notice: Notice; conv: string }) {
  return (
    <XStack theme="red" items="center" gap="$2" px="$4" py="$2" bg="$color3">
      <Text flex={1} fontSize="$2" color="$color11">
        {notice.message}
      </Text>
      <Button size="$1" chromeless onPress={() => store.dismiss(notice.id, conv)}>
        Dismiss
      </Button>
    </XStack>
  );
}

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

