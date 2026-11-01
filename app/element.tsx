import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Button, Paragraph, ScrollView, Text, YStack } from 'tamagui';
import { useElement, useStore } from '../src/store';
import { DeleteElement, ElementContent } from '../src/ui/element';
import { Trash } from '../src/ui/icons';

// One element, opened from its chat link or a list; always the latest copy wizzle holds.
export default function ElementScreen() {
  const params = useLocalSearchParams<{ agent: string; id: string }>();
  const router = useRouter();
  const stored = useElement({ agentId: params.agent ?? '', id: params.id ?? '' });
  const snapshot = useStore();
  const [deleting, setDeleting] = useState(false);
  const agentName = snapshot.agents.find((agent) => agent.id === stored?.agentId)?.name;

  const deleteButton = (
    <Button size="$3" circular chromeless scaleIcon={1.3} aria-label="Delete element" icon={<Trash />} onPress={() => setDeleting(true)} />
  );

  return (
    <>
      <Stack.Screen options={{ title: stored?.element.title ?? 'Element', ...(stored && { headerRight: () => deleteButton }) }} />
      <YStack flex={1}>
        <ScrollView>
          {stored ? (
            <YStack p="$4" gap="$4">
              <Text fontSize="$1" color="$color10">
                {agentName ? `${stored.element.kind}, from ${agentName}` : stored.element.kind}
              </Text>
              <ElementContent node={stored.element.content} />
            </YStack>
          ) : (
            <Paragraph p="$6" color="$color11" text="center">
              This element is not in wizzle.
            </Paragraph>
          )}
        </ScrollView>
        {deleting && stored ? (
          <DeleteElement
            stored={stored}
            onClose={() => setDeleting(false)}
            onDone={() => {
              setDeleting(false);
              if (router.canGoBack()) router.back();
              else router.replace('/');
            }}
          />
        ) : null}
      </YStack>
    </>
  );
}
