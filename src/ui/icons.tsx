import Svg, { Circle, Rect } from 'react-native-svg';
import { useTheme } from 'tamagui';

const TEETH = [0, 45, 90, 135, 180, 225, 270, 315];

function useInk(color?: string): string {
  const theme = useTheme();
  return color ?? theme.color.val;
}

// Tamagui's Button passes size and color into an icon element, so both are props with theme fallbacks.
export function Gear({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  // Strokes only, so the middle shows whatever is behind the icon instead of a painted backdrop.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {TEETH.map((angle) => (
        <Rect
          key={angle}
          x={10.6}
          y={1.6}
          width={2.8}
          height={4.6}
          rx={1}
          fill={ink}
          rotation={angle}
          originX={12}
          originY={12}
        />
      ))}
      <Circle cx={12} cy={12} r={6.3} stroke={ink} strokeWidth={3.2} fill="none" />
    </Svg>
  );
}

export function Layers({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={7.2} y={2.2} width={14.6} height={14.6} rx={3.4} stroke={ink} strokeWidth={2} fill="none" />
      <Rect x={2.2} y={7.2} width={14.6} height={14.6} rx={3.4} stroke={ink} strokeWidth={2} fill="none" />
    </Svg>
  );
}
