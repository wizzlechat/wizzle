import { Stack } from 'expo-router';
import { ScrollView, YStack, useTheme } from 'tamagui';
import { APPEARANCES, setAppearance, useAppearance } from '../src/ui/appearance';
import { Check } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';

export default function Appearance() {
  const appearance = useAppearance();
  const theme = useTheme();

  return (
    <>
      <Stack.Screen options={{ title: 'Appearance' }} />
      <ScrollView>
        <YStack p="$4">
          <ListSection>
            {APPEARANCES.map((option) => (
              <ListRow
                key={option.key}
                label={option.label}
                trailing={appearance === option.key ? <Check color={theme.color.val} /> : null}
                onPress={() => setAppearance(option.key)}
              />
            ))}
          </ListSection>
        </YStack>
      </ScrollView>
    </>
  );
}
