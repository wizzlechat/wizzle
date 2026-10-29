import { useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useMarkdown } from 'react-native-marked';
import { YStack, useTheme } from 'tamagui';
import { messageFont, useTextSize, type TextSize } from './text-size.ts';

// One object per text size: react-native-marked re-parses whenever its styles or theme change identity.
const styles = new Map<TextSize, ReturnType<typeof build>>();

function build(size: TextSize) {
  const font = messageFont(size);
  return {
    text: { fontFamily: 'Inter', ...font },
    paragraph: { paddingVertical: 2, paddingHorizontal: 0 },
    code: { padding: 10, borderRadius: 8 },
    li: { fontFamily: 'Inter', ...font },
  };
}

function stylesFor(size: TextSize) {
  let built = styles.get(size);
  if (!built) {
    built = build(size);
    styles.set(size, built);
  }
  return built;
}

// Agent text is markdown. The nodes render inside our row, so no list ends up inside a list.
export function Markdown({ value }: { value: string }) {
  const scheme = useColorScheme() ?? 'light';
  const size = useTextSize();
  const theme = useTheme();
  const text = theme.color.val;
  const link = theme.blue10.val;
  const code = theme.color3.val;
  const border = theme.borderColor.val;
  const colors = useMemo(() => ({ colors: { text, link, code, border } }), [text, link, code, border]);
  const nodes = useMarkdown(value, { colorScheme: scheme, theme: colors, styles: stylesFor(size) });
  return <YStack gap="$1">{nodes}</YStack>;
}
