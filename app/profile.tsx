import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { H4, Paragraph, ScrollView, Text, XStack, YStack } from 'tamagui';
import { store, useStore } from '../src/store';
import { ACCESSORIES, EYE_STYLES, LIST_STYLES, MAX_NAME_CHARS } from '../src/store/store';
import type { Accessory, AgentProfile, EyeStyle, ListStyle } from '../src/store/types';
import { Field, Pill } from '../src/ui/controls';
import { Face, faceColor } from '../src/ui/face';
import { ListRow, ListSection, SectionTitle } from '../src/ui/list';
import { profileTitle } from '../src/ui/titles';

const HUES = [0, 20, 40, 95, 145, 175, 200, 225, 255, 285, 320];
const EYE_LABELS: Record<EyeStyle, string> = { pill: 'Classic', dot: 'Dots', wide: 'Bright', visor: 'Visor' };
const ACCESSORY_LABELS: Record<Accessory, string> = { antenna: 'Antenna', sprout: 'Sprout', bow: 'Bow', crown: 'Crown', halo: 'Halo' };
const LIST_LABELS: Record<ListStyle, string> = { compact: 'Compact', large: 'Large' };

// One agent as this phone sees it: its nickname and look are kept here and never reach the host.
export default function Profile() {
  const { agent: agentId = '' } = useLocalSearchParams<{ agent?: string }>();
  const snapshot = useStore();
  const agent = snapshot.agents.find((one) => one.id === agentId);
  const profile = snapshot.profiles[agentId] ?? {};
  const hostName = agent?.hostName ?? agent?.name ?? '';
  const [nickname, setNickname] = useState(profile.nickname ?? '');

  // Every change carries the nickname being typed, and closing the screen saves it too.
  function save(change: AgentProfile = {}): void {
    if (agent) store.setProfile(agentId, { ...profile, nickname, ...change });
  }
  const saveLatest = useRef(save);
  saveLatest.current = save;
  useEffect(() => () => saveLatest.current(), []);

  function reset(): void {
    setNickname('');
    store.setProfile(agentId, {});
  }

  if (!agent) {
    return (
      <>
        <Stack.Screen options={{ title: profileTitle(snapshot, agentId) }} />
        <Paragraph p="$6" color="$color11" text="center">
          This agent is not on this phone.
        </Paragraph>
      </>
    );
  }

  const eyes = profile.eyes ?? 'pill';
  return (
    <>
      <Stack.Screen options={{ title: profileTitle(snapshot, agentId) }} />
      <ScrollView keyboardShouldPersistTaps="handled">
        <YStack p="$4" pb="$8" gap="$5">
          <YStack items="center" gap="$2" pt="$8">
            <Face seed={agentId} look={profile} size={96} pokable />
            <H4 pt="$3" text="center">
              {agent.name}
            </H4>
            {agent.hostName ? (
              <Text fontSize="$2" color="$color10">
                {`${agent.hostName} on the host`}
              </Text>
            ) : null}
            {agent.description ? (
              <Paragraph color="$color11" text="center">
                {agent.description}
              </Paragraph>
            ) : null}
          </YStack>
          {agent.model ? (
            <ListSection>
              <ListRow label="Model" value={agent.model} />
            </ListSection>
          ) : null}
          <YStack gap="$2">
            <SectionTitle>Nickname</SectionTitle>
            <Field
              value={nickname}
              onChangeText={setNickname}
              placeholder={hostName}
              maxLength={MAX_NAME_CHARS}
              returnKeyType="done"
              onBlur={() => save()}
              onSubmitEditing={() => save()}
            />
            <Text px="$4" fontSize="$2" color="$color10">
              {`Only this phone shows it. The agent still calls itself ${hostName}.`}
            </Text>
          </YStack>
          <YStack gap="$2">
            <SectionTitle>Color</SectionTitle>
            <XStack flexWrap="wrap" gap="$2" px="$2">
              <Swatch color={faceColor(agentId)} label="Default color" picked={profile.hue === undefined} onPress={() => save({ hue: undefined })} />
              {HUES.map((hue) => (
                <Swatch
                  key={hue}
                  color={faceColor(agentId, hue)}
                  label={`Hue ${hue}`}
                  picked={profile.hue === hue}
                  onPress={() => save({ hue })}
                />
              ))}
            </XStack>
          </YStack>
          <YStack gap="$2">
            <SectionTitle>Eyes</SectionTitle>
            <XStack flexWrap="wrap" gap="$2">
              {EYE_STYLES.map((style) => (
                <Choice
                  key={style}
                  label={EYE_LABELS[style]}
                  picked={eyes === style}
                  onPress={() => save({ eyes: style === 'pill' ? undefined : style })}
                >
                  <Face seed={agentId} look={{ ...profile, eyes: style }} size={36} />
                </Choice>
              ))}
            </XStack>
          </YStack>
          <YStack gap="$2">
            <SectionTitle>Accessory</SectionTitle>
            <XStack flexWrap="wrap" gap="$2">
              <Choice label="None" picked={profile.accessory === undefined} onPress={() => save({ accessory: undefined })}>
                <Face seed={agentId} look={{ ...profile, accessory: undefined }} size={36} />
              </Choice>
              {ACCESSORIES.map((kind) => (
                <Choice key={kind} label={ACCESSORY_LABELS[kind]} picked={profile.accessory === kind} onPress={() => save({ accessory: kind })}>
                  <Face seed={agentId} look={{ ...profile, accessory: kind }} size={36} />
                </Choice>
              ))}
            </XStack>
          </YStack>
          <YStack gap="$2">
            <SectionTitle>Agent list style</SectionTitle>
            <XStack gap="$2">
              {LIST_STYLES.map((style) => (
                <Choice
                  key={style}
                  flex={1}
                  label={LIST_LABELS[style]}
                  picked={(profile.listStyle ?? 'compact') === style}
                  onPress={() => save({ listStyle: style === 'compact' ? undefined : style })}
                >
                  <ListPreview style={style} seed={agentId} look={profile} />
                </Choice>
              ))}
            </XStack>
          </YStack>
          {Object.keys(profile).length > 0 || nickname.length > 0 ? <Pill onPress={reset}>Reset to default</Pill> : null}
        </YStack>
      </ScrollView>
    </>
  );
}

function Swatch({ color, label, picked, onPress }: { color: string; label: string; picked: boolean; onPress: () => void }) {
  return (
    <YStack
      p={3}
      rounded={22}
      borderWidth={2}
      borderColor={picked ? '$color11' : 'transparent'}
      role="button"
      aria-label={label}
      aria-selected={picked}
      pressStyle={{ opacity: 0.7 }}
      onPress={onPress}
    >
      <YStack width={32} height={32} rounded={16} style={{ backgroundColor: color }} />
    </YStack>
  );
}

// The face sits low in its tile so an accessory has room above it.
function Choice({
  label,
  picked,
  flex,
  onPress,
  children,
}: {
  label: string;
  picked: boolean;
  flex?: number;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <YStack
      width={flex === undefined ? 78 : undefined}
      flex={flex}
      items="center"
      gap="$2"
      pt={24}
      pb="$2"
      rounded="$6"
      bg="$color3"
      borderWidth={2}
      borderColor={picked ? '$color11' : 'transparent'}
      role="button"
      aria-label={label}
      aria-selected={picked}
      pressStyle={{ bg: '$color4' }}
      onPress={onPress}
    >
      {children}
      <Text fontSize="$1" color="$color11">
        {label}
      </Text>
    </YStack>
  );
}

// A sketch of the agent's list row: a small face beside the name, or a bigger one beside the name and the last message.
function ListPreview({ style, seed, look }: { style: ListStyle; seed: string; look: AgentProfile }) {
  const bar = (width: `${number}%`, strong = false) => <YStack height={6} width={width} rounded={3} bg={strong ? '$color8' : '$color6'} />;
  if (style === 'large') {
    return (
      <XStack width="100%" items="center" gap="$2" px="$3">
        <Face seed={seed} look={look} size={28} />
        <YStack flex={1} gap="$1.5">
          {bar('60%', true)}
          {bar('90%')}
        </YStack>
      </XStack>
    );
  }
  return (
    <YStack width="100%" gap="$1.5" px="$3">
      <XStack items="center" gap="$2">
        <Face seed={seed} look={look} size={14} />
        <YStack flex={1}>{bar('55%', true)}</YStack>
      </XStack>
      {bar('90%')}
    </YStack>
  );
}
