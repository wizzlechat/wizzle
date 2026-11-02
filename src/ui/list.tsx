import { StyleSheet } from 'react-native';
import { Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import { Chevron, type Icon } from './icons.tsx';

export const LINE = StyleSheet.hairlineWidth;

// Every row draws its own bottom line, and the card clips the last one.
export function ListCard({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <YStack rounded="$8" bg="$color3" overflow="hidden">
      {title ? (
        <Text px="$4" pt="$3" pb="$1" fontSize="$2" fontWeight="600" color="$color10" numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      <YStack mb={-LINE}>{children}</YStack>
    </YStack>
  );
}

// A count on a list row: unread messages or open questions.
export function Badge({ count }: { count: number }) {
  return (
    <XStack theme="accent" bg="$color9" rounded="$10" px="$2" items="center">
      <Text fontSize="$1" color="$color1" fontWeight="700">
        {count}
      </Text>
    </XStack>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return (
    <Text px="$4" fontSize="$2" color="$color10">
      {children}
    </Text>
  );
}

export function ListSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <YStack gap="$2">
      {title ? <SectionTitle>{title}</SectionTitle> : null}
      <ListCard>{children}</ListCard>
    </YStack>
  );
}

// The line starts at the label, so it runs under the text and not under the icon.
export function ListRow({
  icon: Glyph,
  leading,
  label,
  detail,
  detailLines = 1,
  value,
  trailing,
  chevron,
  danger,
  busy,
  disabled,
  onPress,
  onLongPress,
}: {
  icon?: Icon;
  leading?: React.ReactNode;
  label: string;
  detail?: string;
  detailLines?: number;
  value?: string;
  trailing?: React.ReactNode;
  chevron?: boolean;
  danger?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const live = onPress !== undefined && !disabled && !busy;
  return (
    <XStack
      pl="$4"
      items="center"
      gap="$3"
      role={onPress ? 'button' : undefined}
      aria-label={label}
      opacity={disabled ? 0.5 : 1}
      pressStyle={live ? { bg: '$color4' } : undefined}
      onPress={live ? onPress : undefined}
      onLongPress={live ? onLongPress : undefined}
    >
      {Glyph ? <Glyph size={22} color={danger ? theme.red10.val : theme.color11.val} /> : leading}
      <XStack flex={1} items="center" gap="$2" minH={52} py="$3" pr="$4" borderBottomWidth={LINE} borderColor="$color5">
        <YStack flex={1} gap="$1">
          <Text color={danger ? '$red10' : '$color'} numberOfLines={1}>
            {label}
          </Text>
          {detail ? (
            <Text fontSize="$2" color="$color10" numberOfLines={detailLines}>
              {detail}
            </Text>
          ) : null}
        </YStack>
        {value ? (
          <Text maxW="60%" color="$color10" numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {trailing}
        {busy ? <Spinner size="small" /> : chevron ? <Chevron color={theme.color10.val} /> : null}
      </XStack>
    </XStack>
  );
}
