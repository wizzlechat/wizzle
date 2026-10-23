import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';

// Takes up the room the keyboard covers, frame by frame, including while a drag pulls the keyboard down.
export function KeyboardSpace({ minimum = 0 }: { minimum?: number }) {
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: Math.max(-height.value, minimum) }), [minimum]);
  return <Reanimated.View style={style} />;
}

// Rests `rest` points above the screen bottom and sits on the keyboard's top edge once the keyboard is higher than that.
export function KeyboardRider({
  rest,
  style,
  onLayout,
  children,
}: {
  rest: number;
  style?: StyleProp<ViewStyle>;
  onLayout?: ViewProps['onLayout'];
  children: React.ReactNode;
}) {
  const { height } = useReanimatedKeyboardAnimation();
  const ride = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, height.value + rest) }] }), [rest]);
  return (
    <Reanimated.View style={[style, ride]} onLayout={onLayout}>
      {children}
    </Reanimated.View>
  );
}
