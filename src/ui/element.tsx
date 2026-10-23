import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView } from 'react-native';
import { Text, XStack, YStack, useTheme } from 'tamagui';
import type { UiImage, UiList, UiNode, UiNodeType, UiPager, UiReveal, UiStack, UiText } from '../protocol/index.ts';
import { useElement } from '../store/index.ts';
import type { ElementRef } from '../store/types.ts';
import { Cards, Chevron } from './icons.tsx';

const MAX_IMAGE_WIDTH = 320;
const PLACEHOLDER_HEIGHT = 180;

// Text matches agent messages: body is the chat's 16 on 24.
const TEXT_ROLE = {
  title: { fontSize: '$6', lineHeight: 26, fontWeight: '700', color: '$color' },
  body: { fontSize: '$3', lineHeight: 24, color: '$color' },
  caption: { fontSize: '$1', lineHeight: 20, color: '$color10' },
} as const;

type Renderer<T extends UiNodeType> = (props: { node: Extract<UiNode, { type: T }> }) => React.ReactElement | null;

// The renderer is this table: each component reads only its own node's fields.
const NODES: { [T in UiNodeType]: Renderer<T> } = {
  text: TextNode,
  image: ImageNode,
  stack: StackNode,
  list: ListNode,
  reveal: RevealNode,
  pager: PagerNode,
};

export function elementHref(ref: ElementRef): string {
  return `/element?agent=${encodeURIComponent(ref.agentId)}&id=${encodeURIComponent(ref.id)}`;
}

export function ElementContent({ node }: { node: UiNode }) {
  const Render = NODES[node.type] as (props: { node: UiNode }) => React.ReactElement | null;
  return <Render node={node} />;
}

// The chat row for an element file: it opens the latest copy of that element.
export function ElementLink({ reference }: { reference: ElementRef }) {
  const router = useRouter();
  const theme = useTheme();
  const stored = useElement(reference);
  const title = stored?.element.title ?? 'Element';
  return (
    <XStack
      self="flex-start"
      maxW="100%"
      items="center"
      gap="$3"
      pl="$3"
      pr="$2"
      py="$3"
      rounded="$8"
      bg="$color3"
      role="button"
      aria-label={`Open ${title}`}
      pressStyle={{ bg: '$color4' }}
      onPress={() => router.push(elementHref(reference))}
    >
      <Cards color={theme.color11.val} />
      <YStack shrink={1} gap="$0.5">
        <Text fontWeight="600" numberOfLines={1}>
          {title}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {stored ? stored.element.kind : 'Not on this phone'}
        </Text>
      </YStack>
      <Chevron color={theme.color10.val} />
    </XStack>
  );
}

function TextNode({ node }: { node: UiText }) {
  return <Text {...TEXT_ROLE[node.role ?? 'body']}>{node.text}</Text>;
}

// The image's own aspect ratio sets the height once known; one that fails to load shows its alt text.
function ImageNode({ node }: { node: UiImage }) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setRatio(null);
    setFailed(false);
    Image.getSize(
      node.url,
      (width, height) => {
        if (live && width > 0 && height > 0) setRatio(height / width);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [node.url]);
  if (failed) {
    return (
      <YStack p="$3" rounded="$8" bg="$color4" self="flex-start" maxW="100%">
        <Text fontSize="$2" color="$color11">
          {node.alt}
        </Text>
      </YStack>
    );
  }
  const height = ratio === null ? PLACEHOLDER_HEIGHT : Math.round(MAX_IMAGE_WIDTH * ratio);
  return (
    <Image
      source={{ uri: node.url }}
      accessibilityLabel={node.alt}
      resizeMode="cover"
      onError={() => setFailed(true)}
      style={{ width: MAX_IMAGE_WIDTH, maxWidth: '100%', height, borderRadius: 16, backgroundColor: 'rgba(127,127,127,0.15)' }}
    />
  );
}

function StackNode({ node }: { node: UiStack }) {
  return (
    <YStack gap="$3">
      {node.children.map((child, index) => (
        <ElementContent key={index} node={child} />
      ))}
    </YStack>
  );
}

function ListNode({ node }: { node: UiList }) {
  return (
    <YStack gap="$2">
      {node.items.map((item, index) => (
        <XStack key={index} gap="$2" items="flex-start">
          <Text fontSize="$3" lineHeight={24} color="$color11" minW={20}>
            {node.ordered ? `${index + 1}.` : '•'}
          </Text>
          <YStack flex={1}>
            <ElementContent node={item} />
          </YStack>
        </XStack>
      ))}
    </YStack>
  );
}

// Flips on the phone: a tap shows the back, another the front.
function RevealNode({ node }: { node: UiReveal }) {
  const [back, setBack] = useState(false);
  return (
    <YStack
      minH={200}
      justify="center"
      gap="$4"
      p="$5"
      rounded="$8"
      bg="$color3"
      role="button"
      aria-label={back ? 'Show the front' : 'Show the back'}
      pressStyle={{ bg: '$color4' }}
      onPress={() => setBack((shown) => !shown)}
    >
      <ElementContent node={back ? node.back : node.front} />
      <Text fontSize="$1" color="$color10">
        {back ? 'Tap for the front' : 'Tap to flip'}
      </Text>
    </YStack>
  );
}

// One page at a time, swiped on the phone; the width comes from the space it is given.
function PagerNode({ node }: { node: UiPager }) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  if (node.pages.length === 0) return null;
  return (
    <YStack gap="$3" onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <ScrollView
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => setPage(Math.round(event.nativeEvent.contentOffset.x / width))}
        >
          {node.pages.map((child, index) => (
            <YStack key={index} width={width}>
              <ElementContent node={child} />
            </YStack>
          ))}
        </ScrollView>
      ) : null}
      <Text fontSize="$1" color="$color10" text="center">
        {`${page + 1} of ${node.pages.length}`}
      </Text>
    </YStack>
  );
}
