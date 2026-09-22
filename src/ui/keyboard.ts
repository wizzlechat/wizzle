import { useEffect, useState } from 'react';
import { Keyboard, LayoutAnimation, Platform, useWindowDimensions, type KeyboardEvent } from 'react-native';

// How much of the window the keyboard covers. Android resizes the window itself, so it stays at zero there.
export function useKeyboardInset(): number {
  const { height } = useWindowDimensions();
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const onFrame = (event: KeyboardEvent): void => {
      LayoutAnimation.configureNext({ duration: event.duration || 250, update: { type: 'keyboard' } });
      setInset(Math.max(height - event.endCoordinates.screenY, 0));
    };
    const change = Keyboard.addListener('keyboardWillChangeFrame', onFrame);
    const hide = Keyboard.addListener('keyboardWillHide', onFrame);
    return () => {
      change.remove();
      hide.remove();
    };
  }, [height]);
  return inset;
}
