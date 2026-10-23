import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';

const EYE_COLOR = '#141414';
const GLANCE_MS = 220;

// Where the eyes may glance, as multiples of the reach.
const GLANCES: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [-1, -1],
  [1, -1],
  [0, 1],
];

// Thinking keeps the gaze up and drifts between these instead of coming back to center.
const PONDERING: Array<[number, number]> = [
  [-1, -1],
  [1, -1],
  [0, -1],
];

// The same agent id always lands on the same hue.
function hue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Plain Views rather than SVG, so the blink and the glance run on the native driver.
export function Face({ seed, size = 20, thinking = false }: { seed: string; size?: number; thinking?: boolean }) {
  const blink = useRef(new Animated.Value(1)).current;
  const lookX = useRef(new Animated.Value(0)).current;
  const lookY = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const color = useMemo(() => `hsl(${hue(seed)}, 55%, 58%)`, [seed]);
  const reach = size * 0.12;

  useEffect(() => {
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let lookTimer: ReturnType<typeof setTimeout> | undefined;

    function shut(): Animated.CompositeAnimation {
      return Animated.sequence([
        Animated.timing(blink, { toValue: 0.1, duration: 70, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 90, useNativeDriver: true }),
      ]);
    }

    function move(x: number, y: number): Animated.CompositeAnimation {
      const easing = Easing.out(Easing.quad);
      return Animated.parallel([
        Animated.timing(lookX, { toValue: x, duration: GLANCE_MS, easing, useNativeDriver: true }),
        Animated.timing(lookY, { toValue: y, duration: GLANCE_MS, easing, useNativeDriver: true }),
      ]);
    }

    function nextBlink(): void {
      blinkTimer = setTimeout(() => {
        const twice = Math.random() < 0.2;
        (twice ? Animated.sequence([shut(), Animated.delay(80), shut()]) : shut()).start(({ finished }) => {
          if (finished) nextBlink();
        });
      }, between(2500, 6000));
    }

    function nextLook(): void {
      if (thinking) {
        const [x, y] = PONDERING[Math.floor(Math.random() * PONDERING.length)] ?? [0, -1];
        Animated.sequence([move(x * reach, y * reach), Animated.delay(between(900, 2000))]).start(({ finished }) => {
          if (finished) nextLook();
        });
        return;
      }
      lookTimer = setTimeout(() => {
        const [x, y] = GLANCES[Math.floor(Math.random() * GLANCES.length)] ?? [0, 0];
        Animated.sequence([move(x * reach, y * reach), Animated.delay(between(600, 1600)), move(0, 0)]).start(({ finished }) => {
          if (finished) nextLook();
        });
      }, between(2000, 5000));
    }

    const bobbing = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    if (thinking) bobbing.start();
    else bob.setValue(0);
    nextBlink();
    nextLook();
    return () => {
      clearTimeout(blinkTimer);
      clearTimeout(lookTimer);
      bobbing.stop();
      blink.stopAnimation();
      lookX.stopAnimation();
      lookY.stopAnimation();
    };
  }, [blink, lookX, lookY, bob, reach, thinking]);

  const eyeWidth = Math.max(3, Math.round(size * 0.16));
  const eye = {
    width: eyeWidth,
    height: Math.round(size * 0.34),
    borderRadius: eyeWidth / 2,
    backgroundColor: EYE_COLOR,
    transform: [{ scaleY: blink }],
  };

  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ translateY: Animated.multiply(bob, size * 0.07) }],
      }}
    >
      <Animated.View style={{ flexDirection: 'row', gap: size * 0.2, transform: [{ translateX: lookX }, { translateY: lookY }] }}>
        <Animated.View style={eye} />
        <Animated.View style={eye} />
      </Animated.View>
    </Animated.View>
  );
}
