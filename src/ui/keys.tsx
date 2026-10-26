import { useEffect, useRef } from 'react';
import { useTheme } from 'tamagui';
import type { Secret, SecretType } from '../protocol/index.ts';
import type { StoreSnapshot } from '../store/types.ts';
import { Check, Plus } from './icons.tsx';
import { ListRow } from './list.tsx';

// OneCLI's own setup files model keys under these hosts.
export const SECRET_TYPES: { key: SecretType; label: string; host?: string }[] = [
  { key: 'generic', label: 'Generic' },
  { key: 'anthropic', label: 'Anthropic', host: 'api.anthropic.com' },
  { key: 'openai', label: 'OpenAI', host: 'api.openai.com' },
];

// Where a key goes and how it is sent, in one line.
export function secretDetail(secret: Secret): string {
  const where = `${secret.host}${secret.path ?? ''}`;
  if (secret.type !== 'generic') return `${where}, ${SECRET_TYPES.find((one) => one.key === secret.type)?.label} model key`;
  const injection = secret.injection;
  if (!injection) return where;
  if ('headerName' in injection) return `${where}, ${injection.headerName} header`;
  if ('paramName' in injection) return `${where}, ${injection.paramName} parameter`;
  return `${where}, in the path`;
}

// Calls back once for each key this phone creates while the screen is open.
export function useAddedSecret(newest: StoreSnapshot['newestSecret'], onAdded: (id: string) => void): void {
  const seen = useRef(newest?.seq ?? 0);
  useEffect(() => {
    if (!newest || newest.seq <= seen.current) return;
    seen.current = newest.seq;
    onAdded(newest.id);
  }, [newest, onAdded]);
}

// The vault as tick rows, with a row to add a key; null secrets is a listing still on its way.
export function KeyRows({
  secrets,
  ticked,
  busy,
  onToggle,
  onAdd,
}: {
  secrets: Secret[] | null;
  ticked: ReadonlySet<string>;
  busy?: ReadonlySet<string>;
  onToggle: (secretId: string) => void;
  onAdd: () => void;
}) {
  const theme = useTheme();
  return (
    <>
      {secrets === null ? <ListRow label="Loading keys" busy /> : null}
      {(secrets ?? []).map((secret) => (
        <ListRow
          key={secret.id}
          label={secret.name}
          detail={secretDetail(secret)}
          trailing={ticked.has(secret.id) ? <Check color={theme.color.val} /> : null}
          busy={busy?.has(secret.id)}
          onPress={() => onToggle(secret.id)}
        />
      ))}
      <ListRow icon={Plus} label="Add key" onPress={onAdd} />
    </>
  );
}
