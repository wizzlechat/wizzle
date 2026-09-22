import { useColorScheme } from 'react-native';
import { useMarkdown } from 'react-native-marked';
import { YStack, useTheme } from 'tamagui';

// Agent text is markdown. The nodes render inside our row, so no list ends up inside a list.
export function Markdown({ value }: { value: string }) {
  const scheme = useColorScheme() ?? 'light';
  const theme = useTheme();
  const nodes = useMarkdown(value, {
    colorScheme: scheme,
    theme: {
      colors: {
        text: theme.color.val,
        link: theme.blue10.val,
        code: theme.color3.val,
        border: theme.borderColor.val,
      },
    },
    styles: {
      text: { fontFamily: 'Inter', fontSize: 16, lineHeight: 24 },
      paragraph: { paddingVertical: 2, paddingHorizontal: 0 },
      code: { padding: 10, borderRadius: 8 },
      li: { fontFamily: 'Inter', fontSize: 16, lineHeight: 24 },
    },
  });
  return <YStack gap="$1">{nodes}</YStack>;
}
