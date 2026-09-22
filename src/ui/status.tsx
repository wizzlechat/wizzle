import { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import { Spinner, Text, XStack, YStack, useTheme } from 'tamagui';
import type { Activity } from '../protocol/index.ts';
import type { Phase } from '../relay/connection.ts';

type PhaseStatus = { label: string; banner: string; color: string; busy: boolean };

export const PHASE: Record<Phase, PhaseStatus> = {
  unpaired: { label: 'Not paired', banner: 'No bridge is paired', color: '#8E8E93', busy: false },
  connecting: { label: 'Connecting to relay', banner: 'Connecting to the relay', color: '#8E8E93', busy: true },
  waiting: { label: 'Bridge offline', banner: 'Bridge offline, messages are queued', color: '#FF9F0A', busy: false },
  handshake: { label: 'Securing session', banner: 'Securing the session', color: '#FF9F0A', busy: true },
  connected: { label: 'Connected', banner: 'Connected', color: '#34C759', busy: false },
  failed: { label: 'Rejected by relay', banner: 'The relay rejected this pairing', color: '#FF3B30', busy: false },
};

const PULSE_MS = 900;

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <YStack width={size} height={size} rounded={size / 2} style={{ backgroundColor: color }} />;
}

// Tamagui's react-native driver has no loop preset, so the pulse runs on the same Animated engine.
export function ThinkingDot({ size = 8 }: { size?: number }) {
  const theme = useTheme();
  const pulse = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: PULSE_MS, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: PULSE_MS, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: theme.blue10.val,
        opacity: pulse,
      }}
    />
  );
}

export function StatusDot({ phase, size = 10 }: { phase: Phase; size?: number }) {
  const status = PHASE[phase];
  if (status.busy) return <Spinner size="small" color={status.color} />;
  return <Dot color={status.color} size={size} />;
}

// Only on screen while something is wrong, so a healthy connection stays silent.
export function ConnectionBanner({ phase, error }: { phase: Phase; error: string | null }) {
  if (phase === 'connected') return null;
  return (
    <XStack items="center" gap="$2" px="$4" py="$2" bg="$color3">
      <StatusDot phase={phase} size={8} />
      <Text flex={1} fontSize="$2" color="$color11">
        {error ?? PHASE[phase].banner}
      </Text>
    </XStack>
  );
}

// What the agent is doing right now, in the bridge's own words when it sent any.
export function activityLabel(activity: Activity): string {
  if (activity.label) return activity.label;
  if (activity.state === 'tool') return activity.tool ? `Running ${activity.tool}` : 'Working';
  if (activity.state === 'thinking') return 'Thinking';
  return 'Idle';
}

export function ActivityRow({ activity }: { activity: Activity }) {
  return (
    <XStack items="center" gap="$2" px="$4" py="$2">
      <Spinner size="small" color="$blue10" />
      <Text fontSize="$2" color="$blue10" numberOfLines={1}>
        {activityLabel(activity)}
      </Text>
    </XStack>
  );
}
