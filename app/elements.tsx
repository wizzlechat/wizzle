import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Paragraph, ScrollView, YStack } from 'tamagui';
import { useStore } from '../src/store';
import type { StoredElement } from '../src/store/types';
import { DeleteElement, elementHref } from '../src/ui/element';
import { Cards } from '../src/ui/icons';
import { ListRow, ListSection } from '../src/ui/list';
import { shortTime } from '../src/ui/time';

// Every element in wizzle grouped by kind, newest kind first; with ?agent= only that agent's.
export default function Elements() {
  const { agent } = useLocalSearchParams<{ agent?: string }>();
  const snapshot = useStore();
  const router = useRouter();
  const [doomed, setDoomed] = useState<StoredElement | null>(null);
  const nameOf = (agentId: string) => snapshot.agents.find((one) => one.id === agentId)?.name ?? 'Unknown agent';
  const shown = snapshot.elements.filter((stored) => !agent || stored.agentId === agent);
  const kinds = new Map<string, StoredElement[]>();
  for (const stored of shown) {
    const list = kinds.get(stored.element.kind);
    if (list) list.push(stored);
    else kinds.set(stored.element.kind, [stored]);
  }

  return (
    <>
      <Stack.Screen options={{ title: agent ? `${nameOf(agent)} elements` : 'Elements' }} />
      <YStack flex={1}>
        <ScrollView>
          <YStack p="$4" gap="$6">
            {shown.length === 0 ? (
              <Paragraph color="$color11" text="center">
                No elements yet. Ask an agent for flash cards or a daily report.
              </Paragraph>
            ) : (
              [...kinds].map(([kind, list]) => (
                <ListSection key={kind} title={kind}>
                  {list.map((stored) => (
                    <ListRow
                      key={`${stored.agentId}/${stored.element.id}`}
                      icon={Cards}
                      label={stored.element.title}
                      detail={agent ? shortTime(stored.receivedAt) : `${nameOf(stored.agentId)}, ${shortTime(stored.receivedAt)}`}
                      chevron
                      onPress={() => router.push(elementHref({ agentId: stored.agentId, id: stored.element.id }))}
                      onLongPress={() => setDoomed(stored)}
                    />
                  ))}
                </ListSection>
              ))
            )}
          </YStack>
        </ScrollView>
        {doomed ? <DeleteElement stored={doomed} onClose={() => setDoomed(null)} onDone={() => setDoomed(null)} /> : null}
      </YStack>
    </>
  );
}
