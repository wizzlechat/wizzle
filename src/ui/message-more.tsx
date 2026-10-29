import { setStringAsync } from 'expo-clipboard';
import { ActionSheetIOS, Alert, Platform } from 'react-native';
import { XStack } from 'tamagui';
import { Ellipsis } from './icons.tsx';
import { plainMessage } from './plain.ts';

// The dots under an agent message: the system's own sheet on iOS, an alert elsewhere.
export function MessageMore({ text, color }: { text: string; color: string }) {
  function open(): void {
    const copy = () => void setStringAsync(plainMessage(text));
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: ['Copy plain text', 'Cancel'], cancelButtonIndex: 1 }, (index) => {
        if (index === 0) copy();
      });
      return;
    }
    Alert.alert('Message', undefined, [
      { text: 'Copy plain text', onPress: copy },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  return (
    <XStack role="button" aria-label="More" hitSlop={8} pressStyle={{ opacity: 0.5 }} onPress={open}>
      <Ellipsis size={18} color={color} />
    </XStack>
  );
}
