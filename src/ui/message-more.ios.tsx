import { Button, Host, Image, Menu } from '@expo/ui/swift-ui';
import { setStringAsync } from 'expo-clipboard';
import { plainMessage } from '../store/store.ts';
import { useAppearance } from './appearance.ts';

// Apple's own menu, opened by a tap on the dots under an agent message.
export function MessageMore({ text, color }: { text: string; color: string }) {
  const appearance = useAppearance();
  return (
    <Host matchContents {...(appearance !== 'system' && { colorScheme: appearance })}>
      <Menu label={<Image systemName="ellipsis" size={18} color={color} />}>
        <Button label="Copy plain text" systemImage="doc.on.doc" onPress={() => void setStringAsync(plainMessage(text))} />
      </Menu>
    </Host>
  );
}
