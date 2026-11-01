import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView } from 'react-native';
import { Text, XStack, YStack, useTheme } from 'tamagui';
import type { UiArticle, UiImage, UiList, UiNode, UiNodeType, UiPager, UiReveal, UiStack, UiText } from '../protocol/index.ts';
import { store, useElement, useSelector } from '../store/index.ts';
import type { ElementRef, StoredElement } from '../store/types.ts';
import { Cards, Chevron } from './icons.tsx';
import { Markdown } from './markdown.tsx';
import { ConfirmPrompt } from './topics.tsx';

const MAX_IMAGE_WIDTH = 320;
const PLACEHOLDER_HEIGHT = 180;

// Text matches agent messages: body is the chat's 16 on 24.
const TEXT_ROLE = {
  title: { fontSize: '$6', lineHeight: 26, fontWeight: '700', color: '$color' },
  heading: { fontSize: '$5', lineHeight: 24, fontWeight: '700', color: '$color', mt: '$2' },
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
  article: ArticleNode,
};

export function elementHref(ref: ElementRef): string {
  return `/element?agent=${encodeURIComponent(ref.agentId)}&id=${encodeURIComponent(ref.id)}`;
}

export function ElementContent({ node }: { node: UiNode }) {
  const Render = NODES[node.type] as (props: { node: UiNode }) => React.ReactElement | null;
  return <Render node={node} />;
}

// The chat row for an element file: it opens the latest copy of that element, or names the file once deleted.
export function ElementLink({ reference, name }: { reference: ElementRef; name?: string }) {
  const router = useRouter();
  const theme = useTheme();
  const stored = useElement(reference);
  const title = stored?.element.title ?? name ?? 'Element';
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
          {stored ? stored.element.kind : 'Not in wizzle'}
        </Text>
      </YStack>
      <Chevron color={theme.color10.val} />
    </XStack>
  );
}

// Removes wizzle's copy only: the agent keeps its file, and sending it again brings the element back.
export function DeleteElement({ stored, onClose, onDone }: { stored: StoredElement; onClose: () => void; onDone: () => void }) {
  const agentName = useSelector((snapshot) => snapshot.agents.find((agent) => agent.id === stored.agentId)?.name) ?? 'The agent';
  return (
    <ConfirmPrompt
      heading={`Delete ${stored.element.title}?`}
      body={`It goes from wizzle only. ${agentName} keeps its file and can send it again, and the chat keeps its link.`}
      action="Delete"
      submit={async () => {
        store.deleteElement(stored.agentId, stored.element.id);
        return stored.element.id;
      }}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

function TextNode({ node }: { node: UiText }) {
  return <Text {...TEXT_ROLE[node.role ?? 'body']}>{node.text}</Text>;
}

function ImageNode({ node }: { node: UiImage }) {
  return <Picture node={node} width={MAX_IMAGE_WIDTH} />;
}

// An article's cover spans the width it is given, so that width is measured first.
function CoverImage({ node }: { node: UiImage }) {
  const [width, setWidth] = useState(0);
  return (
    <YStack onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? <Picture node={node} width={width} /> : null}
    </YStack>
  );
}

// The image's own aspect ratio sets the height once known; one that fails to load shows its alt text.
function Picture({ node, width }: { node: UiImage; width: number }) {
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
  const height = ratio === null ? PLACEHOLDER_HEIGHT : Math.round(width * ratio);
  return (
    <Image
      source={{ uri: node.url }}
      accessibilityLabel={node.alt}
      resizeMode="cover"
      onError={() => setFailed(true)}
      style={{ width, maxWidth: '100%', height, borderRadius: 16, backgroundColor: 'rgba(127,127,127,0.15)' }}
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

// Flips in wizzle: a tap shows the back, another the front.
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

// One page at a time, swiped in wizzle; the width comes from the space it is given.
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

// A long read: the cover spans the width, the headline sits over the standfirst, and the body is markdown.
function ArticleNode({ node }: { node: UiArticle }) {
  const heading = node.title || node.subtitle || node.byline;
  return (
    <YStack gap="$4">
      {node.cover ? <CoverImage node={node.cover} /> : null}
      {heading ? (
        <YStack gap="$2">
          {node.title ? (
            <Text fontSize="$8" lineHeight={32} fontWeight="700" color="$color">
              {node.title}
            </Text>
          ) : null}
          {node.subtitle ? (
            <Text fontSize="$5" lineHeight={26} color="$color11">
              {node.subtitle}
            </Text>
          ) : null}
          {node.byline ? (
            <Text fontSize="$1" lineHeight={20} color="$color10">
              {node.byline}
            </Text>
          ) : null}
        </YStack>
      ) : null}
      <Markdown value={node.body} />
    </YStack>
  );
}
