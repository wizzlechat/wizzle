import { Stack } from 'expo-router';
import { ScrollView, Text, YStack, useTheme } from 'tamagui';
import { Check } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';
import { TEXT_SIZES, setTextSize, useMessageFont, useTextSize } from '../src/ui/text-size';

export default function TextSizeScreen() {
  const size = useTextSize();
  const font = useMessageFont();
  const theme = useTheme();

  return (
    <>
      <Stack.Screen options={{ title: 'Message text size' }} />
      <ScrollView>
        <YStack p="$4" gap="$4">
          <ListSection>
            {TEXT_SIZES.map((option) => (
              <ListRow
                key={option.key}
                label={option.label}
                trailing={size === option.key ? <Check color={theme.color.val} /> : null}
                onPress={() => setTextSize(option.key)}
              />
            ))}
          </ListSection>
          <YStack px="$4" py="$3" rounded="$8" bg="$color3">
            <Text {...font}>Agents reply at this size, and so does what you send them.</Text>
          </YStack>
        </YStack>
      </ScrollView>
    </>
  );
}
