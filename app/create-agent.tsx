import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Paragraph, ScrollView, Text, YStack, useTheme } from 'tamagui';
import type { TemplateInfo } from '../src/protocol/index';
import { useConnection } from '../src/relay/connection';
import { SYSTEM_CONV, store, useStore } from '../src/store';
import { MAX_NAME_CHARS, MAX_PURPOSE_CHARS, agentFolder, nameFailure } from '../src/store/store';
import type { CreateState } from '../src/store/types';
import { Field, Pill } from '../src/ui/controls';
import { Check } from '../src/ui/icons';
import { KeyboardSpace } from '../src/ui/keyboard';
import { ListRow, ListSection, SectionTitle } from '../src/ui/list';
import { AgentDot, ConnectionBanner } from '../src/ui/status';

// How long the host may take before the screen stops asking the phone to wait for it.
const SLOW_MS = 30_000;

type Start = { kind: 'blank' } | { kind: 'template'; ref: string } | { kind: 'copy'; agentId: string };

// The store replaces the create object on every change, so the screen tracks the one it started.
function sameCreate(a: CreateState | null, b: CreateState | null): boolean {
  return a !== null && b !== null && a.startedAt === b.startedAt && a.packetId === b.packetId;
}

export default function CreateAgent() {
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('');
  const [start, setStart] = useState<Start>({ kind: 'blank' });
  const [ticket, setTicket] = useState<CreateState | null>(null);
  const [slow, setSlow] = useState(false);

  const create = sameCreate(snapshot.create, ticket) ? snapshot.create : null;
  const conv = create?.conv;
  const waiting = create !== null && create.state !== 'failed' && conv === undefined;

  useEffect(() => {
    if (conv === undefined) return;
    router.replace(`/chat/${encodeURIComponent(conv)}`);
  }, [conv, router]);

  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [waiting]);

  const templates = snapshot.capabilities?.templates === true ? snapshot.templates : [];
  const systemAgentId = snapshot.conversations.find((row) => row.id === SYSTEM_CONV)?.agentId;
  const sources = snapshot.agents.filter((agent) => agent.id !== systemAgentId);
  const trimmed = name.trim();
  const refusal = trimmed.length > 0 ? nameFailure(trimmed) : null;
  const folder = refusal ? null : agentFolder(trimmed);
  const connected = conn.phase === 'connected';
  const blocked = !connected || waiting || trimmed.length === 0 || refusal !== null || purpose.trim().length > MAX_PURPOSE_CHARS;

  function submit(): void {
    if (blocked) return;
    const started = store.createAgent({
      name: trimmed,
      ...(purpose.trim().length > 0 && { purpose: purpose.trim() }),
      ...(start.kind === 'template' && { template: start.ref }),
      ...(start.kind === 'copy' && { copyFrom: start.agentId }),
    });
    if (started) setTicket(started);
  }

  const tick = <Check color={theme.color.val} />;

  return (
    <>
      <Stack.Screen options={{ title: 'New agent' }} />
      <YStack flex={1}>
        <ConnectionBanner phase={conn.phase} error={conn.error} />
        <ScrollView keyboardShouldPersistTaps="handled">
          <YStack p="$4" gap="$5">
            <YStack gap="$2">
              <SectionTitle>Name</SectionTitle>
              <Field
                value={name}
                onChangeText={setName}
                placeholder="Scout"
                maxLength={MAX_NAME_CHARS}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
              />
              <Note color={refusal ? '$red10' : '$color11'}>
                {refusal ? refusal.message : folder ? `Its folder will be ${folder}.` : 'What you will call this agent.'}
              </Note>
            </YStack>

            <ListSection title="Start from">
              <ListRow
                label="Blank"
                trailing={start.kind === 'blank' ? tick : null}
                onPress={() => setStart({ kind: 'blank' })}
              />
              {templates.length > 0 ? (
                <ListRow
                  label="Template"
                  trailing={start.kind === 'template' ? tick : null}
                  onPress={() => setStart({ kind: 'template', ref: templates[0]?.ref ?? '' })}
                />
              ) : null}
              {sources.length > 0 ? (
                <ListRow
                  label="Copy an agent"
                  trailing={start.kind === 'copy' ? tick : null}
                  onPress={() => setStart({ kind: 'copy', agentId: sources[0]?.id ?? '' })}
                />
              ) : null}
            </ListSection>

            {start.kind === 'template' ? (
              <ListSection title="Template">
                {templates.map((template) => (
                  <ListRow
                    key={template.ref}
                    label={template.name}
                    value={template.version}
                    detail={templateDetail(template)}
                    detailLines={4}
                    trailing={start.ref === template.ref ? tick : null}
                    onPress={() => setStart({ kind: 'template', ref: template.ref })}
                  />
                ))}
              </ListSection>
            ) : null}

            {start.kind === 'copy' ? (
              <YStack gap="$2">
                <ListSection title="Agent to copy">
                  {sources.map((agent) => (
                    <ListRow
                      key={agent.id}
                      leading={<AgentDot status={agent.status} />}
                      label={agent.name}
                      value={agent.model}
                      trailing={start.agentId === agent.id ? tick : null}
                      onPress={() => setStart({ kind: 'copy', agentId: agent.id })}
                    />
                  ))}
                </ListSection>
                <Note>Its settings, MCP servers and instructions are copied. Installed packages are not.</Note>
              </YStack>
            ) : null}

            <YStack gap="$2">
              <SectionTitle>Purpose</SectionTitle>
              <Field
                multiline
                minH={110}
                textAlignVertical="top"
                value={purpose}
                onChangeText={setPurpose}
                placeholder="Watch the shared inbox and draft replies for me"
                maxLength={MAX_PURPOSE_CHARS}
              />
              <Note>Optional. With a purpose the agent sets itself up and asks you up to three questions in its first chat.</Note>
            </YStack>
          </YStack>
        </ScrollView>

        <YStack gap="$2" px="$4" pt="$2" pb="$4">
          <Pill kind="primary" busy={waiting} disabled={blocked} onPress={submit}>
            Create agent
          </Pill>
          {create?.state === 'failed' && create.error ? (
            <Paragraph fontSize="$2" color="$red10">
              {create.error.message}
            </Paragraph>
          ) : null}
          {waiting && slow ? (
            <Paragraph fontSize="$2" color="$color11">
              Still setting up. {create?.name ?? 'The agent'} will appear in the list when the host finishes, and you can leave this
              screen.
            </Paragraph>
          ) : null}
          {!connected && create?.state !== 'failed' ? (
            <Paragraph fontSize="$2" color="$color11">
              Connect to the bridge to create an agent.
            </Paragraph>
          ) : null}
        </YStack>
        <KeyboardSpace minimum={insets.bottom} />
      </YStack>
    </>
  );
}

function Note({ children, color = '$color11' }: { children: string; color?: '$color11' | '$red10' }) {
  return (
    <Text px="$4" fontSize="$2" color={color}>
      {children}
    </Text>
  );
}

function templateDetail(template: TemplateInfo): string | undefined {
  const parts = [
    template.tasks > 0 ? `includes ${template.tasks} ${template.tasks === 1 ? 'task' : 'tasks'}, created paused` : null,
    template.mcpServers > 0 ? `${template.mcpServers} MCP` : null,
    template.skills > 0 ? `${template.skills} skills` : null,
  ].filter((part): part is string => part !== null);
  const lines = [template.description, parts.join(', ')].filter((line) => line !== undefined && line.length > 0);
  return lines.length > 0 ? lines.join('\n') : undefined;
}
