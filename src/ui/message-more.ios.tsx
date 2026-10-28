import { Button, Host, Image, Menu } from '@expo/ui/swift-ui';
import { contentShape, frame, shapes } from '@expo/ui/swift-ui/modifiers';
import { setStringAsync } from 'expo-clipboard';
import { XStack } from 'tamagui';
import { plainMessage } from '../store/store.ts';
import { useAppearance } from './appearance.ts';

const GLYPH = 18;
// The ellipsis glyph is only a few points tall, so the menu's label gets a tap area this big around it.
const TAP = 36;

// Apple's own menu, opened by a tap on the dots under an agent message.
export function MessageMore({ text, color }: { text: string; color: string }) {
  const appearance = useAppearance();
  // The negative margin keeps the dots taking the same room as the copy and speaker icons beside them.
  return (
    <XStack m={-(TAP - GLYPH) / 2}>
      <Host matchContents {...(appearance !== 'system' && { colorScheme: appearance })}>
        <Menu
          label={
            <Image
              systemName="ellipsis"
              size={GLYPH}
              color={color}
              modifiers={[frame({ width: TAP, height: TAP }), contentShape(shapes.rectangle())]}
            />
          }
        >
          <Button label="Copy plain text" systemImage="doc.on.doc" onPress={() => void setStringAsync(plainMessage(text))} />
        </Menu>
      </Host>
    </XStack>
  );
}
