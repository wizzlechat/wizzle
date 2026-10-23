import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { useTheme } from 'tamagui';
import type { Activity } from '../protocol/index.ts';
import { Face } from './face.tsx';
import { activityLabel } from './status.tsx';

const ROW_HEIGHT = 36;
const MAX_CHARS = 48;
const SHIMMER_MS = 1800;
// The face arrives from and leaves to somewhere in this window, right of its spot and down behind the input.
const DRIFT = 140;
const DROP = 48;

type Spot = { x: number; rotate: number };

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomSpot(): Spot {
  return { x: between(20, DRIFT), rotate: between(-25, 25) };
}

// Blends a #rrggbb color toward another; any other format comes back unchanged.
function mix(from: string, to: string, amount: number): string {
  const a = /^#([0-9a-f]{6})$/i.exec(from)?.[1];
  const b = /^#([0-9a-f]{6})$/i.exec(to)?.[1];
  if (!a || !b) return from;
  const channel = (i: number) => {
    const x = parseInt(a.slice(i, i + 2), 16);
    const y = parseInt(b.slice(i, i + 2), 16);
    return Math.round(x + (y - x) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(2)}${channel(4)}`;
}

// The agent's face and its activity above the input; it rises from behind the input and drops back when done.
export function ThinkingRow({ activity, seed }: { activity: Activity | null; seed: string }) {
  const active = activity !== null;
  const current = activity ? activityLabel(activity) : null;
  const [label, setLabel] = useState<string | null>(null);
  const [spot, setSpot] = useState<Spot>(randomSpot);
  const height = useRef(new Animated.Value(0)).current;
  const fly = useRef(new Animated.Value(0)).current;
  const shown = useRef(false);

  useEffect(() => {
    if (current) setLabel(current);
  }, [current]);

  useEffect(() => {
    if (active === shown.current) return;
    shown.current = active;
    setSpot(randomSpot());
    if (active) {
      Animated.parallel([
        Animated.timing(height, { toValue: ROW_HEIGHT, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: false }),
        Animated.spring(fly, { toValue: 1, friction: 6, tension: 70, useNativeDriver: true }),
      ]).start();
      return;
    }
    Animated.timing(fly, { toValue: 0, duration: 280, easing: Easing.in(Easing.quad), useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      Animated.timing(height, { toValue: 0, duration: 160, useNativeDriver: false }).start(({ finished: closed }) => {
        if (closed) setLabel(null);
      });
    });
  }, [active, fly, height]);

  const faceStyle = {
    opacity: fly.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' as const }),
    transform: [
      { translateX: fly.interpolate({ inputRange: [0, 1], outputRange: [spot.x, 0] }) },
      { translateY: fly.interpolate({ inputRange: [0, 1], outputRange: [DROP, 0] }) },
      { scale: fly.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
      { rotate: fly.interpolate({ inputRange: [0, 1], outputRange: [`${spot.rotate}deg`, '0deg'] }) },
    ],
  };
  const textOpacity = fly.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' });

  return (
    <Animated.View style={{ height }}>
      {label !== null ? (
        <View style={{ height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18 }}>
          <Animated.View style={faceStyle}>
            <Face seed={seed} thinking />
          </Animated.View>
          <Animated.View style={{ flexShrink: 1, overflow: 'hidden', opacity: textOpacity }}>
            <Shimmer text={label} />
          </Animated.View>
        </View>
      ) : null}
    </Animated.View>
  );
}

// Each letter brightens as a band of lighter blue sweeps across from left to right.
function Shimmer({ text }: { text: string }) {
  const theme = useTheme();
  const wave = useRef(new Animated.Value(0)).current;
  const base = theme.blue10.val;
  const light = mix(base, '#ffffff', 0.45);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wave, { toValue: 1, duration: SHIMMER_MS, easing: Easing.linear, useNativeDriver: false }),
        Animated.delay(300),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [wave]);

  const chars = Array.from(text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS - 3)}...` : text);
  const last = Math.max(1, chars.length - 1);
  return (
    <View style={{ flexDirection: 'row' }}>
      {chars.map((char, index) => {
        // The band runs from just before the first letter to just past the last, in wave units.
        const peak = (index / last + 0.4) / 1.8;
        const color = wave.interpolate({
          inputRange: [peak - 0.2, peak, peak + 0.2],
          outputRange: [base, light, base],
          extrapolate: 'clamp',
        });
        return (
          <Animated.Text key={index} style={{ color, fontFamily: 'Inter', fontSize: 15 }}>
            {char}
          </Animated.Text>
        );
      })}
    </View>
  );
}
