import { Button, Text, XStack } from 'tamagui';

// One line across the top of a screen, with an optional button on the right; red for an error.
export function Banner({
  children,
  leading,
  action,
  onAction,
  danger,
}: {
  children: string;
  leading?: React.ReactNode;
  action?: string;
  onAction?: () => void;
  danger?: boolean;
}) {
  return (
    <XStack theme={danger ? 'red' : undefined} items="center" gap="$2" px="$4" py="$2" bg="$color3">
      {leading}
      <Text flex={1} fontSize="$2" color="$color11">
        {children}
      </Text>
      {action ? (
        <Button size="$1" chromeless onPress={onAction}>
          {action}
        </Button>
      ) : null}
    </XStack>
  );
}
