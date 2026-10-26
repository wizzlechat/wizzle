import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Paragraph, ScrollView, Text, YStack, useTheme } from 'tamagui';
import type { Secret, SecretChanges, SecretInjection, SecretInput, SecretType } from '../src/protocol/index';
import { useConnection } from '../src/relay/connection';
import { store, useStore } from '../src/store';
import type { SendFailure } from '../src/store/types';
import { Field, Pill } from '../src/ui/controls';
import { Check } from '../src/ui/icons';
import { KeyboardSpace } from '../src/ui/keyboard';
import { SECRET_TYPES } from '../src/ui/keys';
import { ListRow, ListSection, SectionTitle } from '../src/ui/list';
import { ConfirmPrompt } from '../src/ui/topics';

type Mode = 'header' | 'param' | 'pathTemplate' | 'pathRegex';

// OneCLI's four ways of putting a generic key into a request; {value} marks the key.
const MODES: { key: Mode; label: string; detail: string; missing: string }[] = [
  { key: 'header', label: 'Header', detail: 'A request header, like Authorization: Bearer {value}', missing: 'A header needs its name.' },
  { key: 'param', label: 'Query parameter', detail: 'A parameter on the address, like ?key={value}', missing: 'A parameter needs its name.' },
  { key: 'pathTemplate', label: 'Path template', detail: 'Inside the path, like /bot{value}', missing: 'A path template needs {value} in it.' },
  {
    key: 'pathRegex',
    label: 'Path regex',
    detail: 'A pattern rewrites the path; the replacement takes $1 and {value}',
    missing: 'A path regex needs a pattern and a replacement with {value}.',
  },
];

type Form = {
  name: string;
  type: SecretType;
  host: string;
  path: string;
  mode: Mode;
  headerName: string;
  valueFormat: string;
  paramName: string;
  paramFormat: string;
  pathTemplate: string;
  pathRegex: string;
  pathReplacement: string;
  value: string;
};

function formFor(secret: Secret | undefined): Form {
  const injection = secret?.injection;
  const header = injection && 'headerName' in injection ? injection : undefined;
  const param = injection && 'paramName' in injection ? injection : undefined;
  const template = injection && 'pathTemplate' in injection ? injection : undefined;
  const regex = injection && 'pathRegex' in injection ? injection : undefined;
  return {
    name: secret?.name ?? '',
    type: secret?.type ?? 'generic',
    host: secret?.host ?? '',
    path: secret?.path ?? '',
    mode: param ? 'param' : template ? 'pathTemplate' : regex ? 'pathRegex' : 'header',
    headerName: header?.headerName ?? (secret ? '' : 'Authorization'),
    valueFormat: header ? (header.valueFormat ?? '{value}') : 'Bearer {value}',
    paramName: param?.paramName ?? '',
    paramFormat: param?.paramFormat ?? '{value}',
    pathTemplate: template?.pathTemplate ?? '',
    pathRegex: regex?.pathRegex ?? '',
    pathReplacement: regex?.pathReplacement ?? '',
    value: '',
  };
}

// Null while the chosen way is missing a field it needs.
function injectionOf(form: Form): SecretInjection | null {
  const header = form.headerName.trim();
  const valueFormat = form.valueFormat.trim();
  const param = form.paramName.trim();
  const paramFormat = form.paramFormat.trim();
  if (form.mode === 'header') return header ? { headerName: header, ...(valueFormat ? { valueFormat } : {}) } : null;
  if (form.mode === 'param') return param ? { paramName: param, ...(paramFormat ? { paramFormat } : {}) } : null;
  if (form.mode === 'pathTemplate') return form.pathTemplate.trim() ? { pathTemplate: form.pathTemplate.trim() } : null;
  const pathRegex = form.pathRegex.trim();
  const pathReplacement = form.pathReplacement.trim();
  return pathRegex && pathReplacement ? { pathRegex, pathReplacement } : null;
}

function formFailure(form: Form, editing: boolean): string | null {
  if (form.name.trim().length === 0) return 'A key needs a name.';
  if (form.host.trim().length === 0) return 'A key needs a host, like api.github.com.';
  if (form.type === 'generic' && !injectionOf(form)) return MODES.find((one) => one.key === form.mode)?.missing ?? null;
  if (!editing && form.value.length === 0) return 'A key needs its value.';
  return null;
}

function inputOf(form: Form): SecretInput {
  const path = form.path.trim();
  const injection = form.type === 'generic' ? injectionOf(form) : null;
  return {
    name: form.name.trim(),
    type: form.type,
    host: form.host.trim(),
    value: form.value,
    ...(path ? { path } : {}),
    ...(injection ? { injection } : {}),
  };
}

// Only what differs from the saved key; an empty value keeps the stored one.
function changesOf(form: Form, secret: Secret): SecretChanges {
  const changes: SecretChanges = {};
  const name = form.name.trim();
  const host = form.host.trim();
  const path = form.path.trim();
  if (name !== secret.name) changes.name = name;
  if (host !== secret.host) changes.host = host;
  if (path !== (secret.path ?? '')) changes.path = path.length > 0 ? path : null;
  const injection = secret.type === 'generic' ? injectionOf(form) : null;
  if (injection && JSON.stringify(injection) !== JSON.stringify(secret.injection ?? null)) changes.injection = injection;
  if (form.value.length > 0) changes.value = form.value;
  return changes;
}

// Adds a key with ?id= absent, edits the vault key it names otherwise.
export default function KeyForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const conn = useConnection();
  const snapshot = useStore();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const secret = id ? snapshot.secrets?.find((one) => one.id === id) : undefined;
  const [form, setForm] = useState<Form>(() => formFor(secret));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SendFailure | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editing = id !== undefined;
  const set = (change: Partial<Form>) => setForm((current) => ({ ...current, ...change }));
  const tick = <Check color={theme.color.val} />;

  if (editing && !secret) {
    return (
      <>
        <Stack.Screen options={{ title: 'Key' }} />
        <Paragraph p="$4" color="$color11" text="center">
          This key is no longer in the vault.
        </Paragraph>
      </>
    );
  }

  function pickType(type: SecretType): void {
    const defaults = SECRET_TYPES.map((one) => one.host).filter((host): host is string => host !== undefined);
    const host = SECRET_TYPES.find((one) => one.key === type)?.host;
    // A host the user typed stays; one this form filled in follows the type.
    const filled = form.host.trim().length === 0 || defaults.includes(form.host.trim());
    set({ type, ...(filled ? { host: host ?? '' } : {}) });
  }

  function save(): void {
    if (busy) return;
    const failure = formFailure(form, editing);
    if (failure) {
      setError({ code: 'bad_request', message: failure });
      return;
    }
    setBusy(true);
    setError(null);
    let run: Promise<string>;
    if (secret) {
      const changes = changesOf(form, secret);
      run = Object.keys(changes).length === 0 ? Promise.resolve(secret.id) : store.updateSecret(secret.id, changes);
    } else {
      run = store.createSecret(inputOf(form));
    }
    run.then(
      () => router.back(),
      (failed: SendFailure) => {
        setBusy(false);
        setError(failed);
      },
    );
  }

  const connected = conn.phase === 'connected';

  return (
    <>
      <Stack.Screen options={{ title: secret ? secret.name : 'New key' }} />
      <YStack flex={1}>
        <ScrollView keyboardShouldPersistTaps="handled">
          <YStack p="$4" gap="$5">
            <YStack gap="$2">
              <SectionTitle>Name</SectionTitle>
              <Field value={form.name} onChangeText={(name) => set({ name })} placeholder="GitHub" maxLength={255} autoCorrect={false} />
            </YStack>

            {secret ? null : (
              <ListSection title="Type">
                {SECRET_TYPES.map((type) => (
                  <ListRow
                    key={type.key}
                    label={type.label}
                    detail={type.key === 'generic' ? 'Any API key or token' : `A model key for ${type.host}`}
                    trailing={form.type === type.key ? tick : null}
                    onPress={() => pickType(type.key)}
                  />
                ))}
              </ListSection>
            )}

            <YStack gap="$2">
              <SectionTitle>Host</SectionTitle>
              <Field
                value={form.host}
                onChangeText={(host) => set({ host })}
                placeholder="api.github.com"
                maxLength={1000}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <Note>The key is only added to requests for this host. *.example.com covers its subdomains.</Note>
            </YStack>

            <YStack gap="$2">
              <SectionTitle>Path</SectionTitle>
              <Field
                value={form.path}
                onChangeText={(path) => set({ path })}
                placeholder="/v1/*"
                maxLength={1000}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Note>Optional. Limits the key to matching paths on the host.</Note>
            </YStack>

            {form.type === 'generic' ? (
              <YStack gap="$3">
                <ListSection title="Sent as">
                  {MODES.map((mode) => (
                    <ListRow
                      key={mode.key}
                      label={mode.label}
                      detail={mode.detail}
                      detailLines={2}
                      trailing={form.mode === mode.key ? tick : null}
                      onPress={() => set({ mode: mode.key })}
                    />
                  ))}
                </ListSection>
                {form.mode === 'header' ? (
                  <>
                    <Field value={form.headerName} onChangeText={(headerName) => set({ headerName })} placeholder="Authorization" autoCapitalize="none" autoCorrect={false} />
                    <Field value={form.valueFormat} onChangeText={(valueFormat) => set({ valueFormat })} placeholder="Bearer {value}" autoCapitalize="none" autoCorrect={false} />
                    <Note>The header's name, then its value with {'{value}'} where the key goes.</Note>
                  </>
                ) : form.mode === 'param' ? (
                  <>
                    <Field value={form.paramName} onChangeText={(paramName) => set({ paramName })} placeholder="key" autoCapitalize="none" autoCorrect={false} />
                    <Field value={form.paramFormat} onChangeText={(paramFormat) => set({ paramFormat })} placeholder="{value}" autoCapitalize="none" autoCorrect={false} />
                    <Note>The parameter's name, then its value with {'{value}'} where the key goes.</Note>
                  </>
                ) : form.mode === 'pathTemplate' ? (
                  <>
                    <Field value={form.pathTemplate} onChangeText={(pathTemplate) => set({ pathTemplate })} placeholder="/bot{value}" autoCapitalize="none" autoCorrect={false} />
                    <Note>Starts with / and holds {'{value}'} exactly once. A key sent in the path cannot contain / ? # % or spaces.</Note>
                  </>
                ) : (
                  <>
                    <Field value={form.pathRegex} onChangeText={(pathRegex) => set({ pathRegex })} placeholder="^/v1/(.*)$" autoCapitalize="none" autoCorrect={false} />
                    <Field value={form.pathReplacement} onChangeText={(pathReplacement) => set({ pathReplacement })} placeholder="/v1/{value}/$1" autoCapitalize="none" autoCorrect={false} />
                    <Note>The pattern matches the request path; the replacement uses $1 for captures and {'{value}'} for the key.</Note>
                  </>
                )}
              </YStack>
            ) : null}

            <YStack gap="$2">
              <SectionTitle>Value</SectionTitle>
              <Field
                value={form.value}
                onChangeText={(value) => set({ value })}
                placeholder={secret ? 'Leave empty to keep the saved value' : 'Paste the key'}
                maxLength={10_000}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                textContentType="none"
              />
              <Note>Sent once to the bridge host and stored by OneCLI. It is never shown again.</Note>
            </YStack>

            {secret ? (
              <Pill kind="danger" disabled={busy} onPress={() => setConfirmDelete(true)}>
                Delete key
              </Pill>
            ) : null}
          </YStack>
        </ScrollView>

        <YStack gap="$2" px="$4" pt="$2" pb="$4">
          <Pill kind="primary" busy={busy} disabled={!connected} onPress={save}>
            {secret ? 'Save' : 'Add key'}
          </Pill>
          {error ? (
            <Paragraph fontSize="$2" color="$red10">
              {error.message}
            </Paragraph>
          ) : null}
          {!connected ? (
            <Paragraph fontSize="$2" color="$color11">
              Connect to the bridge to save a key.
            </Paragraph>
          ) : null}
        </YStack>
        <KeyboardSpace minimum={insets.bottom} />
        {confirmDelete && secret ? (
          <ConfirmPrompt
            heading={`Delete ${secret.name}?`}
            body={`It leaves the vault and every agent it is attached to, so requests to ${secret.host} go without it.`}
            action="Delete"
            submit={() => store.deleteSecret(secret.id)}
            onClose={() => setConfirmDelete(false)}
            onDone={() => router.back()}
          />
        ) : null}
      </YStack>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <Text px="$4" fontSize="$2" color="$color11">
      {children}
    </Text>
  );
}
