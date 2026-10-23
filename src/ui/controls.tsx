import { Input, Spinner, Text, XStack, useTheme, type InputProps } from 'tamagui';
import type { Icon } from './icons.tsx';

export type PillKind = 'primary' | 'secondary' | 'danger';

// Primary is the input bar's send button in pill form; secondary is its round grey buttons.
export function Pill({
  children,
  kind = 'secondary',
  small,
  icon: Glyph,
  busy,
  disabled,
  flex,
  onPress,
}: {
  children: string;
  kind?: PillKind;
  small?: boolean;
  icon?: Icon;
  busy?: boolean;
  disabled?: boolean;
  flex?: number;
  onPress?: () => void;
}) {
  const theme = useTheme();
  const live = onPress !== undefined && !disabled && !busy;
  const ink = kind === 'primary' ? theme.color1.val : kind === 'danger' ? theme.red10.val : theme.color.val;
  return (
    <XStack
      flex={flex}
      height={small ? 30 : 44}
      px={small ? '$3' : '$5'}
      gap="$2"
      rounded={small ? 15 : 22}
      items="center"
      justify="center"
      bg={kind === 'primary' ? '$color12' : '$color5'}
      opacity={disabled ? 0.4 : 1}
      role="button"
      aria-label={children}
      aria-disabled={disabled}
      pressStyle={live ? { opacity: 0.7 } : undefined}
      onPress={live ? onPress : undefined}
    >
      {busy ? (
        <Spinner size="small" color={ink} />
      ) : (
        <>
          {Glyph ? <Glyph size={small ? 16 : 18} color={ink} /> : null}
          <Text fontSize={small ? '$2' : '$3'} fontWeight="600" numberOfLines={1} style={{ color: ink }}>
            {children}
          </Text>
        </>
      )}
    </XStack>
  );
}

// Text fields share the input bar's rounded look.
export function Field(props: InputProps) {
  return (
    <Input
      unstyled
      minH={48}
      px="$4"
      py="$3"
      rounded="$8"
      bg="$color3"
      borderWidth={1}
      borderColor="$color5"
      fontSize="$4"
      color="$color"
      placeholderTextColor="$color10"
      {...props}
    />
  );
}
