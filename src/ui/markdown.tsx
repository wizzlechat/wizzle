import { useMemo, type ReactNode } from 'react';
import { Text, useColorScheme, type TextStyle } from 'react-native';
import { Renderer, useMarkdown } from 'react-native-marked';
import { YStack, useTheme } from 'tamagui';
import { mentionSpans, type Mentionable } from '../protocol/index.ts';
import { messageFont, useTextSize, type TextSize } from './text-size.ts';

// In a room, who a mention names and the color it is drawn in; null is @all.
export type MentionStyle = { members: Mentionable[]; color: (id: string | null) => string };

// Plain text runs split around each @mention, which is drawn bold in its member's color.
class MentionRenderer extends Renderer {
  private readonly mentions: MentionStyle;

  constructor(mentions: MentionStyle) {
    super();
    this.mentions = mentions;
  }

  override text(text: string | ReactNode[], styles?: TextStyle): ReactNode {
    if (typeof text !== 'string') return super.text(text, styles);
    const spans = mentionSpans(text, this.mentions.members);
    if (spans.length === 0) return super.text(text, styles);
    const parts: ReactNode[] = [];
    let at = 0;
    for (const span of spans) {
      if (span.start > at) parts.push(text.slice(at, span.start));
      parts.push(
        <Text key={this.getKey()} style={{ fontWeight: '700', color: this.mentions.color(span.id) }}>
          {text.slice(span.start, span.end)}
        </Text>,
      );
      at = span.end;
    }
    if (at < text.length) parts.push(text.slice(at));
    return super.text(parts, styles);
  }
}

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
export function Markdown({ value, mentions }: { value: string; mentions?: MentionStyle }) {
  const scheme = useColorScheme() ?? 'light';
  const size = useTextSize();
  const theme = useTheme();
  const text = theme.color.val;
  const link = theme.blue10.val;
  const code = theme.color3.val;
  const border = theme.borderColor.val;
  const colors = useMemo(() => ({ colors: { text, link, code, border } }), [text, link, code, border]);
  const renderer = useMemo(() => (mentions ? new MentionRenderer(mentions) : undefined), [mentions]);
  const nodes = useMarkdown(value, { colorScheme: scheme, theme: colors, styles: stylesFor(size), ...(renderer && { renderer }) });
  return <YStack gap="$1">{nodes}</YStack>;
}
