import { setStringAsync } from 'expo-clipboard';
import { Alert } from 'react-native';
import { XStack } from 'tamagui';
import { plainMessage } from '../store/store.ts';
import { Dots } from './icons.tsx';

// Apple's menu is iOS only; elsewhere the same choice comes up as a system alert.
export function MessageMore({ text, color }: { text: string; color: string }) {
  function open(): void {
    Alert.alert('Message', undefined, [
      { text: 'Copy plain text', onPress: () => void setStringAsync(plainMessage(text)) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  return (
    <XStack role="button" aria-label="More" hitSlop={8} pressStyle={{ opacity: 0.5 }} onPress={open}>
      <Dots size={18} color={color} />
    </XStack>
  );
}
