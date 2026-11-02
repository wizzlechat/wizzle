import { GlassView, isGlassEffectAPIAvailable } from 'expo-glass-effect';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Button, Input, Spinner, Text, XStack, YStack, useTheme, useThemeName } from 'tamagui';
import { pickFiles, pickPhotos, type Picked } from '../files/pick.ts';
import { MAX_ATTACHMENTS, attachmentFailure, store } from '../store/index.ts';
import type { Attachment } from '../store/types.ts';
import { useDictation } from './dictation.ts';
import { ArrowUp, Close, File, Mic, Photo, Plus, Stop } from './icons.tsx';
import { ListRow } from './list.tsx';
import { MentionPicker, addressees, mentionQuery, type RoomContext } from './room-chat.tsx';
import { useMessageFont } from './text-size.ts';
import { fileSize } from './time.ts';
import { Menu } from './topics.tsx';

// iOS 26 and later draw the input bar in Liquid Glass; elsewhere it stays a solid pill.
const GLASS = isGlassEffectAPIAvailable();
const BAR_RADIUS = 26;

export type ComposerState = ReturnType<typeof useComposer>;

// The draft, its files and the mic for one chat; files picked but never sent leave with the screen.
export function useComposer(conv: string) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const dictation = useDictation(draft, setDraft);
  const unsent = useRef<Attachment[]>([]);
  unsent.current = attachments;
  useEffect(() => () => unsent.current.forEach((one) => store.unattach(one)), []);

  function submit(): void {
    if (!store.send(conv, draft, attachments)) return;
    dictation.cancel();
    setDraft('');
    unsent.current = [];
    setAttachments([]);
    setError(null);
  }

  // Each pick is copied into the app's files folder, then measured against the limits.
  async function add(pick: () => Promise<Picked[]>): Promise<void> {
    setAttaching(true);
    try {
      let current = attachments;
      for (const picked of await pick()) {
        const early = attachmentFailure(current, picked);
        if (early) {
          setError(early.message);
          break;
        }
        const kept = await store.attach(conv, picked);
        if (!kept) {
          setError(`${picked.name} could not be copied.`);
          break;
        }
        const failure = attachmentFailure(current, kept);
        if (failure) {
          store.unattach(kept);
          setError(failure.message);
          break;
        }
        current = [...current, kept];
        setError(null);
      }
      setAttachments(current);
    } finally {
      setAttaching(false);
    }
  }

  function drop(attachment: Attachment): void {
    store.unattach(attachment);
    setAttachments((current) => current.filter((one) => one.uri !== attachment.uri));
    setError(null);
  }

  return { draft, setDraft, attachments, error, dismissError: () => setError(null), attaching, dictation, submit, add, drop };
}

// The input bar: errors and picked files above a pill holding the text and its three round buttons.
// In a room it also offers members for the @ being typed and says who the draft wakes.
export function Composer({
  composer,
  canAttach,
  nativeID,
  onAttach,
  onLayout,
  room,
}: {
  composer: ComposerState;
  canAttach: boolean;
  nativeID: string;
  onAttach: () => void;
  onLayout: (height: number) => void;
  room?: RoomContext;
}) {
  const theme = useTheme();
  const dark = useThemeName().startsWith('dark');
  const font = useMessageFont();
  const { draft, setDraft, attachments, error, dismissError, attaching, dictation, submit, drop } = composer;
  const [cursor, setCursor] = useState<number | null>(null);
  const query = room ? mentionQuery(draft, cursor ?? draft.length) : null;
  function pick(handle: string): void {
    if (!query) return;
    const end = query.start + query.query.length + 1;
    setDraft(`${draft.slice(0, query.start)}@${handle} ${draft.slice(end)}`);
    setCursor(query.start + handle.length + 2);
  }
  return (
    <YStack px="$3" pt="$1" pb="$2" gap="$2" onLayout={(event) => onLayout(event.nativeEvent.layout.height)}>
      {room && query ? <MentionPicker query={query.query} context={room} onPick={pick} /> : null}
      {room && draft.trim().length > 0 ? (
        <Text px="$2" fontSize="$1" color="$color10">
          {addressees(draft, room.members)}
        </Text>
      ) : null}
      {error ? <ComposerError onDismiss={dismissError}>{error}</ComposerError> : null}
      {dictation.error ? <ComposerError onDismiss={dictation.dismiss}>{dictation.error}</ComposerError> : null}
      {attachments.length > 0 ? (
        <XStack gap="$2" flexWrap="wrap">
          {attachments.map((attachment) => (
            <Chip key={attachment.uri} attachment={attachment} onRemove={() => drop(attachment)} />
          ))}
        </XStack>
      ) : null}
      <YStack gap="$1" rounded={BAR_RADIUS} bg={GLASS ? undefined : '$color3'} borderWidth={GLASS ? 0 : 1} borderColor="$color5">
        {GLASS ? <GlassView colorScheme={dark ? 'dark' : 'light'} style={[StyleSheet.absoluteFill, { borderRadius: BAR_RADIUS }]} /> : null}
        <Input
          unstyled
          multiline
          minH={44}
          maxH={120}
          pt="$3"
          pb="$1.5"
          px="$3.5"
          fontSize={font.fontSize}
          color="$color"
          placeholderTextColor="$color10"
          value={draft}
          onChangeText={(next) => {
            // A typed edit takes over from the mic, so nothing heard later overwrites it.
            dictation.cancel();
            setDraft(next);
          }}
          onSelectionChange={(event) => setCursor(event.nativeEvent.selection.end)}
          placeholder={room ? 'Message the room' : 'Ask anything'}
          nativeID={nativeID}
          onSubmitEditing={submit}
          submitBehavior="submit"
        />
        <XStack items="center" gap="$2" px={10} pb={10}>
          {canAttach ? (
            <BarButton label="Attach a file" disabled={attaching || attachments.length >= MAX_ATTACHMENTS} onPress={onAttach}>
              {attaching ? <Spinner size="small" /> : <Plus />}
            </BarButton>
          ) : null}
          <YStack flex={1} />
          <BarButton
            label={dictation.state === 'idle' ? 'Dictate' : 'Stop dictation'}
            active={dictation.state === 'listening'}
            wide={dictation.state !== 'idle'}
            onPress={dictation.toggle}
          >
            {dictation.state === 'starting' ? (
              <Spinner size="small" />
            ) : dictation.state === 'listening' ? (
              <Stop size={18} color="white" />
            ) : (
              <Mic size={20} />
            )}
          </BarButton>
          <BarButton label="Send" send disabled={attaching || (draft.trim().length === 0 && attachments.length === 0)} onPress={submit}>
            <ArrowUp size={20} color={theme.color1.val} />
          </BarButton>
        </XStack>
      </YStack>
    </YStack>
  );
}

// Where a file comes from; the caller closes the menu and hands the pick to the composer.
export function AttachMenu({
  remaining,
  onPick,
  onClose,
}: {
  remaining: number;
  onPick: (pick: () => Promise<Picked[]>) => void;
  onClose: () => void;
}) {
  return (
    <Menu title="Attach" onClose={onClose}>
      <ListRow icon={Photo} label="Photo library" onPress={() => onPick(() => pickPhotos(remaining))} />
      <ListRow icon={File} label="Files" onPress={() => onPick(pickFiles)} />
    </Menu>
  );
}

function ComposerError({ children, onDismiss }: { children: string; onDismiss: () => void }) {
  return (
    <XStack items="center" gap="$2" px="$2">
      <Text flex={1} fontSize="$2" color="$red10">
        {children}
      </Text>
      <Button size="$1" chromeless onPress={onDismiss}>
        Dismiss
      </Button>
    </XStack>
  );
}

// The bar's round buttons; send is the same shape a little wider, in the text color so it stands out.
function BarButton({
  label,
  send,
  active,
  wide,
  disabled,
  onPress,
  children,
}: {
  label: string;
  send?: boolean;
  active?: boolean;
  wide?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  children: React.ReactNode;
}) {
  const live = onPress !== undefined && !disabled;
  return (
    <YStack
      width={send || wide ? 52 : 36}
      transition="quick"
      animateOnly={['width', 'backgroundColor']}
      height={36}
      rounded={18}
      items="center"
      justify="center"
      bg={active ? '$red10' : send ? '$color12' : GLASS ? '$color01' : '$color5'}
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
