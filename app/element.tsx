import { Stack, useLocalSearchParams } from 'expo-router';
import { Paragraph, ScrollView, Text, YStack } from 'tamagui';
import { useElement, useStore } from '../src/store';
import { ElementContent } from '../src/ui/element';

// One element, opened from its chat link or a list; always the latest copy the phone holds.
export default function ElementScreen() {
  const params = useLocalSearchParams<{ agent: string; id: string }>();
  const stored = useElement({ agentId: params.agent ?? '', id: params.id ?? '' });
  const snapshot = useStore();
  const agentName = snapshot.agents.find((agent) => agent.id === stored?.agentId)?.name;

  return (
    <>
      <Stack.Screen options={{ title: stored?.element.title ?? 'Element' }} />
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
            This element is not on this phone.
          </Paragraph>
        )}
      </ScrollView>
    </>
  );
}
