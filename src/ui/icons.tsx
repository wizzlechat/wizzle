import Svg, { Circle, Path, Rect } from 'react-native-svg';
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

// The bridge: Tabler's plug-connected (MIT).
export function Plug({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M7 12l5 5l-1.5 1.5a3.536 3.536 0 1 1 -5 -5l1.5 -1.5" />
      <Path d="M17 12l-5 -5l1.5 -1.5a3.536 3.536 0 1 1 5 5l-1.5 1.5" />
      <Path d="M3 21l2.5 -2.5" />
      <Path d="M18.5 5.5l2.5 -2.5" />
      <Path d="M10 11l-2 2" />
      <Path d="M13 14l-2 2" />
    </Outline>
  );
}

export function Dots({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={5} r={2} fill={ink} />
      <Circle cx={12} cy={12} r={2} fill={ink} />
      <Circle cx={12} cy={19} r={2} fill={ink} />
    </Svg>
  );
}

// Three dots in a row, the shape iOS uses for a message's own menu.
export function Ellipsis({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={5} cy={12} r={2} fill={ink} />
      <Circle cx={12} cy={12} r={2} fill={ink} />
      <Circle cx={19} cy={12} r={2} fill={ink} />
    </Svg>
  );
}

export function Paperclip({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke={ink}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

export function Close({ size = 14, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M6 6l12 12M18 6L6 18" stroke={ink} strokeWidth={2.4} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

export function Plus({ size = 20, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={10.8} y={4} width={2.4} height={16} rx={1.2} fill={ink} />
      <Rect x={4} y={10.8} width={16} height={2.4} rx={1.2} fill={ink} />
    </Svg>
  );
}

export type Icon = (props: { size?: number; color?: string }) => React.ReactElement;

// Outline icons share one stroke, set once on the Svg and inherited by every shape.
function Outline({ size, ink, children }: { size: number; ink: string; children: React.ReactNode }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      stroke={ink}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    >
      {children}
    </Svg>
  );
}

export function Mic({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Rect x={9} y={2} width={6} height={12} rx={3} />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </Outline>
  );
}

export function ArrowUp({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M12 19V5M5 12l7-7 7 7" />
    </Outline>
  );
}

export function Chevron({ size = 18, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M9 18l6-6-6-6" />
    </Outline>
  );
}

export function Check({ size = 20, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M20 6L9 17l-5-5" />
    </Outline>
  );
}

export function Contrast({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 3a9 9 0 0 1 0 18z" fill={ink} stroke="none" />
    </Outline>
  );
}

export function Bell({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
    </Outline>
  );
}

export function Letters({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </Outline>
  );
}

export function Swap({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M8 3L4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />
    </Outline>
  );
}

export function Trash({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Outline>
  );
}

export function Copy({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Rect x={8} y={8} width={14} height={14} rx={2} />
      <Path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
    </Outline>
  );
}

export function Stop({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={6} y={6} width={12} height={12} rx={2.5} fill={ink} />
    </Svg>
  );
}

export function Speaker({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M11 5L6 9H2v6h4l5 4V5zM15.54 8.46a5 5 0 0 1 0 7.07M19.07 4.93a10 10 0 0 1 0 14.14" />
    </Outline>
  );
}

export function Key({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Circle cx={7.5} cy={15.5} r={5.5} />
      <Path d="M21 2l-9.6 9.6M15.5 7.5l2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
    </Outline>
  );
}

export function Pencil({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M4 20h4L19 9a2.83 2.83 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />
    </Outline>
  );
}

export function Pause({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Rect x={6} y={4} width={4} height={16} rx={1} />
      <Rect x={14} y={4} width={4} height={16} rx={1} />
    </Outline>
  );
}

export function Play({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M6 4l14 8-14 8z" />
    </Outline>
  );
}

export function Restart({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" />
    </Outline>
  );
}

export function Photo({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Rect x={3} y={3} width={18} height={18} rx={2} />
      <Circle cx={9} cy={9} r={2} />
      <Path d="M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </Outline>
  );
}

export function File({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6" />
    </Outline>
  );
}

export function ChatPlus({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM12 7v6M9 10h6" />
    </Outline>
  );
}

// Two stacked cards: agent made elements.
export function Cards({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Path d="M8 3h11a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 8v11a2 2 0 0 0 2 2h11" />
    </Outline>
  );
}

export function Clock({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Circle cx={12} cy={12} r={9} />
      <Path d="M12 7v5l3 2" />
    </Outline>
  );
}

// Two heads: the members of a room.
export function People({ size = 22, color }: { size?: number; color?: string }) {
  const ink = useInk(color);
  return (
    <Outline size={size} ink={ink}>
      <Circle cx={9} cy={8} r={3.5} />
      <Path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
    </Outline>
  );
}
