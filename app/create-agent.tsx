import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
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
import { KeyRows, useAddedSecret } from '../src/ui/keys';
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
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

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

  const connected = conn.phase === 'connected';
  const keys = snapshot.capabilities?.keys === true;

  // The library may have been out of reach when the connection first listed templates.
  useEffect(() => {
    if (!connected) return;
    store.loadTemplates(true);
    store.loadSecrets();
  }, [connected]);

  const pick = useCallback((secretId: string) => setPicked((current) => new Set([...current, secretId])), []);
  useAddedSecret(snapshot.newestSecret, pick);

  function toggleKey(secretId: string): void {
    setPicked((current) => (current.has(secretId) ? new Set([...current].filter((one) => one !== secretId)) : new Set([...current, secretId])));
  }

  const templates = snapshot.capabilities?.templates === true ? snapshot.templates : [];
  const installed = templates.filter((template) => template.category === undefined);
  const categories = [...new Set(templates.flatMap((template) => (template.category !== undefined ? [template.category] : [])))];
  const chosen = start.kind === 'template' ? templates.find((template) => template.ref === start.ref) : undefined;
  const systemAgentId = snapshot.conversations.find((row) => row.id === SYSTEM_CONV)?.agentId;
  const sources = snapshot.agents.filter((agent) => agent.id !== systemAgentId);
  const trimmed = name.trim();
  const refusal = trimmed.length > 0 ? nameFailure(trimmed) : null;
  const folder = refusal ? null : agentFolder(trimmed);
  const blocked = !connected || waiting || trimmed.length === 0 || refusal !== null || purpose.trim().length > MAX_PURPOSE_CHARS;

  function submit(): void {
    if (blocked) return;
    const started = store.createAgent({
      name: trimmed,
      ...(purpose.trim().length > 0 && { purpose: purpose.trim() }),
      ...(start.kind === 'template' && { template: start.ref }),
      ...(start.kind === 'copy' && { copyFrom: start.agentId }),
      // A key deleted since it was picked is dropped here rather than refused by the host.
      ...(keys && { secrets: [...picked].filter((id) => snapshot.secrets?.some((secret) => secret.id === id)) }),
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
              <YStack gap="$4">
                {[
                  { title: 'Installed', list: installed },
                  ...categories.map((category) => ({
                    title: categoryTitle(category),
                    list: templates.filter((template) => template.category === category),
                  })),
                ]
                  .filter((group) => group.list.length > 0)
                  .map((group) => (
                    <ListSection key={group.title} title={group.title}>
                      {group.list.map((template) => (
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
                  ))}
                {chosen?.category !== undefined && !chosen.downloaded ? (
                  <Note>From the public template library. The host downloads it when you create the agent.</Note>
                ) : null}
              </YStack>
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

            {keys ? (
              <YStack gap="$2">
                <ListSection title="Keys">
                  <KeyRows
                    secrets={snapshot.secrets === null && snapshot.keysError === null ? null : (snapshot.secrets ?? [])}
                    ticked={picked}
                    onToggle={toggleKey}
                    onAdd={() => router.push('/key')}
                  />
                </ListSection>
                {snapshot.keysError ? <Note color="$red10">{snapshot.keysError.message}</Note> : null}
                <Note>Ticked keys are attached to the new agent. Its model key is attached on its own.</Note>
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

// The library files templates by folder name, like social-media.
function categoryTitle(category: string): string {
  const words = category.replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function templateDetail(template: TemplateInfo): string | undefined {
  const tasks = template.tasks ?? 0;
  const mcpServers = template.mcpServers ?? 0;
  const skills = template.skills ?? 0;
  const parts = [
    tasks > 0 ? `includes ${tasks} ${tasks === 1 ? 'task' : 'tasks'}, created paused` : null,
    mcpServers > 0 ? `${mcpServers} MCP` : null,
    skills > 0 ? `${skills} skills` : null,
  ].filter((part): part is string => part !== null);
  const lines = [template.description, parts.join(', ')].filter((line) => line !== undefined && line.length > 0);
  return lines.length > 0 ? lines.join('\n') : undefined;
}
