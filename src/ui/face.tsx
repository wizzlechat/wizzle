import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { useThemeName } from 'tamagui';
import type { Accessory, AgentProfile, EyeStyle } from '../store/types.ts';
import { useSleeping } from './sleeping.ts';

const EYE_COLOR = '#141414';
const GLANCE_MS = 220;
const ZZZ_MS = 3600;
const GOLD = '#f4c430';
const NEON = '#39ff14';
// On a light background the neon reads washed out, so the letters go a shade deeper there and keep the glow.
const NEON_DEEP = '#17b800';
const GLOW = 'rgba(57, 255, 20, 0.85)';
// Nothing said in an agent's conversations for this long and its face dozes off.
const SLEEP_MS = 7 * 24 * 60 * 60_000;
// Asleep, the face slumps to this share of its height.
const SLUMP = 0.45;

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

// Each Z starts this far through the loop, so up to three are on their way up at once.
const ZZZ_PHASES = [0, 1 / 3, 2 / 3];
// Points along the rise where the arc is sampled; native interpolation is straight between them.
const ARC_STEPS = [0, 0.2, 0.4, 0.6, 0.8, 1];

// The same agent id always lands on the same hue.
function hue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

export function faceColor(seed: string, chosen?: number): string {
  return `hsl(${chosen ?? hue(seed)}, 55%, 58%)`;
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// Asleep once lastAt is SLEEP_MS old; the timer lets a screen nobody touches still doze off.
export function useAsleep(lastAt: number | undefined, busy: boolean): boolean {
  const enabled = useSleeping();
  const [asleep, setAsleep] = useState(() => enabled && !busy && lastAt !== undefined && lastAt + SLEEP_MS <= Date.now());
  useEffect(() => {
    if (!enabled || busy || lastAt === undefined) {
      setAsleep(false);
      return;
    }
    const left = lastAt + SLEEP_MS - Date.now();
    if (left <= 0) {
      setAsleep(true);
      return;
    }
    setAsleep(false);
    const timer = setTimeout(() => setAsleep(true), left);
    return () => clearTimeout(timer);
  }, [enabled, lastAt, busy]);
  return asleep;
}

function eyeStyle(style: EyeStyle, size: number): ViewStyle {
  const shape = (width: number, height: number): ViewStyle => ({ width, height, borderRadius: Math.min(width, height) / 2 });
  if (style === 'dot') return shape(Math.max(3, Math.round(size * 0.2)), Math.max(3, Math.round(size * 0.2)));
  if (style === 'wide') return shape(Math.max(4, Math.round(size * 0.24)), Math.round(size * 0.3));
  if (style === 'visor') return shape(Math.round(size * 0.6), Math.max(3, Math.round(size * 0.18)));
  return shape(Math.max(3, Math.round(size * 0.16)), Math.round(size * 0.34));
}

const EYE_GAP: Record<EyeStyle, number> = { pill: 0.2, dot: 0.22, wide: 0.14, visor: 0 };

// Plain Views rather than SVG, so the blink and the glance run on the native driver; only the accessory is SVG.
export function Face({
  seed,
  look,
  size = 20,
  thinking = false,
  asleep = false,
  hopAt,
  pokable = false,
}: {
  seed: string;
  look?: AgentProfile;
  size?: number;
  thinking?: boolean;
  asleep?: boolean;
  // A rise in this time after the first one seen is a reply arriving, and the face hops.
  hopAt?: number;
  pokable?: boolean;
}) {
  const blink = useRef(new Animated.Value(1)).current;
  const lookX = useRef(new Animated.Value(0)).current;
  const lookY = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  const breath = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;
  const squint = useRef(new Animated.Value(0)).current;
  const zzz = useRef(new Animated.Value(0)).current;
  const slump = useRef(new Animated.Value(0)).current;
  // A face that was seen awake slumps over slowly; one that mounts asleep is slumped from the start.
  const seenAwake = useRef(false);
  const lastHop = useRef(hopAt);
  const color = useMemo(() => faceColor(seed, look?.hue), [seed, look?.hue]);
  const eyes = look?.eyes ?? 'pill';
  const sleeping = asleep && !thinking;
  const reach = size * 0.12;

  useEffect(() => {
    if (sleeping) {
      blink.setValue(1);
      lookX.setValue(0);
      lookY.setValue(0);
      bob.setValue(0);
      const breathing = Animated.loop(
        Animated.sequence([
          Animated.timing(breath, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(breath, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      );
      const drifting = Animated.loop(Animated.timing(zzz, { toValue: 1, duration: ZZZ_MS, easing: Easing.linear, useNativeDriver: true }));
      if (seenAwake.current) {
        Animated.timing(slump, { toValue: 1, duration: 1200, easing: Easing.inOut(Easing.quad), useNativeDriver: true }).start();
      } else {
        slump.setValue(1);
      }
      breathing.start();
      drifting.start();
      return () => {
        breathing.stop();
        drifting.stop();
        breath.setValue(0);
        zzz.setValue(0);
        slump.setValue(0);
      };
    }
    seenAwake.current = true;

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
  }, [blink, lookX, lookY, bob, breath, zzz, slump, reach, thinking, sleeping]);

  useEffect(() => {
    const before = lastHop.current;
    lastHop.current = hopAt;
    if (before === undefined || hopAt === undefined || hopAt <= before) return;
    hop.setValue(0);
    Animated.sequence([
      Animated.timing(hop, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(hop, { toValue: 0, friction: 4, tension: 140, useNativeDriver: true }),
    ]).start();
  }, [hopAt, hop]);

  function poke(): void {
    squint.stopAnimation();
    Animated.sequence([
      Animated.timing(squint, { toValue: 1, duration: 90, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.delay(260),
      Animated.spring(squint, { toValue: 0, friction: 5, tension: 120, useNativeDriver: true }),
    ]).start();
  }

  const swell = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  // Asleep, the face slumps down and spreads a little, its bottom edge staying put.
  const flat = slump.interpolate({ inputRange: [0, 1], outputRange: [1, SLUMP] });
  const spread = slump.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });
  const body = {
    width: size,
    height: size,
    transform: [{ translateY: Animated.add(Animated.multiply(bob, size * 0.07), Animated.multiply(hop, -size * 0.45)) }],
  };
  const shape = {
    flex: 1,
    // Asleep, the top rounds into a dome and the bottom corners stay tight, so the slumped face sits like a mound.
    borderTopLeftRadius: size * (sleeping ? 0.5 : 0.32),
    borderTopRightRadius: size * (sleeping ? 0.5 : 0.32),
    borderBottomLeftRadius: size * (sleeping ? 0.14 : 0.32),
    borderBottomRightRadius: size * (sleeping ? 0.14 : 0.32),
    backgroundColor: color,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    transform: [
      { translateY: Animated.multiply(slump, (size * (1 - SLUMP)) / 2) },
      {
        scaleX: Animated.multiply(
          spread,
          Animated.add(swell, squint.interpolate({ inputRange: [0, 1], outputRange: [0, 0.08] })),
        ),
      },
      { scaleY: Animated.multiply(flat, Animated.add(swell, squint.interpolate({ inputRange: [0, 1], outputRange: [0, -0.08] }))) },
    ],
  };
  const eye = {
    ...eyeStyle(eyes, size),
    backgroundColor: EYE_COLOR,
    transform: [{ scaleY: Animated.multiply(blink, squint.interpolate({ inputRange: [0, 1], outputRange: [1, 0.2] })) }],
  };
  const closed = {
    width: eyes === 'visor' ? Math.round(size * 0.6) : Math.max(3, Math.round(size * 0.2)),
    height: Math.max(1.25, size * 0.045),
    borderRadius: size * 0.02,
    backgroundColor: EYE_COLOR,
  };
  const count = eyes === 'visor' ? 1 : 2;

  // The eyes undo the slump's squash so they stay drawn at full size; the accessory rides down on top of it.
  const face = (
    <View style={{ width: size, height: size }}>
      <Animated.View style={body}>
        <Animated.View style={shape}>
          <Animated.View
            style={{
              flexDirection: 'row',
              gap: size * EYE_GAP[eyes],
              transform: [{ translateX: lookX }, { translateY: lookY }, { scaleY: Animated.divide(1, flat) }],
            }}
          >
            {Array.from({ length: count }, (_, i) =>
              sleeping ? (
                <View key={i} style={closed} />
              ) : (
                <Animated.View key={i} style={eye}>
                  {eyes === 'wide' ? <Glint size={size} /> : null}
                </Animated.View>
              ),
            )}
          </Animated.View>
        </Animated.View>
        {look?.accessory ? (
          <Animated.View
            pointerEvents="none"
            style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, transform: [{ translateY: Animated.multiply(slump, size * (1 - SLUMP)) }] }}
          >
            <Wearing kind={look.accessory} size={size} color={color} />
          </Animated.View>
        ) : null}
      </Animated.View>
      {sleeping ? <Zzz drift={zzz} size={size} /> : null}
    </View>
  );

  if (!pokable) return face;
  return (
    <Pressable onPress={poke} hitSlop={12} aria-label="Poke">
      {face}
    </Pressable>
  );
}

function Glint({ size }: { size: number }) {
  const dot = Math.max(1.5, size * 0.08);
  return (
    <View style={{ position: 'absolute', top: size * 0.04, right: size * 0.03, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: '#ffffff' }} />
  );
}

// Drawn in a 20 by 12 box whose y 9 is the top edge of the face.
function Wearing({ kind, size, color }: { kind: Accessory; size: number; color: string }) {
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: -size * 0.45, width: size, height: size * 0.6 }}>
      <Svg width={size} height={size * 0.6} viewBox="0 0 20 12">
        {kind === 'antenna' ? (
          <>
            <Path d="M10 9.5 L11.6 3.6" stroke={EYE_COLOR} strokeWidth={1.1} strokeLinecap="round" />
            <Circle cx={11.9} cy={2.6} r={1.8} fill={color} stroke={EYE_COLOR} strokeWidth={0.8} />
          </>
        ) : kind === 'sprout' ? (
          <>
            <Path d="M10 9.5 C10 8 10 6.8 10.2 5.6" stroke="#3f8f4f" strokeWidth={1} strokeLinecap="round" fill="none" />
            <Path d="M10.2 5.8 C8 6 6.4 4.6 6.4 2.8 C8.6 2.8 10.2 4 10.2 5.8 Z" fill="#5cb85c" />
            <Path d="M10.2 5.4 C11.8 5.3 13.2 4 13.2 2.4 C11.4 2.4 10.2 3.6 10.2 5.4 Z" fill="#7ccf6e" />
          </>
        ) : kind === 'bow' ? (
          <>
            <Path d="M14.6 9.2 C12.6 7 11.2 7.4 11.4 9.2 C11.2 11 12.6 11.4 14.6 9.2 Z" fill="#ff6fa8" />
            <Path d="M14.6 9.2 C16.6 7 18 7.4 17.8 9.2 C18 11 16.6 11.4 14.6 9.2 Z" fill="#ff6fa8" />
            <Circle cx={14.6} cy={9.2} r={1} fill="#e04f8c" />
          </>
        ) : kind === 'crown' ? (
          <>
            <Path d="M5.6 10 L5.6 4.6 L8 7 L10 3.4 L12 7 L14.4 4.6 L14.4 10 Z" fill={GOLD} stroke="#d9a514" strokeWidth={0.5} strokeLinejoin="round" />
            <Circle cx={5.6} cy={4.4} r={0.7} fill={GOLD} />
            <Circle cx={10} cy={3.2} r={0.8} fill={GOLD} />
            <Circle cx={14.4} cy={4.4} r={0.7} fill={GOLD} />
          </>
        ) : (
          <Ellipse cx={10} cy={5.6} rx={5.6} ry={1.5} stroke={GOLD} strokeWidth={1.2} fill="none" />
        )}
      </Svg>
    </View>
  );
}

// Neon block Z's in a column over the head, rising and fading out at the top.
function Zzz({ drift, size }: { drift: Animated.Value; size: number }) {
  const dark = useThemeName().startsWith('dark');
  // Grows with the face within these limits, so a big face never gives off huge ones.
  const fontSize = Math.min(14, Math.max(9, Math.round(size * 0.35)));
  const rise = fontSize * 2.2;
  const letters = useMemo(
    () =>
      ZZZ_PHASES.map((phase) => {
        // A phase-shifted copy of the loop that wraps back to zero, so all three share one animation.
        const progress =
          phase === 0
            ? drift
            : drift.interpolate({ inputRange: [0, 1 - phase, 1 - phase + 0.001, 1], outputRange: [phase, 1, 0, phase] });
        return {
          opacity: progress.interpolate({ inputRange: [0, 0.12, 0.6, 1], outputRange: [0, 1, 1, 0] }),
          transform: [
            // Leftward along a quarter sine while rising evenly, so each Z bends up as it goes.
            { translateX: progress.interpolate({ inputRange: ARC_STEPS, outputRange: ARC_STEPS.map((t) => -Math.sin((t * Math.PI) / 2) * rise * 0.6) }) },
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -rise] }) },
            // Small as it appears, largest midway, and smallest of all as it fades out at the top.
            { scale: progress.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.4, 1, 0.3] }) },
          ],
        };
      }),
    [drift, rise],
  );
  const letter = {
    position: 'absolute' as const,
    color: dark ? NEON : NEON_DEEP,
    fontFamily: 'InterExtraBold',
    fontSize,
    lineHeight: Math.round(fontSize * 1.2),
    textShadowColor: GLOW,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: fontSize * 0.5,
  };
  // A Z is about 0.65 of its font size wide, so this puts its right edge just left of the head's middle.
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: size * 0.45 - fontSize * 0.65, top: size * (1.05 - SLUMP) - fontSize }}>
      {letters.map((style, i) => (
        <Animated.Text key={i} style={[letter, style]}>
          Z
        </Animated.Text>
      ))}
    </View>
  );
}
