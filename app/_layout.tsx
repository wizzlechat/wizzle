import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { TamaguiProvider, useTheme } from 'tamagui';
import { startPush } from '../src/push';
import { connection } from '../src/relay/connection';
import '../src/store';
import { useAppearance } from '../src/ui/appearance';
import { useAppFonts } from '../src/ui/fonts';
import { tamaguiConfig } from '../tamagui.config';

// useColorScheme also reports null or unspecified, and treating those as light flips every screen
// and the native header for that frame, so the last real answer is kept instead.
function useScheme(): 'light' | 'dark' {
  const scheme = useColorScheme();
  const appearance = useAppearance();
  const last = useRef<'light' | 'dark'>('light');
  if (scheme === 'light' || scheme === 'dark') last.current = scheme;
  return appearance === 'system' ? last.current : appearance;
}

export default function RootLayout() {
  const scheme = useScheme();
  const fontsReady = useAppFonts();
  useEffect(() => {
    connection.start();
    const stopPush = startPush();
    // Background closes the socket so the relay pushes instead of writing to a phone that is gone.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') connection.suspend();
      if (state === 'active') {
        connection.resume();
        connection.wake();
      }
    });
    return () => {
      sub.remove();
      stopPush();
    };
  }, []);
  if (!fontsReady) return null;
  return (
    <KeyboardProvider>
      <TamaguiProvider config={tamaguiConfig} defaultTheme={scheme}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <RootStack />
      </TamaguiProvider>
    </KeyboardProvider>
  );
}

// The native header takes its colors from the Tamagui theme so it matches the screens.
function RootStack() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.background.val },
        headerTintColor: theme.color.val,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.background.val },
      }}
    >
      {/* An element opens over whatever linked to it. */}
      <Stack.Screen name="element" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
