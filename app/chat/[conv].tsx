import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Input, Spinner, Text, XStack, YStack } from 'tamagui';
import type { ApprovalDecision } from '../../src/protocol/index';
import { useConnection } from '../../src/relay/connection';
import { SYSTEM_CONV, store, useConversation, useStore } from '../../src/store';
import type { ChatEntry, Notice, OpenApproval, OpenQuestion } from '../../src/store/types';
import { useKeyboardInset } from '../../src/ui/keyboard';
import { Markdown } from '../../src/ui/markdown';
import { ActivityRow, ConnectionBanner } from '../../src/ui/status';
import { fileSize, shortTime } from '../../src/ui/time';

const DECISION: Record<ApprovalDecision, string> = { allow: 'Allow', deny: 'Deny', allow_always: 'Always allow' };

export default function Chat() {
  const params = useLocalSearchParams<{ conv: string }>();
  const conv = decodeId(params.conv);
  const conn = useConnection();
  const snapshot = useStore();
  const state = useConversation(conv);
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardInset();
  const [draft, setDraft] = useState('');
  const [composerHeight, setComposerHeight] = useState(0);

  const row = snapshot.conversations.find((item) => item.id === conv);
  const agentName = row?.agent?.name ?? row?.title ?? 'agent';
  const readOnly = conv === SYSTEM_CONV;
  // A history request while the bridge is offline sends nothing, so try again once it is back.
  useEffect(() => {
    store.open(conv);
  }, [conv, conn.phase]);

  const newestFirst = useMemo(() => state.messages.slice().reverse(), [state.messages]);

  function submit(): void {
    if (store.send(conv, draft)) setDraft('');
  }

  return (
    <>
      <Stack.Screen options={{ title: row?.title ?? (readOnly ? 'System' : conv) }} />
      <YStack flex={1} pb={Math.max(keyboard, insets.bottom)}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        {state.notices.map((notice) => (
          <NoticeRow key={notice.id} notice={notice} conv={conv} />
        ))}
        <FlatList
          inverted
          data={newestFirst}
          keyExtractor={(entry) => entry.msgId}
          contentContainerStyle={{ paddingVertical: 8 }}
          keyboardDismissMode="interactive"
          onEndReachedThreshold={0.4}
          onEndReached={() => store.loadOlder(conv)}
          ListFooterComponent={state.loading ? <Spinner size="small" py="$3" /> : null}
          ListEmptyComponent={<Empty loading={state.loading} readOnly={readOnly} />}
          renderItem={({ item }) => <Entry entry={item} agentName={agentName} conv={conv} />}
        />
        {state.questions.map((open) => (
          <QuestionCard key={open.question.questionId} open={open} conv={conv} />
        ))}
        {state.approvals.map((open) => (
          <ApprovalCard key={open.approval.approvalId} open={open} conv={conv} />
        ))}
        {state.activity ? <ActivityRow activity={state.activity} /> : null}
        {readOnly ? (
          <XStack px="$4" py="$3" borderTopWidth={1} borderColor="$borderColor">
            <Text fontSize="$2" color="$color11">
              This conversation is read only.
            </Text>
          </XStack>
        ) : (
          <XStack gap="$2" px="$3" py="$2" items="flex-end" borderTopWidth={1} borderColor="$borderColor">
            {/* A multiline Input sizes itself from its own padding, so the button copies that height. */}
            <Input
              flex={1}
              multiline
              minH="$4"
              maxH={120}
              value={draft}
              onChangeText={setDraft}
              placeholder="Message"
              onSubmitEditing={submit}
              submitBehavior="submit"
              onLayout={(event) => {
                if (draft.length === 0) setComposerHeight(event.nativeEvent.layout.height);
              }}
            />
            <Button
              theme="accent"
              height={composerHeight || undefined}
              disabled={draft.trim().length === 0}
              onPress={submit}
            >
              Send
            </Button>
          </XStack>
        )}
      </YStack>
    </>
  );
}

function decodeId(raw: string | undefined): string {
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function Entry({ entry, agentName, conv }: { entry: ChatEntry; agentName: string; conv: string }) {
  const failure = entry.local?.failure;
  const who = entry.role === 'user' ? 'you' : entry.role === 'system' ? 'system' : agentName;
  return (
    <YStack px="$4" py="$2" gap="$1" opacity={failure ? 0.6 : 1}>
      <XStack items="center" gap="$2">
        <Text fontSize="$1" fontWeight="700" color={entry.role === 'user' ? '$blue10' : '$color11'}>
          {who}
        </Text>
        <Text fontSize="$1" color="$color10">
          {shortTime(entry.at)}
        </Text>
        {entry.edited ? (
          <Text fontSize="$1" color="$color10">
            edited
          </Text>
        ) : null}
      </XStack>
      <Body entry={entry} />
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
          <XStack gap="$2">
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

function Body({ entry }: { entry: ChatEntry }) {
  if (entry.kind === 'file' && entry.file) {
    return (
      <YStack gap="$1" p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
        <Text fontWeight="600">{entry.file.name}</Text>
        <Text fontSize="$1" color="$color11">
          {`${entry.file.mime}, ${fileSize(entry.file.size)}`}
        </Text>
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

function QuestionCard({ open, conv }: { open: OpenQuestion; conv: string }) {
  const { question } = open;
  const [picked, setPicked] = useState<string[]>([]);
  const multi = question.multi === true;

  function toggle(value: string): void {
    setPicked((current) => (current.includes(value) ? current.filter((one) => one !== value) : [...current, value]));
  }

  return (
    <Card>
      {question.title ? <Text fontWeight="700">{question.title}</Text> : null}
      <Text>{question.question}</Text>
      {question.expiresAt ? (
        <Text fontSize="$1" color="$color10">
          {`Expires ${shortTime(question.expiresAt)}`}
        </Text>
      ) : null}
      {open.answered !== undefined ? (
        <Text fontSize="$2" color="$color11">
          {`Answered: ${[open.answered].flat().join(', ')}`}
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

